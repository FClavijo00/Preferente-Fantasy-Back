const pool = require('../config/db');
const { calcularPuntosJugador } = require('../controllers/jugadores.controller');
const { getDownloadUrl } = require('../config/s3');

const crearPartido = async (req, res) => {
    try {

        const { equipo_local_id, equipo_visitante_id, jornada_id, goles_local, goles_visitante, jugado, fecha_partido } = req.body;

        // 1. Validar campos obligatorios
        if (!equipo_local_id || !equipo_visitante_id || !jornada_id) {
            return res.status(400).json({
                ok: false,
                message: 'Los campos equipo_local_id, equipo_visitante_id y jornada_id son obligatorios'
            });
        }

        // 2. Un equipo no puede jugar contra sí mismo
        if (equipo_local_id === equipo_visitante_id) {
            return res.status(400).json({
                ok: false,
                message: 'El equipo local y el equipo visitante no pueden ser el mismo'
            });
        }

        // 3. Comprobar que ninguno de los dos equipos tenga ya un partido asignado en esa misma jornada
        const checkDuplicateQuery = `
            SELECT id FROM partidos 
            WHERE jornada_id = $1 
            AND (equipo_local_id IN ($2, $3) OR equipo_visitante_id IN ($2, $3))
            LIMIT 1;
        `;
        const duplicateCheck = await pool.query(checkDuplicateQuery, [jornada_id, equipo_local_id, equipo_visitante_id]);

        if (duplicateCheck.rows.length > 0) {
            return res.status(400).json({
                ok: false,
                message: 'Uno de los dos equipos ya tiene un partido registrado en esta jornada'
            });
        }

        // 4. Inserción del partido
        const query = `
            INSERT INTO partidos (
                equipo_local_id, 
                equipo_visitante_id, 
                jornada_id, 
                goles_local, 
                goles_visitante, 
                jugado, 
                fecha_partido
            ) 
            VALUES ($1, $2, $3, $4, $5, $6, $7) 
            RETURNING *;
        `;

        const { rows } = await pool.query(query, [
            equipo_local_id,
            equipo_visitante_id,
            jornada_id,
            goles_local,
            goles_visitante,
            jugado,
            fecha_partido
        ]);

        return res.status(201).json({
            ok: true,
            message: 'Partido creado exitosamente',
            data: rows[0]
        });

    } catch (error) {
        console.error('Error al crear el partido:', error);
        res.status(500).json({
            ok: false,
            message: 'Error al crear el partido'
        });
    }
}

const editarPartido = async (req, res) => {
    try {

        const { partido_id, equipo_local_id, equipo_visitante_id, jornada_id, goles_local, goles_visitante, jugado, fecha_partido } = req.body;

        // 1. Validar campos obligatorios
        if (!partido_id || !equipo_local_id || !equipo_visitante_id || !jornada_id) {
            return res.status(400).json({
                ok: false,
                message: 'Los campos partido_id, equipo_local_id, equipo_visitante_id y jornada_id son obligatorios'
            });
        }

        // 2. Un equipo no puede jugar contra sí mismo
        if (equipo_local_id === equipo_visitante_id) {
            return res.status(400).json({
                ok: false,
                message: 'El equipo local y el equipo visitante no pueden ser el mismo'
            });
        }

        // 3. Comprobar que ninguno de los dos equipos tenga ya un partido asignado en esa misma jornada
        const checkDuplicateQuery = `
            SELECT id FROM partidos 
            WHERE jornada_id = $1 
            AND (equipo_local_id IN ($2, $3) OR equipo_visitante_id IN ($2, $3))
            AND id != $4
            LIMIT 1;
        `;
        const duplicateCheck = await pool.query(checkDuplicateQuery, [jornada_id, equipo_local_id, equipo_visitante_id, partido_id]);

        if (duplicateCheck.rows.length > 0) {
            return res.status(400).json({
                ok: false,
                message: 'Uno de los dos equipos ya tiene un partido registrado en esta jornada'
            });
        }

        // 4. Actualizar el partido
        const query = `
            UPDATE partidos 
            SET equipo_local_id = $1, 
                equipo_visitante_id = $2, 
                jornada_id = $3, 
                goles_local = $4, 
                goles_visitante = $5, 
                jugado = $6, 
                fecha_partido = $7 
            WHERE id = $8 
            RETURNING *;
        `;

        const { rows } = await pool.query(query, [
            equipo_local_id,
            equipo_visitante_id,
            jornada_id,
            goles_local,
            goles_visitante,
            jugado,
            fecha_partido,
            partido_id
        ]);

        return res.status(200).json({
            ok: true,
            message: 'Partido editado exitosamente',
            data: rows[0]
        });


    } catch (error) {
        console.error('Error al editar el partido:', error);
        res.status(500).json({
            ok: false,
            message: 'Error al editar el partido'
        });
    }
}

