const express = require("express");
const router = express.Router();
const { getEquipos, getClasificacion, getEquiposLimpios } = require('../controllers/equipos.controller');
const { verifyToken } = require("../services/verifyToken");

// GET /api/equipos
router.get('/getEquipos', verifyToken, getEquipos);

router.get('/getEquiposLimpios', verifyToken, getEquiposLimpios);

router.get('/getClasificacion', verifyToken, getClasificacion);

module.exports = router;