const pool = require('../config/db');
const { getDownloadUrl } = require('../config/s3');

const getEquipos = async (req, res) => {
  try {

    const query = `
      WITH puntos_agrupados AS (
        -- 1. Calculamos los puntos totales y la lista de puntuaciones por jornada para cada jugador
        SELECT 
          PJJ.jugador_id,
          COALESCE(SUM(PJJ.puntos_totales), 0) AS puntos_totales_acumulados,
          COALESCE(
            json_agg(
              json_build_object(
                'jornada', J.numero_jornada,
                'puntos', PJJ.puntos_totales,
                'desglose', PJJ.desglose_json,
                'jornada_id', PJJ.jornada_id
              ) ORDER BY PJJ.jornada_id DESC
            ) FILTER (WHERE PJJ.jornada_id IS NOT NULL),
            '[]'::json
          ) AS historial_jornadas
        FROM puntos_jugadores_jornada PJJ
        INNER JOIN jornadas J ON J.id = PJJ.jornada_id
        GROUP BY jugador_id
      )
      SELECT 
        E.*,
        COALESCE(
          json_agg(
            json_build_object(
              'id', J.id,
              'nombre', J.nombre,
              'apellidos', J.apellidos,
              'apodo', J.apodo,
              'posicion', J.posicion,
              'foto_url', J.foto_url,
              'lesionado', J.lesionado,
              'activo', J.activo,
              'precio', J.precio,
              'puntos_totales', COALESCE(PA.puntos_totales_acumulados, 0),
              'puntuaciones_jornada', COALESCE(PA.historial_jornadas, '[]'::json)
            )
            ORDER BY 
              CASE J.posicion
                WHEN 'POR' THEN 1
                WHEN 'DEF' THEN 2
                WHEN 'MED' THEN 3
                WHEN 'DEL' THEN 4
                ELSE 5
              END ASC,
              COALESCE(PA.puntos_totales_acumulados, 0) DESC,
              J.nombre ASC -- Criterio de desempate opcional por nombre
          ) FILTER (WHERE J.id IS NOT NULL AND J.activo = true),
          '[]'::json
        ) AS jugadores
      FROM equipos E
      LEFT JOIN jugadores J ON J.equipo_id = E.id
      LEFT JOIN puntos_agrupados PA ON PA.jugador_id = J.id
      GROUP BY E.id
      ORDER BY E.nombre ASC;
    `;

    const { rows } = await pool.query(query);

    const equiposProcesados = await Promise.all(
      rows.map(async (equipo) => {
        const fotoUrl = await getDownloadUrl('equipos/' + equipo.escudo_url);
        equipo.escudo = fotoUrl;

        const listaJugadores = await Promise.all(
          (equipo.jugadores || []).map(async (jugador) => {
            if (!jugador.foto_url) {
              return {
                ...jugador,
                foto: null
              }
            } else {
              const fotoUrl = await getDownloadUrl('jugadores/' + jugador.foto_url);
              return {
                ...jugador,
                foto: fotoUrl
              };
            }
          })
        )

        equipo.jugadores = listaJugadores;

        return equipo;
      }
      ));

    res.status(200).json({
      ok: true,
      data: equiposProcesados
    });
  } catch (error) {
    console.error('Error al obtener equipos:', error);
    res.status(500).json({
      ok: false,
      message: 'Error al obtener la lista de equipos'
    });
  }
};

const getClasificacion = async (req, res) => {
  try {
    const query = `
      SELECT * FROM vista_clasificacion
    `;

    const { rows } = await pool.query(query);

    // Detalle de las sanciones (puntos y motivo) para enseñarlas en la clasificación
    const { rows: sanciones } = await pool.query(
      'SELECT equipo_id, puntos, motivo FROM sanciones_equipo ORDER BY created_at, id'
    );

    const clasificacionProcesada = await Promise.all(
      rows.map(async (equipo) => {
        const fotoUrl = await getDownloadUrl('equipos/' + equipo.escudo_url);
        equipo.escudo = fotoUrl;
        equipo.sanciones = sanciones
          .filter((s) => s.equipo_id === equipo.equipo_id)
          .map(({ puntos, motivo }) => ({ puntos, motivo }));

        return equipo;
      }
      ));

    res.status(200).json({
      ok: true,
      data: clasificacionProcesada
    });
  } catch (error) {
    console.error('Error al obtener clasificación:', error);
    res.status(500).json({
      ok: false,
      message: 'Error al obtener la clasificación'
    });
  }
};

