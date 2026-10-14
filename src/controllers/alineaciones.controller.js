const pool = require('../config/db');
const { getDownloadUrl } = require('../config/s3');

const cargarAlineacion = async (req, res) => {
    try {
        const { liga_id, usuario_id, jornada_id } = req.body;

        if (!liga_id || !usuario_id || !jornada_id) {
            return res.status(400).json({ error: 'Faltan parámetros requeridos.' });
        }

        // 1. Buscamos la plantilla guardada
        const queryPlantilla = `
            SELECT id, formacion_id 
            FROM plantillas_usuario 
            WHERE liga_id = $1 AND usuario_id = $2 AND jornada_id = $3
        `;
        const { rows: plantillas } = await pool.query(queryPlantilla, [liga_id, usuario_id, jornada_id]);

        if (plantillas.length === 0) {
            // No hay plantilla guardada aún para esta jornada
            return res.json({ existe: false, formacion_id: 1, jugadores: [] });
        }

        const plantilla = plantillas[0];

        // 2. Traemos los jugadores alineados con sus datos
        const queryJugadores = `
            SELECT 
                pj.hueco_index,
                pj.posicion,
                j.id,
                j.nombre,
                j.apodo,
                j.foto_url,
                j.equipo_id,
                e.nombre AS equipo_nombre,
                e.escudo_url AS equipo_escudo_url
            FROM plantilla_jugadores pj
            JOIN jugadores j ON pj.jugador_id = j.id
            JOIN equipos e ON j.equipo_id = e.id
            WHERE pj.plantilla_id = $1
        `;
        const { rows: jugadores } = await pool.query(queryJugadores, [plantilla.id]);

        // 3. Procesamos la foto de los jugadores
        const jugadoresProcesados = await Promise.all(
            jugadores.map(async (jugador) => {
                const fotoUrl = await getDownloadUrl('jugadores/' + jugador.foto_url);
                jugador.foto = fotoUrl;

                const equipoFotoUrl = await getDownloadUrl('equipos/' + jugador.equipo_escudo_url);
                jugador.equipo_escudo = equipoFotoUrl;
                
                return jugador;
            })
        )

        return res.json({
            existe: true,
            formacion_id: plantilla.formacion_id,
            jugadores: jugadoresProcesados
        });

    } catch (error) {
        console.error('Error al cargar alineación:', error);
        return res.status(500).json({ error: 'Error interno del servidor.' });
    }
};

const cargarAlineacionesJornadas = async (req, res) => {
    try {
        const { liga_id, usuario_id, jornada_id } = req.body;

        if (!liga_id || !usuario_id || !jornada_id) {
            return res.status(400).json({ error: 'Faltan parámetros requeridos.' });
        }

        const query = `
        SELECT 
            pu.id AS plantilla_id,
            pu.liga_id,
            pu.usuario_id,
            pu.jornada_id,
            pu.formacion_id,
            f.formacion,
            jor.numero_jornada,
            jor.estado,
            COALESCE(
                json_agg(
                    json_build_object(
                    'hueco_index', pj.hueco_index,
                    'posicion', pj.posicion,
                    'jugador_id', j.id,
                    'nombre', j.nombre,
                    'apellidos', j.apellidos,
                    'apodo', j.apodo,
                    'foto', j.foto_url,
                    'equipo_id', j.equipo_id,
                    'equipo_nombre', e.nombre,
                    'equipo_escudo_url', e.escudo_url,
                    'puntos_jornada', COALESCE(pjj.puntos_totales, 0),
                    'desglose_puntos', pjj.desglose_json
                    ) ORDER BY pj.hueco_index ASC
                ) FILTER (WHERE pj.plantilla_id IS NOT NULL),
                '[]'::json
            ) AS jugadores
        FROM plantillas_usuario pu
        LEFT JOIN plantilla_jugadores pj ON pj.plantilla_id = pu.id
        LEFT JOIN jugadores j ON j.id = pj.jugador_id
        LEFT JOIN equipos e ON e.id = j.equipo_id
        LEFT JOIN jornadas jor ON jor.id = pu.jornada_id
        LEFT JOIN formaciones f ON f.id = pu.formacion_id
        -- Hacemos el JOIN con puntos filtrando por jugador_id Y la jornada exacta de la plantilla
        LEFT JOIN puntos_jugadores_jornada pjj ON pjj.jugador_id = pj.jugador_id AND pjj.jornada_id = pu.jornada_id
        WHERE pu.liga_id = $1 AND pu.usuario_id = $2 AND pu.jornada_id = $3 AND jor.estado != 'PENDIENTE'
        GROUP BY pu.id, jor.numero_jornada, f.formacion, jor.estado
        ORDER BY pu.jornada_id DESC
        `;

        const { rows: plantillas } = await pool.query(query, [liga_id, usuario_id, jornada_id]);

        // 2. Procesamos la foto de los jugadores
        const plantillasProcesadas = await Promise.all(
            plantillas.map(async (plantilla) => {
                const jugadoresProcesados = await Promise.all(
                plantilla.jugadores.map(async (jugador) => ({
                    ...jugador,
                    foto: jugador.foto ? await getDownloadUrl('jugadores/' + jugador.foto) : null,
                    equipo_escudo: jugador.equipo_escudo_url ? await getDownloadUrl('equipos/' + jugador.equipo_escudo_url) : null
                }))
                );

                return {
                ...plantilla,
                jugadores: jugadoresProcesados
                };
            })
        );

        return res.json({
            ok: true,
            data: plantillasProcesadas
        });

    } catch (error) {
        console.error('Error al cargar alineaciones:', error);
        return res.status(500).json({ error: 'Error interno del servidor.' });
    }
};

