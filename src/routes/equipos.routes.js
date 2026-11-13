const express = require("express");
const router = express.Router();
const { getEquipos, getClasificacion, getEquiposLimpios, getDetalleEquipo } = require('../controllers/equipos.controller');
const { verifyToken } = require("../services/verifyToken");

// GET /api/equipos
router.get('/getEquipos', verifyToken, getEquipos);

router.get('/getEquiposLimpios', verifyToken, getEquiposLimpios);

router.get('/getClasificacion', verifyToken, getClasificacion);

// Detalle de un equipo (modal desde la clasificación)
router.post('/getDetalleEquipo', verifyToken, getDetalleEquipo);

module.exports = router;