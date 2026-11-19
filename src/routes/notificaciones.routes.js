const express = require('express');
const router = express.Router();
const { verifyToken } = require('../services/verifyToken');
const { requireAdmin } = require('../services/permisos');
const {
    getClavePublica,
    suscribir,
    desuscribir,
    getPreferencias,
    guardarPreferencias,
    enviarPrueba,
    enviarAviso,
    getHistorialAvisos,
} = require('../controllers/notificaciones.controller');

// /api/notificaciones
router.get('/getClavePublica', verifyToken, getClavePublica);

router.post('/suscribir', verifyToken, suscribir);

router.post('/desuscribir', verifyToken, desuscribir);

router.get('/getPreferencias', verifyToken, getPreferencias);

router.post('/guardarPreferencias', verifyToken, guardarPreferencias);

router.post('/enviarPrueba', verifyToken, enviarPrueba);

// Panel de control (solo admin)
router.post('/enviarAviso', verifyToken, requireAdmin, enviarAviso);

router.get('/getHistorialAvisos', verifyToken, requireAdmin, getHistorialAvisos);

module.exports = router;
