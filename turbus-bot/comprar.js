// Automatiza la compra de pasajes en Tur Bus hasta la página de pago.
// El pago (Webpay / tarjeta) lo confirmas tú en la ventana del navegador:
// el script nunca ingresa datos de tarjeta ni confirma cobros.
//
// Uso:
//   npm install
//   cp config.ejemplo.json config.json   # y edita tus datos
//   npm run comprar
//
// Si Tur Bus cambia su sitio, ajusta los textos/selectores del bloque SELECTORES
// (puedes descubrirlos con `npm run grabar`).

import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';

const URL_INICIO = 'https://www.turbus.cl/';

const SELECTORES = {
  origen: [/origen/i, /desde/i],
  destino: [/destino/i, /hacia/i],
  fecha: [/fecha.*ida/i, /ida/i, /fecha/i],
  botonBuscar: /buscar/i,
  // Cada servicio listado en los resultados
  tarjetaServicio: '[class*="service"], [class*="servicio"], [class*="trip"], [class*="viaje"]',
  botonElegirServicio: /seleccionar|elegir|comprar|ver asientos/i,
  asientoLibre: '[class*="seat"]:not([class*="occupied"]):not([class*="ocupado"]):not([class*="disabled"]), [class*="asiento"][class*="disponible"]',
  botonContinuar: /continuar|siguiente|confirmar asientos|ir a pagar/i,
  campos: {
    nombre: /^nombre/i,
    apellido: /apellido/i,
    rut: /rut|documento/i,
    email: /correo|e-?mail/i,
    telefono: /tel[eé]fono|celular|m[oó]vil/i,
  },
  indicadoresPago: /webpay|medio de pago|pagar|total a pagar/i,
};

const config = JSON.parse(readFileSync(new URL('./config.json', import.meta.url), 'utf8'));
mkdirSync(new URL('./capturas/', import.meta.url), { recursive: true });

const log = (...m) => console.log('›', ...m);

async function primerVisible(page, candidatos) {
  for (const c of candidatos) {
    for (const loc of [page.getByLabel(c), page.getByPlaceholder(c), page.getByRole('combobox', { name: c }), page.getByRole('textbox', { name: c })]) {
      const l = loc.first();
      if (await l.isVisible().catch(() => false)) return l;
    }
  }
  throw new Error(`No encontré el campo ${candidatos.join(' / ')}`);
}

async function elegirCiudad(page, candidatos, ciudad) {
  const campo = await primerVisible(page, candidatos);
  await campo.click();
  await campo.fill('');
  await campo.pressSequentially(ciudad, { delay: 80 });
  const opcion = page.getByRole('option', { name: new RegExp(ciudad, 'i') })
    .or(page.locator('li, [class*="option"], [class*="suggest"]').filter({ hasText: new RegExp(ciudad, 'i') }))
    .first();
  await opcion.waitFor({ timeout: 10_000 });
  await opcion.click();
  log(`Ciudad elegida: ${ciudad}`);
}

async function elegirFecha(page, fechaISO) {
  const [a, m, d] = fechaISO.split('-');
  const campo = await primerVisible(page, SELECTORES.fecha);
  // Primero intenta escribir la fecha; si es un calendario, hace clic en el día.
  try {
    await campo.fill(`${d}/${m}/${a}`, { timeout: 3000 });
    await campo.press('Enter');
  } catch {
    await campo.click();
    const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    const mesBuscado = new RegExp(`${meses[Number(m) - 1]}.*${a}`, 'i');
    for (let i = 0; i < 12 && !(await page.getByText(mesBuscado).first().isVisible().catch(() => false)); i++) {
      await page.getByRole('button', { name: /siguiente|next|›|>/i }).first().click();
    }
    await page.getByRole('button', { name: new RegExp(`^${Number(d)}$`) })
      .or(page.locator('[class*="day"]:not([class*="disabled"])').getByText(new RegExp(`^${Number(d)}$`)))
      .first().click();
  }
  log(`Fecha elegida: ${fechaISO}`);
}

const minutos = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

