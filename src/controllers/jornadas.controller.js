const pool = require('../config/db');
const { getDownloadUrl } = require('../config/s3');

const getCalendarioJornadas = async (req, res) => {
    try {
        const query = `
            SELECT 
                -- Datos de la jornada
                j.id as jornada_id,
                j.numero_jornada,
                j.estado as jornada_estado,
                json_agg(
                    json_build_object(
                    'partido_id', p.id,
                    'fecha_partido', p.fecha_partido,
                    'goles_local', p.goles_local,
                    'goles_visitante', p.goles_visitante,
                    'jugado', p.jugado,
                    'tiene_acta', p.tiene_acta,
                    'local', json_build_object(
                        'id', eq_loc.id,
                        'nombre', eq_loc.nombre,
                        'escudo_url', eq_loc.escudo_url
                    ),
                    'visitante', json_build_object(
                        'id', eq_vis.id,
                        'nombre', eq_vis.nombre,
                        'escudo_url', eq_vis.escudo_url
                    )
                    ) ORDER BY p.fecha_partido ASC
                ) AS partidos
            FROM jornadas j
            INNER JOIN partidos p ON p.jornada_id = j.id
            INNER JOIN equipos eq_loc ON p.equipo_local_id = eq_loc.id
            INNER JOIN equipos eq_vis ON p.equipo_visitante_id = eq_vis.id
            -- WHERE j.competicion_id = $1 Opcional: filtrar por competición
            GROUP BY j.id, j.numero_jornada, j.estado
            ORDER BY j.numero_jornada ASC;
        `;

        const { rows } = await pool.query(query);

        const calendarioProcesado = await Promise.all(
            rows.map(async (jornada) => {
                const partidos = await Promise.all(
                    jornada.partidos.map(async (partido) => {
                        const local = await getDownloadUrl('equipos/' + partido.local.escudo_url);
                        const visitante = await getDownloadUrl('equipos/' + partido.visitante.escudo_url);
                        partido.local.escudo = local;
                        partido.visitante.escudo = visitante;
                        return partido;
                    })
                );
                jornada.partidos = partidos;
                return jornada;
            })
        );

        res.status(200).json({
            ok: true,
            data: calendarioProcesado
        });

    } catch (error) {
        console.error('Error al obtener el calendario de jornadas:', error);
        res.status(500).json({
            ok: false,
            message: 'Error al obtener el calendario de jornadas'
        });
    }
}

const getJornadaActual = async (req, res) => {
    try {
        const queryJorActual = 'SELECT num_jornada FROM jornada_actual';
        const queryJorTotal = 'SELECT jornadas_totales FROM competiciones';

        const { rows: rowsActual } = await pool.query(queryJorActual);
        const { rows: rowsTotal } = await pool.query(queryJorTotal);

        const data = {
            jornadaActual: rowsActual[0].num_jornada,
            jornadasTotales: rowsTotal[0].jornadas_totales
        };

        res.status(200).json({
            ok: true,
            data: data
        });
    } catch (error) {
        console.error('Error al obtener la jornada actual:', error);
        res.status(500).json({
            ok: false,
            message: 'Error al obtener la jornada actual'
        });
    }
}

const getSiguienteJornada = async (req, res) => {
    try {
        const query = `
            SELECT * FROM jornadas WHERE estado = 'PENDIENTE'
            ORDER BY id ASC
        `;

        const { rows } = await pool.query(query);

        if (rows.length === 0) {
            return res.status(404).json({
                ok: false,
                message: 'No hay jornadas pendientes'
            });
        }

       /*  const siguienteJornada = rows[0].num_jornada;
        const query2 = 'UPDATE jornada_actual SET num_jornada = $1 WHERE estado = $2';
        await pool.query(query2, [siguienteJornada, 'PENDIENTE']); */

        res.status(200).json({
            ok: true,
            data: rows[0]
        });

    } catch (error) {
        console.error('Error al obtener la siguiente jornada:', error);
        res.status(500).json({
            ok: false,
            message: 'Error al obtener la siguiente jornada'
        });
    }
}

const getJornadas = async (req, res) => {
    try {
        const query = 'SELECT * FROM jornadas ORDER BY numero_jornada ASC';

        const { rows } = await pool.query(query);

        res.status(200).json({
            ok: true,
            data: rows
        });

    } catch (error) {
        console.error('Error al obtener las jornadas:', error);
        res.status(500).json({
            ok: false,
            message: 'Error al obtener las jornadas'
        });
    }
}

