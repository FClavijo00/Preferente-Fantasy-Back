const express = require('express');
const router = express.Router();
const { verifyToken } = require('../services/verifyToken');
const { requireAdmin } = require('../services/permisos');
const { getSancionesAdmin, crearSancion, editarSancion, eliminarSancion } = require('../controllers/sanciones.controller');

// /api/sanciones — panel de control (solo admin)
router.get('/getSancionesAdmin', verifyToken, requireAdmin, getSancionesAdmin);

router.post('/crearSancion', verifyToken, requireAdmin, crearSancion);

router.post('/editarSancion', verifyToken, requireAdmin, editarSancion);

router.post('/eliminarSancion', verifyToken, requireAdmin, eliminarSancion);

module.exports = router;
