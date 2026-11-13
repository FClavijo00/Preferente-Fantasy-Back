const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Middlewares Globales
app.use(cors()); // Permite peticiones desde tu app Ionic en local/móvil
app.use(express.json());

// Rutas
const equiposRoutes = require('../routes/equipos.routes');
app.use('/api/equipos', equiposRoutes);

const jugadoresRoutes = require('../routes/jugadores.routes');
app.use('/api/jugadores', jugadoresRoutes);

const jornadasRoutes = require('../routes/jornadas.routes');
app.use('/api/jornadas', jornadasRoutes);

const authRoutes = require('../routes/auth.routes');
app.use('/api/auth', authRoutes);

const ligasRoutes = require('../routes/ligas.routes');
app.use('/api/ligas', ligasRoutes);

const partidosRoutes = require('../routes/partidos.routes');
app.use('/api/partidos', partidosRoutes);

const formacionesRoutes = require('../routes/formaciones.routes');
app.use('/api/formaciones', formacionesRoutes);

const alineacionesRoutes = require('../routes/alineaciones.routes');
app.use('/api/alineaciones', alineacionesRoutes);

const clasificacionesRoutes = require('../routes/clasificaciones.routes');
app.use('/api/clasificaciones', clasificacionesRoutes);

const sancionesRoutes = require('../routes/sanciones.routes');
app.use('/api/sanciones', sancionesRoutes);

// Errores no controlados (p. ej. una foto que supera el límite de subida): siempre en JSON,
// nunca la página de error de Express con la traza
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ ok: false, message: 'La foto es demasiado grande (máximo 5 MB).' });
  }
  if (err && err.name === 'MulterError') {
    return res.status(400).json({ ok: false, message: 'No se ha podido procesar el archivo enviado.' });
  }
  console.error('Error no controlado:', err);
  res.status(500).json({ ok: false, message: 'Error interno del servidor' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor backend corriendo en el puerto ${PORT}`);
});