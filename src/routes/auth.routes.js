const express = require("express");
const router = express.Router();
const { login, register, cambiarPassword, actualizarUsuario, cargarPerfil } = require('../controllers/auth.controller');
const { upload } = require('../config/s3');
// GET /api/auth
router.post('/login', login);

router.post('/register', upload.single('foto'), register);

router.post('/cambiarPassword', cambiarPassword)

router.post('/actualizarUsuario', upload.single('foto'), actualizarUsuario);

router.post('/cargarPerfil', cargarPerfil);

module.exports = router;