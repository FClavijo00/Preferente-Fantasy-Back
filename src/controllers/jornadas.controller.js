const pool = require('../config/db');
const { esMiembroLiga } = require('../services/permisos');
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
                    'fecha', to_char(p.fecha_partido, 'DD/MM/YYYY'), 
                    'hora', to_char(p.fecha_partido, 'HH24:MI'),
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
            SELECT id, competicion_id, numero_jornada, fecha_inicio,
            fecha_fin, estado, to_char(fecha_inicio, 'DD/MM/YYYY') as fecha_inicio_formateada,
            to_char(fecha_fin, 'DD/MM/YYYY') as fecha_fin_formateada,
            to_char(fecha_inicio, 'HH24:MI') as hora_inicio_formateada,
            to_char(fecha_fin, 'HH24:MI') as hora_fin_formateada
            FROM jornadas WHERE estado = 'PENDIENTE'
            ORDER BY numero_jornada ASC, id ASC
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

const getJornadasDisputadas = async (req, res) => {
    try {
        const query = `
        SELECT * 
        FROM jornadas 
        WHERE estado = 'CERRADA' 
        ORDER BY numero_jornada DESC`;

        const { rows } = await pool.query(query);

        res.status(200).json({
            ok: true,
            data: rows
        });
    } catch (error) {
        console.error('Error al obtener las jornadas disputadas:', error);
        res.status(500).json({
            ok: false,
            message: 'Error al obtener las jornadas disputadas'
        });
    }
}

