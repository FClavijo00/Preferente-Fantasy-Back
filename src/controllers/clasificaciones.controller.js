const pool = require('../config/db');
const { getDownloadUrl } = require('../config/s3');
const { esMiembroLiga } = require('../services/permisos');

/** Avatar subido por el usuario: URL firmada. El resto (avatares predefinidos o vacío) tal cual. */
const firmarAvatar = async (imageUrl) =>
    imageUrl && imageUrl.startsWith('avatar') ? getDownloadUrl('usuarios/' + imageUrl) : imageUrl;

/** Jornadas ya empezadas (en juego o cerradas) en las que la liga tiene alineaciones. */
const SQL_JORNADAS_LIGA = `
    SELECT j.id, j.numero_jornada, j.estado,
           EXISTS (SELECT 1 FROM once_ideal oi WHERE oi.jornada_id = j.id) AS tiene_once_ideal
      FROM jornadas j
     WHERE j.estado IN ('EN_JUEGO', 'CERRADA')
       AND EXISTS (SELECT 1 FROM plantillas_usuario pu WHERE pu.jornada_id = j.id AND pu.liga_id = $1)
     ORDER BY j.numero_jornada DESC, j.id DESC`;

/**
 * Clasificación general de la liga. Incluye "movimiento": puestos que ha subido (+) o bajado (-)
 * respecto a la clasificación antes de la última jornada empezada (null si solo hay una).
 */
const getClasificacionLiga = async (req, res) => {
    try {
        const ligaId = Number(req.body.liga_id);
        if (!Number.isInteger(ligaId)) {
            return res.status(400).json({ ok: false, message: 'Falta la liga.' });
        }
        if (!(await esMiembroLiga(ligaId, req.userId))) {
            return res.status(403).json({ ok: false, message: 'No perteneces a esta liga' });
        }

        const { rows: jornadas } = await pool.query(SQL_JORNADAS_LIGA, [ligaId]);
        const ultima = jornadas[0]?.id ?? null;

        const { rows } = await pool.query(
            `WITH puntos AS (
                SELECT lu.usuario_id,
                       COALESCE(SUM(pjj.puntos_totales), 0)::INT AS total,
                       COALESCE(SUM(pjj.puntos_totales) FILTER (WHERE pu.jornada_id IS DISTINCT FROM $2::INT), 0)::INT AS previo
                  FROM liga_usuarios lu
                  LEFT JOIN plantillas_usuario pu ON pu.usuario_id = lu.usuario_id AND pu.liga_id = lu.liga_id
                  LEFT JOIN plantilla_jugadores pj ON pj.plantilla_id = pu.id
                  LEFT JOIN puntos_jugadores_jornada pjj ON pjj.jugador_id = pj.jugador_id AND pjj.jornada_id = pu.jornada_id
                 WHERE lu.liga_id = $1
                 GROUP BY lu.usuario_id
             )
             SELECT u.id AS usuario_id, u.nombre_usuario, u.nombre_club, u.image_url,
                    p.total AS puntos_totales,
                    RANK() OVER (ORDER BY p.total DESC)::INT AS posicion,
                    RANK() OVER (ORDER BY p.previo DESC)::INT AS posicion_previa
               FROM puntos p
               JOIN usuarios u ON u.id = p.usuario_id
              ORDER BY p.total DESC, u.nombre_club`,
            [ligaId, ultima],
        );

        // Con menos de dos jornadas no hay con qué comparar
        const hayPrevia = jornadas.length >= 2;
        const data = [];
        for (const { posicion_previa, ...u } of rows) {
            data.push({
                ...u,
                image_url: await firmarAvatar(u.image_url),
                movimiento: hayPrevia ? posicion_previa - u.posicion : null,
            });
        }

        res.status(200).json({ ok: true, data });
    } catch (error) {
        console.error('Error al obtener la clasificación de la liga:', error);
        res.status(500).json({ ok: false, message: 'Error al obtener la clasificación de la liga' });
    }
};

/** Clasificación de una jornada empezada: solo quienes alinearon en ella. */
const getClasificacionPorJornada = async (req, res) => {
    try {
        const ligaId = Number(req.body.liga_id);
        const jornadaId = Number(req.body.jornada_id);
        if (!Number.isInteger(ligaId) || !Number.isInteger(jornadaId)) {
            return res.status(400).json({ ok: false, message: 'Faltan parámetros requeridos.' });
        }
        if (!(await esMiembroLiga(ligaId, req.userId))) {
            return res.status(403).json({ ok: false, message: 'No perteneces a esta liga' });
        }

        const { rows } = await pool.query(
            `SELECT u.id AS usuario_id, u.nombre_usuario, u.nombre_club, u.image_url,
                    COALESCE(SUM(pjj.puntos_totales), 0)::INT AS puntos_totales,
                    RANK() OVER (ORDER BY COALESCE(SUM(pjj.puntos_totales), 0) DESC)::INT AS posicion
               FROM plantillas_usuario pu
               JOIN jornadas jo ON jo.id = pu.jornada_id
               JOIN usuarios u ON u.id = pu.usuario_id
               JOIN liga_usuarios lu ON lu.usuario_id = pu.usuario_id AND lu.liga_id = pu.liga_id
               LEFT JOIN plantilla_jugadores pj ON pj.plantilla_id = pu.id
               LEFT JOIN puntos_jugadores_jornada pjj ON pjj.jugador_id = pj.jugador_id AND pjj.jornada_id = pu.jornada_id
              WHERE pu.liga_id = $1 AND pu.jornada_id = $2 AND jo.estado <> 'PENDIENTE'
              GROUP BY u.id, u.nombre_usuario, u.nombre_club, u.image_url
              ORDER BY puntos_totales DESC, u.nombre_club`,
            [ligaId, jornadaId],
        );

        const data = [];
        for (const u of rows) data.push({ ...u, image_url: await firmarAvatar(u.image_url) });

        res.status(200).json({ ok: true, data });
    } catch (error) {
        console.error('Error al obtener la clasificación por jornada:', error);
        res.status(500).json({ ok: false, message: 'Error al obtener la clasificación por jornada' });
    }
};

