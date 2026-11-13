const pool = require('../config/db');
const { getDownloadUrl } = require('../config/s3');

/* ==========================================================================
   Sanciones de puntos a equipos (panel de control, solo admin).
   La clasificación (vista_clasificacion) resta automáticamente la suma de sanciones
   de cada equipo. Tabla creada en migraciones/001_sanciones_y_clasificacion.sql
   ========================================================================== */

const MAX_PUNTOS = 99;
const MAX_MOTIVO = 200;

/** Valida y normaliza los datos de una sanción. Devuelve { datos } o { error }. */
const leerSancion = (body) => {
    const datos = {
        equipo_id: Number(body.equipo_id),
        puntos: Number(body.puntos),
        motivo: typeof body.motivo === 'string' && body.motivo.trim() ? body.motivo.trim() : null,
    };
    if (!Number.isInteger(datos.equipo_id)) return { error: 'Elige el equipo sancionado.' };
    if (!Number.isInteger(datos.puntos) || datos.puntos < 1 || datos.puntos > MAX_PUNTOS) {
        return { error: `Los puntos deben ser un número entero entre 1 y ${MAX_PUNTOS}.` };
    }
    if (datos.motivo && datos.motivo.length > MAX_MOTIVO) {
        return { error: `El motivo no puede pasar de ${MAX_MOTIVO} caracteres.` };
    }
    return { datos };
};

const equipoExiste = async (equipoId) => {
    const { rowCount } = await pool.query('SELECT 1 FROM equipos WHERE id = $1', [equipoId]);
    return rowCount > 0;
};

/** Listado de sanciones (más recientes primero) con el nombre y escudo del equipo. */
const getSancionesAdmin = async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT s.id, s.equipo_id, s.puntos, s.motivo,
                   to_char(s.created_at, 'YYYY-MM-DD"T"HH24:MI') AS creada,
                   e.nombre AS equipo, e.escudo_url
            FROM sanciones_equipo s
            JOIN equipos e ON e.id = s.equipo_id
            ORDER BY s.created_at DESC, s.id DESC`);

        const sanciones = await Promise.all(
            rows.map(async ({ escudo_url, ...s }) => ({
                ...s,
                escudo: escudo_url ? await getDownloadUrl('equipos/' + escudo_url) : null,
            })),
        );

        res.status(200).json({ ok: true, data: sanciones });
    } catch (error) {
        console.error('Error al obtener las sanciones:', error);
        res.status(500).json({ ok: false, message: 'Error al obtener las sanciones' });
    }
};

const crearSancion = async (req, res) => {
    try {
        const { datos, error } = leerSancion(req.body);
        if (error) return res.status(400).json({ ok: false, message: error });
        if (!(await equipoExiste(datos.equipo_id))) {
            return res.status(404).json({ ok: false, message: 'El equipo no existe.' });
        }

        const { rows } = await pool.query(
            'INSERT INTO sanciones_equipo (equipo_id, puntos, motivo) VALUES ($1, $2, $3) RETURNING id',
            [datos.equipo_id, datos.puntos, datos.motivo],
        );
        res.status(200).json({ ok: true, message: 'Sanción creada', data: { id: rows[0].id } });
    } catch (error) {
        console.error('Error al crear la sanción:', error);
        res.status(500).json({ ok: false, message: 'Error al crear la sanción' });
    }
};

const editarSancion = async (req, res) => {
    try {
        const id = Number(req.body.id);
        if (!Number.isInteger(id)) return res.status(400).json({ ok: false, message: 'Falta la sanción.' });

        const { datos, error } = leerSancion(req.body);
        if (error) return res.status(400).json({ ok: false, message: error });
        if (!(await equipoExiste(datos.equipo_id))) {
            return res.status(404).json({ ok: false, message: 'El equipo no existe.' });
        }

        const { rowCount } = await pool.query(
            'UPDATE sanciones_equipo SET equipo_id = $1, puntos = $2, motivo = $3 WHERE id = $4',
            [datos.equipo_id, datos.puntos, datos.motivo, id],
        );
        if (rowCount === 0) return res.status(404).json({ ok: false, message: 'La sanción no existe.' });

        res.status(200).json({ ok: true, message: 'Sanción actualizada' });
    } catch (error) {
        console.error('Error al editar la sanción:', error);
        res.status(500).json({ ok: false, message: 'Error al editar la sanción' });
    }
};

const eliminarSancion = async (req, res) => {
    try {
        const id = Number(req.body.id);
        if (!Number.isInteger(id)) return res.status(400).json({ ok: false, message: 'Falta la sanción.' });

        const { rowCount } = await pool.query('DELETE FROM sanciones_equipo WHERE id = $1', [id]);
        if (rowCount === 0) return res.status(404).json({ ok: false, message: 'La sanción no existe.' });

        res.status(200).json({ ok: true, message: 'Sanción eliminada' });
    } catch (error) {
        console.error('Error al eliminar la sanción:', error);
        res.status(500).json({ ok: false, message: 'Error al eliminar la sanción' });
    }
};

module.exports = { getSancionesAdmin, crearSancion, editarSancion, eliminarSancion };
