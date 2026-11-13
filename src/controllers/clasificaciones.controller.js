const pool = require('../config/db');
const { getDownloadUrl } = require('../config/s3');
const { esMiembroLiga } = require('../services/permisos');

const getClasificacionLiga = async (req, res) => {
    try {
        const { liga_id } = req.body;

        if (!liga_id) {
            return res.status(400).json({ error: 'Faltan parámetros requeridos.' });
        }

        const query = `
            SELECT 
                u.id AS usuario_id,
                u.nombre_usuario,
                u.nombre_club,
                u.image_url,
                COALESCE(SUM(pjj.puntos_totales), 0) AS puntos_totales,
                RANK() OVER (ORDER BY COALESCE(SUM(pjj.puntos_totales), 0) DESC) AS posicion
            FROM liga_usuarios lu
            JOIN usuarios u ON u.id = lu.usuario_id
            LEFT JOIN plantillas_usuario pu ON pu.usuario_id = u.id AND pu.liga_id = lu.liga_id
            LEFT JOIN plantilla_jugadores pj ON pj.plantilla_id = pu.id
            LEFT JOIN puntos_jugadores_jornada pjj ON pjj.jugador_id = pj.jugador_id AND pjj.jornada_id = pu.jornada_id
            WHERE lu.liga_id = $1
            GROUP BY u.id, u.nombre_usuario, u.nombre_club, u.image_url
            ORDER BY puntos_totales DESC;
        `;

        const resClasificacion = await pool.query(query, [liga_id]);

        // AQUÍ IRÍA LA PARTE DE PROCESADOR EL AVATAR DEL USUARIO
        const clasificacionProcesada = await Promise.all(
            resClasificacion.rows.map(async (usuario) => {
                if (usuario.image_url && usuario.image_url.startsWith('avatar')) {
                    const imageUrl = await getDownloadUrl('usuarios/' + usuario.image_url);
                    return { ...usuario, image_url: imageUrl };
                }
                return usuario;
            })
        )

        res.status(200).json({
            ok: true,
            data: clasificacionProcesada
        });
    } catch (error) {
        console.error('Error al obtener la clasificación de la liga:', error);
        res.status(500).json({
            ok: false,
            message: 'Error al obtener la clasificación de la liga'
        });
    }
}

const getClasificacionPorJornada = async (req, res) => {
    try {
        const { liga_id,jornada_id } = req.body;

        if (!jornada_id) {
            return res.status(400).json({ error: 'Faltan parámetros requeridos.' });
        }

        const query = `
            SELECT 
                u.id AS usuario_id,
                u.nombre_usuario,
                u.nombre_club,
                u.image_url,
                COALESCE(SUM(pjj.puntos_totales), 0) AS puntos_totales,
                RANK() OVER (ORDER BY COALESCE(SUM(pjj.puntos_totales), 0) DESC) AS posicion
            FROM liga_usuarios lu
            JOIN usuarios u ON u.id = lu.usuario_id
            LEFT JOIN plantillas_usuario pu ON pu.usuario_id = u.id AND pu.liga_id = lu.liga_id
            LEFT JOIN plantilla_jugadores pj ON pj.plantilla_id = pu.id
            LEFT JOIN puntos_jugadores_jornada pjj ON pjj.jugador_id = pj.jugador_id AND pjj.jornada_id = pu.jornada_id
            WHERE lu.liga_id = $1 AND pu.jornada_id = $2
            GROUP BY u.id, u.nombre_usuario, u.nombre_club, u.image_url
            ORDER BY puntos_totales DESC;
        `;

        const resClasificacion = await pool.query(query, [liga_id,jornada_id]);

        // AQUÍ IRÍA LA PARTE DE PROCESADOR EL AVATAR DEL USUARIO
        const clasificacionProcesada = await Promise.all(
            resClasificacion.rows.map(async (usuario) => {
                if (usuario.image_url && usuario.image_url.startsWith('avatar')) {
                    const imageUrl = await getDownloadUrl('usuarios/' + usuario.image_url);
                    return { ...usuario, image_url: imageUrl };
                }
                return usuario;
            })
        )

        res.status(200).json({
            ok: true,
            data: clasificacionProcesada
        });

    } catch (error) {
        console.error('Error al obtener la clasificación por jornada:', error);
        res.status(500).json({
            ok: false,
            message: 'Error al obtener la clasificación por jornada'
        });
    }
}

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
    getClasificacionLiga, getClasificacionPorJornada, getResumenUltimaJornada
}