const cerrarActaPartido = async (req, res) => {
    try {

        const {
            partido_id,
            titulares_local,
            suplentes_local,
            titulares_visitante,
            suplentes_visitante,
            tarjetas,
            goles,
            jugador_destacado_id
        } = req.body;

        // INICIAR TRANSACCIÓN
        await pool.query('BEGIN');

        // 1. OBTENER INFORMACIÓN DEL PARTIDO
        const partidoQuery =
            `SELECT equipo_local_id, equipo_visitante_id, goles_local, goles_visitante, jornada_id 
            FROM partidos WHERE id = $1`;
        const partidoResult = await pool.query(partidoQuery, [partido_id]);
        if (partidoResult.rows.length === 0) {
            await pool.query('ROLLBACK');
            return res.status(404).json({
                ok: false,
                message: 'Partido no encontrado'
            });
        }
        const { equipo_local_id, equipo_visitante_id, goles_local, goles_visitante, jornada_id } = partidoResult.rows[0];

        // 2. LIMPIAR TODOS LOS DATOS ANTERIORES DEL ACTA
        await pool.query('DELETE FROM partido_jugadores WHERE partido_id = $1', [partido_id]);
        await pool.query('DELETE FROM tarjetas WHERE partido_id = $1', [partido_id]);
        await pool.query('DELETE FROM goles WHERE partido_id = $1', [partido_id]);
        await pool.query('DELETE FROM puntos_jugadores_jornada WHERE partido_id = $1', [partido_id]);
        await pool.query('DELETE FROM destacados_jornada WHERE partido_id = $1', [partido_id]);

        // 3. INSERTAR CONVOCATORIA
        const insertarConvocado = async (jugadorId, equipoId, esTitular, esSuplente) => {
            await pool.query(
                `INSERT INTO partido_jugadores (partido_id, jugador_id, equipo_id, es_titular, es_suplente) 
                VALUES ($1, $2, $3, $4, $5)`,
                [partido_id, jugadorId, equipoId, esTitular, esSuplente]
            );
        };

        for (const id of titulares_local) await insertarConvocado(id, equipo_local_id, true, false);
        for (const id of suplentes_local) await insertarConvocado(id, equipo_local_id, false, true);
        for (const id of titulares_visitante) await insertarConvocado(id, equipo_visitante_id, true, false);
        for (const id of suplentes_visitante) await insertarConvocado(id, equipo_visitante_id, false, true);

        // 4. INSERTAR TARJETAS
        for (const t of tarjetas) {
            await pool.query(
                `INSERT INTO tarjetas (partido_id, jugador_id, equipo_id, tipo) 
                VALUES ($1, $2, $3, $4)`,
                [partido_id, t.jugador_id, t.equipo_id, t.tipo]
            );
        }

        // 5. INSERTAR GOLES
        for (const g of goles) {
            await pool.query(
                `INSERT INTO goles (partido_id, jugador_id, equipo_id, tipo)
                VALUES ($1, $2, $3, $4)`,
                [partido_id, g.jugador_id, g.equipo_id, g.tipo]
            )
        };

        // 6. JUGADOR DESTACADO
        if (jugador_destacado_id !== null) {
            await pool.query(
                `INSERT INTO destacados_jornada (partido_id, jugador_id, jornada_id) 
                VALUES ($1, $2, $3) RETURNING *`,
                [partido_id, jugador_destacado_id, jornada_id]
            );
        }

        // 6. CALCULAR PUNTOS
        for (const jugador of [...titulares_local, ...suplentes_local, ...titulares_visitante, ...suplentes_visitante]) {
            // 1. Obtener los datos necesarios del jugador
            const golesDelJugador = goles.filter(g => g.jugador_id === jugador);
            const tarjetasDelJugador = tarjetas.filter(t => t.jugador_id === jugador);

            const esLocalTitular = jugador === titulares_local.filter(id => id === jugador)[0];
            const esLocalSuplente = jugador === suplentes_local.filter(id => id === jugador)[0];
            const esVisitanteTitular = jugador === titulares_visitante.filter(id => id === jugador)[0];
            const esVisitanteSuplente = jugador === suplentes_visitante.filter(id => id === jugador)[0];

            const esLocal = esLocalTitular || esLocalSuplente;
            const esVisitante = esVisitanteTitular || esVisitanteSuplente;
            const golesAFavor = esLocal ? goles_local : goles_visitante;
            const golesEncajados = esLocal ? goles_visitante : goles_local;

            let resultadoPartido = 'EMPATE';
            if (golesAFavor > golesEncajados) resultadoPartido = 'VICTORIA';
            if (golesAFavor < golesEncajados) resultadoPartido = 'DERROTA';

            const queryPosicion = await pool.query(
                `SELECT posicion FROM jugadores WHERE id = $1`,
                [jugador]
            );
            const posicionJugador = queryPosicion.rows[0].posicion;

            // 2. Calcular puntos
            const calculoPuntos = calcularPuntosJugador({
                posicion: posicionJugador, // 'POR', 'DEF', 'MED', 'DEL'
                esTitular: esLocalTitular || esVisitanteTitular,
                esSuplente: esLocalSuplente || esVisitanteSuplente,
                resultado: resultadoPartido,
                golesJugador: golesDelJugador,
                tarjetasJugador: tarjetasDelJugador,
                golesEncajados,
                golesAFavor,
                esDestacado: jugador === jugador_destacado_id ? true : false // si se envía en el acta
            });

            const puntosTotales = calculoPuntos.puntosTotales;
            const desglose = calculoPuntos.desglose;

            // 3. Insertar en la tabla puntos_jugadores_jornada
            await pool.query(
                `INSERT INTO puntos_jugadores_jornada 
                (jugador_id, partido_id, jornada_id, puntos_totales, desglose_json) 
                VALUES ($1, $2, $3, $4, $5)`,
                [jugador, partido_id, jornada_id, puntosTotales, JSON.stringify(desglose)]
            );
        }

        // 7. ACTUALIZAR ESTADO DEL PARTIDO (ACTA)
        await pool.query(
            `UPDATE partidos SET tiene_acta = $1 WHERE id = $2`,
            [true, partido_id]
        );

        // CONFIRMAR TRANSACCIÓN
        await pool.query('COMMIT');

        res.status(200).json({
            ok: true,
            message: 'Acta del partido cerrada exitosamente'
        });


    } catch (error) {
        console.error('Error al cerrar el acta del partido:', error);
        res.status(500).json({
            ok: false,
            message: 'Error al cerrar el acta del partido'
        });
    }
}

