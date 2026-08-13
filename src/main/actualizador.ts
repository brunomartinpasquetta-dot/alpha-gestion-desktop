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
import { EjecutorHttpNode } from './actualizador-red';

/** Poner en true recien cuando los builds de macOS salgan firmados y notarizados. */
const MAC_TIENE_FIRMA = false;

const MS_PRIMER_CHEQUEO = 5_000;
const MS_ENTRE_CHEQUEOS = 4 * 60 * 60 * 1000;

/**
 * Reintentos del primer chequeo. Windows tarda en levantar la red: a los 5
 * segundos de arrancar, la maquina del cliente muchas veces todavia no tiene
 * conexion, y con un solo intento el programa se quedaba cuatro horas sin volver
 * a probar. Se reintenta con esperas crecientes hasta el primer exito.
 */
const REINTENTOS_MS = [15_000, 60_000, 300_000] as const;

const URL_RELEASE_LATEST = `https://api.github.com/repos/${REPO_GITHUB.owner}/${REPO_GITHUB.repo}/releases/latest`;
const URL_RELEASES_WEB = `https://github.com/${REPO_GITHUB.owner}/${REPO_GITHUB.repo}/releases/latest`;

/**
 * Ultimo problema del actualizador automatico. Se guarda para poder MOSTRARLO
 * cuando el usuario pregunta desde Ayuda: si la descarga falla en su maquina,
 * el error terminaba en un log que nadie mira y desde afuera parecia que el
 * sistema simplemente no se actualiza.
 */
