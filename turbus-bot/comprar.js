// Automatiza la compra de pasajes en turbus.cl hasta la página de pago.
// El pago (aceptar términos, PAGAR y Webpay) lo haces tú: el script nunca
// acepta términos, ni presiona PAGAR, ni ingresa datos de tarjeta.
//
// Uso:
//   npm install
//   cp config.ejemplo.json config.json   # y edita tus datos
//
//   npm run comprar -- --fecha 2026-10-23 --listar                        # 1) horarios del día
//   npm run comprar -- --fecha 2026-10-23 --salida 09:00 --ver-asientos   # 2) asientos libres
//   npm run comprar -- --fecha 2026-10-23 --salida 09:00 --numeros 1,3    # 3) asientos → página de pago
//   npm run comprar -- --fecha 2026-10-23 --hora 09:00 --pasajes 2 --piso 1   # todo automático
//
// Funciona en tu computador (Chrome visible, espera tu Enter para que pagues) y
// en una sesión de Claude en la nube (headless, sin teclado; deja capturas y
// capturas/resultado.json).
//
// Datos: config.json, o la variable de entorno TURBUS_CONFIG con el mismo JSON.
// Si turbus.cl cambia, ajusta el bloque SELECTORES (`npm run grabar` ayuda).

import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';

const URL_BASE = (process.env.TURBUS_URL || 'https://www.turbus.cl/').replace(/\/?$/, '/');
// turbus.cl rechaza las llamadas a su API si el navegador se identifica como "HeadlessChrome".
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

const SELECTORES = {
  servicio: '[class*="service-item_service_item_outer"]',
  botonComprar: /^\s*comprar\s*$/i,
  mapaAsientos: '.coach-layout-container',
  pisos: '.floor-buttons a',
  filaAsientos: '.coach-table ul',
  asiento: 'li:has(.seat-number-css)',
  numeroAsiento: '.seat-number-css',
  asientoDisponible: '[class*="_available"]',
  botonContinuar: /^\s*continuar/i,
  pasajero: {
    fila: '.local-inputs-details',
    documento: '.rut-input input',
    nombre: '.name-input input', // 1º nombre, 2º apellido
  },
  contacto: {
    email: '.passenger-input-personal-details input[type="email"]', // 1º correo, 2º confirmación
    telefono: '.passenger-input-personal-details input[type="tel"]',
  },
  webpay: '.webpay-payment-method:has(img[alt*="webpay"]) input[type="radio"]',
  contador: '.countdown-counter',
};

const ruta = (p) => new URL(p, import.meta.url).pathname;

function cargarConfig() {
  const { values } = parseArgs({
    options: {
      config: { type: 'string' }, origen: { type: 'string' }, destino: { type: 'string' },
      fecha: { type: 'string' }, hora: { type: 'string' }, pasajes: { type: 'string' }, asiento: { type: 'string' },
      empresa: { type: 'string' },         // filtra por empresa (ej: Turbus, "Cóndor Bus")
      piso: { type: 'string' },            // solo asientos de ese piso (1 o 2)
      listar: { type: 'boolean' },         // 1) solo lista los horarios del día
      salida: { type: 'string' },          // 2) toma exactamente ese horario (HH:MM)
      'ver-asientos': { type: 'boolean' }, //    ...y solo lista los asientos libres
      numeros: { type: 'string' },         // 3) toma esos asientos (ej: 1,3) y avanza hasta el pago
    },
  });
  const archivo = values.config ?? ruta('./config.json');
  const base = process.env.TURBUS_CONFIG
    ? JSON.parse(process.env.TURBUS_CONFIG)
    : JSON.parse(readFileSync(existsSync(archivo) ? archivo : ruta('./config.ejemplo.json'), 'utf8'));
  const c = {
    ...base,
    ...(values.origen && { origen: values.origen }),
    ...(values.destino && { destino: values.destino }),
    ...(values.fecha && { fecha: values.fecha }),
    ...(values.hora && { horaPreferida: values.hora }),
    ...(values.pasajes && { cantidadPasajes: Number(values.pasajes) }),
    ...(values.asiento && { preferenciaAsiento: values.asiento }),
    ...(values.empresa && { empresa: values.empresa }),
    ...(values.piso && { piso: Number(values.piso) }),
    listar: Boolean(values.listar),
    salida: values.salida,
    verAsientos: Boolean(values['ver-asientos']),
    numeros: values.numeros ? values.numeros.split(',').map((n) => n.trim()).filter(Boolean) : null,
  };
  if (c.numeros) c.cantidadPasajes = c.numeros.length;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.fecha ?? '')) throw new Error(`Fecha inválida "${c.fecha}" (usa AAAA-MM-DD)`);
  for (const h of [c.horaPreferida, c.salida]) if (h && !/^\d{1,2}:\d{2}$/.test(h)) throw new Error(`Hora inválida "${h}" (usa HH:MM)`);
  if (c.pasajeros.length < c.cantidadPasajes) throw new Error(`Faltan datos: ${c.cantidadPasajes} pasajes pero ${c.pasajeros.length} pasajeros`);
  return c;
}

