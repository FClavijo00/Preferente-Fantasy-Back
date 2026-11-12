const pool = require('../config/db');
const crypto = require('node:crypto');
const { getDownloadUrl, uploadPhoto, deletePhoto } = require('../config/s3');

/* ==========================================================================
   Crear / editar jugador (panel de control, solo admin)
   - Los datos llegan como FormData (texto): se validan y convierten aquí.
   - El nombre del fichero de la foto lo pone el SERVIDOR, nunca el navegador:
     así no se puede pisar la foto de otro jugador (ni ningún otro fichero).
   ========================================================================== */

const POSICIONES = ['POR', 'DEF', 'MED', 'DEL'];
const TAMANO_MAX_FOTO = 3 * 1024 * 1024; // 3 MB (el recorte del front genera ~30 KB)

const aBooleano = (valor, porDefecto) => {
    if (valor === undefined || valor === null || valor === '') return porDefecto;
    return valor === true || valor === 'true' || valor === '1' || valor === 1;
};

const textoLimpio = (valor) => (typeof valor === 'string' ? valor.trim() : '');

/** Valida y normaliza los datos del formulario. Devuelve { datos } o { error }. */
const leerDatosJugador = (body) => {
    const datos = {
        equipo_id: Number(body.equipo_id),
        nombre: textoLimpio(body.nombre),
        apellidos: textoLimpio(body.apellidos),
        apodo: textoLimpio(body.apodo) || null,
        posicion: textoLimpio(body.posicion).toUpperCase(),
        lesionado: aBooleano(body.lesionado, false),
        activo: aBooleano(body.activo, true),
    };

    if (!Number.isInteger(datos.equipo_id)) return { error: 'Elige el equipo del jugador.' };
    if (!datos.nombre) return { error: 'El nombre es obligatorio.' };
    if (!datos.apellidos) return { error: 'Los apellidos son obligatorios.' };
    if (!POSICIONES.includes(datos.posicion)) return { error: 'La posición no es válida.' };
    if ([datos.nombre, datos.apellidos, datos.apodo].some((t) => t && t.length > 60)) {
        return { error: 'Nombre, apellidos y apodo: 60 caracteres como máximo.' };
    }
    return { datos };
};

const validarFoto = (file) => {
    if (!file) return null;
    if (!file.mimetype || !file.mimetype.startsWith('image/')) return 'La foto debe ser una imagen.';
    if (file.size > TAMANO_MAX_FOTO) return 'La foto es demasiado grande (máximo 3 MB).';
    return null;
};

/** Sube la foto con un nombre generado en el servidor y devuelve ese nombre (foto_url). */
const subirFotoJugador = async (file) => {
    const nombre = `jugador_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.webp`;
    await uploadPhoto({ ...file, originalname: nombre }, 'jugadores');
    return nombre;
};

/** Borra una foto antigua sin bloquear la respuesta (si falla, solo queda un fichero huérfano). */
const borrarFotoAntigua = (fotoUrl) => {
    if (!fotoUrl) return;
    deletePhoto('jugadores/' + fotoUrl).catch((error) => {
        console.error('No se pudo borrar la foto antigua del jugador:', error);
    });
};

