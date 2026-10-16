// Prueba de punta a punta del script contra test/sitio-simulado.html (no toca turbus.cl).
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const dir = new URL('..', import.meta.url).pathname;
const r = spawnSync('node', ['comprar.js', '--config', 'config.ejemplo.json', '--fecha', '2026-10-23', '--hora', '09:00'], {
  cwd: dir,
  env: { ...process.env, HEADLESS: '1', TURBUS_URL: new URL('./sitio-simulado.html', import.meta.url).href },
  encoding: 'utf8',
});
process.stdout.write(r.stdout + r.stderr);
const res = JSON.parse(readFileSync(`${dir}/capturas/resultado.json`, 'utf8'));
assert.equal(res.ok, true, 'el flujo debe llegar a la página de pago');
assert.equal(res.salida, '08:45', 'debe elegir la salida más cercana a las 09:00 que no esté agotada');
assert.deepEqual(res.asientos, ['8'], 'debe preferir ventana libre (1 y 4 están ocupados → 8)');
console.log('\n✔ prueba OK');