/** Jornadas en juego o cerradas en las que la liga tiene alineaciones (más reciente primero). */
const getJornadasLiga = async (req, res) => {
    try {
        const ligaId = Number(req.body.liga_id);
        if (!Number.isInteger(ligaId)) {
            return res.status(400).json({ ok: false, message: 'Falta la liga.' });
        }
        if (!(await esMiembroLiga(ligaId, req.userId))) {
            return res.status(403).json({ ok: false, message: 'No perteneces a esta liga' });
        }
        const { rows } = await pool.query(SQL_JORNADAS_LIGA, [ligaId]);
        res.status(200).json({ ok: true, data: rows });
    } catch (error) {
        console.error('Error al obtener las jornadas de la liga:', error);
        res.status(500).json({ ok: false, message: 'Error al obtener las jornadas de la liga' });
    }
};

/**
 * Resumen de la última jornada CERRADA jugada en una liga, para el usuario (bloque del Inicio):
 * sus puntos, su puesto en el ranking de esa jornada, cuántos participaron y la mejor puntuación.
 * El ranking es el mismo que el de Clasificación > Jornadas (solo cuentan quienes alinearon).
 */
const getResumenUltimaJornada = async (req, res) => {
    try {
        const ligaId = Number(req.body.liga_id);
        if (!Number.isInteger(ligaId)) {
            return res.status(400).json({ ok: false, message: 'Falta la liga.' });
        }
        if (!(await esMiembroLiga(ligaId, req.userId))) {
            return res.status(403).json({ ok: false, message: 'No perteneces a esta liga' });
        }

        // Última jornada cerrada en la que ESTA liga jugó (con alineaciones): una liga creada a
        // mitad de temporada no tiene nada que enseñar de jornadas anteriores
        const { rows: jornadas } = await pool.query(
            `SELECT j.id, j.numero_jornada
             FROM jornadas j
             WHERE j.estado = 'CERRADA' AND j.competicion_id = 1
               AND EXISTS (SELECT 1 FROM plantillas_usuario pu WHERE pu.jornada_id = j.id AND pu.liga_id = $1)
             ORDER BY j.numero_jornada DESC, j.id DESC
             LIMIT 1`,
            [ligaId],
        );

        if (jornadas.length === 0) {
            return res.status(200).json({ ok: true, data: { jornada: null } });
        }
        const jornada = jornadas[0];

        const { rows: ranking } = await pool.query(
            `SELECT
                pu.usuario_id,
                u.nombre_club,
                COALESCE(SUM(pjj.puntos_totales), 0)::INT AS puntos,
                RANK() OVER (ORDER BY COALESCE(SUM(pjj.puntos_totales), 0) DESC)::INT AS posicion
             FROM plantillas_usuario pu
             JOIN usuarios u ON u.id = pu.usuario_id
             LEFT JOIN plantilla_jugadores pj ON pj.plantilla_id = pu.id
             LEFT JOIN puntos_jugadores_jornada pjj
                    ON pjj.jugador_id = pj.jugador_id AND pjj.jornada_id = pu.jornada_id
             WHERE pu.liga_id = $1 AND pu.jornada_id = $2
             GROUP BY pu.usuario_id, u.nombre_club
             ORDER BY puntos DESC`,
            [ligaId, jornada.id],
        );

        const yo = ranking.find((r) => r.usuario_id === req.userId) ?? null;
        const mejor = ranking[0] ?? null;

        res.status(200).json({
            ok: true,
            data: {
                jornada,
                participantes: ranking.length,
                // null si el usuario no alineó en esa jornada
                mis_puntos: yo ? yo.puntos : null,
                mi_posicion: yo ? yo.posicion : null,
                mejor: mejor ? { nombre_club: mejor.nombre_club, puntos: mejor.puntos, soy_yo: mejor.usuario_id === req.userId } : null,
            },
        });
    } catch (error) {
        console.error('Error al obtener el resumen de la última jornada:', error);
        res.status(500).json({ ok: false, message: 'Error al obtener el resumen de la jornada' });
    }
};

module.exports = {
    getClasificacionLiga, getClasificacionPorJornada, getResumenUltimaJornada, getJornadasLiga
}