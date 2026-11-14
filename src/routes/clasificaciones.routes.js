const express = require("express");
const router = express.Router();
const { verifyToken } = require("../services/verifyToken");
const { getClasificacionLiga, getClasificacionPorJornada, getResumenUltimaJornada, getJornadasLiga } = require("../controllers/clasificaciones.controller");

// GET /api/clasificaciones
router.post('/getClasificacionLiga', verifyToken, getClasificacionLiga);

router.post('/getClasificacionPorJornada', verifyToken, getClasificacionPorJornada);

// Jornadas en juego o cerradas con alineaciones en la liga (pestaña Jornadas)
router.post('/getJornadasLiga', verifyToken, getJornadasLiga);

// Inicio: resumen de la última jornada cerrada en la liga
router.post('/getResumenUltimaJornada', verifyToken, getResumenUltimaJornada);

module.exports = router;