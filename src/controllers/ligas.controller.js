const pool = require('../config/db');

const getMisLigas = async (req, res) => {
    try {
        // Extraemos el id cargado en el token
        const userId = req.userId;

        const query = `
        SELECT L.id, L.nombre as nombre_liga, L.codigo_acceso, L.privada,
        C.nombre as nombre_competicion, COUNT(todos_LU.usuario_id)::INT AS total_participantes
        FROM ligas L
        INNER JOIN competiciones C ON C.id = L.competicion_id
        INNER JOIN liga_usuarios mi_lu ON mi_lu.liga_id = L.id AND mi_lu.usuario_id = $1
        LEFT JOIN liga_usuarios todos_LU ON todos_LU.liga_id = L.id
        GROUP BY 
            L.id, 
            L.nombre, 
            L.codigo_acceso, 
            L.privada, 
            C.nombre`;

        const { rows } = await pool.query(query, [userId]);

        res.status(200).json({
            ok: true,
            data: rows
        });
    } catch (error) {
        console.error('Error al obtener mis ligas:', error);
        res.status(500).json({
            ok: false,
            message: 'Error al obtener mis ligas'
        });
    }
}

const getLigasAbiertas = async (req, res) => {
    try {
        // Extraemos el id cargado en el token
        const userId = req.userId;

        const query = `
            SELECT L.id, L.nombre as nombre_liga, L.codigo_acceso, L.privada, 
            C.nombre as nombre_competicion, COUNT(DISTINCT LU.usuario_id)::INT AS total_participantes
            FROM ligas L
            INNER JOIN competiciones C ON C.id = L.competicion_id
            LEFT JOIN liga_usuarios LU ON LU.liga_id = L.id
            WHERE L.privada = false
            AND NOT EXISTS (
                SELECT 1 
                FROM liga_usuarios mi_lu 
                WHERE mi_lu.liga_id = L.id 
                AND mi_lu.usuario_id = $1
            )
            GROUP BY 
                L.id, 
                L.nombre, 
                L.codigo_acceso, 
                L.privada, 
                C.nombre`;

        const { rows } = await pool.query(query, [userId]);
        res.status(200).json({
            ok: true,
            data: rows
        });
    } catch (error) {
        console.error('Error al obtener las ligas:', error);
        res.status(500).json({
            ok: false,
            message: 'Error al obtener las ligas'
        });
    }
};

const crearLiga = async (req, res) => {
    try {
        const { nombre_campeonato, privado, userId } = req.body;

        let codigo = null;

        if (privado) {
            codigo = generarCodigoUnico();
        }

        const query = 'INSERT INTO ligas (nombre, privada, codigo_acceso, competicion_id, creado_por) VALUES ($1, $2, $3, $4, $5) RETURNING *';
        const { rows } = await pool.query(query, [nombre_campeonato, privado, codigo, 1, userId]);

        const query2 = 'INSERT INTO liga_usuarios (liga_id, usuario_id) VALUES ($1, $2)';
        await pool.query(query2, [rows[0].id, userId]);

        res.status(200).json({
            ok: true,
            message: 'Liga creada exitosamente',
        });

    } catch (error) {
        console.error('Error al crear la liga:', error);
        res.status(500).json({
            ok: false,
            message: 'Error al crear la liga'
        })
    }
}

const unirseALiga = async (req, res) => {
    try {
        const { codigo, ligaId, userId } = req.body;

        if (codigo) {
            const query = 'SELECT * FROM ligas WHERE codigo_acceso = $1';
            const { rows } = await pool.query(query, [codigo]);

            if (rows.length === 0) {
                return res.status(404).json({
                    ok: false,
                    message: 'Liga no encontrada. Pruebe con otro código.'
                });
            }

            const liga = rows[0];

            const query2 = 'INSERT INTO liga_usuarios (liga_id, usuario_id) VALUES ($1, $2)';
            await pool.query(query2, [liga.id, userId]);
        } else {
            const query = 'INSERT INTO liga_usuarios (liga_id, usuario_id) VALUES ($1, $2)';
            await pool.query(query, [ligaId, userId]);
        }

        res.status(200).json({
            ok: true,
            message: 'Te has unido a la liga'
        });
    } catch (error) {
        console.error('Error al unirse a la liga:', error);
        res.status(500).json({
            ok: false,
            message: 'Error al unirse a la liga'
        })
    }
}

const generarCodigoUnico = () => {
    // Genera un bloque aleatorio en base 36 y extrae 4 caracteres
    const aleatorio = Math.random().toString(36).substring(2, 6).padEnd(4, '0').toUpperCase();

    return `PF-${aleatorio}`;
};

module.exports = { crearLiga, getMisLigas, getLigasAbiertas, unirseALiga };