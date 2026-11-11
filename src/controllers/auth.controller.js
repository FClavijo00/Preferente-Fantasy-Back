const pool = require('../config/db');
const jwt = require('jsonwebtoken');
const { getDownloadUrl, getUploadUrl, uploadPhoto, deletePhoto } = require('../config/s3');
const bcrypt = require('bcrypt');

// Nunca devolver el hash de la contraseña al cliente
const sinPassword = ({ password, ...usuario }) => usuario;

const login = async (req, res) => {
    try {
        const { email, password } = req.body;

        const queryEmail = 'SELECT * FROM usuarios WHERE email = $1';

        const { rows } = await pool.query(queryEmail, [email]);

        if (rows.length === 0) {
            return res.status(401).json({
                ok: false,
                message: 'Correo electrónico no registrado o incorrecto.'
            });
        }

        const user = rows[0];

        // 2. Comparas la contraseña introducida con el hash guardado
        const isMatch = await bcrypt.compare(password, user.password);

        if (!isMatch) {
            return res.status(401).json({
                ok: false,
                message: 'Contraseña incorrecta.'
            });
        }

        if (user.image_url && user.image_url.startsWith('avatar')) {
            user.image_url = await getDownloadUrl('usuarios/' + user.image_url);
        }

        // Generamos el token con una validez (ej. 30 días)
        const token = jwt.sign(
            { userId: user.id, email: user.email },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN }
        );

        const data = {
            token: token,
            usuario: {
                id: user.id,
                email: user.email,
                nombre_usuario: user.nombre_usuario,
                nombre_club: user.nombre_club,
                rol_id: user.rol_id,
                image_url: user.image_url,
                image: user.image
            }
        }

        res.status(200).json({
            ok: true,
            data: data
        });
    } catch (error) {
        console.error('Error al iniciar sesión:', error);
        res.status(500).json({
            ok: false,
            message: 'Error al iniciar sesión'
        });
    }
};

const register = async (req, res) => {
    try {
        const { email, password, username, club, foto, foto_url } = req.body;

        if (!email || !password || !username || !club) {
            return res.status(400).json({
                ok: false,
                message: 'Todos los campos son obligatorios'
            });
        }

        let url_foto = null;

        const searchQueryEmail = 'SELECT * FROM usuarios WHERE email = $1';
        const resQueryEmail = await pool.query(searchQueryEmail, [email]);

        if (resQueryEmail.rows.length > 0) {
            return res.status(400).json({
                ok: false,
                message: 'El correo electrónico ya está registrado'
            });
        }

        const searchQueryUsername = 'SELECT * FROM usuarios WHERE nombre_usuario = $1';
        const resQueryUsername = await pool.query(searchQueryUsername, [username]);

        if (resQueryUsername.rows.length > 0) {
            return res.status(400).json({
                ok: false,
                message: 'El nombre de usuario ya está registrado'
            });
        }

        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        const insertQuery = 'INSERT INTO usuarios (email, password, nombre_usuario, nombre_club) VALUES ($1, $2, $3, $4) RETURNING *';
        const resultInsert = await pool.query(insertQuery, [email, hashedPassword, username, club]);

        if (req.file) {
            url_foto = foto_url;
            await uploadPhoto(req.file, 'usuarios');
            const updateQuery = 'UPDATE usuarios SET image_url = $1 WHERE id = $2';
            await pool.query(updateQuery, [url_foto, resultInsert.rows[0].id]);
        }

        res.status(200).json({
            ok: true,
            data: sinPassword(resultInsert.rows[0])
        });

    } catch (error) {
        res.status(500).json({
            ok: false,
            message: 'Error al registrar usuario'
        });
    }
};

const actualizarUsuario = async (req, res) => {
    try {
        const { nombre_club, nombre_usuario, foto_url } = req.body;
        // El usuario solo puede editar su propio perfil (id sacado del token)
        const id = req.userId;

        if (!id) {
            return res.status(400).json({
                ok: false,
                message: 'Todos los campos son obligatorios'
            });
        }

        let url_foto = null;

        const updateQuery = 'UPDATE usuarios SET nombre_club = $1, nombre_usuario = $2 WHERE id = $3';
        await pool.query(updateQuery, [nombre_club, nombre_usuario, id]);

        if (req.file) {
            url_foto = foto_url;
            await uploadPhoto(req.file, 'usuarios');
            const updateQuery = 'UPDATE usuarios SET image_url = $1 WHERE id = $2';
            await pool.query(updateQuery, [url_foto, id]);
        }

        const searchQuery = 'SELECT * FROM usuarios WHERE id = $1';
        const resQuery = await pool.query(searchQuery, [id]);

        if (resQuery.rows[0].image_url && resQuery.rows[0].image_url.startsWith('avatar')) {
            resQuery.rows[0].image_url = await getDownloadUrl('usuarios/' + resQuery.rows[0].image_url);
        }

        res.status(200).json({
            ok: true,
            data: sinPassword(resQuery.rows[0]),
            message: 'Usuario actualizado exitosamente'
        });

    } catch (error) {
        res.status(500).json({
            ok: false,
            message: 'Error al registrar usuario'
        });
    }
}