const obtenerActaPartido = async (req, res) => {
    try {
        const { partido_id } = req.body;

        // 1. Obtener datos básicos del partido
        const partidoRes = await pool.query(
            `SELECT id, equipo_local_id, equipo_visitante_id, goles_local, goles_visitante, jornada_id, jugado
            FROM partidos WHERE id = $1`,
            [partido_id]
        );

        if (partidoRes.rows.length === 0) {
            return res.status(404).json({ error: 'Partido no encontrado' });
        }

        const partido = partidoRes.rows[0];

        const jugadoresRes = await pool.query(
            `SELECT * FROM partido_jugadores WHERE partido_id = $1`,
            [partido_id]
        );

        const titularesLocal = jugadoresRes.rows
            .filter(j => j.equipo_id === partido.equipo_local_id && j.es_titular)
            .map(j => j.jugador_id);

        const suplentesLocal = jugadoresRes.rows
            .filter(j => j.equipo_id === partido.equipo_local_id && j.es_suplente)
            .map(j => j.jugador_id);

        const titularesVisitante = jugadoresRes.rows
            .filter(j => j.equipo_id === partido.equipo_visitante_id && j.es_titular)
            .map(j => j.jugador_id);

        const suplentesVisitante = jugadoresRes.rows
            .filter(j => j.equipo_id === partido.equipo_visitante_id && j.es_suplente)
            .map(j => j.jugador_id);

        // 3. Obtener tarjetas
        const tarjetasLocalRes = await pool.query(
            `SELECT jugador_id, equipo_id, tipo 
            FROM tarjetas WHERE partido_id = $1 AND equipo_id = $2`,
            [partido_id, partido.equipo_local_id]
        );

        const tarjetasVisitanteRes = await pool.query(
            `SELECT jugador_id, equipo_id, tipo 
            FROM tarjetas WHERE partido_id = $1 AND equipo_id = $2`,
            [partido_id, partido.equipo_visitante_id]
        );

        // 4. Obtener goles
        const golesLocalRes = await pool.query(
            `SELECT jugador_id, equipo_id, tipo
            FROM goles WHERE partido_id = $1 AND equipo_id = $2`,
            [partido_id, partido.equipo_local_id]
        );

        const golesVisitanteRes = await pool.query(
            `SELECT jugador_id, equipo_id, tipo
            FROM goles WHERE partido_id = $1 AND equipo_id = $2`,
            [partido_id, partido.equipo_visitante_id]
        );

        // 5. Obtener jugador destacado si existe
        const destacadoRes = await pool.query(
            `SELECT jugador_id FROM destacados_jornada WHERE partido_id = $1`,
            [partido_id]
        );
        const jugadorDestacadoId = destacadoRes.rows.length > 0 ? destacadoRes.rows[0].jugador_id : null;

        return res.status(200).json({
            partido_id: partido.id,
            titulares_local: titularesLocal,
            suplentes_local: suplentesLocal,
            titulares_visitante: titularesVisitante,
            suplentes_visitante: suplentesVisitante,
            tarjetas_local: tarjetasLocalRes.rows,
            tarjetas_visitante: tarjetasVisitanteRes.rows,
            goles_local: golesLocalRes.rows,
            goles_visitante: golesVisitanteRes.rows,
            jugador_destacado_id: jugadorDestacadoId
        });
    } catch (error) {
        console.error('Error al obtener el acta del partido:', error);
        res.status(500).json({
            ok: false,
            message: 'Error al obtener el acta del partido'
        });
    }
}

