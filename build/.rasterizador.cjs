
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
