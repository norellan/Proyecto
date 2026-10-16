# Proyecto

## turbus-bot: comprar pasajes Tur Bus

Cuando el usuario pida comprar o buscar pasajes Tur Bus (por ejemplo, "cómprame pasaje a El Tabo el viernes a las 9"):

1. El arnés (Playwright y Chromium) lo instala el hook `.claude/hooks/session-start.sh`. Si falta, corre `cd turbus-bot && npm install`.
2. Datos de los pasajeros: usa la variable de entorno `TURBUS_CONFIG` (JSON con el formato de `turbus-bot/config.ejemplo.json`) si existe. Si no existe, pídele al usuario nombre, apellido, RUT, correo y teléfono, y escríbelos en `turbus-bot/config.json`. Ese archivo está en `.gitignore`: nunca lo commitees.
3. Convierte las fechas relativas ("el viernes") a AAAA-MM-DD. Por defecto la ruta es Santiago → El Tabo (`--origen X --destino Y` para otra). Guía al usuario en 3 pasos, mostrándole las opciones en el chat:
   1. **Día → horarios:** `cd turbus-bot && npm run comprar -- --fecha AAAA-MM-DD --listar`. Muéstrale `resultado.json.servicios` (hora, precio, agotado) como lista y envíale `capturas/horarios.png`.
   2. **Hora → asientos:** `npm run comprar -- --fecha AAAA-MM-DD --salida HH:MM --ver-asientos`. Muéstrale `asientosLibres` (marca los de ventana) y envíale `capturas/asientos.png`.
   3. **Asientos → pago:** `npm run comprar -- --fecha AAAA-MM-DD --salida HH:MM --numeros 8,12` (un número por pasajero).
   Si el usuario quiere ir rápido: `npm run comprar -- --fecha AAAA-MM-DD --hora HH:MM --pasajes N` elige sola la salida más cercana y asientos de ventana.
4. Lee `turbus-bot/capturas/resultado.json` y envíale al usuario `capturas/antes-de-pagar.png` (o `capturas/error.png`) con SendUserFile, junto con la salida, los asientos y `urlPago`.
5. **Nunca completes el pago ni ingreses datos de tarjeta.** El script se detiene antes de pagar. Si falla por un cambio en el sitio, ajusta `SELECTORES` en `comprar.js`, valida con `npm test` y vuelve a intentar.

Prueba local (sitio simulado, no usa turbus.cl): `cd turbus-bot && npm test`.
