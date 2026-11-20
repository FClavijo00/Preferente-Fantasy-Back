/**
 * Notificaciones push (Web Push con claves VAPID, sin Firebase).
 *
 * Variables de entorno (cada entorno con SUS claves; si cambian, se pierden las suscripciones):
 *   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY   npx web-push generate-vapid-keys
 *   VAPID_SUBJECT                         URL de la web (o mailto:) para los servicios de push
 * Sin claves, todo sigue funcionando y las notificaciones simplemente no se envían.
 *
 * Tipos (columna de notificaciones_preferencias): actas, recordatorios, once_ideal, avisos.
 * Cada aviso automático se registra en notificaciones_enviadas (tipo + clave) ANTES de enviarse,
 * así nunca sale dos veces aunque se repita la acción o haya dos instancias del servidor.
 */
const webpush = require('web-push');
const db = require('../config/db');

const TIPOS = ['actas', 'recordatorios', 'once_ideal', 'avisos'];

const configurado = Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
if (configurado) {
    webpush.setVapidDetails(
        process.env.VAPID_SUBJECT || 'https://preferente-fantasy.vercel.app',
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY,
    );
} else {
    console.warn('🔕 Notificaciones push desactivadas: faltan VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY');
}

const clavePublica = () => (configurado ? process.env.VAPID_PUBLIC_KEY : null);

/**
 * Reserva un aviso (tipo + clave). Devuelve true si es la primera vez y hay que enviarlo,
 * false si ya se había enviado (o reservado) antes.
 */
const reservarEnvio = async (tipo, clave, titulo, cuerpo) => {
    const { rowCount } = await db.query(
        `INSERT INTO notificaciones_enviadas (tipo, clave, titulo, cuerpo)
         VALUES ($1, $2, $3, $4) ON CONFLICT (tipo, clave) DO NOTHING`,
        [tipo, String(clave), titulo, cuerpo],
    );
    return rowCount > 0;
};

const anotarDestinatarios = (tipo, clave, n) =>
    db.query('UPDATE notificaciones_enviadas SET destinatarios = $3 WHERE tipo = $1 AND clave = $2', [
        tipo,
        String(clave),
        n,
    ]);

/** Envía a una suscripción. Si el servicio de push dice que ya no existe, la borra. */
const enviarASuscripcion = async (s, payload) => {
    try {
        await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            JSON.stringify(payload),
            { TTL: 60 * 60 * 24 }, // si el móvil está apagado, se entrega durante 24 h
        );
        return true;
    } catch (error) {
        if (error.statusCode === 404 || error.statusCode === 410) {
            await db.query('DELETE FROM push_suscripciones WHERE id = $1', [s.id]).catch(() => {});
        } else {
            console.error('Error enviando notificación push:', error.statusCode || '', error.body || error.message);
        }
        return false;
    }
};

/**
 * Envía a los dispositivos de los usuarios indicados (o de todos si usuarioIds es null)
 * que tengan activado ese tipo de notificación.
 * mensajes: un payload para todos, o una función usuarioId => payload (o null para saltarlo).
 * Devuelve cuántos dispositivos la han recibido.
 */
const enviar = async ({ tipo, usuarioIds = null, mensaje, ignorarPreferencias = false }) => {
    if (!configurado || !TIPOS.includes(tipo)) return 0;
    if (Array.isArray(usuarioIds) && usuarioIds.length === 0) return 0;

    // ${tipo} es seguro: se ha comprobado que es uno de TIPOS (nombres de columna)
    const { rows: suscripciones } = await db.query(
        `SELECT s.id, s.usuario_id, s.endpoint, s.p256dh, s.auth
           FROM push_suscripciones s
           LEFT JOIN notificaciones_preferencias np ON np.usuario_id = s.usuario_id
          WHERE ($2::boolean OR COALESCE(np.${tipo}, TRUE))
            AND ($1::int[] IS NULL OR s.usuario_id = ANY($1::int[]))`,
        [usuarioIds, ignorarPreferencias],
    );

    let entregadas = 0;
    // En tandas para no abrir cientos de conexiones a la vez
    for (let i = 0; i < suscripciones.length; i += 50) {
        const tanda = suscripciones.slice(i, i + 50);
        const resultados = await Promise.all(
            tanda.map((s) => {
                const payload = typeof mensaje === 'function' ? mensaje(s.usuario_id) : mensaje;
                return payload ? enviarASuscripcion(s, payload) : false;
            }),
        );
        entregadas += resultados.filter(Boolean).length;
    }
    return entregadas;
};

