const pool = require('../config/db');
const { getDownloadUrl, uploadPhoto } = require('../config/s3');

const crearJugador = async (req, res) => {
    try {
        const { equipo_id, nombre, apellidos, apodo, posicion, lesionado, activo, foto_url } = req.body;

        const query = 'INSERT INTO jugadores (nombre, apellidos, apodo, posicion, lesionado, activo, equipo_id, foto_url) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *';
        const { rows } = await pool.query(query, [nombre, apellidos, apodo, posicion, lesionado, activo, equipo_id, foto_url]);

        if (req.file) {
            await uploadPhoto(req.file, 'jugadores');
        }

        res.status(200).json({
            ok: true,
            message: 'Jugador creado exitosamente',
            data: rows[0]
        });
    } catch (error) {
        console.error('Error al crear jugador:', error);
        res.status(500).json({
            ok: false,
            message: 'Error al crear jugador'
        });
    }
}

const editarJugador = async (req, res) => {
    try {
        const { id, equipo_id, nombre, apellidos, apodo, posicion, lesionado, activo, foto_url } = req.body;

        const query = 'UPDATE jugadores SET equipo_id = $1, nombre = $2, apellidos = $3, apodo = $4, posicion = $5, lesionado = $6, activo = $7, foto_url = $8 WHERE id = $9 RETURNING *';
        const { rows } = await pool.query(query, [equipo_id, nombre, apellidos, apodo, posicion, lesionado, activo, foto_url, id]);

        if (req.file) {
            await uploadPhoto(req.file, 'jugadores');
        }

        res.status(200).json({
            ok: true,
            message: 'Jugador editado exitosamente',
            data: rows[0]
        })
    } catch (error) {
        console.error('Error al editar jugador:', error);
        res.status(500).json({
            ok: false,
            message: 'Error al editar jugador'
        });
    }
}


const getRanking = async (req, res) => {
    try {
        const query = `
            SELECT J.nombre, J.apellidos, J.apodo, J.posicion, J.foto_url,
            E.nombre AS equipo, EJ.goles, EJ.goles_en_propia, EJ.goles_encajados,
            EJ.goles_penalti, EJ.jugador_id, EJ.partidos_jugados, EJ.partidos_titular,
            EJ.partidos_suplente, EJ.tarjetas_amarillas, EJ.tarjetas_rojas
            FROM estadisticas_jugadores EJ
            INNER JOIN jugadores J ON J.id = EJ.jugador_id
            INNER JOIN equipos E ON E.id = J.equipo_id
            WHERE EJ.goles > 0
            ORDER BY EJ.goles DESC
        `;

        const { rows } = await pool.query(query);

        const rankingProcesado = await Promise.all(
            rows.map(async (jugador) => {
                const fotoUrl = await getDownloadUrl('jugadores/' + jugador.foto_url);
                jugador.foto = fotoUrl;

                return jugador;
            })
        );

        res.status(200).json({
            ok: true,
            data: rankingProcesado
        });

    } catch (error) {
        console.error('Error al obtener clasificación:', error);
        res.status(500).json({
            ok: false,
            message: 'Error al obtener la clasificación'
        });
    }
}

