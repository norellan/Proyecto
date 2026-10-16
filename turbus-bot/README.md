# turbus-bot

Este script automatiza la compra de pasajes **Tur Bus de Santiago a El Tabo** (o cualquier otra ruta) hasta llegar a la página de pago.

Lo que hace:
1. Abre turbus.cl en un Chrome visible.
2. Llena el origen, el destino y la fecha.
3. Elige el servicio con la salida más cercana a `horaPreferida` y descarta los agotados.
4. Elige asientos libres, con ventana primero si así lo pides.
5. Completa los datos de los pasajeros.
6. **Se detiene en la página de pago** y saca una captura en `capturas/`. El pago lo haces tú.

## Uso

```bash
cd turbus-bot
npm install
cp config.ejemplo.json config.json   # pon tus datos (este archivo no se sube a git)
npm run comprar
```

El navegador guarda su sesión en `perfil-navegador/`, así que, si inicias sesión en Tur Bus una vez, la sesión queda guardada para las siguientes ejecuciones.

## Si el sitio cambia

Los textos y selectores están todos en el bloque `SELECTORES` de `comprar.js`. Con `npm run grabar` se abre el grabador de Playwright, que muestra los selectores reales mientras haces clic en el sitio.

Si un paso falla, el script guarda `capturas/error.png` y deja el navegador abierto para que termines a mano.

## Programarlo (opcional)

Por ejemplo, para que corra los lunes a las 8:00 con cron (`crontab -e`):

```
0 8 * * 1 cd /ruta/a/turbus-bot && DISPLAY=:0 npm run comprar
```

## Desde la app de Claude (nube / celular)

En una sesión de Claude Code en la nube sobre este repo, el hook `.claude/hooks/session-start.sh` instala Playwright solo. Basta con pedir: *"cómprame pasaje a El Tabo el viernes a las 9"*. Claude ejecuta el script, que corre sin pantalla (headless), y te envía la captura de la página de pago.

- Para no repetir tus datos cada vez, guárdalos como variable de entorno `TURBUS_CONFIG` (el JSON de `config.ejemplo.json`) en la configuración del entorno.
- El dominio `www.turbus.cl` tiene que estar permitido en el acceso a red del entorno.
- Argumentos: `--fecha AAAA-MM-DD --hora HH:MM --pasajes N --origen X --destino Y --asiento ventana`.

## Prueba

`npm test` recorre el flujo completo contra `test/sitio-simulado.html`, un sitio local que imita el proceso de compra.