const cargarPartidosJornada = async (req, res) => {
    try {
        const { jornadaId } = req.body;

        const query = `
            SELECT p.id as partido_id, p.jornada_id, p.equipo_local_id, p.equipo_visitante_id, 
            to_char(p.fecha_partido, 'DD/MM/YYYY') as fecha, to_char(p.fecha_partido, 'HH24:MI') as hora,
            p.fecha_partido, p.goles_local, p.goles_visitante, p.jugado, p.tiene_acta,
            -- Hora de España tal cual está guardada (sin conversiones de zona): para editar
            to_char(p.fecha_partido, 'YYYY-MM-DD"T"HH24:MI') as fecha_partido_local,
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

const ESTADOS_JORNADA = ['PENDIENTE', 'EN_JUEGO', 'CERRADA'];

const cambiarEstadoJornada = async (req, res) => {
    try {
        const { jornadaId, estado } = req.body;

        if (!Number.isInteger(Number(jornadaId)) || !ESTADOS_JORNADA.includes(estado)) {
            return res.status(400).json({ ok: false, message: 'Jornada o estado no válidos.' });
        }

        const query = 'UPDATE jornadas SET estado = $1 WHERE id = $2';
        const { rowCount } = await pool.query(query, [estado, jornadaId]);
        if (rowCount === 0) return res.status(404).json({ ok: false, message: 'La jornada no existe.' });

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

/* ==========================================================================
   Gestión de jornadas (panel de control, solo admin)
   Las fechas viajan como texto "YYYY-MM-DDTHH:mm" (hora de España, sin zona):
   se guardan y se muestran tal cual, sin conversiones de zona horaria.
   ========================================================================== */

const FORMATO_FECHA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/** Valida número y fechas de una jornada. Devuelve el mensaje de error o null. */
const validarJornada = ({ numero_jornada, fecha_inicio, fecha_fin }) => {
    if (!Number.isInteger(numero_jornada) || numero_jornada < 1) {
        return 'El número de jornada debe ser un entero mayor que 0.';
    }
    if (!FORMATO_FECHA.test(fecha_inicio || '') || !FORMATO_FECHA.test(fecha_fin || '')) {
        return 'Las fechas de inicio y fin son obligatorias.';
    }
    // Mismo formato y sin zona: se pueden comparar como texto
    if (fecha_fin < fecha_inicio) {
        return 'La fecha de fin no puede ser anterior a la de inicio.';
    }
    return null;
};

const numeroJornadaOcupado = async (numero, excluirId = null) => {
    const { rowCount } = await pool.query(
        'SELECT 1 FROM jornadas WHERE numero_jornada = $1 AND competicion_id = 1 AND ($2::int IS NULL OR id <> $2)',
        [numero, excluirId],
    );
    return rowCount > 0;
};

/** Jornadas con lo que cuelga de cada una (para saber si se pueden borrar). */
const getJornadasAdmin = async (req, res) => {
    try {
        const query = `
            SELECT
                j.id,
                j.numero_jornada,
                j.estado,
                to_char(j.fecha_inicio, 'YYYY-MM-DD"T"HH24:MI') AS fecha_inicio,
                to_char(j.fecha_fin, 'YYYY-MM-DD"T"HH24:MI') AS fecha_fin,
                (SELECT COUNT(*) FROM partidos p WHERE p.jornada_id = j.id)::INT AS num_partidos,
                (SELECT COUNT(*) FROM plantillas_usuario pu WHERE pu.jornada_id = j.id)::INT AS num_alineaciones,
                EXISTS (SELECT 1 FROM once_ideal oi WHERE oi.jornada_id = j.id) AS tiene_once_ideal
            FROM jornadas j
            WHERE j.competicion_id = 1
            ORDER BY j.numero_jornada ASC, j.id ASC`;

        const { rows } = await pool.query(query);
        res.status(200).json({ ok: true, data: rows });
    } catch (error) {
        console.error('Error al obtener las jornadas (admin):', error);
        res.status(500).json({ ok: false, message: 'Error al obtener las jornadas' });
    }
};

const crearJornada = async (req, res) => {
    try {
        const numero_jornada = Number(req.body.numero_jornada);
        const { fecha_inicio, fecha_fin } = req.body;

        const error = validarJornada({ numero_jornada, fecha_inicio, fecha_fin });
        if (error) return res.status(400).json({ ok: false, message: error });

        if (await numeroJornadaOcupado(numero_jornada)) {
            return res.status(409).json({ ok: false, message: `Ya existe la jornada ${numero_jornada}.` });
        }

        // Toda jornada nueva empieza PENDIENTE; el estado se cambia desde el calendario
        const query = `
            INSERT INTO jornadas (numero_jornada, estado, fecha_inicio, fecha_fin, competicion_id)
            VALUES ($1, 'PENDIENTE', $2, $3, 1)
            RETURNING id`;
        const { rows } = await pool.query(query, [numero_jornada, fecha_inicio, fecha_fin]);

        res.status(200).json({
            ok: true,
            message: `Jornada ${numero_jornada} creada`,
            data: { id: rows[0].id },
        });
    } catch (error) {
        console.error('Error al crear la jornada:', error);
        res.status(500).json({ ok: false, message: 'Error al crear la jornada' });
    }
};

const editarJornada = async (req, res) => {
    try {
        const id = Number(req.body.id);
        const numero_jornada = Number(req.body.numero_jornada);
        const { fecha_inicio, fecha_fin } = req.body;

        if (!Number.isInteger(id)) return res.status(400).json({ ok: false, message: 'Falta la jornada.' });

        const error = validarJornada({ numero_jornada, fecha_inicio, fecha_fin });
        if (error) return res.status(400).json({ ok: false, message: error });

        if (await numeroJornadaOcupado(numero_jornada, id)) {
            return res.status(409).json({ ok: false, message: `Ya existe la jornada ${numero_jornada}.` });
        }

        const { rowCount } = await pool.query(
            'UPDATE jornadas SET numero_jornada = $1, fecha_inicio = $2, fecha_fin = $3 WHERE id = $4',
            [numero_jornada, fecha_inicio, fecha_fin, id],
        );
        if (rowCount === 0) return res.status(404).json({ ok: false, message: 'La jornada no existe.' });

        res.status(200).json({ ok: true, message: `Jornada ${numero_jornada} actualizada` });
    } catch (error) {
        console.error('Error al editar la jornada:', error);
        res.status(500).json({ ok: false, message: 'Error al editar la jornada' });
    }
};

/**
 * Solo se borran jornadas vacías. Con partidos u 11 ideal la BD no dejaría (sin cascada), y
 * con alineaciones el borrado arrastraría en cascada las plantillas y puntos de los usuarios.
 */
const eliminarJornada = async (req, res) => {
    try {
        const id = Number(req.body.id);
        if (!Number.isInteger(id)) return res.status(400).json({ ok: false, message: 'Falta la jornada.' });

        const { rows } = await pool.query(
            `SELECT
                j.numero_jornada,
                (SELECT COUNT(*) FROM partidos p WHERE p.jornada_id = j.id)::INT AS num_partidos,
                (SELECT COUNT(*) FROM plantillas_usuario pu WHERE pu.jornada_id = j.id)::INT AS num_alineaciones,
                EXISTS (SELECT 1 FROM once_ideal oi WHERE oi.jornada_id = j.id) AS tiene_once_ideal
            FROM jornadas j WHERE j.id = $1`,
            [id],
        );
        if (rows.length === 0) return res.status(404).json({ ok: false, message: 'La jornada no existe.' });

        const j = rows[0];
        if (j.num_partidos > 0 || j.num_alineaciones > 0 || j.tiene_once_ideal) {
            return res.status(409).json({
                ok: false,
                message: `La jornada ${j.numero_jornada} tiene partidos, alineaciones u 11 ideal y no se puede eliminar.`,
            });
        }

        await pool.query('DELETE FROM jornadas WHERE id = $1', [id]);
        res.status(200).json({ ok: true, message: `Jornada ${j.numero_jornada} eliminada` });
    } catch (error) {
        console.error('Error al eliminar la jornada:', error);
        res.status(500).json({ ok: false, message: 'Error al eliminar la jornada' });
    }
};

const getPuntuacionesJornadas = async (req, res) => {
    try {
        const { liga_id, usuario_id } = req.body;

        if (!liga_id || !usuario_id) {
            return res.status(400).json({ ok: false, message: 'Faltan parámetros requeridos.' });
        }

        // Puntos de cualquier miembro (clasificación), pero solo dentro de tus ligas
        if (!(await esMiembroLiga(liga_id, req.userId))) {
            return res.status(403).json({ ok: false, message: 'No perteneces a esta liga' });
        }

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

/**
 * Panel de control: jornadas cerradas (y cualquiera que ya tenga 11 ideal) con su estado de 11 ideal.
 */
const getJornadasOnceIdealAdmin = async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT
                j.id,
                j.numero_jornada,
                j.estado,
                oi.id AS once_ideal_id,
                oi.formacion_id,
                f.formacion,
                (SELECT COUNT(*) FROM puntos_jugadores_jornada pjj WHERE pjj.jornada_id = j.id)::INT AS jugadores_puntuados
            FROM jornadas j
            LEFT JOIN once_ideal oi ON oi.jornada_id = j.id
            LEFT JOIN formaciones f ON f.id = oi.formacion_id
            WHERE j.competicion_id = 1 AND (j.estado = 'CERRADA' OR oi.id IS NOT NULL)
            ORDER BY j.numero_jornada DESC`);

        res.status(200).json({ ok: true, data: rows });
    } catch (error) {
        console.error('Error al obtener las jornadas del 11 ideal:', error);
        res.status(500).json({ ok: false, message: 'Error al obtener las jornadas' });
    }
};

const getJornadasOnceIdeal = async (req, res) => {
    try {
        const query = `
            SELECT J.id, J.competicion_id, J.numero_jornada, J.estado
            FROM jornadas J
            JOIN once_ideal OI ON J.id = OI.jornada_id
            ORDER BY J.id ASC
        `;

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


module.exports = {
    getCalendarioJornadas,
    getJornadaActual,
    getJornadas,
    cargarPartidosJornada,
    cambiarEstadoJornada,
    crearJornada,
    getJornadasAdmin,
    editarJornada,
    eliminarJornada,
    getSiguienteJornada,
    getPuntuacionesJornadas,
    getJornadasDisputadas,
    getJornadasOnceIdeal,
    getJornadasOnceIdealAdmin
};