const config = cargarConfig();
// Sin pantalla (sesión en la nube) → headless y sin esperar el teclado.
const headless = process.env.HEADLESS === '1' || (process.platform === 'linux' && !process.env.DISPLAY);
const interactivo = !headless && process.stdin.isTTY;
mkdirSync(ruta('./capturas/'), { recursive: true });

const log = (...m) => console.log('›', ...m);
const minutos = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const sinTildes = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// "Santiago" → "santiago,-chile" ; "El Tabo" → "el-tabo,-chile"
const slugCiudad = (ciudad) => `${ciudad.replace(/,.*$/, '').trim().toLowerCase().replace(/\s+/g, '-')},-chile`;

function urlBusqueda() {
  const [a, m, d] = config.fecha.split('-');
  return `${URL_BASE}es/pasajes-bus/${slugCiudad(config.origen)}/${slugCiudad(config.destino)}?date_onward=${d}-${m}-${a}`;
}

async function buscar(page) {
  resultado.linkBusqueda = urlBusqueda();
  await page.goto(resultado.linkBusqueda, { waitUntil: 'domcontentloaded' });
  const hay = await page.locator(SELECTORES.servicio).first().waitFor({ timeout: 45_000 }).then(() => true, () => false);
  if (!hay) throw new Error(`No hay servicios ${config.origen} → ${config.destino} el ${config.fecha} (o cambió el sitio)`);
  log(`Búsqueda: ${config.origen} → ${config.destino}, ${config.fecha}`);
}

async function leerServicios(page) {
  const textos = await page.locator(SELECTORES.servicio).evaluateAll((els) => els.map((e) => e.innerText));
  return textos.map((texto, i) => {
    const t = texto.replace(/\s+/g, ' ');
    const [salida, llegada] = t.match(/\b\d{1,2}:\d{2}\b/g) ?? [];
    return {
      i,
      hora: salida,
      llegada,
      empresa: t.match(/\b(Turbus|Tur Bus|C[oó]ndor Bus|Pullman Bus)\b/i)?.[1] ?? null,
      precio: t.match(/\$\s?[\d.]+/)?.[0] ?? null,
      clase: t.match(/Semi Cama|Sal[oó]n Cama|Cama|Premium|Ejecutivo/i)?.[0] ?? null,
      agotado: /agotado|sin asientos/i.test(t),
    };
  }).filter((s) => s.hora && (!config.empresa || sinTildes(s.empresa ?? '').includes(sinTildes(config.empresa))));
}

async function elegirServicio(page) {
  const servicios = await leerServicios(page);
  if (!servicios.length) throw new Error('No hay servicios (revisa --empresa)');
  let elegido;
  if (config.salida) {
    const coinciden = servicios.filter((s) => minutos(s.hora) === minutos(config.salida));
    if (!coinciden.length) throw new Error(`No hay salida a las ${config.salida}. Horarios: ${servicios.map((s) => s.hora).join(', ')}`);
    elegido = coinciden.find((s) => !s.agotado);
    if (!elegido) throw new Error(`La salida de las ${config.salida} está agotada`);
    if (coinciden.length > 1 && !config.empresa) log(`Ojo: hay ${coinciden.length} buses a las ${config.salida}; tomo ${elegido.empresa} (usa --empresa para elegir)`);
  } else {
    const disponibles = servicios.filter((s) => !s.agotado);
    if (!disponibles.length) throw new Error('Todos los servicios están agotados');
    const objetivo = minutos(config.horaPreferida);
    elegido = disponibles.reduce((a, b) => (Math.abs(minutos(b.hora) - objetivo) < Math.abs(minutos(a.hora) - objetivo) ? b : a));
  }
  Object.assign(resultado, { salida: elegido.hora, llegada: elegido.llegada, empresa: elegido.empresa, precio: elegido.precio });
  log(`Servicio: ${elegido.hora} → ${elegido.llegada} · ${elegido.empresa} · ${elegido.precio}`);
  await page.locator(SELECTORES.servicio).nth(elegido.i).getByText(SELECTORES.botonComprar).click();
  await page.locator(SELECTORES.mapaAsientos).first().waitFor({ timeout: 30_000 });
}

