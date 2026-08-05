#!/usr/bin/env node
/**
 * Genera los assets de icono para el empaquetado, a partir de `build/icon.svg`.
 *
 *   npm run iconos
 *
 * Salidas (todas en `build/`):
 *   - icon.png   1024x1024, fuente de los otros dos
 *   - icon.icns  macOS, multi-tamano
 *   - icon.ico   Windows, multi-tamano
 *
 * El SVG se rasteriza con el propio Electron (una ventana oculta y transparente
 * que captura la pagina), en vez de sumar una dependencia nativa de imagenes
 * como sharp o librsvg. Electron ya esta instalado y su motor de render es
 * exactamente el que dibuja la app, asi que el resultado es fiel.
 *
 * Es idempotente: se puede correr las veces que haga falta.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import png2icons from 'png2icons';

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = resolve(aqui, '..');
const carpetaBuild = join(raiz, 'build');
const rutaSvg = join(carpetaBuild, 'icon.svg');
const rutaPng = join(carpetaBuild, 'icon.png');

const LADO = 1024;

function abortar(mensaje) {
  console.error(`\n[iconos] ${mensaje}\n`);
  process.exit(1);
}

/**
 * Script que corre DENTRO de Electron: abre una ventana transparente del tamano
 * exacto del icono, carga el SVG y captura el resultado como PNG.
 */
const GUION_RASTERIZADOR = `
const { app, BrowserWindow } = require('electron');
const { readFileSync, writeFileSync } = require('node:fs');

const [rutaSvg, rutaPng, lado] = process.argv.slice(2);
const tamano = Number(lado);

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const ventana = new BrowserWindow({
    width: tamano,
    height: tamano,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    useContentSize: true,
    webPreferences: { offscreen: false, nodeIntegration: false, contextIsolation: true },
  });

  const svg = readFileSync(rutaSvg, 'utf8');
  const pagina =
    '<!doctype html><meta charset="utf-8">' +
    '<style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}' +
    'svg{display:block;width:' + tamano + 'px;height:' + tamano + 'px}</style>' +
    svg;

  await ventana.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(pagina));
  // Un respiro para que termine de aplicar los gradientes antes de capturar.
  await new Promise((r) => setTimeout(r, 400));

  const imagen = await ventana.webContents.capturePage();
  writeFileSync(rutaPng, imagen.toPNG());
  ventana.destroy();
  app.exit(0);
});
`;

function rasterizar() {
  if (!existsSync(rutaSvg)) abortar(`No existe ${rutaSvg}. Es la fuente del icono.`);

  mkdirSync(carpetaBuild, { recursive: true });
  const rutaGuion = join(carpetaBuild, '.rasterizador.cjs');
  writeFileSync(rutaGuion, GUION_RASTERIZADOR);

  const electron = join(raiz, 'node_modules', '.bin', 'electron');
  if (!existsSync(electron)) abortar('No se encontro Electron. Corre `npm install` primero.');

  // ELECTRON_RUN_AS_NODE arruinaria el arranque: sin modulo `app` no hay ventana.
  const entorno = { ...process.env };
  delete entorno.ELECTRON_RUN_AS_NODE;

  const resultado = spawnSync(electron, [rutaGuion, rutaSvg, rutaPng, String(LADO)], {
    cwd: raiz,
    env: entorno,
    stdio: ['ignore', 'inherit', 'inherit'],
  });

  if (resultado.status !== 0) abortar('Electron no pudo rasterizar el SVG.');
  if (!existsSync(rutaPng)) abortar('La captura no genero el PNG.');
}

function generarBinarios() {
  const png = readFileSync(rutaPng);

  const icns = png2icons.createICNS(png, png2icons.BILINEAR, 0);
  if (!icns) abortar('No se pudo generar icon.icns.');
  writeFileSync(join(carpetaBuild, 'icon.icns'), icns);

  const ico = png2icons.createICO(png, png2icons.BILINEAR, 0, true);
  if (!ico) abortar('No se pudo generar icon.ico.');
  writeFileSync(join(carpetaBuild, 'icon.ico'), ico);

  const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
  console.log('[iconos] Generados en build/:');
  console.log(`  icon.png   ${kb(png.length)}  (${LADO}x${LADO})`);
  console.log(`  icon.icns  ${kb(icns.length)}  (macOS)`);
  console.log(`  icon.ico   ${kb(ico.length)}  (Windows)`);
}

console.log('[iconos] Rasterizando build/icon.svg con Electron...');
rasterizar();
generarBinarios();
