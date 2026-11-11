const jwt = require('jsonwebtoken');

const verifyToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  
  // El formato esperado es: "Bearer <token>"
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ ok: false, code: 'TOKEN_INVALIDO', message: 'Acceso denegado: Token no proporcionado' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId; // Extraemos el id cargado en el token
    next();
  } catch (error) {
    // 401 + code: el front cierra la sesión al recibirlo (403 queda para "no tienes permiso")
    return res.status(401).json({ ok: false, code: 'TOKEN_INVALIDO', message: 'Token inválido o expirado' });
  }
};

module.exports = { verifyToken };