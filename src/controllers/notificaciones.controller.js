const db = require('../config/db');
const push = require('../services/notificaciones');

const PREFERENCIAS_POR_DEFECTO = { actas: true, recordatorios: true, once_ideal: true, avisos: true };

/** Clave pública VAPID: la necesita el navegador para suscribirse. null si el servidor no tiene push. */
const getClavePublica = (req, res) => {
    res.status(200).json({ ok: true, data: { clave: push.clavePublica() } });
};

/** Guarda (o reasigna a este usuario) la suscripción de este navegador. */
const suscribir = async (req, res) => {
    try {
        const s = req.body?.suscripcion;
        const endpoint = typeof s?.endpoint === 'string' ? s.endpoint : '';
        const p256dh = s?.keys?.p256dh;
        const auth = s?.keys?.auth;

        if (!endpoint.startsWith('https://') || typeof p256dh !== 'string' || typeof auth !== 'string') {
            return res.status(400).json({ ok: false, message: 'Suscripción no válida.' });
        }

        // El mismo navegador puede pasar a otra cuenta: el endpoint manda y se queda con el usuario actual
        await db.query(
            `INSERT INTO push_suscripciones (usuario_id, endpoint, p256dh, auth, user_agent)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (endpoint) DO UPDATE
                SET usuario_id = EXCLUDED.usuario_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
                    user_agent = EXCLUDED.user_agent, updated_at = NOW()`,
            [req.userId, endpoint, p256dh, auth, String(req.headers['user-agent'] || '').slice(0, 300)],
        );

        res.status(200).json({ ok: true, message: 'Notificaciones activadas' });
    } catch (error) {
        console.error('Error al guardar la suscripción push:', error);
        res.status(500).json({ ok: false, message: 'No se han podido activar las notificaciones' });
    }
};

/** Borra la suscripción de este navegador (al desactivarlas o al cerrar sesión). */
const desuscribir = async (req, res) => {
    try {
        const { endpoint } = req.body || {};
        if (typeof endpoint !== 'string' || !endpoint) {
            return res.status(400).json({ ok: false, message: 'Falta el dispositivo.' });
        }
        await db.query('DELETE FROM push_suscripciones WHERE endpoint = $1 AND usuario_id = $2', [
            endpoint,
            req.userId,
        ]);
        res.status(200).json({ ok: true, message: 'Notificaciones desactivadas en este dispositivo' });
    } catch (error) {
        console.error('Error al borrar la suscripción push:', error);
        res.status(500).json({ ok: false, message: 'No se han podido desactivar las notificaciones' });
    }
};

const getPreferencias = async (req, res) => {
    try {
        const { rows } = await db.query(
            'SELECT actas, recordatorios, once_ideal, avisos FROM notificaciones_preferencias WHERE usuario_id = $1',
            [req.userId],
        );
        res.status(200).json({ ok: true, data: rows[0] ?? PREFERENCIAS_POR_DEFECTO });
    } catch (error) {
        console.error('Error al cargar las preferencias de notificaciones:', error);
        res.status(500).json({ ok: false, message: 'Error al cargar las preferencias' });
    }
};

const guardarPreferencias = async (req, res) => {
    try {
        const p = { ...PREFERENCIAS_POR_DEFECTO };
        for (const tipo of push.TIPOS) {
            if (typeof req.body?.[tipo] === 'boolean') p[tipo] = req.body[tipo];
        }
        const { rows } = await db.query(
            `INSERT INTO notificaciones_preferencias (usuario_id, actas, recordatorios, once_ideal, avisos)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (usuario_id) DO UPDATE
                SET actas = EXCLUDED.actas, recordatorios = EXCLUDED.recordatorios,
                    once_ideal = EXCLUDED.once_ideal, avisos = EXCLUDED.avisos, updated_at = NOW()
             RETURNING actas, recordatorios, once_ideal, avisos`,
            [req.userId, p.actas, p.recordatorios, p.once_ideal, p.avisos],
        );
        res.status(200).json({ ok: true, data: rows[0], message: 'Preferencias guardadas' });
    } catch (error) {
        console.error('Error al guardar las preferencias de notificaciones:', error);
        res.status(500).json({ ok: false, message: 'Error al guardar las preferencias' });
    }
};

