const express = require("express");
const router = express.Router();
const { crearJugador, editarJugador, eliminarJugador, getRanking, getJugadores, getJugadoresPorJornada, getJugadoresEquipoAdmin, getDetalleJugador } = require('../controllers/jugadores.controller');
const { verifyToken } = require("../services/verifyToken");
const { requireAdmin } = require('../services/permisos');
const { upload } = require('../config/s3');

// GET /api/jugadores
router.get('/getRanking', verifyToken, getRanking);

// Detalle de un jugador (modal genérico)
router.post('/getDetalleJugador', verifyToken, getDetalleJugador);

router.post('/crearJugador', verifyToken, requireAdmin, upload.single('foto'), crearJugador);

router.post('/editarJugador', verifyToken, requireAdmin, upload.single('foto'), editarJugador);

router.post('/eliminarJugador', verifyToken, requireAdmin, eliminarJugador);

router.post('/getJugadores', verifyToken, getJugadores);

router.post('/getJugadoresPorJornada', verifyToken, getJugadoresPorJornada);

// Panel de control
router.post('/getJugadoresEquipoAdmin', verifyToken, requireAdmin, getJugadoresEquipoAdmin);

module.exports = router;