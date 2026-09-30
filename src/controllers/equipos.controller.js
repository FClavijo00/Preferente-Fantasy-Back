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

    const clasificacionProcesada = await Promise.all(
      rows.map(async (equipo) => {
        const fotoUrl = await getDownloadUrl('equipos/' + equipo.escudo_url);
        equipo.escudo = fotoUrl;

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

module.exports = { getEquipos, getEquiposLimpios, getClasificacion };