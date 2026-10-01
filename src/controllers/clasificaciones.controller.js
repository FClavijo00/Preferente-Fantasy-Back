const pool = require('../config/db');
const { getDownloadUrl } = require('../config/s3');

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

        res.status(200).json({
            ok: true,
            data: resClasificacion.rows
        });
    } catch (error) {
        console.error('Error al obtener la clasificación de la liga:', error);
        res.status(500).json({
            ok: false,
            message: 'Error al obtener la clasificación de la liga'
        });
    }
}

module.exports = {
    getClasificacionLiga
}