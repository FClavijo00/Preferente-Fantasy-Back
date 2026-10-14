const express = require("express");
const router = express.Router();
const { verifyToken } = require("../services/verifyToken");
const { guardarAlineacion, cargarAlineacion, cargarAlineacionesJornadas, cargarOnceIdeal } = require("../controllers/alineaciones.controller");

// GET /api/alineaciones
router.post('/cargarAlineacion', verifyToken, cargarAlineacion);

router.post('/cargarAlineacionesJornadas', verifyToken, cargarAlineacionesJornadas);

router.post('/guardarAlineacion', verifyToken, guardarAlineacion);

router.post('/cargarOnceIdeal', verifyToken, cargarOnceIdeal);

module.exports = router;