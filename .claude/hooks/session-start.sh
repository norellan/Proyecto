#!/bin/bash
# Instala el arnés de turbus-bot (Playwright + Chromium) en sesiones de Claude en la nube.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR/turbus-bot"
npm install --no-audit --no-fund

# Usa el Chromium preinstalado si existe; si no, lo descarga.
if [ -z "${PLAYWRIGHT_BROWSERS_PATH:-}" ] || [ ! -d "${PLAYWRIGHT_BROWSERS_PATH}" ]; then
  npx playwright install --with-deps chromium
fi
