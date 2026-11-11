const express = require("express");
const router = express.Router();
const { login, register, cambiarPassword, actualizarUsuario, cargarPerfil, eliminarCuenta } = require('../controllers/auth.controller');
const { upload } = require('../config/s3');
const { verifyToken } = require('../services/verifyToken');
// GET /api/auth
router.post('/login', login);

router.post('/register', upload.single('foto'), register);

// Estas rutas actúan siempre sobre el usuario del token, nunca sobre un id/email del body
router.post('/cambiarPassword', verifyToken, cambiarPassword);

router.post('/actualizarUsuario', verifyToken, upload.single('foto'), actualizarUsuario);

router.post('/cargarPerfil', verifyToken, cargarPerfil);

router.post('/eliminarCuenta', verifyToken, eliminarCuenta);

module.exports = router;