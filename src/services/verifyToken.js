const jwt = require('jsonwebtoken');

const verifyToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  
  // El formato esperado es: "Bearer <token>"
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ ok: false, message: 'Acceso denegado: Token no proporcionado' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId; // Extraemos el id cargado en el token
    next();
  } catch (error) {
    return res.status(403).json({ ok: false, message: 'Token inválido o expirado' });
  }
};

module.exports = { verifyToken };