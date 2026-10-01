const express = require("express");
const router = express.Router();
const { verifyToken } = require("../services/verifyToken");
const { getClasificacionLiga } = require("../controllers/clasificaciones.controller");

// GET /api/clasificaciones
router.post('/getClasificacionLiga', verifyToken, getClasificacionLiga);

module.exports = router;