// Recorre los pisos y devuelve los asientos con su estado. En cada fila (<ul>)
// el primer y el último asiento van junto a la ventana.
async function leerAsientos(page) {
  const pisos = page.locator(SELECTORES.pisos);
  const nPisos = Math.max(1, await pisos.count());
  const asientos = [];
  for (let piso = 1; piso <= nPisos; piso++) {
    if (nPisos > 1) { await pisos.nth(piso - 1).click(); await page.waitForTimeout(400); }
    const filas = await page.locator(SELECTORES.filaAsientos).evaluateAll((uls, sel) => uls.map((ul) =>
      [...ul.querySelectorAll(sel.asiento)].map((li) => ({
        numero: li.querySelector(sel.numeroAsiento).innerText.trim(),
        libre: Boolean(li.querySelector(sel.asientoDisponible)),
      }))), SELECTORES);
    // Cada fila tiene dos pares (ventana + pasillo) a cada lado del pasillo central.
    filas.forEach((fila, f) => fila.forEach((a, j) => asientos.push({
      ...a, piso, ventana: j === 0 || j === fila.length - 1, par: `${piso}-${f}-${j < fila.length / 2 ? 'a' : 'b'}`,
    })));
  }
  return asientos;
}

async function marcarAsiento(page, asiento, nPisos) {
  if (nPisos > 1) { await page.locator(SELECTORES.pisos).nth(asiento.piso - 1).click(); await page.waitForTimeout(400); }
  await page.locator(`${SELECTORES.filaAsientos} ${SELECTORES.asiento}`)
    .filter({ has: page.locator(SELECTORES.numeroAsiento, { hasText: new RegExp(`^\\s*${asiento.numero}\\s*$`) }) })
    .first().click();
  await page.waitForTimeout(300);
}

async function elegirAsientos(page) {
  const asientos = await leerAsientos(page);
  const nPisos = new Set(asientos.map((a) => a.piso)).size;
  const libres = asientos.filter((a) => a.libre && (!config.piso || a.piso === config.piso));
  let elegidos;
  if (config.numeros) {
    const faltan = config.numeros.filter((n) => !libres.some((a) => a.numero === n));
    if (faltan.length) throw new Error(`Asiento(s) ${faltan.join(', ')} no disponibles. Libres: ${libres.map((a) => a.numero).join(', ')}`);
    elegidos = config.numeros.map((n) => libres.find((a) => a.numero === n));
  } else {
    const prioridad = (a) => (config.preferenciaAsiento === 'ventana' && a.ventana ? 0 : 1);
    elegidos = [...libres].sort((x, y) => prioridad(x) - prioridad(y) || x.piso - y.piso || Number(x.numero) - Number(y.numero)).slice(0, config.cantidadPasajes);
    if (elegidos.length < config.cantidadPasajes) throw new Error(`Solo quedan ${libres.length} asientos libres${config.piso ? ` en el piso ${config.piso}` : ''}`);
  }
  for (const a of elegidos) {
    await marcarAsiento(page, a, nPisos);
    resultado.asientos.push(a.numero);
    log(`Asiento: ${a.numero} (piso ${a.piso}${a.ventana ? ', ventana' : ''})`);
  }
  await page.getByText(SELECTORES.botonContinuar).first().click();
  await page.locator(SELECTORES.pasajero.fila).first().waitFor({ timeout: 30_000 });
}

