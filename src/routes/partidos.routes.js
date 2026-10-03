const express = require("express");
const router = express.Router();
const { crearPartido, editarPartido, cerrarActaPartido, obtenerActaPartido, getActaPartidoPuntos } = require('../controllers/partidos.controller');
const { verifyToken } = require("../services/verifyToken");

// /api/partidos

router.post('/crearPartido', verifyToken, crearPartido);

router.post('/editarPartido', verifyToken, editarPartido);

router.post('/cerrarActa', verifyToken, cerrarActaPartido);

router.post('/obtenerActa', verifyToken, obtenerActaPartido);

router.post('/getActaPartidoPuntos', verifyToken, getActaPartidoPuntos);

module.exports = router;