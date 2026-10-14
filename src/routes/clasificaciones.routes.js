const express = require("express");
const router = express.Router();
const { verifyToken } = require("../services/verifyToken");
const { getClasificacionLiga, getClasificacionPorJornada } = require("../controllers/clasificaciones.controller");

// GET /api/clasificaciones
router.post('/getClasificacionLiga', verifyToken, getClasificacionLiga);

router.post('/getClasificacionPorJornada', verifyToken, getClasificacionPorJornada);

module.exports = router;