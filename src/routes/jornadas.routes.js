const express = require("express");
const router = express.Router();
const {
    getCalendarioJornadas,
    getJornadaActual,
    getJornadas,
    cargarPartidosJornada,
    cambiarEstadoJornada,
    crearJornada,
    getSiguienteJornada,
    getPuntuacionesJornadas,
    getJornadasDisputadas,
    getJornadasOnceIdeal,
    getJornadasOnceIdealAdmin,
    getJornadasAdmin,
    editarJornada,
    eliminarJornada
} = require('../controllers/jornadas.controller');
const { verifyToken } = require("../services/verifyToken");
const { requireAdmin } = require('../services/permisos');

// GET /api/jornadas
router.get('/getCalendarioJornadas', verifyToken, getCalendarioJornadas);

router.get('/getJornadaActual', verifyToken, getJornadaActual);

router.get('/getJornadas', verifyToken, getJornadas);

router.post('/cargarPartidosJornada', verifyToken, cargarPartidosJornada);

router.post('/cambiarEstadoJornada', verifyToken, requireAdmin, cambiarEstadoJornada);

router.post('/crearJornada', verifyToken, requireAdmin, crearJornada);

// Panel de control: gestión de jornadas
router.get('/getJornadasAdmin', verifyToken, requireAdmin, getJornadasAdmin);

router.post('/editarJornada', verifyToken, requireAdmin, editarJornada);

router.post('/eliminarJornada', verifyToken, requireAdmin, eliminarJornada);

router.get('/getSiguienteJornada', verifyToken, getSiguienteJornada);

router.post('/getPuntuacionesJornadas', verifyToken, getPuntuacionesJornadas);

router.get('/getJornadasDisputadas', verifyToken, getJornadasDisputadas);

router.get('/getJornadasOnceIdeal', verifyToken, getJornadasOnceIdeal);

router.get('/getJornadasOnceIdealAdmin', verifyToken, requireAdmin, getJornadasOnceIdealAdmin);

module.exports = router;