const pool = require('../config/db');
const { getDownloadUrl } = require('../config/s3');

/*
 * Datos PÚBLICOS (sin sesión) para las páginas abiertas de la web: resultados, clasificación y 11 ideal.
 * Solo datos deportivos de la competición real; nada de usuarios ni de ligas fantasy.
 *
 * Una jornada solo se publica cuando tiene 11 ideal: el admin lo pone cuando ya están todas las actas,
 * así que es la garantía de que los datos de la jornada están completos.
 */

const COMPETICION = 1;

/** Firma las URLs de S3 una sola vez por petición (los escudos se repiten mucho). */
const crearFirmador = () => {
    const cache = new Map();
    return (carpeta, archivo) => {
        if (!archivo) return null;
        const clave = `${carpeta}/${archivo}`;
        if (!cache.has(clave)) cache.set(clave, getDownloadUrl(clave).catch(() => null));
        return cache.get(clave);
    };
};

/** Clasificación de la liga real contando solo hasta la jornada indicada (incluida). */
const clasificacionHasta = async (numeroJornada) => {
    const { rows } = await pool.query(
        `WITH jugados AS (
            SELECT p.equipo_local_id AS equipo_id, p.goles_local AS gf, p.goles_visitante AS gc
              FROM partidos p JOIN jornadas j ON j.id = p.jornada_id
             WHERE j.competicion_id = $1 AND j.numero_jornada <= $2
               AND p.jugado AND p.goles_local IS NOT NULL AND p.goles_visitante IS NOT NULL
            UNION ALL
            SELECT p.equipo_visitante_id, p.goles_visitante, p.goles_local
              FROM partidos p JOIN jornadas j ON j.id = p.jornada_id
             WHERE j.competicion_id = $1 AND j.numero_jornada <= $2
               AND p.jugado AND p.goles_local IS NOT NULL AND p.goles_visitante IS NOT NULL
        ),
        resultados AS (
            SELECT equipo_id,
                   COUNT(*)::INT AS pj,
                   SUM(CASE WHEN gf > gc THEN 1 ELSE 0 END)::INT AS g,
                   SUM(CASE WHEN gf = gc THEN 1 ELSE 0 END)::INT AS e,
                   SUM(CASE WHEN gf < gc THEN 1 ELSE 0 END)::INT AS p,
                   SUM(gf)::INT AS gf, SUM(gc)::INT AS gc,
                   SUM(CASE WHEN gf > gc THEN 3 WHEN gf = gc THEN 1 ELSE 0 END)::INT AS puntos_brutos
              FROM jugados GROUP BY equipo_id
        ),
        sanciones AS (SELECT equipo_id, SUM(puntos)::INT AS san FROM sanciones_equipo GROUP BY equipo_id)
        SELECT e.id AS equipo_id, e.nombre AS equipo, e.siglas, e.escudo_url,
               COALESCE(r.pj, 0) AS pj, COALESCE(r.g, 0) AS g, COALESCE(r.e, 0) AS e, COALESCE(r.p, 0) AS p,
               COALESCE(r.gf, 0) AS gf, COALESCE(r.gc, 0) AS gc,
               COALESCE(r.gf, 0) - COALESCE(r.gc, 0) AS dg,
               COALESCE(s.san, 0) AS san,
               COALESCE(r.puntos_brutos, 0) - COALESCE(s.san, 0) AS puntos
          FROM equipos e
          LEFT JOIN resultados r ON r.equipo_id = e.id
          LEFT JOIN sanciones s ON s.equipo_id = e.id
         WHERE e.competicion_id = $1
         ORDER BY puntos DESC, dg DESC, gf DESC, e.nombre ASC`,
        [COMPETICION, numeroJornada],
    );
    return rows;
};

/**
 * GET /api/publico/jornada/:numero?  (sin número → la última publicada)
 * Resultados, clasificación tras esa jornada (con subidas/bajadas), 11 ideal y mejores jugadores.
 */
