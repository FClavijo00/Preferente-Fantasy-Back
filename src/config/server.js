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


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor backend corriendo en el puerto ${PORT}`);
});