const cambiarPassword = async (req, res) => {
    try {
        const { passwordActual, passwordNueva } = req.body;

        if (!passwordActual || !passwordNueva) {
            return res.status(400).json({
                ok: false,
                message: 'Todos los campos son obligatorios'
            });
        }

        if (passwordNueva.length < 6) {
            return res.status(400).json({
                ok: false,
                message: 'La nueva contraseña debe tener al menos 6 caracteres'
            });
        }

        // Solo se cambia la contraseña del usuario del token, y solo si conoce la actual
        const { rows } = await pool.query('SELECT password FROM usuarios WHERE id = $1', [req.userId]);

        if (rows.length === 0) {
            return res.status(404).json({
                ok: false,
                message: 'Usuario no encontrado'
            });
        }

        const passwordCorrecta = await bcrypt.compare(passwordActual, rows[0].password);

        if (!passwordCorrecta) {
            return res.status(401).json({
                ok: false,
                message: 'La contraseña actual no es correcta'
            });
        }

        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(passwordNueva, saltRounds);

        const updateQuery = 'UPDATE usuarios SET password = $1 WHERE id = $2';
        await pool.query(updateQuery, [hashedPassword, req.userId]);

        res.status(200).json({
            ok: true,
            message: 'Contraseña cambiada exitosamente'
        });

    } catch (error) {
        res.status(500).json({
            ok: false,
            message: 'Error al cambiar la contraseña'
        });
    }
}

const cargarPerfil = async (req, res) => {
    try {
        // Solo el perfil propio (id sacado del token)
        const id = req.userId;

        if (!id) {
            return res.status(400).json({
                ok: false,
                message: 'Todos los campos son obligatorios'
            });
        }

        const searchQuery = 'SELECT * FROM usuarios WHERE id = $1';
        const resQuery = await pool.query(searchQuery, [id]);

        if (resQuery.rows.length === 0) {
            return res.status(404).json({
                ok: false,
                message: 'Usuario no encontrado'
            });
        }

        if (resQuery.rows[0].image_url && resQuery.rows[0].image_url.startsWith('avatar')) {
            resQuery.rows[0].image_url = await getDownloadUrl('usuarios/' + resQuery.rows[0].image_url);
        }

        res.status(200).json({
            ok: true,
            data: sinPassword(resQuery.rows[0])
        });

    } catch (error) {
        res.status(500).json({
            ok: false,
            message: 'Error al cargar el perfil'
        })
    }
}

/**
 * Elimina la cuenta del usuario del token tras confirmar su contraseña.
 *
 * OJO: ligas.creado_por tiene ON DELETE CASCADE, así que antes de borrar al
 * usuario hay que traspasar las ligas que creó y que tienen más miembros
 * (si no, se borrarían con los equipos de todos). El resto de sus datos
 * (liga_usuarios, plantillas_usuario y plantilla_jugadores) caen en cascada.
 */
const eliminarCuenta = async (req, res) => {
    const { password } = req.body;

    if (!password) {
        return res.status(400).json({
            ok: false,
            message: 'Introduce tu contraseña para confirmar'
        });
    }

    // Conexión dedicada: con pool.query cada consulta puede ir por una conexión
    // distinta y BEGIN/COMMIT no agruparían nada
    const client = await pool.pool.connect();
    let imagenUrl = null;

    try {
        const { rows } = await client.query('SELECT password, image_url FROM usuarios WHERE id = $1', [req.userId]);

        if (rows.length === 0) {
            return res.status(404).json({
                ok: false,
                message: 'Usuario no encontrado'
            });
        }

        const passwordCorrecta = await bcrypt.compare(password, rows[0].password);

        if (!passwordCorrecta) {
            return res.status(401).json({
                ok: false,
                message: 'La contraseña no es correcta'
            });
        }

        imagenUrl = rows[0].image_url;

        await client.query('BEGIN');

        // Traspasar cada liga creada por el usuario al miembro más antiguo que quede
        await client.query(`
            UPDATE ligas l
            SET creado_por = sig.usuario_id
            FROM (
                SELECT DISTINCT ON (lu.liga_id) lu.liga_id, lu.usuario_id
                FROM liga_usuarios lu
                JOIN ligas li ON li.id = lu.liga_id
                WHERE li.creado_por = $1 AND lu.usuario_id <> $1
                ORDER BY lu.liga_id, lu.joined_at ASC
            ) sig
            WHERE l.id = sig.liga_id
        `, [req.userId]);

        // Las ligas en las que estaba solo se borran en cascada con el usuario
        await client.query('DELETE FROM usuarios WHERE id = $1', [req.userId]);

        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('Error al eliminar la cuenta:', error);
        return res.status(500).json({
            ok: false,
            message: 'Error al eliminar la cuenta'
        });
    } finally {
        client.release();
    }

    res.status(200).json({
        ok: true,
        message: 'Tu cuenta se ha eliminado correctamente'
    });

    // La foto se borra después de responder: si fallase, la cuenta ya está eliminada
    // y solo quedaría un fichero huérfano en el almacenamiento
    if (imagenUrl && imagenUrl.startsWith('avatar')) {
        deletePhoto('usuarios/' + imagenUrl).catch((error) => {
            console.error('No se pudo borrar la foto del usuario eliminado:', error);
        });
    }
};

module.exports = { login, register, cambiarPassword, actualizarUsuario, cargarPerfil, eliminarCuenta };