const express = require('express');
const router = express.Router();
const { getJornadaPublica } = require('../controllers/publico.controller');

// Sin verifyToken: son las páginas abiertas de la web (buscadores, AdSense, visitantes sin cuenta)
router.get('/jornada', getJornadaPublica);
router.get('/jornada/:numero', getJornadaPublica);

module.exports = router;
