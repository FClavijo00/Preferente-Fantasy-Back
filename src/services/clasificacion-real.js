const pool = require('../config/db');

const COMPETICION = 1;

/**
 * Clasificación de la liga real contando solo hasta la jornada indicada (incluida).
 * Mismo cálculo y desempates que vista_clasificacion (puntos, diferencia de goles, goles a favor, nombre).
 * Las sanciones se restan siempre (no guardamos en qué jornada se impusieron).
 */
const clasificacionHasta = async (numeroJornada, competicionId = COMPETICION) => {
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
        [competicionId, numeroJornada],
    );
    return rows;
};

/**
 * Puesto de cada equipo antes de la última jornada con resultados (para las flechas de sube/baja).
 * Map equipo_id → posición. Vacío si aún no hay una jornada anterior con partidos.
 */
const posicionesJornadaAnterior = async (competicionId = COMPETICION) => {
    const { rows } = await pool.query(
        `SELECT MAX(j.numero_jornada) AS ultima
           FROM partidos p JOIN jornadas j ON j.id = p.jornada_id
          WHERE j.competicion_id = $1 AND p.jugado
            AND p.goles_local IS NOT NULL AND p.goles_visitante IS NOT NULL`,
        [competicionId],
    );
    const ultima = rows[0]?.ultima;
    if (!ultima || ultima <= 1) return new Map();
    const anterior = await clasificacionHasta(ultima - 1, competicionId);
    if (!anterior.some((f) => f.pj > 0)) return new Map();
    return new Map(anterior.map((f, i) => [f.equipo_id, i + 1]));
};

module.exports = { clasificacionHasta, posicionesJornadaAnterior, COMPETICION };
