const db = require('../config/db');

const ROL_ADMIN = 1;

/**
 * Middleware para rutas del panel de control. Va SIEMPRE después de verifyToken.
 * El rol se lee de la base de datos (no del token) para que un cambio de rol
 * tenga efecto inmediato.
 */
const requireAdmin = async (req, res, next) => {
    try {
        const { rows } = await db.query('SELECT rol_id FROM usuarios WHERE id = $1', [req.userId]);

        if (rows.length === 0 || rows[0].rol_id !== ROL_ADMIN) {
            return res.status(403).json({ ok: false, message: 'No tienes permisos para realizar esta acción' });
        }

        next();
    } catch (error) {
        console.error('Error al comprobar permisos de administrador:', error);
        res.status(500).json({ ok: false, message: 'Error al comprobar permisos' });
    }
};

const esMiembroLiga = async (ligaId, userId) => {
    const { rowCount } = await db.query(
        'SELECT 1 FROM liga_usuarios WHERE liga_id = $1 AND usuario_id = $2',
        [ligaId, userId],
    );
    return rowCount > 0;
};

const esCreadorLiga = async (ligaId, userId) => {
    const { rowCount } = await db.query('SELECT 1 FROM ligas WHERE id = $1 AND creado_por = $2', [ligaId, userId]);
    return rowCount > 0;
};

/**
 * Ejecuta `fn(client)` dentro de una transacción real.
 * Con pool.query cada consulta puede ir por una conexión distinta del pool,
 * así que BEGIN/COMMIT/ROLLBACK no agruparían nada: hay que usar un único client.
 */
const withTransaction = async (fn) => {
    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');
        const resultado = await fn(client);
        await client.query('COMMIT');
        return resultado;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
};

module.exports = { requireAdmin, esMiembroLiga, esCreadorLiga, withTransaction, ROL_ADMIN };
