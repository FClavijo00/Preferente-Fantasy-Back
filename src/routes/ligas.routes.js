const express = require("express");
const router = express.Router();
const { crearLiga, getMisLigas, getLigasAbiertas, unirseALiga, abandonarLiga, eliminarLiga, cargarUsuariosLiga } = require('../controllers/ligas.controller');
const { verifyToken } = require("../services/verifyToken");

// /api/ligas

router.post('/abandonarLiga', verifyToken, abandonarLiga);

router.post('/eliminarLiga', verifyToken, eliminarLiga);

router.post('/crearLiga', verifyToken, crearLiga);

router.get('/getMisLigas', verifyToken, getMisLigas);

router.get('/getLigasAbiertas', verifyToken, getLigasAbiertas);

router.post('/unirseALiga', verifyToken, unirseALiga);

router.post('/cargarUsuariosLiga,', verifyToken, cargarUsuariosLiga);

module.exports = router;