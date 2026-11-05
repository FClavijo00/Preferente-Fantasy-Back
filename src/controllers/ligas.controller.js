const pool = require("../config/db");
const { getDownloadUrl } = require("../config/s3");

const abandonarLiga = async (req, res) => {
    try {
        const { liga_id, user_id } = req.body;

        if (!liga_id || !user_id) {
            return res.status(400).json({ error: "Faltan parámetros requeridos." });
        }

        await pool.query("BEGIN");

        // 1. Obtener el creador de la liga y el recuento de usuarios
        const ligaQuery = `
            SELECT creado_por as creador_id,
            (SELECT COUNT(*) FROM liga_usuarios WHERE liga_id = $1) as total_usuarios
            FROM ligas
            WHERE id = $1;
        `;
        const ligaResult = await pool.query(ligaQuery, [liga_id]);

        if (ligaResult.rows.length === 0) {
            await pool.query("ROLLBACK");
            return res.status(404).json({
                ok: false,
                message: "Liga no encontrada.",
            });
        }

        const { creador_id, total_usuarios } = ligaResult.rows[0];
        const numUsuarios = parseInt(total_usuarios, 10);

        // 2. Verificar que el usuario pertenece realmente a la liga
        const miembroQuery = `
            SELECT 1 FROM liga_usuarios WHERE liga_id = $1 AND usuario_id = $2;
        `;
        const miembroResult = await pool.query(miembroQuery, [liga_id, user_id]);

        if (miembroResult.rows.length === 0) {
            await pool.query("ROLLBACK");
            return res.status(404).json({
                ok: false,
                message: "El usuario no forma parte de esta liga.",
            });
        }

        // CASO A : Es el único usuario en la liga
        if (numUsuarios === 1) {
            // Eliminar plantillas del usuario
            await pool.query(
                `DELETE FROM plantillas_usuario WHERE liga_id = $1 AND usuario_id = $2;`,
                [liga_id, user_id],
            );
            // Eliminar al usuario de la liga
            await pool.query(
                `DELETE FROM liga_usuarios WHERE liga_id = $1 AND usuario_id = $2;`,
                [liga_id, user_id],
            );
            // Eliminar la liga por completo
            await pool.query(`DELETE FROM ligas WHERE id = $1;`, [liga_id]);
        }

        // CASO B : Hay más usuarios en la liga
        else {
            // Si el usuario que abandona es el creador, delegar al siguiente usuario que entró
            if (creador_id === user_id) {
                const siguienteUsuarioQuery = `
                    SELECT usuario_id 
                    FROM liga_usuarios 
                    WHERE liga_id = $1 AND usuario_id != $2 
                    ORDER BY joined_at ASC 
                    LIMIT 1;
                `;
                const sigResult = await pool.query(siguienteUsuarioQuery, [
                    liga_id,
                    user_id,
                ]);

                if (sigResult.rows.length > 0) {
                    const nuevoCreadorId = sigResult.rows[0].usuario_id;
                    await pool.query(`UPDATE ligas SET creado_por = $1 WHERE id = $2;`, [
                        nuevoCreadorId,
                        liga_id,
                    ]);
                }
            }

            // Eliminar plantillas del usuario que abandona
            await pool.query(
                `DELETE FROM plantillas_usuario WHERE liga_id = $1 AND usuario_id = $2;`,
                [liga_id, user_id],
            );
            // Eliminar la relación del usuario con la liga
            await pool.query(
                `DELETE FROM liga_usuarios WHERE liga_id = $1 AND usuario_id = $2;`,
                [liga_id, user_id],
            );
        }

        await pool.query("COMMIT");

        res.status(200).json({
            ok: true,
            message: "Has abandonado la liga exitosamente.",
        });
    } catch (error) {
        console.error("Error al abandonar la liga:", error);
        res.status(500).json({
            ok: false,
            message: "Error al abandonar la liga",
        });
    }
};

const eliminarLiga = async (req, res) => {
    try {
        const { liga_id } = req.body;

        if (!liga_id) {
            return res.status(400).json({ error: "Faltan parámetros requeridos." });
        }

        const query = `
            DELETE FROM ligas
            WHERE id = $1;
        `;

        await pool.query(query, [liga_id]);

        res.status(200).json({
            ok: true,
            message: "Has eliminado la liga exitosamente.",
        });
    } catch (error) {
        console.error("Error al eliminar la liga:", error);
        res.status(500).json({
            ok: false,
            message: "Error al eliminar la liga",
        });
    }
};

