const express = require("express");
const router = express.Router();
const { verifyToken } = require("../services/verifyToken");
const { guardarAlineacion, cargarAlineacion } = require("../controllers/alineaciones.controller");

// GET /api/alineaciones
router.post('/cargarAlineacion', verifyToken, cargarAlineacion);

router.post('/guardarAlineacion', verifyToken, guardarAlineacion);

module.exports = router;