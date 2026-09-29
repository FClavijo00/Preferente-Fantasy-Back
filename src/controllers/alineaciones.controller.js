const pool = require('../config/db');
const { getDownloadUrl } = require('../config/s3');

const cargarAlineacion = async (req, res) => {
    try {
        const { liga_id, usuario_id, jornada_id } = req.body;

        if (!liga_id || !usuario_id || !jornada_id) {
            return res.status(400).json({ error: 'Faltan parámetros requeridos.' });
        }

        // 1. Buscamos la plantilla guardada
        const queryPlantilla = `
            SELECT id, formacion_id 
            FROM plantillas_usuario 
            WHERE liga_id = $1 AND usuario_id = $2 AND jornada_id = $3
        `;
        const { rows: plantillas } = await pool.query(queryPlantilla, [liga_id, usuario_id, jornada_id]);

        if (plantillas.length === 0) {
            // No hay plantilla guardada aún para esta jornada
            return res.json({ existe: false, formacion_id: 1, jugadores: [] });
        }

        const plantilla = plantillas[0];

        // 2. Traemos los jugadores alineados con sus datos
        const queryJugadores = `
            SELECT 
                pj.hueco_index,
                pj.posicion,
                j.id,
                j.nombre,
                j.apodo,
                j.foto_url,
                j.equipo_id,
                e.nombre AS equipo_nombre
            FROM plantilla_jugadores pj
            JOIN jugadores j ON pj.jugador_id = j.id
            JOIN equipos e ON j.equipo_id = e.id
            WHERE pj.plantilla_id = $1
        `;
        const { rows: jugadores } = await pool.query(queryJugadores, [plantilla.id]);

        // 3. Procesamos la foto de los jugadores
        const jugadoresProcesados = await Promise.all(
            jugadores.map(async (jugador) => {
                const fotoUrl = await getDownloadUrl('jugadores/' + jugador.foto_url);
                jugador.foto = fotoUrl;
                return jugador;
            })
        )

        return res.json({
            existe: true,
            formacion_id: plantilla.formacion_id,
            jugadores: jugadoresProcesados
        });

    } catch (error) {
        console.error('Error al cargar alineación:', error);
        return res.status(500).json({ error: 'Error interno del servidor.' });
    }
};

const guardarAlineacion = async (req, res) => {
    try {
        const { liga_id, usuario_id, jornada_id, formacion_id, jugadores } = req.body;

        // Validación básica
        if (!liga_id || !usuario_id || !jornada_id || !formacion_id || !Array.isArray(jugadores)) {
            return res.status(400).json({ error: 'Faltan campos obligatorios para guardar la alineación.' });
        }

        // 1. Iniciamos la transacción SQL
        await pool.query('BEGIN');

        //2. Insertamos o actualizamos plantilla del usuario para la jornada
        const queryPlantilla = `
            INSERT INTO plantillas_usuario (liga_id, usuario_id, jornada_id, formacion_id)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (liga_id, usuario_id, jornada_id) 
            DO UPDATE SET formacion_id = EXCLUDED.formacion_id, updated_at = NOW()
            RETURNING id;
        `;

        const resPlantilla = await pool.query(queryPlantilla, [
            liga_id,
            usuario_id,
            jornada_id,
            formacion_id
        ]);

        const plantillaId = resPlantilla.rows[0].id;

        // 3. Limpiamos los jugadores guardados previamente en esta plantilla (si existían)
        await pool.query(
            'DELETE FROM plantilla_jugadores WHERE plantilla_id = $1',
            [plantillaId]
        );

        // 4. Insertamos los nuevos jugadores seleccionados
        const queryJugadores = `
            INSERT INTO plantilla_jugadores (plantilla_id, jugador_id, posicion, hueco_index)
            VALUES ($1, $2, $3, $4);
        `;

        for (const slot of jugadores) {
            if (slot.jugador_id) { // Solo insertamos los huecos que tengan jugador asignado
                await pool.query(queryJugadores, [
                    plantillaId,
                    slot.jugador_id,
                    slot.posicion,
                    slot.hueco_index
                ]);
            }
        }

        // 5. Confirmamos todos los cambios en la base de datos
        await pool.query('COMMIT');

        return res.status(200).json({
            ok: true,
            mensaje: 'Alineación guardada correctamente.',
            plantilla_id: plantillaId,

        });

    } catch (error) {
        // Si algo falla, revertimos cualquier cambio efectuado
        await pool.query('ROLLBACK');
        console.error('Error al guardar alineación:', error);
        return res.status(500).json({ error: 'Error al guardar la alineación.' });
    }
};

module.exports = {
    cargarAlineacion,
    guardarAlineacion
};