const getActaPartidoPuntos = async (req, res) => {
    try {
        const { partido_id } = req.body;

        const query = `
        SELECT 
            p.id AS partido_id,
            p.jornada_id,
            jor.numero_jornada,
            p.goles_local,
            p.goles_visitante,
            p.jugado,
            p.tiene_acta,
            
            -- Datos Equipo Local
            el.id AS equipo_local_id,
            el.nombre AS nombre_local,
            el.siglas AS siglas_local,
            el.escudo_url AS escudo_local_url,
            
            -- Datos Equipo Visitante
            ev.id AS equipo_visitante_id,
            ev.nombre AS nombre_visitante,
            ev.siglas AS siglas_visitante,
            ev.escudo_url AS escudo_visitante_url,
            
            -- Jugadores del Equipo Local + Puntos
            COALESCE(
                (
                SELECT json_agg(
                    json_build_object(
                    'id', j.id,
                    'nombre', j.nombre,
                    'apellidos', j.apellidos,
                    'apodo', j.apodo,
                    'foto_url', j.foto_url,
                    'posicion', j.posicion,
                    'puntos_jornada', COALESCE(pjj.puntos_totales, 0),
                    'titular', pj.es_titular,
                    'desglose', COALESCE(pjj.desglose_json::jsonb, '{}'::jsonb)
                    ) ORDER BY 
                        CASE j.posicion 
                        WHEN 'POR' THEN 1 
                        WHEN 'DEF' THEN 2 
                        WHEN 'MED' THEN 3 
                        WHEN 'DEL' THEN 4 
                        ELSE 5 
                        END ASC, COALESCE(pjj.puntos_totales, 0) DESC
                )
                FROM jugadores j
                JOIN puntos_jugadores_jornada pjj 
                    ON pjj.jugador_id = j.id AND pjj.jornada_id = p.jornada_id
                LEFT JOIN partido_jugadores pj 
                    ON pj.jugador_id = j.id AND pj.partido_id = p.id
                WHERE j.equipo_id = p.equipo_local_id
                ),
                '[]'::json
            ) AS jugadores_local,

            -- Jugadores del Equipo Visitante + Puntos
            COALESCE(
                (
                SELECT json_agg(
                    json_build_object(
                    'id', j.id,
                    'nombre', j.nombre,
                    'apellidos', j.apellidos,
                    'apodo', j.apodo,
                    'foto_url', j.foto_url,
                    'posicion', j.posicion,
                    'titular', pj.es_titular,
                    'puntos_jornada', COALESCE(pjj.puntos_totales, 0),
                    'desglose', COALESCE(pjj.desglose_json::jsonb, '{}'::jsonb)
                    ) ORDER BY 
                        CASE j.posicion 
                        WHEN 'POR' THEN 1 
                        WHEN 'DEF' THEN 2 
                        WHEN 'MED' THEN 3 
                        WHEN 'DEL' THEN 4 
                        ELSE 5 
                        END ASC, j.id ASC
                )
                FROM jugadores j
                JOIN puntos_jugadores_jornada pjj 
                    ON pjj.jugador_id = j.id AND pjj.jornada_id = p.jornada_id
                LEFT JOIN partido_jugadores pj 
                    ON pj.jugador_id = j.id AND pj.partido_id = p.id
                WHERE j.equipo_id = p.equipo_visitante_id
                ),
                '[]'::json
            ) AS jugadores_visitante

            FROM partidos p
            JOIN jornadas jor ON jor.id = p.jornada_id
            JOIN equipos el ON el.id = p.equipo_local_id
            JOIN equipos ev ON ev.id = p.equipo_visitante_id
            WHERE p.id = $1;
        `;

        const { rows } = await pool.query(query, [partido_id]);

        if (rows.length === 0) {
            return res.status(404).json({
                ok: false,
                message: 'Partido no encontrado'
            });
        }

        const actaProcesada = await Promise.all(
            rows.map(async (acta) => {
                // 1. Resolvemos las imágenes de los escudos
                const [fotoEscudoLocal, fotoEscudoVisitante] = await Promise.all([
                    acta.escudo_local_url ? getDownloadUrl('equipos/' + acta.escudo_local_url) : null,
                    acta.escudo_visitante_url ? getDownloadUrl('equipos/' + acta.escudo_visitante_url) : null
                ]);

                // 2. Resolvemos las fotos de los jugadores locales
                const jugadoresLocalProcesados = await Promise.all(
                    (acta.jugadores_local || []).map(async (jugador) => ({
                        ...jugador,
                        foto: jugador.foto_url ? await getDownloadUrl('jugadores/' + jugador.foto_url) : null
                    }))
                );

                // 3. Resolvemos las fotos de los jugadores visitantes
                const jugadoresVisitanteProcesados = await Promise.all(
                    (acta.jugadores_visitante || []).map(async (jugador) => ({
                        ...jugador,
                        foto: jugador.foto_url ? await getDownloadUrl('jugadores/' + jugador.foto_url) : null
                    }))
                );

                // 4. Retornamos el acta totalmente resuelta
                return {
                    ...acta,
                    escudo_local: fotoEscudoLocal,
                    escudo_visitante: fotoEscudoVisitante,
                    jugadores_local: jugadoresLocalProcesados,
                    jugadores_visitante: jugadoresVisitanteProcesados
                };
            })
        )

        res.status(200).json({
            ok: true,
            data: actaProcesada[0]
        });

    } catch (error) {
        console.error('Error al obtener el acta del partido:', error);
        res.status(500).json({
            ok: false,
            message: 'Error al obtener el acta del partido'
        });
    }
}

module.exports = {
    crearPartido,
    editarPartido,
    cerrarActaPartido,
    obtenerActaPartido,
    getActaPartidoPuntos
};