function calcularPuntosJugador({
    posicion,          // 'POR', 'DEF', 'MED', 'DEL'
    esTitular,         // true / false
    esSuplente,        // true / false
    resultado,         // 'VICTORIA', 'EMPATE', 'DERROTA'
    golesJugador,      // Array de goles marcados por el jugador: [{ tipo: 'NORMAL'|'PENALTI'|'PROPIA' }]
    tarjetasJugador,   // Array de tarjetas del jugador: [{ tipo: 'AMARILLA'|'DOBLE AMARILLA'|'ROJA' }]
    golesEncajados,    // Goles encajados por su equipo en el partido
    golesAFavor,       // Goles marcados por su equipo en el partido
    esDestacado        // true / false (si fue nominado como jugador destacado)
}) {
    let total = 0;
    const desglose = {
        participacion: null,
        resultado: null,
        goles: [],
        tarjetas: [],
        bonusEquipo: [],
        destacado: null
    }

    // 1. PARTICIPACIÓN (Titular / Suplente)
    if (esTitular) {
        total += 2;
        desglose.participacion = { concepto: 'Titular', puntos: 2 };
    } else if (esSuplente) {
        total += 1;
        desglose.participacion = { concepto: 'Suplente', puntos: 1 };
    }

    // 2. RESULTADO DEL PARTIDO
    if (resultado === 'VICTORIA') {
        total += 2;
        desglose.resultado = { concepto: 'Partido Ganado', puntos: 2 };
    } else if (resultado === 'EMPATE') {
        total += 1;
        desglose.resultado = { concepto: 'Partido Empatado', puntos: 1 };
    } else {
        desglose.resultado = { concepto: 'Partido Perdido', puntos: 0 };
    }

    // 3. GOLES MARCADOS POR EL JUGADOR
    for (const gol of golesJugador) {
        let golesMarcados = 0;
        if (gol.tipo === 'PROPIA') {
            total -= 1;
            desglose.goles.push({ concepto: 'Gol en P.P.', puntos: -1 });
        } else if (gol.tipo === 'PENALTI') {
            total += 2;
            desglose.goles.push({ concepto: 'Gol de Penalti', puntos: 2 });
        } else {
            // Gol normal según posición
            let ptsGol = 0;
            switch (posicion) {
                case 'DEL': ptsGol = 3; break;
                case 'MED': ptsGol = 4; break;
                case 'DEF': ptsGol = 5; break;
                case 'POR': ptsGol = 10; break;
            }
            total += ptsGol;
            golesMarcados += 1;
            desglose.goles.push({ concepto: `Goles`, puntos: ptsGol });
        }
    }

    // 4. TARJETAS
    const amarillas = tarjetasJugador.filter(t => t.tipo === 'AMARILLA').length;
    const doblesAmarillas = tarjetasJugador.filter(t => t.tipo === 'DOBLE AMARILLA').length;
    const rojas = tarjetasJugador.filter(t => t.tipo === 'ROJA').length;

    if (amarillas === 1 && rojas === 0) {
        total -= 1;
        desglose.tarjetas.push({ concepto: 'Tarjeta amarilla', puntos: -1 });
    } else if (doblesAmarillas >= 1) {
        // Doble amarilla que deriva en expulsión
        total -= 2;
        desglose.tarjetas.push({ concepto: 'Doble tarjeta amarilla', puntos: -2 });
    } else if (rojas >= 1 && doblesAmarillas === 0) {
        total -= 3;
        desglose.tarjetas.push({ concepto: 'Roja directa', puntos: -3 });
    }

    // 5. REGLAS POR POSICIÓN (DEF Y POR)
    if (posicion === 'DEF' || posicion === 'POR') {
        // Portería a cero
        if (golesEncajados === 0) {
            total += 3;
            desglose.bonusEquipo.push({ concepto: 'Portería a Cero', puntos: 3 });
        }
        // Encajar 3 o más goles
        if (golesEncajados >= 3) {
            total -= 2;
            desglose.bonusEquipo.push({ concepto: 'Encajar 3 o más goles', puntos: -2 });
        }
    }

    // 6. REGLAS POR POSICIÓN (MED Y DEL)
    if (posicion === 'MED' || posicion === 'DEL') {
        // Equipo marca 3 o más goles
        if (golesAFavor >= 3) {
            total += 2;
            desglose.bonusEquipo.push({ concepto: 'Equipo marca 3 o más goles', puntos: 2 });
        }
    }

    // 7. JUGADOR DESTACADO
    if (esDestacado) {
        total += 3;
        desglose.destacado = { concepto: 'Jugador destacado del partido', puntos: 3 };
    }

    return {
        puntosTotales: total,
        desglose: desglose
    };
}

module.exports = { crearJugador, editarJugador, getRanking, calcularPuntosJugador };