const crearJugador = async (req, res) => {
    try {
        const { datos, error } = leerDatosJugador(req.body);
        if (error) return res.status(400).json({ ok: false, message: error });

        const errorFoto = validarFoto(req.file);
        if (errorFoto) return res.status(400).json({ ok: false, message: errorFoto });

        // La foto se sube antes: si fallase, no queda un jugador apuntando a una foto inexistente
        const fotoUrl = req.file ? await subirFotoJugador(req.file) : null;

        const { rows } = await pool.query(
            `INSERT INTO jugadores (nombre, apellidos, apodo, posicion, lesionado, activo, equipo_id, foto_url)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [datos.nombre, datos.apellidos, datos.apodo, datos.posicion, datos.lesionado, datos.activo, datos.equipo_id, fotoUrl],
        );

        res.status(200).json({
            ok: true,
            message: 'Jugador creado',
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
        const id = Number(req.body.id);
        if (!Number.isInteger(id)) return res.status(400).json({ ok: false, message: 'Falta el jugador.' });

        const { datos, error } = leerDatosJugador(req.body);
        if (error) return res.status(400).json({ ok: false, message: error });

        const errorFoto = validarFoto(req.file);
        if (errorFoto) return res.status(400).json({ ok: false, message: errorFoto });

        const { rows: actuales } = await pool.query('SELECT foto_url FROM jugadores WHERE id = $1', [id]);
        if (actuales.length === 0) return res.status(404).json({ ok: false, message: 'El jugador no existe.' });
        const fotoAnterior = actuales[0].foto_url;

        // Foto: nueva si llega fichero, ninguna si se pide quitarla, y si no, la que ya tenía
        let fotoUrl = fotoAnterior;
        if (req.file) fotoUrl = await subirFotoJugador(req.file);
        else if (aBooleano(req.body.quitar_foto, false)) fotoUrl = null;

        const { rows } = await pool.query(
            `UPDATE jugadores
             SET equipo_id = $1, nombre = $2, apellidos = $3, apodo = $4, posicion = $5,
                 lesionado = $6, activo = $7, foto_url = $8
             WHERE id = $9 RETURNING *`,
            [datos.equipo_id, datos.nombre, datos.apellidos, datos.apodo, datos.posicion, datos.lesionado, datos.activo, fotoUrl, id],
        );

        if (fotoAnterior && fotoAnterior !== fotoUrl) borrarFotoAntigua(fotoAnterior);

        res.status(200).json({
            ok: true,
            message: 'Jugador actualizado',
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


/**
 * Elimina un jugador (solo admin), solo si NO tiene ningún historial.
 * Casi todo lo que cuelga de un jugador se borra en cascada, incluidas las alineaciones de los
 * usuarios y sus puntos: borrar a alguien que ha jugado les quitaría puntos sin avisar.
 * Para esos casos está "Activo" (desactivarlo lo oculta de la app sin tocar el historial).
 */
const eliminarJugador = async (req, res) => {
    try {
        const id = Number(req.body.id);
        if (!Number.isInteger(id)) return res.status(400).json({ ok: false, message: 'Falta el jugador.' });

        const { rows } = await pool.query(
            `SELECT j.foto_url, (
                    EXISTS (SELECT 1 FROM plantilla_jugadores x WHERE x.jugador_id = j.id)
                 OR EXISTS (SELECT 1 FROM partido_jugadores x WHERE x.jugador_id = j.id)
                 OR EXISTS (SELECT 1 FROM puntos_jugadores_jornada x WHERE x.jugador_id = j.id)
                 OR EXISTS (SELECT 1 FROM goles x WHERE x.jugador_id = j.id)
                 OR EXISTS (SELECT 1 FROM tarjetas x WHERE x.jugador_id = j.id)
                 OR EXISTS (SELECT 1 FROM destacados_jornada x WHERE x.jugador_id = j.id)
                 OR EXISTS (SELECT 1 FROM plantilla_onces_ideales x WHERE x.jugador_id = j.id)
                 OR EXISTS (SELECT 1 FROM estadisticas_partido_jugador x WHERE x.jugador_id = j.id)
                ) AS tiene_historial FROM jugadores j WHERE j.id = $1`,
            [id],
        );
        if (rows.length === 0) return res.status(404).json({ ok: false, message: 'El jugador no existe.' });

        if (rows[0].tiene_historial) {
            return res.status(409).json({
                ok: false,
                code: 'CON_HISTORIAL',
                message: 'Este jugador ya tiene partidos, puntos o alineaciones. Desactívalo en su lugar.'
            });
        }

        await pool.query('DELETE FROM jugadores WHERE id = $1', [id]);
        if (rows[0].foto_url) borrarFotoAntigua(rows[0].foto_url);

        res.status(200).json({ ok: true, message: 'Jugador eliminado' });
    } catch (error) {
        console.error('Error al eliminar el jugador:', error);
        res.status(500).json({ ok: false, message: 'Error al eliminar el jugador' });
    }
};

const getRanking = async (req, res) => {
    try {
        /* const query = `
            SELECT J.nombre, J.apellidos, J.apodo, J.posicion, J.foto_url,
            E.nombre AS equipo, EJ.goles, EJ.goles_en_propia, EJ.goles_encajados,
            EJ.goles_penalti, EJ.jugador_id, EJ.partidos_jugados, EJ.partidos_titular,
            EJ.partidos_suplente, EJ.tarjetas_amarillas, EJ.tarjetas_rojas
            FROM estadisticas_jugadores EJ
            INNER JOIN jugadores J ON J.id = EJ.jugador_id
            INNER JOIN equipos E ON E.id = J.equipo_id
            WHERE EJ.goles > 0
            ORDER BY EJ.goles DESC
        `; */
        const query = `
            SELECT VRP.*, J.foto_url FROM vista_ranking_puntos VRP
            INNER JOIN jugadores J ON J.id = VRP.jugador_id
            WHERE VRP.puntos_totales_temporada > 0
            ORDER BY VRP.puntos_totales_temporada DESC
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
        total += 3;
        desglose.resultado = { concepto: 'Partido Ganado', puntos: 3 };
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
            desglose.goles.push({ concepto: `Gol marcado`, puntos: ptsGol });
        }
    }

    // 4. TARJETAS
    const amarillas = tarjetasJugador.filter(t => t.tipo === 'AMARILLA').length;
    const doblesAmarillas = tarjetasJugador.filter(t => t.tipo === 'DOBLE AMARILLA').length;
    const rojas = tarjetasJugador.filter(t => t.tipo === 'ROJA').length;

    // Una sola sanción por jugador, de la más grave a la más leve. Una doble amarilla llega
    // como AMARILLA + DOBLE AMARILLA: antes ganaba la amarilla (-1) y no la doble (-2).
    if (doblesAmarillas >= 1) {
        // Doble amarilla que deriva en expulsión
        total -= 2;
        desglose.tarjetas.push({ concepto: 'Doble tarjeta amarilla', puntos: -2 });
    } else if (rojas >= 1) {
        total -= 3;
        desglose.tarjetas.push({ concepto: 'Roja directa', puntos: -3 });
    } else if (amarillas >= 1) {
        total -= 1;
        desglose.tarjetas.push({ concepto: 'Tarjeta amarilla', puntos: -1 });
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

const getJugadores = async (req, res) => {
    try {
        const { posicion, excluidos } = req.body;

        if (!posicion) {
            return res.status(400).json({ error: 'La posición es obligatoria.' });
        }

        // Convertimos el string "12,45,88" en un array de números [12, 45, 88]
        const idsExcluidos = excluidos
            ? excluidos.split(',').map(id => parseInt(id, 10)).filter(Boolean)
            : [];

        let query = `
        SELECT 
            j.id,
            j.nombre,
            j.apodo,
            j.posicion,
            j.foto_url,
            j.equipo_id,
            e.nombre AS equipo_nombre,
            e.escudo_url AS equipo_escudo_url,
            COALESCE(SUM(PJJ.puntos_totales), 0)::int AS puntos_totales
        FROM jugadores j
        JOIN equipos e ON j.equipo_id = e.id
        LEFT JOIN puntos_jugadores_jornada PJJ ON j.id = PJJ.jugador_id
        WHERE j.posicion = $1
        `;

        const values = [posicion];

        // Si hay jugadores ya seleccionados, añadimos el filtro NOT IN
        if (idsExcluidos.length > 0) {
            query += ` AND j.id NOT IN (${idsExcluidos.map((_, i) => `$${i + 2}`).join(',')})`;
            values.push(...idsExcluidos);
        }

        query += `
            GROUP BY j.id, e.id, e.nombre, e.escudo_url
            ORDER BY puntos_totales DESC;
        `;

        const { rows } = await pool.query(query, values);

        const jugadoresProcesados = await Promise.all(
            rows.map(async (jugador) => {
                if (jugador.foto_url !== null) {
                    const fotoUrl = await getDownloadUrl('jugadores/' + jugador.foto_url);
                    jugador.foto = fotoUrl;
                }

                const equipoFotoUrl = await getDownloadUrl('equipos/' + jugador.equipo_escudo_url);
                jugador.equipo_escudo = equipoFotoUrl;

                return jugador;
            })
        );

        res.status(200).json({
            ok: true,
            data: jugadoresProcesados
        });

    } catch (error) {
        console.error('Error al obtener jugadores disponibles:', error);
        return res.status(500).json({ error: 'Error interno del servidor.' });
    }
}

const getJugadoresPorJornada = async (req, res) => {
    try {
        const { jornada_id, posicion } = req.body;

        if (!posicion || !jornada_id) {
            return res.status(400).json({ error: 'La posición y el ID de la jornada son obligatorios.' });
        }

        const query = `
            SELECT
                j.id,
                j.nombre,
                j.apodo,
                j.posicion,
                j.foto_url,
                j.equipo_id,
                e.nombre AS equipo_nombre,
                e.escudo_url AS equipo_escudo_url,
                COALESCE(SUM(PJJ.puntos_totales), 0)::int AS puntos_jornada
            FROM jugadores j
            JOIN equipos e ON j.equipo_id = e.id
            LEFT JOIN puntos_jugadores_jornada PJJ ON j.id = PJJ.jugador_id
            WHERE j.posicion = $1 AND PJJ.jornada_id = $2
            GROUP BY j.id, e.id, e.nombre, e.escudo_url
            ORDER BY puntos_jornada DESC
            LIMIT 10
        `;

        const values = [posicion, jornada_id];

        const { rows } = await pool.query(query, values);

        const jugadoresProcesados = await Promise.all(
            rows.map(async (jugador) => {
                if (jugador.foto_url !== null) {
                    const fotoUrl = await getDownloadUrl('jugadores/' + jugador.foto_url);
                    jugador.foto = fotoUrl;
                }

                const equipoFotoUrl = await getDownloadUrl('equipos/' + jugador.equipo_escudo_url);
                jugador.equipo_escudo = equipoFotoUrl;

                return jugador;
            })
        );

        res.status(200).json({
            ok: true,
            data: jugadoresProcesados
        });

    } catch (error) {
        console.error('Error al obtener jugadores disponibles:', error);
        return res.status(500).json({ error: 'Error interno del servidor.' });
    }
}

/**
 * Panel de control: jugadores de un equipo, también los inactivos (para poder reactivarlos).
 * Ordenados por posición (POR, DEF, MED, DEL) y por nombre visible (apodo o nombre + apellidos).
 */
const getJugadoresEquipoAdmin = async (req, res) => {
    try {
        const equipoId = Number(req.body.equipo_id);
        if (!Number.isInteger(equipoId)) {
            return res.status(400).json({ ok: false, message: 'Falta el equipo.' });
        }

        const { rows } = await pool.query(
            `SELECT j.id, j.equipo_id, j.nombre, j.apellidos, j.apodo, j.posicion, j.foto_url,
                    j.lesionado, j.activo, j.precio,
                    (
                    EXISTS (SELECT 1 FROM plantilla_jugadores x WHERE x.jugador_id = j.id)
                 OR EXISTS (SELECT 1 FROM partido_jugadores x WHERE x.jugador_id = j.id)
                 OR EXISTS (SELECT 1 FROM puntos_jugadores_jornada x WHERE x.jugador_id = j.id)
                 OR EXISTS (SELECT 1 FROM goles x WHERE x.jugador_id = j.id)
                 OR EXISTS (SELECT 1 FROM tarjetas x WHERE x.jugador_id = j.id)
                 OR EXISTS (SELECT 1 FROM destacados_jornada x WHERE x.jugador_id = j.id)
                 OR EXISTS (SELECT 1 FROM plantilla_onces_ideales x WHERE x.jugador_id = j.id)
                 OR EXISTS (SELECT 1 FROM estadisticas_partido_jugador x WHERE x.jugador_id = j.id)
                ) AS tiene_historial
             FROM jugadores j
             WHERE j.equipo_id = $1
             ORDER BY
                CASE j.posicion WHEN 'POR' THEN 1 WHEN 'DEF' THEN 2 WHEN 'MED' THEN 3 WHEN 'DEL' THEN 4 ELSE 5 END,
                COALESCE(NULLIF(TRIM(j.apodo), ''), j.nombre || ' ' || COALESCE(j.apellidos, '')) ASC`,
            [equipoId],
        );

        const jugadores = await Promise.all(
            rows.map(async (j) => ({
                ...j,
                foto: j.foto_url ? await getDownloadUrl('jugadores/' + j.foto_url) : null,
            })),
        );

        res.status(200).json({ ok: true, data: jugadores });
    } catch (error) {
        console.error('Error al obtener los jugadores del equipo:', error);
        res.status(500).json({ ok: false, message: 'Error al obtener los jugadores del equipo' });
    }
};

module.exports = { crearJugador, editarJugador, eliminarJugador, getRanking, calcularPuntosJugador, getJugadores, getJugadoresPorJornada, getJugadoresEquipoAdmin };