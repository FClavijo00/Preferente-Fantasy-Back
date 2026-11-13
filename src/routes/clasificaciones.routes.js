const express = require("express");
const router = express.Router();
const { verifyToken } = require("../services/verifyToken");
const { getClasificacionLiga, getClasificacionPorJornada, getResumenUltimaJornada } = require("../controllers/clasificaciones.controller");

// GET /api/clasificaciones
router.post('/getClasificacionLiga', verifyToken, getClasificacionLiga);

router.post('/getClasificacionPorJornada', verifyToken, getClasificacionPorJornada);

// Inicio: resumen de la última jornada cerrada en la liga
router.post('/getResumenUltimaJornada', verifyToken, getResumenUltimaJornada);

module.exports = router;