const cargarPartidosJornada = async (req, res) => {
    try {
        const { jornadaId } = req.body;

        const query = `
            SELECT p.id as partido_id, p.jornada_id, p.equipo_local_id, p.equipo_visitante_id, 
            p.fecha_partido, p.goles_local, p.goles_visitante, p.jugado, p.tiene_acta,
            eq_loc.nombre as local_nombre, eq_vis.nombre as visitante_nombre,
            eq_loc.escudo_url as local_escudo_url, eq_vis.escudo_url as visitante_escudo_url
            FROM partidos p
            INNER JOIN equipos eq_loc ON p.equipo_local_id = eq_loc.id
            INNER JOIN equipos eq_vis ON p.equipo_visitante_id = eq_vis.id
            WHERE p.jornada_id = $1
            ORDER BY p.fecha_partido ASC
        `;

        const { rows } = await pool.query(query, [jornadaId]);

        if (rows.length === 0) {
            return res.status(404).json({
                ok: false,
                message: 'No se encontraron partidos para la jornada'
            });
        }

        const partidosProcesados = await Promise.all(
            rows.map(async (partido) => {
                const localUrl = await getDownloadUrl('equipos/' + partido.local_escudo_url);
                const visitanteUrl = await getDownloadUrl('equipos/' + partido.visitante_escudo_url);

                partido.local_escudo = localUrl;
                partido.visitante_escudo = visitanteUrl;

                return partido;
            })
        );

        res.status(200).json({
            ok: true,
            data: partidosProcesados
        });

    } catch (error) {
        console.error('Error al cargar los partidos de la jornada:', error);
        res.status(500).json({
            ok: false,
            message: 'Error al cargar los partidos de la jornada'
        });
    }
}

const cambiarEstadoJornada = async (req, res) => {
    try {
        const { jornadaId, estado } = req.body;

        const query = 'UPDATE jornadas SET estado = $1 WHERE id = $2';
        await pool.query(query, [estado, jornadaId]);

        res.status(200).json({
            ok: true,
            message: 'Estado de la jornada cambiado exitosamente'
        });

    } catch (error) {
        console.error('Error al cambiar el estado de la jornada:', error);
        res.status(500).json({
            ok: false,
            message: 'Error al cambiar el estado de la jornada'
        });
    }
}

const crearJornada = async (req, res) => {
    try {
        const { numero_jornada, estado, fecha_inicio, fecha_fin } = req.body;

        const query = 'INSERT INTO jornadas (numero_jornada, estado, fecha_inicio, fecha_fin, competicion_id) VALUES ($1, $2, $3, $4, $5) RETURNING *';
        const { rows } = await pool.query(query, [numero_jornada, estado, fecha_inicio, fecha_fin, 1]);

        res.status(200).json({
            ok: true,
            message: 'Jornada creada exitosamente',
            data: rows[0]
        });

    } catch (error) {
        console.error('Error al crear la jornada:', error);
        res.status(500).json({
            ok: false,
            message: 'Error al crear la jornada'
        });
    }
}

const getPuntuacionesJornadas = async (req, res) => {
    try {
        const { liga_id, usuario_id } = req.body;

        const query = `
            SELECT DISTINCT 
                j.id as jornada_id,
                j.numero_jornada, 
                j.estado,
                COALESCE(SUM(pjj.puntos_totales), 0) AS puntos_totales
            FROM plantillas_usuario pu
            JOIN jornadas j ON j.id = pu.jornada_id
            LEFT JOIN plantilla_jugadores pj ON pj.plantilla_id = pu.id
            LEFT JOIN puntos_jugadores_jornada pjj ON pjj.jugador_id = pj.jugador_id AND pjj.jornada_id = pu.jornada_id
            WHERE pu.liga_id = $1 AND pu.usuario_id = $2
            GROUP BY j.id, j.numero_jornada, j.estado
            ORDER BY j.numero_jornada DESC;
        `; 

        const { rows } = await pool.query(query, [liga_id, usuario_id]);

        res.status(200).json({
            ok: true,
            data: rows
        });

    } catch (error) {
        console.error('Error al obtener las puntuaciones de las jornadas:', error);
        res.status(500).json({
            ok: false,
            message: 'Error al obtener las puntuaciones de las jornadas'
        });
    }
}


module.exports = {
    getCalendarioJornadas,
    getJornadaActual,
    getJornadas,
    cargarPartidosJornada,
    cambiarEstadoJornada,
    crearJornada,
    getSiguienteJornada,
    getPuntuacionesJornadas
};