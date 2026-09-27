const express = require("express");
const router = express.Router();
const { crearJugador, editarJugador, getRanking, getJugadores } = require('../controllers/jugadores.controller');
const { verifyToken } = require("../services/verifyToken");
const { upload } = require('../config/s3');

// GET /api/jugadores
router.get('/getRanking', verifyToken, getRanking);

router.post('/crearJugador', verifyToken, upload.single('foto'), crearJugador);

router.post('/editarJugador', verifyToken, upload.single('foto'), editarJugador);

router.post('getJugadores', verifyToken, getJugadores);

module.exports = router;