/**
 * Para los avisos automáticos: se envía solo la primera vez para ese tipo + clave.
 * Nunca lanza error (no debe romper la acción que lo dispara: guardar un acta, etc.).
 */
const enviarUnaVez = async ({ registro, clave, tipo, usuarioIds = null, mensaje, titulo, cuerpo }) => {
    if (!configurado) return 0;
    try {
        if (!(await reservarEnvio(registro, clave, titulo, cuerpo))) return 0;
        const n = await enviar({ tipo, usuarioIds, mensaje });
        await anotarDestinatarios(registro, clave, n);
        return n;
    } catch (error) {
        console.error(`Error en la notificación ${registro}/${clave}:`, error);
        return 0;
    }
};

// ===================== Avisos concretos =====================

/** Acta cerrada por primera vez: "Real Jaén 2-1 Torreperogil" · puntos disponibles. */
const notificarActa = async (partidoId) => {
    const { rows } = await db.query(
        `SELECT p.goles_local, p.goles_visitante, j.numero_jornada,
                el.nombre AS local, ev.nombre AS visitante
           FROM partidos p
           JOIN jornadas j ON j.id = p.jornada_id
           JOIN equipos el ON el.id = p.equipo_local_id
           JOIN equipos ev ON ev.id = p.equipo_visitante_id
          WHERE p.id = $1`,
        [partidoId],
    );
    if (rows.length === 0) return 0;
    const p = rows[0];
    const titulo = `⚽ ${p.local} ${p.goles_local ?? 0}-${p.goles_visitante ?? 0} ${p.visitante}`;
    const cuerpo = `Jornada ${p.numero_jornada} · Ya están los puntos de los jugadores de este partido.`;
    return enviarUnaVez({
        registro: 'acta',
        clave: partidoId,
        tipo: 'actas',
        titulo,
        cuerpo,
        mensaje: { title: titulo, body: cuerpo, url: '/tabs/clasificaciones', tag: `acta-${partidoId}` },
    });
};

/** 11 ideal publicado por primera vez en una jornada. */
const notificarOnceIdeal = async (jornadaId) => {
    const { rows } = await db.query('SELECT numero_jornada FROM jornadas WHERE id = $1', [jornadaId]);
    if (rows.length === 0) return 0;
    const titulo = `⭐ El 11 ideal de la jornada ${rows[0].numero_jornada}`;
    const cuerpo = 'Ya puedes ver a los mejores puntuados de la jornada.';
    return enviarUnaVez({
        registro: 'once_ideal',
        clave: jornadaId,
        tipo: 'once_ideal',
        titulo,
        cuerpo,
        mensaje: { title: titulo, body: cuerpo, url: '/tabs/clasificaciones', tag: `once-ideal-${jornadaId}` },
    });
};

/**
 * 2.93 h → "3 horas", 1.4 h → "1 h 30 min", 0.6 h → "35 minutos".
 * Más de una hora: redondeo al cuarto de hora (el aviso sale en una revisión cada 5 min); menos, a 5 min.
 */
const tiempoRestante = (horas) => {
    const total = Number(horas) * 60;
    const paso = total > 60 ? 15 : 5;
    const minutos = Math.max(5, Math.round(total / paso) * paso);
    const h = Math.floor(minutos / 60);
    const m = minutos % 60;
    if (h === 0) return `${m} minutos`;
    if (m === 0) return h === 1 ? '1 hora' : `${h} horas`;
    return `${h} h ${m} min`;
};

/**
 * Recordatorio de cierre de jornada (24 h o 3 h antes del inicio) a los miembros de alguna liga.
 * El texto depende de si a cada usuario le falta la alineación en alguna de sus ligas.
 */
