const express = require("express");
const router = express.Router();
const { crearPartido, editarPartido, cerrarActaPartido, obtenerActaPartido } = require('../controllers/partidos.controller');
const { verifyToken } = require("../services/verifyToken");

// /api/partidos

router.post('/crearPartido', verifyToken, crearPartido);

router.post('/editarPartido', verifyToken, editarPartido);

router.post('/cerrarActa', verifyToken, cerrarActaPartido);

router.post('/obtenerActa', verifyToken, obtenerActaPartido);

module.exports = router;