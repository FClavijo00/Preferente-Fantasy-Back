const express = require("express");
const router = express.Router();
const { verifyToken } = require("../services/verifyToken");
const { requireAdmin } = require("../services/permisos");
const {
    guardarAlineacion,
    cargarAlineacion,
    cargarAlineacionesJornadas,
    cargarOnceIdeal,
    guardarOnceIdeal,
    eliminarOnceIdeal,
} = require("../controllers/alineaciones.controller");

// GET /api/alineaciones
router.post("/cargarAlineacion", verifyToken, cargarAlineacion);

router.post(
    "/cargarAlineacionesJornadas",
    verifyToken,
    cargarAlineacionesJornadas,
);

router.post("/guardarAlineacion", verifyToken, guardarAlineacion);

router.post("/cargarOnceIdeal", verifyToken, cargarOnceIdeal);

router.post("/guardarOnceIdeal", verifyToken, requireAdmin, guardarOnceIdeal);

router.post("/eliminarOnceIdeal", verifyToken, requireAdmin, eliminarOnceIdeal);

module.exports = router;