/** Notificación de prueba a todos los dispositivos del propio usuario. */
const enviarPrueba = async (req, res) => {
    try {
        if (!push.configurado) {
            return res.status(503).json({ ok: false, message: 'El servidor no tiene las notificaciones configuradas.' });
        }
        const { rows } = await db.query('SELECT 1 FROM push_suscripciones WHERE usuario_id = $1', [req.userId]);
        if (rows.length === 0) {
            return res.status(400).json({ ok: false, message: 'No tienes las notificaciones activadas en ningún dispositivo.' });
        }
        // La prueba llega siempre, tenga los tipos que tenga activados
        const n = await push.enviar({
            tipo: 'avisos',
            usuarioIds: [req.userId],
            ignorarPreferencias: true,
            mensaje: {
                title: '🔔 ¡Notificaciones activadas!',
                body: 'Así te avisaremos de los resultados, del cierre de las jornadas y del 11 ideal.',
                url: '/recepcion',
                tag: 'prueba',
            },
        });
        if (n === 0) {
            return res.status(502).json({ ok: false, message: 'No se ha podido entregar la prueba. Vuelve a activarlas.' });
        }
        res.status(200).json({ ok: true, message: `Notificación de prueba enviada a ${n} dispositivo${n === 1 ? '' : 's'}` });
    } catch (error) {
        console.error('Error al enviar la notificación de prueba:', error);
        res.status(500).json({ ok: false, message: 'No se ha podido enviar la prueba' });
    }
};

/** Panel de control: aviso con mensaje libre a todos los que tengan "avisos" activado. */
const enviarAviso = async (req, res) => {
    try {
        const titulo = typeof req.body?.titulo === 'string' ? req.body.titulo.trim() : '';
        const mensaje = typeof req.body?.mensaje === 'string' ? req.body.mensaje.trim() : '';
        const url = typeof req.body?.url === 'string' && req.body.url.startsWith('/') ? req.body.url : '/recepcion';

        if (titulo.length < 3 || titulo.length > 80 || mensaje.length < 3 || mensaje.length > 250) {
            return res.status(400).json({
                ok: false,
                message: 'El título (3-80 caracteres) y el mensaje (3-250) son obligatorios.',
            });
        }
        if (!push.configurado) {
            return res.status(503).json({ ok: false, message: 'El servidor no tiene las notificaciones configuradas.' });
        }

        // Cada aviso del panel es único: la clave es la hora de envío
        const clave = `${Date.now()}-${req.userId}`;
        await push.reservarEnvio('aviso', clave, titulo, mensaje);
        const n = await push.enviar({ tipo: 'avisos', mensaje: { title: titulo, body: mensaje, url, tag: `aviso-${clave}` } });
        await push.anotarDestinatarios('aviso', clave, n);

        res.status(200).json({
            ok: true,
            data: { entregadas: n },
            message: n ? `Aviso enviado a ${n} dispositivo${n === 1 ? '' : 's'}` : 'Aviso guardado, pero nadie lo tiene activado aún',
        });
    } catch (error) {
        console.error('Error al enviar el aviso:', error);
        res.status(500).json({ ok: false, message: 'No se ha podido enviar el aviso' });
    }
};

/** Panel de control: últimos avisos enviados (de todos los tipos) y cuántos dispositivos hay. */
const getHistorialAvisos = async (req, res) => {
    try {
        const [{ rows: historial }, { rows: total }] = await Promise.all([
            db.query(
                `SELECT id, tipo, titulo, cuerpo, destinatarios, created_at
                   FROM notificaciones_enviadas ORDER BY created_at DESC LIMIT 30`,
            ),
            db.query('SELECT COUNT(*)::INT AS dispositivos, COUNT(DISTINCT usuario_id)::INT AS usuarios FROM push_suscripciones'),
        ]);
        res.status(200).json({ ok: true, data: { historial, ...total[0], configurado: push.configurado } });
    } catch (error) {
        console.error('Error al cargar el historial de avisos:', error);
        res.status(500).json({ ok: false, message: 'Error al cargar el historial' });
    }
};

module.exports = {
    getClavePublica,
    suscribir,
    desuscribir,
    getPreferencias,
    guardarPreferencias,
    enviarPrueba,
    enviarAviso,
    getHistorialAvisos,
};
