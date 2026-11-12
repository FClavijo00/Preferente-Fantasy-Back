const crypto = require("node:crypto");
const pool = require("../config/db");
const { getDownloadUrl } = require("../config/s3");
const {
    esMiembroLiga,
    esCreadorLiga,
    withTransaction,
} = require("../services/permisos");

const soloCreador = (res) =>
    res
        .status(403)
        .json({
            ok: false,
            message: "Solo el creador de la liga puede hacer esto.",
        });

const abandonarLiga = async (req, res) => {
    try {
        const { liga_id } = req.body;
        // Solo puedes abandonar una liga tú mismo: el usuario sale del token
        const user_id = req.userId;

        if (!liga_id) {
            return res.status(400).json({ error: "Faltan parámetros requeridos." });
        }

        const resultado = await withTransaction(async (client) => {
            // 1. Obtener el creador de la liga y el recuento de usuarios
            const ligaResult = await client.query(
                `SELECT creado_por AS creador_id,
                    (SELECT COUNT(*) FROM liga_usuarios WHERE liga_id = $1) AS total_usuarios
                 FROM ligas WHERE id = $1;`,
                [liga_id],
            );

            if (ligaResult.rows.length === 0) {
                return { status: 404, message: "Liga no encontrada." };
            }

            const { creador_id, total_usuarios } = ligaResult.rows[0];
            const numUsuarios = parseInt(total_usuarios, 10);

            // 2. Verificar que el usuario pertenece realmente a la liga
            const miembroResult = await client.query(
                `SELECT 1 FROM liga_usuarios WHERE liga_id = $1 AND usuario_id = $2;`,
                [liga_id, user_id],
            );

            if (miembroResult.rows.length === 0) {
                return {
                    status: 404,
                    message: "El usuario no forma parte de esta liga.",
                };
            }

            if (numUsuarios === 1) {
                // CASO A: es el único usuario -> se elimina la liga entera
                // (liga_usuarios y plantillas_usuario caen en cascada)
                await client.query(`DELETE FROM ligas WHERE id = $1;`, [liga_id]);
            } else {
                // CASO B: hay más usuarios. Si abandona el creador, la liga pasa al siguiente que entró
                if (creador_id === user_id) {
                    await client.query(
                        `UPDATE ligas SET creado_por = (
                            SELECT usuario_id FROM liga_usuarios
                            WHERE liga_id = $1 AND usuario_id <> $2
                            ORDER BY joined_at ASC LIMIT 1
                         ) WHERE id = $1;`,
                        [liga_id, user_id],
                    );
                }

                await client.query(
                    `DELETE FROM plantillas_usuario WHERE liga_id = $1 AND usuario_id = $2;`,
                    [liga_id, user_id],
                );
                await client.query(
                    `DELETE FROM liga_usuarios WHERE liga_id = $1 AND usuario_id = $2;`,
                    [liga_id, user_id],
                );
            }

            return { status: 200 };
        });

        if (resultado.status !== 200) {
            return res
                .status(resultado.status)
                .json({ ok: false, message: resultado.message });
        }

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

        if (!(await esCreadorLiga(liga_id, req.userId))) {
            return soloCreador(res);
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
            C.nombre
        ORDER BY L.nombre`;

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
                C.nombre
            ORDER BY total_participantes DESC, L.nombre`;

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
        const { nombre_campeonato, privado } = req.body;
        // El creador es siempre el usuario del token
        const userId = req.userId;

        if (!nombre_campeonato || !nombre_campeonato.trim()) {
            return res
                .status(400)
                .json({ ok: false, message: "El nombre de la liga es obligatorio." });
        }

        const query =
            "INSERT INTO ligas (nombre, privada, codigo_acceso, competicion_id, creado_por) VALUES ($1, $2, $3, $4, $5) RETURNING *";
        // Crear la liga y unir al creador van juntos: o las dos cosas o ninguna
        const liga = await withTransaction(async (client) => {
            const codigo = privado ? await generarCodigoUnico(client) : null;

            const { rows } = await client.query(query, [
                nombre_campeonato.trim(),
                !!privado,
                codigo,
                1,
                userId,
            ]);

            await client.query(
                "INSERT INTO liga_usuarios (liga_id, usuario_id) VALUES ($1, $2)",
                [rows[0].id, userId],
            );

            return rows[0];
        });

        res.status(200).json({
            ok: true,
            message: "Liga creada exitosamente",
            // El front lo usa para enseñar (y compartir) el código de acceso
            data: {
                id: liga.id,
                nombre_liga: liga.nombre,
                privada: liga.privada,
                codigo_acceso: liga.codigo_acceso,
            },
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
        const { ligaId } = req.body;
        const codigo =
            typeof req.body.codigo === "string"
                ? req.body.codigo.trim().toUpperCase()
                : null;
        // Solo puedes unirte tú mismo: el usuario sale del token
        const userId = req.userId;

        let ligaDestino;

        if (codigo) {
            const { rows } = await pool.query(
                "SELECT id FROM ligas WHERE codigo_acceso = $1",
                [codigo],
            );

            if (rows.length === 0) {
                return res.status(404).json({
                    ok: false,
                    message: "Liga no encontrada. Pruebe con otro código.",
                });
            }

            ligaDestino = rows[0].id;
        } else {
            // Sin código solo se puede entrar en ligas públicas
            const { rows } = await pool.query(
                "SELECT id, privada FROM ligas WHERE id = $1",
                [ligaId],
            );

            if (rows.length === 0) {
                return res
                    .status(404)
                    .json({ ok: false, message: "Liga no encontrada." });
            }

            if (rows[0].privada) {
                return res.status(403).json({
                    ok: false,
                    message: "Esta liga es privada: necesitas su código de acceso.",
                });
            }

            ligaDestino = rows[0].id;
        }

        if (await esMiembroLiga(ligaDestino, userId)) {
            return res
                .status(400)
                .json({ ok: false, message: "Ya formas parte de esta liga." });
        }

        await pool.query(
            "INSERT INTO liga_usuarios (liga_id, usuario_id) VALUES ($1, $2)",
            [ligaDestino, userId],
        );

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

        if (!(await esMiembroLiga(liga_id, req.userId))) {
            return res
                .status(403)
                .json({ ok: false, message: "No perteneces a esta liga." });
        }

        // Sin email: los miembros de una liga no deben ver el correo de los demás
        const query = `
            SELECT
                u.id AS usuario_id,
                u.nombre_usuario,
                u.nombre_club,
                u.image_url
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
        // user_id aquí es el usuario al que se EXPULSA, no quien hace la petición
        const { liga_id, user_id } = req.body;

        if (!liga_id || !user_id) {
            return res.status(400).json({ error: "Faltan parámetros requeridos." });
        }

        if (!(await esCreadorLiga(liga_id, req.userId))) {
            return soloCreador(res);
        }

        if (Number(user_id) === req.userId) {
            return res
                .status(400)
                .json({
                    ok: false,
                    message: "No puedes expulsarte a ti mismo: usa Abandonar liga.",
                });
        }

        await withTransaction(async (client) => {
            await client.query(
                "DELETE FROM liga_usuarios WHERE liga_id = $1 AND usuario_id = $2",
                [liga_id, user_id],
            );
            await client.query(
                "DELETE FROM plantillas_usuario WHERE liga_id = $1 AND usuario_id = $2;",
                [liga_id, user_id],
            );
        });

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

        if (!(await esCreadorLiga(liga_id, req.userId))) {
            return soloCreador(res);
        }

        if (codigo_acceso && privada) {
            const searchCode =
                "SELECT * FROM ligas WHERE codigo_acceso = $1 AND id != $2";
            const { rows } = await pool.query(searchCode, [codigo_acceso, liga_id]);

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
            await pool.query(query, [nombre_liga, privada, codigo_acceso, liga_id]);
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

// Sin 0/O ni 1/I para que no se confundan al dictarlo o copiarlo a mano
const ALFABETO_CODIGO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Genera un código PF-XXXX que no use ninguna otra liga. */
const generarCodigoUnico = async (client) => {
    for (let intento = 0; intento < 20; intento++) {
        let aleatorio = "";
        for (let i = 0; i < 4; i++) {
            aleatorio += ALFABETO_CODIGO[crypto.randomInt(ALFABETO_CODIGO.length)];
        }
        const codigo = `PF-${aleatorio}`;

        const { rowCount } = await client.query(
            "SELECT 1 FROM ligas WHERE codigo_acceso = $1",
            [codigo],
        );
        if (rowCount === 0) return codigo;
    }
    throw new Error("No se ha podido generar un código de liga único");
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
    editarLiga,
};
