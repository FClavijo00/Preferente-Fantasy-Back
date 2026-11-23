const express = require("express");
const router = express.Router();
const { login, register, cambiarPassword, actualizarUsuario, cargarPerfil, eliminarCuenta } = require('../controllers/auth.controller');
const { upload } = require('../config/s3');
const { verifyToken } = require('../services/verifyToken');
const { requireAdmin } = require('../services/permisos');
const { buscarUsuariosAdmin, restablecerPasswordAdmin } = require('../controllers/usuarios-admin.controller');
// GET /api/auth
router.post('/login', login);

router.post('/register', upload.single('foto'), register);

// Estas rutas actúan siempre sobre el usuario del token, nunca sobre un id/email del body
router.post('/cambiarPassword', verifyToken, cambiarPassword);

router.post('/actualizarUsuario', verifyToken, upload.single('foto'), actualizarUsuario);

router.post('/cargarPerfil', verifyToken, cargarPerfil);

router.post('/eliminarCuenta', verifyToken, eliminarCuenta);

// Panel de control → Usuarios (solo admin): buscar y restablecer contraseñas olvidadas
router.post('/buscarUsuariosAdmin', verifyToken, requireAdmin, buscarUsuariosAdmin);
router.post('/restablecerPasswordAdmin', verifyToken, requireAdmin, restablecerPasswordAdmin);

module.exports = router;