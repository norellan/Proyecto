// Prueba de punta a punta de comprar.js contra test/sitio-simulado.html (no toca turbus.cl).
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';

const dir = new URL('..', import.meta.url).pathname;
const html = readFileSync(new URL('./sitio-simulado.html', import.meta.url));
// El sitio simulado responde la misma página para cualquier ruta, como la app de turbus.cl.
const servidor = createServer((_, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); });
await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
const env = { ...process.env, HEADLESS: '1', TURBUS_CONFIG: '', TURBUS_URL: `http://127.0.0.1:${servidor.address().port}/` };

async function correr(nombre, args) {
  const { spawn } = await import('node:child_process');
  const hijo = spawn('node', ['comprar.js', '--config', 'config.ejemplo.json', '--fecha', '2026-10-23', ...args], { cwd: dir, env });
  let salida = '';
  hijo.stdout.on('data', (d) => (salida += d)); hijo.stderr.on('data', (d) => (salida += d));
  await new Promise((r) => hijo.on('close', r));
  console.log(`\n── ${nombre}\n${salida}`.trimEnd());
  return JSON.parse(readFileSync(`${dir}/capturas/resultado.json`, 'utf8'));
}

try {
  let res = await correr('automático (hora 09:00, ventana)', ['--hora', '09:00']);
  assert.equal(res.ok, true, 'el flujo debe llegar a la página de pago');
  assert.equal(res.salida, '08:45', 'salida más cercana a las 09:00 que no esté agotada');
  assert.deepEqual(res.asientos, ['3'], 'ventana libre más baja (1 está ocupado → 3)');
  assert.equal(res.reservaVence, '08:59');

  res = await correr('paso 1: listar horarios', ['--listar']);
  assert.deepEqual(res.servicios.map((s) => s.hora), ['07:30', '08:45', '08:45', '11:00']);
  assert.equal(res.servicios[0].agotado, true);
  assert.equal(res.servicios[2].empresa, 'Cóndor Bus');

  res = await correr('paso 2: asientos del 11:00, piso 2', ['--salida', '11:00', '--piso', '2', '--ver-asientos']);
  assert.ok(res.asientosLibres.every((a) => a.piso === 2 && a.numero !== '18'));
  assert.deepEqual(res.asientosLibres.filter((a) => a.ventana).map((a) => a.numero).slice(0, 2), ['17', '19']);

  res = await correr('paso 3: 08:45 Cóndor, asientos 2 y 22', ['--salida', '08:45', '--empresa', 'condor', '--numeros', '2,22']);
  assert.equal(res.ok, true);
  assert.equal(res.empresa, 'Cóndor Bus');
  assert.deepEqual(res.asientos, ['2', '22']);

  res = await correr('error: asiento ocupado', ['--salida', '11:00', '--numeros', '4']);
  assert.equal(res.ok, false);
  assert.match(res.error, /4 no disponibles/);

  res = await correr('error: salida agotada', ['--salida', '07:30', '--ver-asientos']);
  assert.match(res.error, /agotada/);

  res = await correr('error: hora inexistente', ['--salida', '17:15', '--ver-asientos']);
  assert.match(res.error, /No hay salida a las 17:15/);

  console.log('\n✔ todas las pruebas OK');
} finally {
  servidor.close();
}