const notificarCierreJornada = async (jornada, ventana) => {
    const { rows: usuarios } = await db.query(
        `SELECT lu.usuario_id,
                ARRAY_AGG(l.nombre ORDER BY l.nombre) FILTER (WHERE pu.id IS NULL) AS sin_alineacion
           FROM liga_usuarios lu
           JOIN ligas l ON l.id = lu.liga_id
           LEFT JOIN plantillas_usuario pu
                  ON pu.liga_id = lu.liga_id AND pu.usuario_id = lu.usuario_id AND pu.jornada_id = $1
          GROUP BY lu.usuario_id`,
        [jornada.id],
    );
    const faltan = new Map(usuarios.map((u) => [u.usuario_id, u.sin_alineacion ?? []]));
    // "hoy a las 15:00" / "mañana a las 15:00" (en hora de España)
    const dia = jornada.dias === 0 ? 'hoy' : jornada.dias === 1 ? 'mañana' : `el ${jornada.dia_semana}`;
    const titulo =
        ventana === '3h'
            ? `⏳ Quedan ${tiempoRestante(jornada.horas)} para el cierre de la jornada ${jornada.numero_jornada}`
            : `⏰ La jornada ${jornada.numero_jornada} cierra ${dia} a las ${jornada.hora}`;
    // En el de 3 h el título ya dice cuánto queda: el cuerpo recuerda la hora exacta
    const prefijo = ventana === '3h' ? `Cierra a las ${jornada.hora}. ` : '';

    return enviarUnaVez({
        registro: `recordatorio_${ventana}`,
        clave: jornada.id,
        tipo: 'recordatorios',
        usuarioIds: usuarios.map((u) => u.usuario_id),
        titulo,
        cuerpo: '(personalizado)',
        mensaje: (usuarioId) => {
            const ligas = faltan.get(usuarioId) ?? [];
            const body =
                prefijo +
                (ligas.length === 0
                    ? 'Tienes la alineación hecha. Aún puedes retocarla antes del cierre.'
                    : ligas.length === 1
                      ? `¡No tienes alineación en «${ligas[0]}»! Hazla antes del cierre o sumarás 0 puntos.`
                      : `¡Te falta la alineación en ${ligas.length} ligas! Hazlas antes del cierre o sumarás 0 puntos.`);
            // Con una sola liga entra directo a la alineación; con varias el front lo manda a recepción
            return { title: titulo, body, url: '/tabs/alineacion', tag: `cierre-${jornada.id}` };
        },
    });
};

/**
 * Revisa las jornadas pendientes y lanza los recordatorios que toquen.
 * Lo llama el temporizador del servidor cada pocos minutos (iniciarRecordatorios).
 */
const revisarRecordatorios = async () => {
    if (!configurado) return;
    try {
        // fecha_inicio está en hora de España (sin zona): se pasa a instante real para comparar
        const { rows: jornadas } = await db.query(
            `SELECT id, numero_jornada,
                    EXTRACT(EPOCH FROM ((fecha_inicio AT TIME ZONE 'Europe/Madrid') - NOW())) / 3600 AS horas,
                    TO_CHAR(fecha_inicio, 'HH24:MI') AS hora,
                    (fecha_inicio::date - (NOW() AT TIME ZONE 'Europe/Madrid')::date) AS dias,
                    (ARRAY['domingo','lunes','martes','miércoles','jueves','viernes','sábado'])
                        [EXTRACT(DOW FROM fecha_inicio)::INT + 1] AS dia_semana
               FROM jornadas
              WHERE estado = 'PENDIENTE'
                AND (fecha_inicio AT TIME ZONE 'Europe/Madrid') > NOW()
                AND (fecha_inicio AT TIME ZONE 'Europe/Madrid') <= NOW() + INTERVAL '24 hours'`,
        );
        for (const j of jornadas) {
            const horas = Number(j.horas);
            // El de 24 h solo si aún faltan más de 3 h (si la jornada se crea tarde, va directo el de 3 h)
            if (horas <= 3) await notificarCierreJornada(j, '3h');
            else await notificarCierreJornada(j, '24h');
        }
    } catch (error) {
        console.error('Error revisando los recordatorios de jornada:', error);
    }
};

/** Arranca el temporizador de recordatorios (PUSH_RECORDATORIOS=false lo desactiva). */
const iniciarRecordatorios = () => {
    if (!configurado || process.env.PUSH_RECORDATORIOS === 'false') return;
    const CADA_MINUTOS = 5;
    setTimeout(revisarRecordatorios, 30 * 1000); // al poco de arrancar
    setInterval(revisarRecordatorios, CADA_MINUTOS * 60 * 1000).unref();
    console.log(`🔔 Recordatorios de jornada activos (cada ${CADA_MINUTOS} min)`);
};

/** Lanza una tarea en segundo plano sin bloquear la respuesta ni romperla si falla. */
const enSegundoPlano = (promesa) => {
    Promise.resolve(promesa).catch((error) => console.error('Error en notificación en segundo plano:', error));
};

module.exports = {
    TIPOS,
    configurado,
    clavePublica,
    enviar,
    reservarEnvio,
    anotarDestinatarios,
    notificarActa,
    notificarOnceIdeal,
    notificarCierreJornada,
    revisarRecordatorios,
    iniciarRecordatorios,
    enSegundoPlano,
};