const getEquiposLimpios = async (req, res) => {
  try {
    const query = `
      SELECT id, nombre, escudo_url FROM equipos order by nombre
    `;

    const { rows } = await pool.query(query);

    const equiposProcesados = await Promise.all(
      rows.map(async (equipo) => {
        const fotoUrl = await getDownloadUrl('equipos/' + equipo.escudo_url);
        equipo.escudo = fotoUrl;

        return equipo;
      }
      ));

    res.status(200).json({
      ok: true,
      data: equiposProcesados
    });
  } catch (error) {
    console.error('Error al obtener equipos:', error);
    res.status(500).json({
      ok: false,
      message: 'Error al obtener la lista de equipos'
    });
  }
};

/**
 * Detalle de un equipo para el modal (se abre desde la clasificación):
 * datos, colores, estadio (con coordenadas si las tiene), su línea en la clasificación
 * y los partidos ya disputados, del más reciente al más antiguo.
 */
const getDetalleEquipo = async (req, res) => {
  try {
    const equipoId = Number(req.body.equipo_id);
    if (!Number.isInteger(equipoId)) {
      return res.status(400).json({ ok: false, message: 'Falta el equipo.' });
    }

    const { rows } = await pool.query(
      `SELECT id, nombre, siglas, escudo_url, color_primario, color_secundario,
              estadio, estadio_lat, estadio_lng
       FROM equipos WHERE id = $1`,
      [equipoId],
    );
    if (rows.length === 0) return res.status(404).json({ ok: false, message: 'El equipo no existe.' });
    const e = rows[0];

    // Su fila en la clasificación (mismo orden que la vista: puntos, DG, GF y nombre)
    const { rows: clasif } = await pool.query(
      `SELECT * FROM (
          SELECT equipo_id,
                 ROW_NUMBER() OVER (ORDER BY puntos DESC, diferencia_goles DESC, goles_favor DESC, equipo)::INT AS posicion,
                 partidos_jugados::INT AS pj, puntos::INT AS pts,
                 ganados::INT AS g, empatados::INT AS e, perdidos::INT AS p,
                 goles_favor::INT AS gf, goles_contra::INT AS gc,
                 diferencia_goles::INT AS dg, san::INT AS san
          FROM vista_clasificacion
       ) c WHERE c.equipo_id = $1`,
      [equipoId],
    );

    // Partidos disputados (más reciente primero)
    const { rows: partidos } = await pool.query(
      `SELECT p.id AS partido_id,
              jor.numero_jornada,
              to_char(p.fecha_partido, 'YYYY-MM-DD"T"HH24:MI') AS fecha_local,
              (p.equipo_local_id = $1) AS en_casa,
              r.id AS rival_id, r.nombre AS rival, r.escudo_url AS rival_escudo_url,
              CASE WHEN p.equipo_local_id = $1 THEN p.goles_local ELSE p.goles_visitante END AS goles_favor,
              CASE WHEN p.equipo_local_id = $1 THEN p.goles_visitante ELSE p.goles_local END AS goles_contra,
              p.tiene_acta
       FROM partidos p
       JOIN jornadas jor ON jor.id = p.jornada_id
       JOIN equipos r ON r.id = CASE WHEN p.equipo_local_id = $1 THEN p.equipo_visitante_id ELSE p.equipo_local_id END
       WHERE (p.equipo_local_id = $1 OR p.equipo_visitante_id = $1) AND p.jugado = true
       ORDER BY jor.numero_jornada DESC, p.fecha_partido DESC NULLS LAST`,
      [equipoId],
    );

    // Escudos: una URL firmada por equipo
    const escudos = new Map();
    const firmar = async (url) => {
      if (!url) return null;
      if (!escudos.has(url)) escudos.set(url, await getDownloadUrl('equipos/' + url));
      return escudos.get(url);
    };

    const partidosProcesados = [];
    for (const { rival_escudo_url, ...p } of partidos) {
      const resultado =
        p.goles_favor > p.goles_contra ? 'V' : p.goles_favor < p.goles_contra ? 'D' : 'E';
      partidosProcesados.push({ ...p, resultado, rival_escudo: await firmar(rival_escudo_url) });
    }

    res.status(200).json({
      ok: true,
      data: {
        id: e.id,
        nombre: e.nombre,
        siglas: e.siglas,
        escudo: await firmar(e.escudo_url),
        color_primario: e.color_primario || null,
        color_secundario: e.color_secundario || null,
        estadio: e.estadio || null,
        // NUMERIC llega como texto
        estadio_lat: e.estadio_lat !== null ? Number(e.estadio_lat) : null,
        estadio_lng: e.estadio_lng !== null ? Number(e.estadio_lng) : null,
        clasificacion: clasif[0]
          ? (({ equipo_id, ...c }) => c)(clasif[0])
          : null,
        partidos: partidosProcesados,
      },
    });
  } catch (error) {
    console.error('Error al obtener el detalle del equipo:', error);
    res.status(500).json({ ok: false, message: 'Error al obtener el detalle del equipo' });
  }
};

module.exports = { getEquipos, getEquiposLimpios, getClasificacion, getDetalleEquipo };