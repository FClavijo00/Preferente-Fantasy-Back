/**
 * Carga en la base de datos las jornadas y partidos del calendario oficial que falten.
 *
 *   npm run bd:importar-calendario -- --desde 13              (solo enseña lo que haría)
 *   npm run bd:importar-calendario -- --desde 13 --aplicar    (lo hace)
 *
 * Opciones:
 *   --desde N        Primera jornada a cargar (obligatorio).
 *   --url URL        Base de datos destino (URL pública de Railway). Sin ella, la local del .env.
 *   --aplicar        Escribe de verdad. Sin esta opción solo se muestra el plan.
 *   --datos FICHERO  JSON del calendario (por defecto, el de 1ª Andaluza Jaén 2026/27).
 *
 * Qué hace, jornada a jornada (desde N):
 * - Si la jornada no existe, la crea PENDIENTE: inicio (fecha límite para alinear) el día anterior
 *   a la fecha de la jornada a las 15:00, y fin ese día a las 23:59. Se pueden ajustar en el panel.
 * - Si existe y no tiene partidos, le añade los 9 partidos (sin fecha: "Fecha por confirmar").
 * - Si ya tiene partidos, NO la toca.
 * Todo va en una transacción: o se carga entero o no se carga nada. Se puede repetir sin duplicar.
 *
 * Los equipos se buscan por su nombre exacto en la base de datos destino (no por id).
 */
const path = require('node:path');
const fs = require('node:fs');
const readline = require('node:readline/promises');
require('dotenv').config({ quiet: true });
const { Client } = require('pg');

const args = process.argv.slice(2);
const valor = (nombre) => {
    const i = args.indexOf(nombre);
    return i >= 0 ? args[i + 1] : undefined;
};

const desde = Number(valor('--desde'));
const url = valor('--url');
const aplicar = args.includes('--aplicar');
const ficheroDatos = valor('--datos') || path.join(__dirname, 'datos', 'calendario-1a-andaluza-jaen-2026-27.json');

const COMPETICION_ID = 1;

/** "2026-11-22" -> inicio "2026-11-21T15:00", fin "2026-11-22T23:59" */
const fechasJornada = (fecha) => {
    const [a, m, d] = fecha.split('-').map(Number);
    const anterior = new Date(Date.UTC(a, m - 1, d - 1));
    const dos = (n) => String(n).padStart(2, '0');
    const inicio = `${anterior.getUTCFullYear()}-${dos(anterior.getUTCMonth() + 1)}-${dos(anterior.getUTCDate())}T15:00`;
    return { inicio, fin: `${fecha}T23:59` };
};

const describir = (u) => {
    if (!u) return `${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME} (local, .env)`;
    const x = new URL(u);
    return `${x.hostname}:${x.port || 5432}${x.pathname}`;
};

async function main() {
    if (!Number.isInteger(desde) || desde < 1) throw new Error('Indica la primera jornada: --desde N');

    const datos = JSON.parse(fs.readFileSync(ficheroDatos, 'utf8'));
    const jornadas = datos.jornadas.filter((j) => j.numero >= desde);

    const client = new Client(
        url
            ? { connectionString: url, ssl: { rejectUnauthorized: false } }
            : {
                  host: process.env.DB_HOST,
                  port: process.env.DB_PORT,
                  user: process.env.DB_USER,
                  password: process.env.DB_PASSWORD,
                  database: process.env.DB_NAME,
              },
    );

    console.log(`\nCalendario: ${datos.competicion}`);
    console.log(`Destino:    ${describir(url)}`);
    console.log(`Jornadas:   ${desde} a ${datos.jornadas.at(-1).numero}   ${aplicar ? '(SE VA A ESCRIBIR)' : '(solo simulación)'}\n`);

    await client.connect();
    try {
        // Equipos del destino por nombre exacto
        const { rows: equipos } = await client.query('SELECT id, nombre FROM equipos');
        const idEquipo = new Map(equipos.map((e) => [e.nombre, e.id]));
        const faltan = [...new Set(jornadas.flatMap((j) => j.partidos.flatMap((p) => [p.local, p.visitante])))].filter(
            (n) => !idEquipo.has(n),
        );
        if (faltan.length) throw new Error(`Estos equipos no existen en el destino: ${faltan.join(', ')}`);

        const { rows: existentes } = await client.query(
            `SELECT j.id, j.numero_jornada, (SELECT COUNT(*) FROM partidos p WHERE p.jornada_id = j.id)::INT AS partidos
             FROM jornadas j WHERE j.competicion_id = $1`,
            [COMPETICION_ID],
        );
        const porNumero = new Map(existentes.map((j) => [j.numero_jornada, j]));

        // Plan
        const plan = jornadas.map((j) => {
            const actual = porNumero.get(j.numero);
            if (!actual) return { j, accion: 'crear' };
            if (actual.partidos === 0) return { j, accion: 'partidos', id: actual.id };
            return { j, accion: 'nada', partidos: actual.partidos };
        });

        for (const { j, accion, partidos } of plan) {
            const { inicio } = fechasJornada(j.fecha);
            const texto = {
                crear: `crear jornada (inicio ${inicio.replace('T', ' ')}) + 9 partidos`,
                partidos: 'ya existe sin partidos: añadir 9 partidos',
                nada: `ya tiene ${partidos} partidos: no se toca`,
            }[accion];
            console.log(`  J${String(j.numero).padStart(2)}  ${j.fecha}  ${texto}`);
        }

        const pendientes = plan.filter((p) => p.accion !== 'nada');
        console.log(`\n${pendientes.length} jornadas por cargar (${pendientes.length * 9} partidos).`);

        if (!aplicar) {
            console.log('Simulación: no se ha escrito nada. Añade --aplicar para hacerlo.\n');
            return;
        }
        if (pendientes.length === 0) return;

        // Contra una base de datos remota, confirmación explícita
        if (url) {
            const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
            const ok = (await rl.question(`Escribe CARGAR para escribir en ${describir(url)}: `)).trim();
            rl.close();
            if (ok !== 'CARGAR') {
                console.log('Cancelado.\n');
                return;
            }
        }

        await client.query('BEGIN');
        for (const { j, accion, id } of pendientes) {
            let jornadaId = id;
            if (accion === 'crear') {
                const { inicio, fin } = fechasJornada(j.fecha);
                const { rows } = await client.query(
                    `INSERT INTO jornadas (numero_jornada, estado, fecha_inicio, fecha_fin, competicion_id)
                     VALUES ($1, 'PENDIENTE', $2, $3, $4) RETURNING id`,
                    [j.numero, inicio, fin, COMPETICION_ID],
                );
                jornadaId = rows[0].id;
            }
            for (const p of j.partidos) {
                await client.query(
                    `INSERT INTO partidos (jornada_id, equipo_local_id, equipo_visitante_id, fecha_partido,
                                           goles_local, goles_visitante, jugado, competicion_id)
                     VALUES ($1, $2, $3, NULL, 0, 0, false, $4)`,
                    [jornadaId, idEquipo.get(p.local), idEquipo.get(p.visitante), COMPETICION_ID],
                );
            }
        }
        await client.query('COMMIT');
        console.log(`✅ Cargadas ${pendientes.length} jornadas (${pendientes.length * 9} partidos).\n`);
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        await client.end();
    }
}

main().catch((error) => {
    console.error('\n❌ ' + error.message + '\n');
    process.exit(1);
});