const guardarAlineacion = async (req, res) => {
    try {
        const { liga_id, usuario_id, jornada_id, formacion_id, jugadores } = req.body;

        // Validación básica
        if (!liga_id || !usuario_id || !jornada_id || !formacion_id || !Array.isArray(jugadores)) {
            return res.status(400).json({ error: 'Faltan campos obligatorios para guardar la alineación.' });
        }

        // 1. Iniciamos la transacción SQL
        await pool.query('BEGIN');

        //2. Insertamos o actualizamos plantilla del usuario para la jornada
        const queryPlantilla = `
            INSERT INTO plantillas_usuario (liga_id, usuario_id, jornada_id, formacion_id)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (liga_id, usuario_id, jornada_id) 
            DO UPDATE SET formacion_id = EXCLUDED.formacion_id, updated_at = NOW()
            RETURNING id;
        `;

        const resPlantilla = await pool.query(queryPlantilla, [
            liga_id,
            usuario_id,
            jornada_id,
            formacion_id
        ]);

        const plantillaId = resPlantilla.rows[0].id;

        // 3. Limpiamos los jugadores guardados previamente en esta plantilla (si existían)
        await pool.query(
            'DELETE FROM plantilla_jugadores WHERE plantilla_id = $1',
            [plantillaId]
        );

        // 4. Insertamos los nuevos jugadores seleccionados
        const queryJugadores = `
            INSERT INTO plantilla_jugadores (plantilla_id, jugador_id, posicion, hueco_index)
            VALUES ($1, $2, $3, $4);
        `;

        for (const slot of jugadores) {
            if (slot.jugador_id) { // Solo insertamos los huecos que tengan jugador asignado
                await pool.query(queryJugadores, [
                    plantillaId,
                    slot.jugador_id,
                    slot.posicion,
                    slot.hueco_index
                ]);
            }
        }

        // 5. Confirmamos todos los cambios en la base de datos
        await pool.query('COMMIT');

        return res.status(200).json({
            ok: true,
            mensaje: 'Alineación guardada correctamente.',
            plantilla_id: plantillaId,

        });

    } catch (error) {
        // Si algo falla, revertimos cualquier cambio efectuado
        await pool.query('ROLLBACK');
        console.error('Error al guardar alineación:', error);
        return res.status(500).json({ error: 'Error al guardar la alineación.' });
    }
};

const cargarOnceIdeal = async (req, res) => {
    try {
        const { jornada_id } = req.body;

        if (!jornada_id) {
            return res.status(400).json({ error: 'Faltan parámetros requeridos.' });
        }

        const queryOnceIdeal = `
            SELECT OI.id as once_ideal_id, F.formacion, OI.jornada_id, J.numero_jornada
            FROM once_ideal OI
            JOIN jornadas J ON J.id = OI.jornada_id
            JOIN formaciones F ON F.id = OI.formacion_id
            WHERE OI.jornada_id = $1;
        `;

        const { rows: rowsOnceIdeal } = await pool.query(queryOnceIdeal, [jornada_id]);

        if (rowsOnceIdeal.length === 0) {
            return res.json({ existe: false, formacion_id: 1, jugadores: [] });
        }

        const onceIdeal = rowsOnceIdeal[0];

        const queryJugadores = `
            SELECT
                POI.jugador_id,
                POI.hueco_index,
                j.posicion,
                j.nombre,
                j.apellidos,
                j.apodo,
                j.foto_url,
                j.equipo_id,
                e.nombre AS equipo_nombre,
                e.escudo_url AS equipo_escudo_url,
                PJJ.puntos_totales AS puntos_jornada,
                PJJ.desglose_json
            FROM plantilla_onces_ideales POI
            JOIN jugadores j ON j.id = POI.jugador_id
            JOIN equipos e ON e.id = j.equipo_id
            JOIN puntos_jugadores_jornada PJJ ON PJJ.jugador_id = POI.jugador_id
            WHERE POI.once_ideal_id = $1 AND PJJ.jornada_id = $2
            ORDER BY POI.hueco_index ASC;
        `;

        const { rows: jugadores } = await pool.query(queryJugadores, [onceIdeal.once_ideal_id, jornada_id]);

        const jugadoresProcesados = await Promise.all(
            jugadores.map(async (jugador) => {
                if (jugador.foto_url !== null) {
                    const fotoUrl = await getDownloadUrl('jugadores/' + jugador.foto_url);
                    jugador.foto = fotoUrl;
                }

                const equipoFotoUrl = await getDownloadUrl('equipos/' + jugador.equipo_escudo_url);
                jugador.equipo_escudo = equipoFotoUrl;
                
                return jugador;
            })
        )

         return res.json({
            existe: true,
            once_ideal_info: onceIdeal,
            jugadores: jugadoresProcesados
        });

    } catch {
        console.error('Error al obtener el once ideal de la jornada:', error);
        res.status(500).json({
            ok: false,
            message: 'Error al obtener el once ideal de la jornada'
        });
    }
};

module.exports = {
    cargarAlineacion,
    cargarAlineacionesJornadas,
    guardarAlineacion,
    cargarOnceIdeal
};