const getMisLigas = async (req, res) => {
    try {
        // Extraemos el id cargado en el token
        const userId = req.userId;

        const query = `
        SELECT L.id, L.nombre as nombre_liga, L.codigo_acceso, L.privada, L.creado_por,
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
            data: rows,
        });
    } catch (error) {
        console.error("Error al obtener mis ligas:", error);
        res.status(500).json({
            ok: false,
            message: "Error al obtener mis ligas",
        });
    }
};

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
            data: rows,
        });
    } catch (error) {
        console.error("Error al obtener las ligas:", error);
        res.status(500).json({
            ok: false,
            message: "Error al obtener las ligas",
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

        const query =
            "INSERT INTO ligas (nombre, privada, codigo_acceso, competicion_id, creado_por) VALUES ($1, $2, $3, $4, $5) RETURNING *";
        const { rows } = await pool.query(query, [
            nombre_campeonato,
            privado,
            codigo,
            1,
            userId,
        ]);

        const query2 =
            "INSERT INTO liga_usuarios (liga_id, usuario_id) VALUES ($1, $2)";
        await pool.query(query2, [rows[0].id, userId]);

        res.status(200).json({
            ok: true,
            message: "Liga creada exitosamente",
        });
    } catch (error) {
        console.error("Error al crear la liga:", error);
        res.status(500).json({
            ok: false,
            message: "Error al crear la liga",
        });
    }
};

const unirseALiga = async (req, res) => {
    try {
        const { codigo, ligaId, userId } = req.body;

        if (codigo) {
            const query = "SELECT * FROM ligas WHERE codigo_acceso = $1";
            const { rows } = await pool.query(query, [codigo]);

            if (rows.length === 0) {
                return res.status(404).json({
                    ok: false,
                    message: "Liga no encontrada. Pruebe con otro código.",
                });
            }

            const liga = rows[0];

            const query2 =
                "INSERT INTO liga_usuarios (liga_id, usuario_id) VALUES ($1, $2)";
            await pool.query(query2, [liga.id, userId]);
        } else {
            const query =
                "INSERT INTO liga_usuarios (liga_id, usuario_id) VALUES ($1, $2)";
            await pool.query(query, [ligaId, userId]);
        }

        res.status(200).json({
            ok: true,
            message: "Te has unido a la liga",
        });
    } catch (error) {
        console.error("Error al unirse a la liga:", error);
        res.status(500).json({
            ok: false,
            message: "Error al unirse a la liga",
        });
    }
};

const cargarUsuariosLiga = async (req, res) => {
    try {
        const { liga_id } = req.body;

        if (!liga_id) {
            return res.status(400).json({ error: "Faltan parámetros requeridos." });
        }

        const query = `
            SELECT 
                u.id AS usuario_id,
                u.nombre_usuario,
                u.nombre_club,
                u.image_url,
                u.email
            FROM liga_usuarios lu
            JOIN usuarios u ON u.id = lu.usuario_id
            WHERE lu.liga_id = $1
            GROUP BY u.id, u.nombre_usuario, u.nombre_club, u.image_url
            ORDER BY u.id ASC;
        `;

        const { rows: usuarios } = await pool.query(query, [liga_id]);

        const usuariosProcesados = await Promise.all(
            usuarios.map(async (usuario) => {
                if (usuario.image_url && usuario.image_url.startsWith("avatar")) {
                    const fotoDownloaded = await getDownloadUrl(
                        "usuarios/" + usuario.image_url,
                    );
                    usuario.image_url = fotoDownloaded;
                    return usuario;
                } else {
                    return usuario;
                }
            }),
        );

        res.status(200).json({
            ok: true,
            data: usuariosProcesados,
        });
    } catch (error) {
        console.error("Error al cargar los usuarios de la liga:", error);
        res.status(500).json({
            ok: false,
            message: "Error al cargar los usuarios de la liga",
        });
    }
};

const eliminarUsuarioLiga = async (req, res) => {
    try {
        const { liga_id, user_id } = req.body;

        if (!liga_id || !user_id) {
            return res.status(400).json({ error: "Faltan parámetros requeridos." });
        }

        const query =
            "DELETE FROM liga_usuarios WHERE liga_id = $1 AND usuario_id = $2";
        await pool.query(query, [liga_id, user_id]);

        const query2 = 
            "DELETE FROM plantillas_usuario WHERE liga_id = $1 AND usuario_id = $2;"
        await pool.query(query2, [liga_id, user_id]);

        res.status(200).json({
            ok: true,
            message: "Usuario eliminado de la liga",
        });
    } catch (error) {
        console.error("Error al eliminar el usuario de la liga:", error);
        res.status(500).json({
            ok: false,
            message: "Error al eliminar el usuario de la liga",
        });
    }
};

const editarLiga = async (req, res) => {
    try {
        const { liga_id, nombre_liga, privada, codigo_acceso } = req.body;

        if (!liga_id || !nombre_liga) {
            return res.status(400).json({ error: "Faltan parámetros requeridos." });
        }

        if (codigo_acceso && privada) {
            const searchCode =
                "SELECT * FROM ligas WHERE codigo_acceso = $1 AND id != $2";
            const { rows } = await pool.query(searchCode, [
                codigo_acceso,
                liga_id,
            ]);

            if (rows.length > 0) {
                return res.status(400).json({
                    ok: false,
                    message: "El codigo de acceso ya existe.",
                });
            }
        }

        if (privada) {
            const query =
                "UPDATE ligas SET nombre = $1, privada = $2, codigo_acceso = $3 WHERE id = $4";
            await pool.query(query, [
                nombre_liga,
                privada,
                codigo_acceso,
                liga_id,
            ]);
        } else {
            const query =
                "UPDATE ligas SET nombre = $1, privada = $2, codigo_acceso = NULL WHERE id = $3";
            await pool.query(query, [nombre_liga, privada, liga_id]);
        }

        res.status(200).json({
            ok: true,
            message: "Liga editada exitosamente",
        });
    } catch (error) {
        console.error("Error al editar la liga:", error);
        res.status(500).json({
            ok: false,
            message: "Error al editar la liga",
        });
    }
};

const generarCodigoUnico = () => {
    // Genera un bloque aleatorio en base 36 y extrae 4 caracteres
    const aleatorio = Math.random()
        .toString(36)
        .substring(2, 6)
        .padEnd(4, "0")
        .toUpperCase();

    return `PF-${aleatorio}`;
};

module.exports = {
    cargarUsuariosLiga,
    abandonarLiga,
    eliminarLiga,
    crearLiga,
    getMisLigas,
    getLigasAbiertas,
    unirseALiga,
    eliminarUsuarioLiga,
    editarLiga
};
