const express = require("express");
const router = express.Router();
const {
    crearPartido,
    editarPartido,
    eliminarPartido,
    cerrarActaPartido,
    obtenerActaPartido,
    getActaPartidoPuntos,
    getJugadoresActa,
} = require("../controllers/partidos.controller");
const { verifyToken } = require("../services/verifyToken");
const { requireAdmin } = require("../services/permisos");

// /api/partidos

router.post("/crearPartido", verifyToken, requireAdmin, crearPartido);

router.post("/editarPartido", verifyToken, requireAdmin, editarPartido);

router.post("/eliminarPartido", verifyToken, requireAdmin, eliminarPartido);

router.post("/cerrarActa", verifyToken, requireAdmin, cerrarActaPartido);

router.post("/obtenerActa", verifyToken, obtenerActaPartido);

router.post("/getJugadoresActa", verifyToken, requireAdmin, getJugadoresActa);

router.post("/getActaPartidoPuntos", verifyToken, getActaPartidoPuntos);

module.exports = router;
