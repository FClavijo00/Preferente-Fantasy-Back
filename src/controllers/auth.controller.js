const pool = require('../config/db');
const jwt = require('jsonwebtoken');
const { getDownloadUrl, getUploadUrl, uploadPhoto } = require('../config/s3');
const bcrypt = require('bcrypt');

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
            data: resultInsert.rows[0]
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
        const { id, nombre_club, nombre_usuario, foto_url } = req.body;

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
            data: resQuery.rows[0],
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
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                ok: false,
                message: 'Todos los campos son obligatorios'
            });
        }

        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        const updateQuery = 'UPDATE usuarios SET password = $1 WHERE email = $2';
        await pool.query(updateQuery, [hashedPassword, email]);

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
        const { id } = req.body;

        if (!id) {
            return res.status(400).json({
                ok: false,
                message: 'Todos los campos son obligatorios'
            });
        }

        const searchQuery = 'SELECT * FROM usuarios WHERE id = $1';
        const resQuery = await pool.query(searchQuery, [id]);

        if (resQuery.rows[0].image_url && resQuery.rows[0].image_url.startsWith('avatar')) {
            resQuery.rows[0].image_url = await getDownloadUrl('usuarios/' + resQuery.rows[0].image_url);
        }

        res.status(200).json({
            ok: true,
            data: resQuery.rows[0]
        });

    } catch (error) {
        res.status(500).json({
            ok: false,
            message: 'Error al cargar el perfil'
        })
    }
}

module.exports = { login, register, cambiarPassword, actualizarUsuario, cargarPerfil };