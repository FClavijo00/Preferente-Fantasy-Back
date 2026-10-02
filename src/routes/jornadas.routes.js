const express = require("express");
const router = express.Router();
const { 
    getCalendarioJornadas, 
    getJornadaActual,
     getJornadas, 
     cargarPartidosJornada, 
     cambiarEstadoJornada ,
     crearJornada,
     getSiguienteJornada,
     getPuntuacionesJornadas
} = require('../controllers/jornadas.controller');
const { verifyToken } = require("../services/verifyToken");

// GET /api/jornadas
router.get('/getCalendarioJornadas', verifyToken, getCalendarioJornadas);

router.get('/getJornadaActual', verifyToken, getJornadaActual);

router.get('/getJornadas', verifyToken, getJornadas);

router.post('/cargarPartidosJornada', verifyToken, cargarPartidosJornada);

router.post('/cambiarEstadoJornada', verifyToken, cambiarEstadoJornada);

router.post('/crearJornada', verifyToken, crearJornada);

router.get('/getSiguienteJornada', verifyToken, getSiguienteJornada);

router.post('/getPuntuacionesJornadas', verifyToken, getPuntuacionesJornadas);

module.exports = router;