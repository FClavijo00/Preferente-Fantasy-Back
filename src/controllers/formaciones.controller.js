const pool = require('../config/db');

const getFormaciones = async (req, res) => {
    try {
        const query = 'SELECT * FROM formaciones';

        const { rows } = await pool.query(query);

        res.status(200).json({
            ok: true,
            data: rows
        });

    } catch (error) {
        console.error('Error al obtener las formaciones:', error);
        res.status(500).json({
            ok: false,
            message: 'Error al obtener las formaciones'
        });
    }
};


module.exports = {
    getFormaciones
};