const express = require("express");
const router = express.Router();
const { verifyToken } = require("../services/verifyToken");
const { getFormaciones } = require("../controllers/formaciones.controller");

// GET /api/formaciones
router.get('/getFormaciones', verifyToken, getFormaciones);

module.exports = router;