async function llenarPasajeros(page) {
  const filas = page.locator(SELECTORES.pasajero.fila);
  for (const [i, p] of config.pasajeros.slice(0, config.cantidadPasajes).entries()) {
    const fila = filas.nth(i);
    await fila.locator(SELECTORES.pasajero.documento).fill(p.rut);
    await fila.locator(SELECTORES.pasajero.nombre).nth(0).fill(p.nombre);
    await fila.locator(SELECTORES.pasajero.nombre).nth(1).fill(p.apellido);
  }
  const titular = config.pasajeros[0];
  const emails = page.locator(SELECTORES.contacto.email);
  await emails.nth(0).fill(titular.email);
  await emails.nth(1).fill(titular.email);
  await page.locator(SELECTORES.contacto.telefono).first().fill(titular.telefono.replace(/\D/g, '').replace(/^56/, ''));
  log('Datos de pasajeros completados');
  // El radio real está tapado por un círculo dibujado encima, por eso el clic va forzado.
  const webpay = await page.locator(SELECTORES.webpay).first().check({ force: true, timeout: 5000 }).then(() => true, () => false);
  log(webpay ? 'Webpay seleccionado' : 'No pude marcar Webpay; elígelo tú');
}

const resultado = { ok: false, origen: config.origen, destino: config.destino, fecha: config.fecha, salida: null, asientos: [] };

async function main() {
  const navegador = await chromium.launchPersistentContext(ruta('./perfil-navegador/'), {
    headless,
    locale: 'es-CL',
    userAgent: USER_AGENT,
    viewport: { width: 1366, height: 900 },
  });
  const page = navegador.pages()[0] ?? (await navegador.newPage());
  const pausa = async (msg) => {
    console.log(`\n⏸  ${msg}`);
    if (!interactivo) return;
    const consola = createInterface({ input: process.stdin, output: process.stdout });
    await consola.question('   Presiona Enter para cerrar el navegador... ');
    consola.close();
  };

  try {
    await buscar(page);

    if (config.listar) {
      resultado.servicios = (await leerServicios(page)).map(({ i, ...s }) => s);
      await page.screenshot({ path: ruta('./capturas/horarios.png'), fullPage: true });
      resultado.ok = true;
      resultado.servicios.forEach((s) => log(`${s.hora} → ${s.llegada}  ${s.empresa ?? ''}  ${s.agotado ? 'AGOTADO' : s.precio ?? ''}`));
      return;
    }

    await elegirServicio(page);
    if (config.verAsientos) {
      resultado.asientosLibres = (await leerAsientos(page))
        .filter((a) => a.libre && (!config.piso || a.piso === config.piso))
        .map(({ libre, ...a }) => a);
      await page.locator(SELECTORES.pisos).nth((config.piso ?? 1) - 1).click().catch(() => {});
      await page.locator(SELECTORES.mapaAsientos).first().screenshot({ path: ruta('./capturas/asientos.png') });
      resultado.ok = true;
      log(`Asientos libres: ${resultado.asientosLibres.map((a) => a.numero + (a.ventana ? 'v' : '')).join(', ')}  (v = ventana)`);
      const pares = Object.values(Object.groupBy(resultado.asientosLibres, (a) => a.par)).filter((g) => g.length === 2);
      resultado.paresJuntos = pares.map((g) => g.map((a) => a.numero));
      log(`Pares juntos libres (ventana + pasillo): ${resultado.paresJuntos.map((g) => g.join('-')).join(', ') || 'ninguno'}`);
      return;
    }

    await elegirAsientos(page);
    await llenarPasajeros(page);
    resultado.reservaVence = (await page.locator(SELECTORES.contador).first().innerText().catch(() => '')).trim() || null;
    await page.screenshot({ path: ruta('./capturas/antes-de-pagar.png'), fullPage: true });
    resultado.ok = true;
    resultado.urlPago = page.url();
    log(`Listo para pagar (los asientos quedan retenidos ${resultado.reservaVence ?? 'unos minutos'})`);
    await pausa('Acepta los términos, presiona PAGAR y completa Webpay en el navegador.');
  } catch (err) {
    resultado.error = err.message;
    resultado.urlError = page.url();
    console.error('\n✖', err.message);
    await page.screenshot({ path: ruta('./capturas/error.png'), fullPage: true }).catch(() => {});
    await pausa('Algo falló. Puedes terminar el paso a mano en el navegador (captura en capturas/error.png).');
  } finally {
    writeFileSync(ruta('./capturas/resultado.json'), JSON.stringify(resultado, null, 2));
    await navegador.close();
    process.exitCode = resultado.ok ? 0 : 1;
  }
}

main();
