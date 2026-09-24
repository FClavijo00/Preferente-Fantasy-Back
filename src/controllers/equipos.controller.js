const pool = require('../config/db');
const { getDownloadUrl } = require('../config/s3');

const getEquipos = async (req, res) => {  try {
    const query = `
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
              'precio', J.precio
            )
            ORDER BY 
              CASE J.posicion
                WHEN 'POR' THEN 1
                WHEN 'DEF' THEN 2
                WHEN 'MED' THEN 3
                WHEN 'DEL' THEN 4
                ELSE 5
              END ASC,
              J.nombre ASC
          ) FILTER (WHERE J.id IS NOT NULL AND J.activo = true),
          '[]'::json
        ) AS jugadores
      FROM equipos E
      LEFT JOIN jugadores J ON J.equipo_id = E.id
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
      SELECT E.id, E.nombre, E.escudo_url, 
      CO.pj, CO.pg, CO.pe, CO.pp, CO.gf, CO.gc, CO.dg, CO.pts, CO.san
      FROM clasificacion_oficial CO
      INNER JOIN equipos E ON E.id = CO.equipo_id
      ORDER BY CO.pts DESC, CO.dg DESC, co.gf DESC
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

module.exports = { getEquipos, getClasificacion };