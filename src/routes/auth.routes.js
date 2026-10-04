const express = require("express");
const router = express.Router();
const { login, register } = require('../controllers/auth.controller');
const { upload } = require('../config/s3');
// GET /api/auth
router.post('/login', login);

router.post('/register', upload.single('foto'), register);

module.exports = router;