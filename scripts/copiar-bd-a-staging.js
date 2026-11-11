/**
 * Copia la base de datos de PRODUCCIÓN en la de STAGING (pruebas).
 *
 *   npm run bd:copiar-a-staging
 *
 * - Producción solo se LEE (pg_dump). Staging se BORRA y se reemplaza entera.
 * - Las URLs se piden al ejecutarlo (o por las variables ORIGEN_DATABASE_URL y
 *   DESTINO_DATABASE_URL) y no se guardan en ningún fichero.
 * - Usa la URL PÚBLICA de cada base de datos de Railway (DATABASE_PUBLIC_URL):
 *   la interna (*.railway.internal) solo funciona dentro de Railway.
 * - La restauración va en una única transacción: si falla algo, staging queda como estaba.
 *
 * Requiere pg_dump y psql instalados (PostgreSQL client tools).
 */
const { spawn } = require('node:child_process');
const readline = require('node:readline/promises');
const { Transform } = require('node:stream');

const describir = (url) => {
    const u = new URL(url);
    return `${u.hostname}:${u.port || 5432}/${u.pathname.slice(1)}`;
};

// Líneas que pg_dump moderno genera y que un servidor PostgreSQL más antiguo no entiende
const LINEAS_A_OMITIR = [/^SET transaction_timeout\b/];

const filtrarLineas = () => {
    let resto = '';
    return new Transform({
        transform(chunk, _enc, cb) {
            const lineas = (resto + chunk.toString('utf8')).split('\n');
            resto = lineas.pop();
            const salida = lineas.filter((l) => !LINEAS_A_OMITIR.some((re) => re.test(l)));
            cb(null, salida.length ? salida.join('\n') + '\n' : '');
        },
        flush(cb) {
            cb(null, LINEAS_A_OMITIR.some((re) => re.test(resto)) ? '' : resto);
        },
    });
};

async function main() {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    const origen = process.env.ORIGEN_DATABASE_URL || (await rl.question('URL pública de la BD de PRODUCCIÓN (origen): ')).trim();
    const destino = process.env.DESTINO_DATABASE_URL || (await rl.question('URL pública de la BD de STAGING (destino): ')).trim();

    if (!origen || !destino) throw new Error('Faltan las URLs de origen y destino.');
    if (describir(origen) === describir(destino)) {
        throw new Error('Origen y destino son la MISMA base de datos. Operación cancelada.');
    }

    console.log('\n  Origen  (solo lectura):        ' + describir(origen));
    console.log('  Destino (se BORRA y reemplaza): ' + describir(destino) + '\n');

    const confirmacion = (await rl.question('Escribe COPIAR para continuar: ')).trim();
    rl.close();
    if (confirmacion !== 'COPIAR') {
        console.log('Cancelado.');
        return;
    }

    console.log('\nCopiando... (puede tardar un poco)');

    await new Promise((resolve, reject) => {
        const dump = spawn('pg_dump', ['--no-owner', '--no-acl', '--clean', '--if-exists', origen]);
        const restore = spawn('psql', ['--quiet', '-v', 'ON_ERROR_STOP=1', '--single-transaction', destino], {
            stdio: ['pipe', 'ignore', 'pipe'],
        });

        let errores = '';
        dump.stderr.on('data', (d) => (errores += '[pg_dump] ' + d));
        restore.stderr.on('data', (d) => (errores += '[psql] ' + d));

        dump.stdout.pipe(filtrarLineas()).pipe(restore.stdin);

        let codigoDump = null;
        dump.on('error', reject);
        restore.on('error', reject);
        dump.on('close', (code) => (codigoDump = code));
        restore.on('close', (code) => {
            if (codigoDump === 0 && code === 0) return resolve();
            reject(new Error(`La copia ha fallado (pg_dump=${codigoDump}, psql=${code}). Staging no se ha modificado.\n${errores}`));
        });
    });

    console.log('✅ Copia terminada: staging tiene ahora los datos de producción.');
}

main().catch((error) => {
    console.error('\n❌ ' + error.message);
    process.exit(1);
});
