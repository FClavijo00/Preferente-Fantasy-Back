const express = require("express");
const router = express.Router();
const { crearLiga, getMisLigas, getLigasAbiertas, unirseALiga } = require('../controllers/ligas.controller');
const { verifyToken } = require("../services/verifyToken");

// /api/ligas

router.post('/crearLiga', verifyToken, crearLiga);

router.get('/getMisLigas', verifyToken, getMisLigas);

router.get('/getLigasAbiertas', verifyToken, getLigasAbiertas);

router.post('/unirseALiga', verifyToken, unirseALiga);

module.exports = router;