const getJornadaPublica = async (req, res) => {
    try {
        const { rows: publicadas } = await pool.query(
            `SELECT j.id, j.numero_jornada, j.fecha_inicio, j.fecha_fin
               FROM jornadas j
               JOIN once_ideal oi ON oi.jornada_id = j.id
              WHERE j.competicion_id = $1
              ORDER BY j.numero_jornada DESC`,
            [COMPETICION],
        );
        if (publicadas.length === 0) {
            return res.status(404).json({ ok: false, message: 'Todavía no hay jornadas publicadas.' });
        }

        let jornada = publicadas[0];
        if (req.params.numero !== undefined) {
            const numero = Number(req.params.numero);
            jornada = publicadas.find((j) => j.numero_jornada === numero);
            if (!Number.isInteger(numero) || !jornada) {
                return res.status(404).json({ ok: false, message: 'Esa jornada no está publicada.' });
            }
        }
        const firmar = crearFirmador();

        // Partidos de la jornada
        const { rows: partidos } = await pool.query(
            `SELECT p.id, p.goles_local, p.goles_visitante, p.jugado,
                    to_char(p.fecha_partido, 'YYYY-MM-DD"T"HH24:MI') AS fecha,
                    el.id AS local_id, el.nombre AS local_nombre, el.escudo_url AS local_escudo_url,
                    ev.id AS visitante_id, ev.nombre AS visitante_nombre, ev.escudo_url AS visitante_escudo_url
               FROM partidos p
               JOIN equipos el ON el.id = p.equipo_local_id
               JOIN equipos ev ON ev.id = p.equipo_visitante_id
              WHERE p.jornada_id = $1
              ORDER BY p.fecha_partido ASC, p.id ASC`,
            [jornada.id],
        );

        // Clasificación tras la jornada y la de la anterior, para saber quién sube y quién baja
        const [clasificacion, anterior] = await Promise.all([
            clasificacionHasta(jornada.numero_jornada),
            jornada.numero_jornada > 1 ? clasificacionHasta(jornada.numero_jornada - 1) : Promise.resolve([]),
        ]);
        const posAnterior = new Map(anterior.map((f, i) => [f.equipo_id, i + 1]));

        // 11 ideal
        const { rows: onceInfo } = await pool.query(
            `SELECT oi.id, f.formacion FROM once_ideal oi JOIN formaciones f ON f.id = oi.formacion_id
              WHERE oi.jornada_id = $1`,
            [jornada.id],
        );
        const { rows: once } = await pool.query(
            `SELECT j.id, j.nombre, j.apellidos, j.apodo, j.posicion, j.foto_url,
                    e.nombre AS equipo, e.escudo_url, pjj.puntos_totales AS puntos
               FROM plantilla_onces_ideales poi
               JOIN jugadores j ON j.id = poi.jugador_id
               LEFT JOIN LATERAL (
                    SELECT pjx.equipo_id FROM partido_jugadores pjx
                      JOIN partidos px ON px.id = pjx.partido_id
                     WHERE pjx.jugador_id = j.id AND px.jornada_id = $2 LIMIT 1
               ) eqj ON true
               JOIN equipos e ON e.id = COALESCE(eqj.equipo_id, j.equipo_id)
               LEFT JOIN puntos_jugadores_jornada pjj ON pjj.jugador_id = j.id AND pjj.jornada_id = $2
              WHERE poi.once_ideal_id = $1
              ORDER BY poi.hueco_index ASC`,
            [onceInfo[0].id, jornada.id],
        );

        // Mejores jugadores y goleadores de la jornada (según las actas)
        const { rows: puntuados } = await pool.query(
            `SELECT j.id, j.nombre, j.apellidos, j.apodo, j.posicion,
                    e.nombre AS equipo, e.escudo_url, pjj.puntos_totales AS puntos,
                    COALESCE(jsonb_array_length(pjj.desglose_json::jsonb -> 'goles'), 0)::INT AS goles
               FROM puntos_jugadores_jornada pjj
               JOIN jugadores j ON j.id = pjj.jugador_id
               LEFT JOIN partido_jugadores pj ON pj.jugador_id = j.id AND pj.partido_id = pjj.partido_id
               JOIN equipos e ON e.id = COALESCE(pj.equipo_id, j.equipo_id)
              WHERE pjj.jornada_id = $1
              ORDER BY pjj.puntos_totales DESC, goles DESC, j.nombre ASC`,
            [jornada.id],
        );

        // Acumulado de la temporada hasta esta jornada (incluida): puntos y goles de cada jugador,
        // con el último equipo en el que jugó hasta entonces
        const { rows: acumulado } = await pool.query(
            `WITH totales AS (
                SELECT pjj.jugador_id,
                       SUM(pjj.puntos_totales)::INT AS puntos,
                       SUM(COALESCE(jsonb_array_length(pjj.desglose_json::jsonb -> 'goles'), 0))::INT AS goles
                  FROM puntos_jugadores_jornada pjj
                  JOIN jornadas jo ON jo.id = pjj.jornada_id
                 WHERE jo.competicion_id = $1 AND jo.numero_jornada <= $2
                 GROUP BY pjj.jugador_id
            )
            SELECT j.id, j.nombre, j.apellidos, j.apodo, j.posicion,
                   e.nombre AS equipo, e.escudo_url, t.puntos, t.goles
              FROM totales t
              JOIN jugadores j ON j.id = t.jugador_id
              LEFT JOIN LATERAL (
                   SELECT pjx.equipo_id FROM partido_jugadores pjx
                     JOIN partidos px ON px.id = pjx.partido_id
                     JOIN jornadas jx ON jx.id = px.jornada_id
                    WHERE pjx.jugador_id = j.id AND jx.competicion_id = $1 AND jx.numero_jornada <= $2
                    ORDER BY jx.numero_jornada DESC LIMIT 1
              ) eq ON true
              JOIN equipos e ON e.id = COALESCE(eq.equipo_id, j.equipo_id)`,
            [COMPETICION, jornada.numero_jornada],
        );

        const nombreJugador = (j) => j.apodo || [j.nombre, j.apellidos].filter(Boolean).join(' ');
        const jugadorPublico = async (j) => ({
            id: j.id,
            nombre: nombreJugador(j),
            posicion: j.posicion,
            equipo: j.equipo,
            escudo: await firmar('equipos', j.escudo_url),
            puntos: j.puntos ?? 0,
            ...(j.goles !== undefined ? { goles: j.goles } : {}),
        });

        const data = {
            jornada: {
                numero: jornada.numero_jornada,
                fecha_inicio: jornada.fecha_inicio,
                fecha_fin: jornada.fecha_fin,
            },
            jornadas: publicadas.map((j) => j.numero_jornada),
            partidos: await Promise.all(
                partidos.map(async (p) => ({
                    id: p.id,
                    fecha: p.fecha,
                    jugado: p.jugado,
                    local: { id: p.local_id, nombre: p.local_nombre, escudo: await firmar('equipos', p.local_escudo_url) },
                    visitante: {
                        id: p.visitante_id,
                        nombre: p.visitante_nombre,
                        escudo: await firmar('equipos', p.visitante_escudo_url),
                    },
                    goles_local: p.goles_local,
                    goles_visitante: p.goles_visitante,
                })),
            ),
            clasificacion: await Promise.all(
                clasificacion.map(async (f, i) => ({
                    posicion: i + 1,
                    posicion_anterior: posAnterior.get(f.equipo_id) ?? null,
                    equipo_id: f.equipo_id,
                    equipo: f.equipo,
                    escudo: await firmar('equipos', f.escudo_url),
                    pj: f.pj, g: f.g, e: f.e, p: f.p, gf: f.gf, gc: f.gc, dg: f.dg, san: f.san, puntos: f.puntos,
                })),
            ),
            once_ideal: {
                formacion: onceInfo[0].formacion,
                jugadores: await Promise.all(
                    once.map(async (j) => ({ ...(await jugadorPublico(j)), foto: await firmar('jugadores', j.foto_url) })),
                ),
            },
            // De la jornada: solo para el resumen (el mejor de la jornada y quién marcó más)
            mvp_jornada: puntuados[0] ? await jugadorPublico(puntuados[0]) : null,
            goleadores_jornada: await Promise.all(
                puntuados
                    .filter((j) => j.goles > 0)
                    .sort((a, b) => b.goles - a.goles || b.puntos - a.puntos)
                    .slice(0, 10)
                    .map(jugadorPublico),
            ),
            // Rankings de la temporada hasta esta jornada
            ranking_puntos: await Promise.all(
                [...acumulado]
                    .sort((a, b) => b.puntos - a.puntos || b.goles - a.goles || nombreJugador(a).localeCompare(nombreJugador(b)))
                    .slice(0, 10)
                    .map(jugadorPublico),
            ),
            ranking_goleadores: await Promise.all(
                acumulado
                    .filter((j) => j.goles > 0)
                    .sort((a, b) => b.goles - a.goles || b.puntos - a.puntos || nombreJugador(a).localeCompare(nombreJugador(b)))
                    .slice(0, 10)
                    .map(jugadorPublico),
            ),
            total_goles: partidos.reduce((s, p) => s + (p.goles_local ?? 0) + (p.goles_visitante ?? 0), 0),
        };

        // Lo mismo para todos: que el navegador y Vercel lo reutilicen un rato (las firmas duran 1 h)
        res.set('Cache-Control', 'public, max-age=300');
        res.status(200).json({ ok: true, data });
    } catch (error) {
        console.error('Error al obtener la jornada pública:', error);
        res.status(500).json({ ok: false, message: 'Error al obtener la jornada' });
    }
};

module.exports = { getJornadaPublica };
