// Prueba de punta a punta del script contra test/sitio-simulado.html (no toca turbus.cl).
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const dir = new URL('..', import.meta.url).pathname;
const env = { ...process.env, HEADLESS: '1', TURBUS_CONFIG: '', TURBUS_URL: new URL('./sitio-simulado.html', import.meta.url).href };

function correr(nombre, args) {
  const r = spawnSync('node', ['comprar.js', '--config', 'config.ejemplo.json', '--fecha', '2026-10-23', ...args], { cwd: dir, env, encoding: 'utf8' });
  console.log(`\n── ${nombre}\n${r.stdout}${r.stderr}`.trimEnd());
  return JSON.parse(readFileSync(`${dir}/capturas/resultado.json`, 'utf8'));
}

let res = correr('automático (hora preferida 09:00)', ['--hora', '09:00']);
assert.equal(res.ok, true, 'el flujo debe llegar a la página de pago');
assert.equal(res.salida, '08:45', 'debe elegir la salida más cercana a las 09:00 que no esté agotada');
assert.deepEqual(res.asientos, ['8'], 'debe preferir ventana libre (1, 4 y 5 están ocupados → 8)');

res = correr('paso 1: listar horarios', ['--listar']);
assert.deepEqual(res.servicios.map((s) => s.hora), ['07:30', '08:45', '11:00', '15:30']);
assert.equal(res.servicios[0].agotado, true);
assert.equal(res.servicios[2].precio, '$8.900');

res = correr('paso 2: ver asientos de las 11:00', ['--salida', '11:00', '--ver-asientos']);
assert.equal(res.salida, '11:00');
assert.ok(!res.asientosLibres.some((a) => ['1', '4', '5'].includes(a.numero)), 'no debe listar asientos ocupados');

res = correr('paso 3: comprar 11:00 asientos 12 y 13', ['--salida', '11:00', '--numeros', '12,13']);
assert.equal(res.ok, true);
assert.deepEqual(res.asientos, ['12', '13']);

res = correr('error: asiento ocupado', ['--salida', '11:00', '--numeros', '4']);
assert.equal(res.ok, false);
assert.match(res.error, /4 no disponibles/);

res = correr('error: salida agotada', ['--salida', '07:30', '--ver-asientos']);
assert.match(res.error, /agotada/);

console.log('\n✔ todas las pruebas OK');