async function elegirServicio(page) {
  await page.locator(SELECTORES.tarjetaServicio).first().waitFor({ timeout: 30_000 });
  const tarjetas = page.locator(SELECTORES.tarjetaServicio).filter({ hasText: /\d{1,2}:\d{2}/ });
  const n = await tarjetas.count();
  if (!n) throw new Error('No hay servicios disponibles para esa fecha');

  const objetivo = minutos(config.horaPreferida);
  let mejor = { i: -1, dif: Infinity, hora: '' };
  for (let i = 0; i < n; i++) {
    const texto = await tarjetas.nth(i).innerText();
    const hora = texto.match(/\b(\d{1,2}:\d{2})\b/)?.[1];
    if (/agotado|sin asientos/i.test(texto) || !hora) continue;
    const dif = Math.abs(minutos(hora) - objetivo);
    if (dif < mejor.dif) mejor = { i, dif, hora };
  }
  if (mejor.i < 0) throw new Error('Todos los servicios están agotados');
  log(`Servicio elegido: salida ${mejor.hora} (preferida ${config.horaPreferida})`);
  const tarjeta = tarjetas.nth(mejor.i);
  const boton = tarjeta.getByRole('button', { name: SELECTORES.botonElegirServicio });
  await ((await boton.count()) ? boton.first() : tarjeta).click();
}

async function elegirAsientos(page) {
  const libres = page.locator(SELECTORES.asientoLibre);
  await libres.first().waitFor({ timeout: 30_000 });
  const total = await libres.count();
  // Asientos de ventana: en buses 2+2 suelen ser los números ≡ 1 o 0 (mod 4).
  const orden = [];
  for (let i = 0; i < total; i++) {
    const num = Number((await libres.nth(i).innerText().catch(() => '')).trim());
    const ventana = num && (num % 4 === 1 || num % 4 === 0);
    orden.push({ i, prioridad: config.preferenciaAsiento === 'ventana' && ventana ? 0 : 1 });
  }
  orden.sort((x, y) => x.prioridad - y.prioridad);
  for (const { i } of orden.slice(0, config.cantidadPasajes)) {
    await libres.nth(i).click();
    log(`Asiento elegido: ${(await libres.nth(i).innerText().catch(() => '?')).trim()}`);
  }
  await page.getByRole('button', { name: SELECTORES.botonContinuar }).first().click();
}

async function llenarPasajeros(page) {
  for (const [idx, p] of config.pasajeros.slice(0, config.cantidadPasajes).entries()) {
    for (const [clave, patron] of Object.entries(SELECTORES.campos)) {
      if (!p[clave]) continue;
      const campo = page.getByLabel(patron).or(page.getByPlaceholder(patron)).nth(idx);
      if (await campo.isVisible().catch(() => false)) await campo.fill(p[clave]);
    }
  }
  log('Datos de pasajeros completados');
}

async function main() {
  const navegador = await chromium.launchPersistentContext(new URL('./perfil-navegador/', import.meta.url).pathname, {
    headless: false,
    locale: 'es-CL',
    viewport: { width: 1366, height: 900 },
  });
  const page = navegador.pages()[0] ?? (await navegador.newPage());
  const consola = createInterface({ input: process.stdin, output: process.stdout });
  const pausa = (msg) => consola.question(`\n⏸  ${msg}\n   Presiona Enter para continuar... `);

  try {
    await page.goto(URL_INICIO, { waitUntil: 'domcontentloaded' });
    // Cierra banners de cookies / popups si aparecen
    await page.getByRole('button', { name: /aceptar|entendido|cerrar/i }).first().click({ timeout: 4000 }).catch(() => {});

    await elegirCiudad(page, SELECTORES.origen, config.origen);
    await elegirCiudad(page, SELECTORES.destino, config.destino);
    await elegirFecha(page, config.fecha);
    await page.getByRole('button', { name: SELECTORES.botonBuscar }).first().click();

    await elegirServicio(page);
    await elegirAsientos(page);
    await llenarPasajeros(page);

    await page.screenshot({ path: new URL('./capturas/antes-de-pagar.png', import.meta.url).pathname, fullPage: true });
    await page.getByText(SELECTORES.indicadoresPago).first().waitFor({ timeout: 60_000 }).catch(() => {});
    await pausa('Revisa el resumen y completa el PAGO tú mismo en el navegador. Cuando termines, vuelve aquí.');
  } catch (err) {
    console.error('\n✖', err.message);
    await page.screenshot({ path: new URL('./capturas/error.png', import.meta.url).pathname, fullPage: true }).catch(() => {});
    await pausa('Algo cambió en el sitio. Puedes terminar el paso a mano en el navegador (captura en capturas/error.png).');
  } finally {
    consola.close();
    await navegador.close();
  }
}

main();
