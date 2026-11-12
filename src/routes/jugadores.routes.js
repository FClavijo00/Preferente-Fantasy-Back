const express = require("express");
const router = express.Router();
const { crearJugador, editarJugador, eliminarJugador, getRanking, getJugadores, getJugadoresPorJornada, getJugadoresEquipoAdmin } = require('../controllers/jugadores.controller');
const { verifyToken } = require("../services/verifyToken");
const { requireAdmin } = require('../services/permisos');
const { upload } = require('../config/s3');

// GET /api/jugadores
router.get('/getRanking', verifyToken, getRanking);

router.post('/crearJugador', verifyToken, requireAdmin, upload.single('foto'), crearJugador);

router.post('/editarJugador', verifyToken, requireAdmin, upload.single('foto'), editarJugador);

router.post('/eliminarJugador', verifyToken, requireAdmin, eliminarJugador);

router.post('/getJugadores', verifyToken, getJugadores);

router.post('/getJugadoresPorJornada', verifyToken, getJugadoresPorJornada);

// Panel de control
router.post('/getJugadoresEquipoAdmin', verifyToken, requireAdmin, getJugadoresEquipoAdmin);

module.exports = router;