let ultimoErrorAutomatico: string | null = null;

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
  // La red del actualizador pasa por Node, no por Chromium. Ver actualizador-red.ts:
  // en la PC del cliente, Chromium contestaba "internet desconectado" con internet
  // andando, asi que la descarga fallaba siempre. El campo no esta en los tipos
  // publicos de electron-updater, pero es el punto de extension que usa la propia
  // libreria para armarlo.
  (autoUpdater as unknown as { httpExecutor: EjecutorHttpNode }).httpExecutor =
    new EjecutorHttpNode();

  // Se baja sola en segundo plano. Se instala de dos maneras, y las dos hacen
  // falta: apenas termina de bajar aparece un cartel para reiniciar en el acto
  // (que es lo que espera el usuario), y si lo ignora se aplica igual al cerrar
  // el programa. Antes solo existia la segunda, asi que quien no cerraba nunca
  // el programa se quedaba en la version vieja sin enterarse.
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
    // Un fallo de actualizacion NUNCA debe tumbar el ERP: se anota y se sigue.
    ultimoErrorAutomatico = error.message;
    registrar(`Fallo la actualizacion: ${error.message}`);
  });

  autoUpdater.on('update-downloaded', () => {
    ultimoErrorAutomatico = null;
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

  const chequear = async (): Promise<boolean> => {
    try {
      if (usaAutoUpdate) await autoUpdater.checkForUpdates();
      else await chequearManual();
      return true;
    } catch (error) {
      registrar(`No se pudo chequear: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  };

  // Primer chequeo con reintentos; despues, el ritmo normal.
  const arrancar = async (): Promise<void> => {
    if (await chequear()) return;
    for (const espera of REINTENTOS_MS) {
      await new Promise((seguir) => setTimeout(seguir, espera).unref());
      registrar('Reintentando el chequeo de actualizaciones...');
      if (await chequear()) return;
    }
    registrar('No se pudo chequear al arrancar; se reintenta en el ciclo normal.');
  };

  setTimeout(() => void arrancar(), MS_PRIMER_CHEQUEO).unref();
  setInterval(() => void chequear(), MS_ENTRE_CHEQUEOS).unref();
}

/**
 * Cierra el programa e instala la version ya descargada. El `true` final es
 * `forceRunAfter`: sin eso, en Windows la app no vuelve a abrirse sola despues
 * de actualizar y parece que se cerro por las suyas.
 */
export function instalarYReiniciar(): void {
  autoUpdater.quitAndInstall(false, true);
}

/** Abre la pagina de releases en el navegador del sistema. */
export function abrirPaginaDeDescarga(): void {
  void shell.openExternal(URL_RELEASES_WEB);
}

export interface ResultadoChequeo {
  versionInstalada: string;
  /** Version publicada mas reciente, o null si no se pudo consultar. */
  versionDisponible: string | null;
  /** true si hay una version mas nueva que la instalada. */
  hayActualizacion: boolean;
  /** Que va a pasar: se instala sola, o hay que bajarla a mano. */
  seInstalaSola: boolean;
  /** Mensaje listo para mostrarle al usuario. */
  mensaje: string;
  urlDescarga: string;
}

/**
 * Chequeo DISPARADO POR EL USUARIO desde el menu de Ayuda. A diferencia del
 * automatico, este siempre contesta algo: "estas al dia" tambien es una
 * respuesta, y el usuario que aprieta el boton la espera.
 */
export async function verificarActualizacionesAhora(): Promise<ResultadoChequeo> {
  const versionInstalada = app.getVersion();
  const base: ResultadoChequeo = {
    versionInstalada,
    versionDisponible: null,
    hayActualizacion: false,
    seInstalaSola: false,
    mensaje: '',
    urlDescarga: URL_RELEASES_WEB,
  };

  if (!app.isPackaged) {
    return { ...base, mensaje: 'En modo desarrollo no se buscan actualizaciones.' };
  }

  const seInstalaSola = process.platform !== 'darwin' || MAC_TIENE_FIRMA;

  try {
    const respuesta = await fetch(URL_RELEASE_LATEST, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!respuesta.ok) {
      return {
        ...base,
        seInstalaSola,
        mensaje: `No se pudo consultar: GitHub respondio ${respuesta.status}. Reintenta en un rato.`,
      };
    }

    const release = (await respuesta.json()) as ReleaseGitHub;
    const ultima = release.tag_name?.replace(/^v/, '') ?? '';
    if (ultima === '') {
      return { ...base, seInstalaSola, mensaje: 'No se pudo leer la ultima version publicada.' };
    }

    const urlDescarga = release.html_url ?? URL_RELEASES_WEB;
    if (!esMasNueva(ultima, versionInstalada)) {
      return {
        ...base,
        versionDisponible: ultima,
        seInstalaSola,
        urlDescarga,
        mensaje: `Estas al dia. Version instalada: ${versionInstalada}.`,
      };
    }

    // Si el chequeo automatico venia fallando, decirlo: es la unica pista que
    // tiene el usuario de por que el programa "no se actualiza solo".
    if (ultimoErrorAutomatico !== null) {
      return {
        versionInstalada,
        versionDisponible: ultima,
        hayActualizacion: true,
        seInstalaSola,
        urlDescarga,
        mensaje:
          `Hay una version nueva (${ultima}) pero la descarga automatica esta fallando: ` +
          `${ultimoErrorAutomatico}. Podes bajar el instalador a mano con el boton de al lado.`,
      };
    }

    // Hay version nueva: en Windows la baja el auto-updater; en Mac sin firma,
    // el usuario tiene que bajarla a mano.
    if (seInstalaSola) {
      void autoUpdater.checkForUpdates().catch((error: unknown) => {
        registrar(`No se pudo iniciar la descarga: ${error instanceof Error ? error.message : String(error)}`);
      });
    }

    return {
      versionInstalada,
      versionDisponible: ultima,
      hayActualizacion: true,
      seInstalaSola,
      urlDescarga,
      mensaje: seInstalaSola
        ? `Hay una version nueva (${ultima}). Se esta descargando y se instala al cerrar el programa.`
        : `Hay una version nueva (${ultima}). Descargala e instalala a mano desde la pagina de descargas.`,
    };
  } catch (error) {
    return {
      ...base,
      seInstalaSola,
      mensaje: `No hay conexion con GitHub: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
