/**
 * Actualizaciones automaticas desde GitHub Releases.
 *
 * Solo se activa en la app EMPAQUETADA: en desarrollo no hace nada, porque
 * electron-updater no sabe reemplazar un proyecto corriendo desde el repo.
 *
 * Chequea 5 segundos despues de arrancar y despues cada 4 horas. La descarga es
 * automatica; la instalacion espera a que el usuario cierre la app, para no
 * cortarle una carga a la mitad.
 *
 * LIMITACION CONOCIDA DE macOS
 * ----------------------------
 * Squirrel.Mac —el mecanismo que usa electron-updater— NO puede reemplazar un
 * `.app` sin firmar: el reemplazo falla en silencio y el usuario se queda con
 * una version vieja creyendo que esta al dia. Mientras no haya firma y
 * notarizacion, en macOS NO se intenta el auto-update: se consulta la API de
 * GitHub y, si hay una version mas nueva, se avisa con el link de descarga.
 * En Windows el auto-update funciona completo sin firma (SmartScreen solo pide
 * confirmacion la primera vez).
 *
 * Para habilitar el auto-update real en macOS: configurar CSC_LINK +
 * CSC_KEY_PASSWORD, activar hardenedRuntime + notarizacion en
 * electron-builder.yml, y poner MAC_TIENE_FIRMA en true.
 */

import { app, BrowserWindow, shell } from 'electron';
import { autoUpdater } from 'electron-updater';

import { REPO_GITHUB } from '../compartido/config';

/** Poner en true recien cuando los builds de macOS salgan firmados y notarizados. */
const MAC_TIENE_FIRMA = false;

const MS_PRIMER_CHEQUEO = 5_000;
const MS_ENTRE_CHEQUEOS = 4 * 60 * 60 * 1000;

const URL_RELEASE_LATEST = `https://api.github.com/repos/${REPO_GITHUB.owner}/${REPO_GITHUB.repo}/releases/latest`;
const URL_RELEASES_WEB = `https://github.com/${REPO_GITHUB.owner}/${REPO_GITHUB.repo}/releases/latest`;

function registrar(mensaje: string): void {
  console.info(`[actualizador] ${mensaje}`);
}

/** Compara "1.2.10" contra "1.2.9" numericamente, no alfabeticamente. */
function esMasNueva(candidata: string, actual: string): boolean {
  const partes = (v: string): number[] =>
    v.replace(/^v/, '').split('-')[0]!.split('.').map((n) => Number.parseInt(n, 10) || 0);

  const a = partes(candidata);
  const b = partes(actual);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

/** Avisa al renderer. Si la ventana todavia no existe, el aviso se pierde: no es critico. */
function avisarAlRenderer(canal: string, carga: unknown): void {
  for (const ventana of BrowserWindow.getAllWindows()) {
    if (!ventana.isDestroyed()) ventana.webContents.send(canal, carga);
  }
}

/* -------------------------------------------------------------------------- */
/* macOS sin firma: deteccion manual                                          */
/* -------------------------------------------------------------------------- */

interface ReleaseGitHub {
  tag_name?: string;
  html_url?: string;
}

/**
 * Consulta la ultima release publicada y avisa si estamos atrasados. No descarga
 * ni instala nada: solo evita que el usuario se quede en una version vieja sin
 * enterarse.
 */
async function chequearManual(): Promise<void> {
  try {
    const respuesta = await fetch(URL_RELEASE_LATEST, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!respuesta.ok) {
      registrar(`GitHub respondio ${respuesta.status} al consultar la ultima version.`);
      return;
    }

    const release = (await respuesta.json()) as ReleaseGitHub;
    const ultima = release.tag_name?.replace(/^v/, '') ?? '';
    if (ultima === '') return;

    if (esMasNueva(ultima, app.getVersion())) {
      registrar(`Hay una version nueva: ${ultima} (instalada: ${app.getVersion()}).`);
      avisarAlRenderer('actualizador:desactualizado', {
        versionInstalada: app.getVersion(),
        versionDisponible: ultima,
        urlDescarga: release.html_url ?? URL_RELEASES_WEB,
      });
    } else {
      registrar(`Al dia (${app.getVersion()}).`);
    }
  } catch (error) {
    // Sin internet o GitHub caido: no es un error de la app, no molestamos.
    registrar(`No se pudo consultar la ultima version: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/* -------------------------------------------------------------------------- */
/* Windows (y macOS firmado): auto-update completo                            */
/* -------------------------------------------------------------------------- */

function configurarAutoUpdate(): void {
  // La instalacion se aplica al cerrar: nunca interrumpimos una sesion de trabajo.
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => registrar('Buscando actualizaciones...'));

  autoUpdater.on('update-available', (info) => {
    registrar(`Actualizacion disponible: ${info.version}. Descargando...`);
    avisarAlRenderer('actualizador:disponible', { versionDisponible: info.version });
  });

  autoUpdater.on('update-not-available', () => registrar(`Al dia (${app.getVersion()}).`));

  autoUpdater.on('download-progress', (progreso) => {
    registrar(`Descargando: ${Math.round(progreso.percent)}%`);
  });

  autoUpdater.on('update-downloaded', (info) => {
    registrar(`Actualizacion ${info.version} lista. Se instala al cerrar la app.`);
    avisarAlRenderer('actualizador:descargado', { versionDisponible: info.version });
  });

  autoUpdater.on('error', (error) => {
    // Un fallo de actualizacion NUNCA debe tumbar el ERP: se loguea y se sigue.
    registrar(`Fallo la actualizacion: ${error.message}`);
  });
}

/* -------------------------------------------------------------------------- */
/* Entrada                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Arranca el ciclo de actualizaciones. Es seguro llamarla siempre: en desarrollo
 * no hace nada.
 */
export function iniciarActualizador(): void {
  if (!app.isPackaged) {
    registrar('Modo desarrollo: actualizaciones desactivadas.');
    return;
  }

  const usaAutoUpdate = process.platform !== 'darwin' || MAC_TIENE_FIRMA;

  if (usaAutoUpdate) {
    configurarAutoUpdate();
  } else {
    registrar('macOS sin firma: auto-update desactivado, solo se avisa si hay version nueva.');
  }

  const chequear = (): void => {
    if (usaAutoUpdate) {
      void autoUpdater.checkForUpdates().catch((error: unknown) => {
        registrar(`No se pudo chequear: ${error instanceof Error ? error.message : String(error)}`);
      });
    } else {
      void chequearManual();
    }
  };

  setTimeout(chequear, MS_PRIMER_CHEQUEO).unref();
  setInterval(chequear, MS_ENTRE_CHEQUEOS).unref();
}

/** Abre la pagina de releases en el navegador del sistema. */
export function abrirPaginaDeDescarga(): void {
  void shell.openExternal(URL_RELEASES_WEB);
}
