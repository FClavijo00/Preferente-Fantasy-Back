const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const pool = require('../config/db');

/*
 * Panel de control → Usuarios (solo admin): buscar usuarios y restablecer su contraseña
 * cuando la han olvidado (la app no tiene "¿Olvidaste tu contraseña?" todavía).
 */

const SALT_ROUNDS = 10; // igual que el registro y cambiarPassword
// Sin caracteres que se confunden al dictarlos o copiarlos a mano (0/O, 1/l/I)
const ALFABETO = 'abcdefghjkmnpqrstuvwxyz23456789';

/** "pf-k7m2-x9qa": fácil de pasar por mensaje y de teclear en el móvil */
const generarTemporal = () => {
    const bloque = () => Array.from({ length: 4 }, () => ALFABETO[crypto.randomInt(ALFABETO.length)]).join('');
    return `pf-${bloque()}-${bloque()}`;
};

/** POST /api/auth/buscarUsuariosAdmin { texto } → por correo, usuario o club (máx. 20) */
const buscarUsuariosAdmin = async (req, res) => {
    try {
        const texto = typeof req.body.texto === 'string' ? req.body.texto.trim() : '';
        if (texto.length < 2) {
            return res.status(400).json({ ok: false, message: 'Escribe al menos 2 letras para buscar.' });
        }
        // Los comodines que escriba el admin se buscan como texto normal
        const patron = `%${texto.replace(/[\\%_]/g, (c) => '\\' + c)}%`;

        const { rows } = await pool.query(
            `SELECT u.id, u.email, u.nombre_usuario, u.nombre_club, u.created_at, u.rol_id,
                    (SELECT COUNT(*) FROM liga_usuarios lu WHERE lu.usuario_id = u.id)::INT AS ligas
               FROM usuarios u
              WHERE u.email ILIKE $1 OR u.nombre_usuario ILIKE $1 OR u.nombre_club ILIKE $1
              ORDER BY u.nombre_usuario ASC
              LIMIT 20`,
            [patron],
        );
        res.status(200).json({ ok: true, data: rows });
    } catch (error) {
        console.error('Error al buscar usuarios:', error);
        res.status(500).json({ ok: false, message: 'Error al buscar usuarios' });
    }
};

/**
 * POST /api/auth/restablecerPasswordAdmin { usuario_id }
 * Pone una contraseña temporal aleatoria y la devuelve UNA vez para que el admin se la pase al usuario.
 * No se guarda en claro en ningún sitio (ni en los logs).
 */
const restablecerPasswordAdmin = async (req, res) => {
    try {
        const usuarioId = Number(req.body.usuario_id);
        if (!Number.isInteger(usuarioId)) {
            return res.status(400).json({ ok: false, message: 'Falta el usuario.' });
        }
        if (usuarioId === req.userId) {
            return res.status(400).json({
                ok: false,
                message: 'Tu propia contraseña cámbiala desde Perfil → Cambiar contraseña.',
            });
        }

        const temporal = generarTemporal();
        const hash = await bcrypt.hash(temporal, SALT_ROUNDS);
        const { rows } = await pool.query(
            'UPDATE usuarios SET password = $1 WHERE id = $2 RETURNING id, email, nombre_usuario',
            [hash, usuarioId],
        );
        if (rows.length === 0) return res.status(404).json({ ok: false, message: 'El usuario no existe.' });

        console.log(`🔑 Contraseña restablecida por el admin ${req.userId} para el usuario ${usuarioId}`);
        res.status(200).json({
            ok: true,
            message: `Contraseña de ${rows[0].nombre_usuario} restablecida`,
            data: { usuario_id: rows[0].id, password_temporal: temporal },
        });
    } catch (error) {
        console.error('Error al restablecer la contraseña:', error);
        res.status(500).json({ ok: false, message: 'Error al restablecer la contraseña' });
    }
};

module.exports = { buscarUsuariosAdmin, restablecerPasswordAdmin, generarTemporal };
