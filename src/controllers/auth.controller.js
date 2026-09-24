const pool = require('../config/db');
const jwt = require('jsonwebtoken');
const { getDownloadUrl, getUploadUrl } = require('../config/s3');

const login = async (req, res) => {
    try {
        const { email, password } = req.body;

        const query = 'SELECT * FROM usuarios WHERE email = $1 AND password = $2';

        const { rows } = await pool.query(query, [email, password]);

        if (rows.length === 0) {
            return res.status(401).json({
                ok: false,
                message: 'Correo electrónico o contraseña incorrectos'
            });
        }

        const user = rows[0];

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
                nombre_usuario:user.nombre_usuario,
                nombre_club: user.nombre_club,
                rol_id: user.rol_id,
                image_url: user.image_url
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
        const { email, password, username, club } = req.body;

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

        const insertQuery = 'INSERT INTO usuarios (email, password, nombre_usuario, nombre_club) VALUES ($1, $2, $3, $4) RETURNING *';
        const resultInsert = await pool.query(insertQuery, [email, password, username, club]);
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

module.exports = { login, register };