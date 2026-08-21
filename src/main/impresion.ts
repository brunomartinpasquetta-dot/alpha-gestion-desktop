/**
 * Impresion SILENCIOSA del ticket de elaboracion (ESC/POS al spooler del SO).
 *
 * Portado del PrinterService de StockFlow (v0.1.50, resuelto con impresora
 * real tras ~12 intentos fallidos). La regla que costo aprender:
 *
 *   - App WEB          -> window.print() + CSS @media print.
 *   - App ELECTRON     -> ESC/POS CRUDO al spooler. El print de Electron con
 *                         `silent: true` sale EN BLANCO en termicas (bug
 *                         Electron #41741) y con pageSize custom tira rollo
 *                         infinito. No insistir por ese lado.
 *
 * Aca importa de verdad: el ticket tiene que salir SOLO en la sala de
 * elaboracion, sin que nadie toque un dialogo. Si no hay impresora termica
 * configurada, el renderer cae al dialogo del sistema (window.print), que
 * imprime igual en una hoja comun.
 */

import { execFile } from 'node:child_process';
import { unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** Un renglon del ticket: el texto y como se imprime. */
export interface LineaTicket {
  texto: string;
  /** Doble alto y ancho: el numero de pedido y el cliente. */
  grande?: boolean;
  negrita?: boolean;
  centrado?: boolean;
  /** Linea de guiones a lo ancho del papel. */
  separador?: boolean;
}

/* ------------------------------- ESC/POS ---------------------------------- */

const ESC = 0x1b;
const GS = 0x1d;
const COLUMNAS_80MM = 48;

/**
 * Acentos: la termica no habla UTF-8. Se manda CP437/850 y, para que nunca
 * salga basura, el texto viaja sin tildes (el contenido es de fabrica, no una
 * carta de restaurante: se lee igual y no depende del codepage del modelo).
 */
function aAscii(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7e\n]/g, ' ');
}

function bytesDeLinea(linea: LineaTicket): number[] {
  const salida: number[] = [];
  salida.push(ESC, 0x61, linea.centrado === true ? 1 : 0); // alineacion
  salida.push(ESC, 0x45, linea.negrita === true || linea.grande === true ? 1 : 0); // negrita
  salida.push(GS, 0x21, linea.grande === true ? 0x11 : 0x00); // doble alto/ancho

  const texto = linea.separador === true ? '-'.repeat(COLUMNAS_80MM) : aAscii(linea.texto);
  salida.push(...Array.from(Buffer.from(texto, 'ascii')));
  salida.push(0x0a);
  return salida;
}

/** Arma el ticket completo en bytes ESC/POS, listo para el spooler. */
export function armarTicket(lineas: readonly LineaTicket[]): Buffer {
  const salida: number[] = [];
  salida.push(ESC, 0x40); // init
  salida.push(ESC, 0x74, 0x00); // codepage CP437
  for (const linea of lineas) salida.push(...bytesDeLinea(linea));
  salida.push(0x0a, 0x0a, 0x0a, 0x0a); // aire para cortar
  salida.push(GS, 0x56, 0x00); // corte total
  return Buffer.from(salida);
}

/* --------------------------- Envio al spooler ------------------------------ */

/**
 * Script PowerShell que manda los bytes por winspool con datatype RAW. Se usa
 * PowerShell y no una dependencia nativa a proposito: node-printer rompe los
 * builds y esto no necesita compilar nada.
 */
const PS1_RAW = `param([Parameter(Mandatory=$true)][string]$Printer, [Parameter(Mandatory=$true)][string]$DataFile)
$ErrorActionPreference = 'Stop'
$bytes = [System.IO.File]::ReadAllBytes($DataFile)
$src = @'
using System;
using System.Runtime.InteropServices;
public class AlphaRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct DOCINFOW {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }
  [DllImport("winspool.Drv", EntryPoint="OpenPrinterW", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool OpenPrinter(string src, out IntPtr hPrinter, IntPtr pd);
  [DllImport("winspool.Drv", EntryPoint="ClosePrinter", SetLastError=true)]
  public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="StartDocPrinterW", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, int level, ref DOCINFOW di);
  [DllImport("winspool.Drv", EntryPoint="EndDocPrinter", SetLastError=true)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="StartPagePrinter", SetLastError=true)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="EndPagePrinter", SetLastError=true)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="WritePrinter", SetLastError=true)]
  public static extern bool WritePrinter(IntPtr hPrinter, byte[] pBytes, int dwCount, out int dwWritten);
  public static void Send(string printerName, byte[] bytes) {
    IntPtr h;
    if (!OpenPrinter(printerName, out h, IntPtr.Zero))
      throw new Exception("OpenPrinter fallo err=" + Marshal.GetLastWin32Error());
    try {
      DOCINFOW di = new DOCINFOW();
      di.pDocName = "Alpha Gestion - Orden de elaboracion";
      di.pDataType = "RAW";
      if (!StartDocPrinter(h, 1, ref di)) throw new Exception("StartDocPrinter fallo err=" + Marshal.GetLastWin32Error());
      try {
        if (!StartPagePrinter(h)) throw new Exception("StartPagePrinter fallo");
        int written;
        if (!WritePrinter(h, bytes, bytes.Length, out written)) throw new Exception("WritePrinter fallo");
        EndPagePrinter(h);
      } finally { EndDocPrinter(h); }
    } finally { ClosePrinter(h); }
  }
}
'@
Add-Type -TypeDefinition $src -Language CSharp
[AlphaRawPrinter]::Send($Printer, $bytes)
`;

/** Manda bytes crudos a una impresora ya instalada en el sistema. */
export async function enviarCrudoAImpresora(impresora: string, datos: Buffer): Promise<void> {
  const nombre = impresora.trim();
  if (nombre === '') throw new Error('No hay impresora de tickets configurada.');

  const sello = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const archivoBin = path.join(os.tmpdir(), `alpha-escpos-${sello}.bin`);
  await writeFile(archivoBin, datos);

  try {
    if (process.platform === 'win32') {
      const archivoPs1 = path.join(os.tmpdir(), `alpha-rawprint-${sello}.ps1`);
      await writeFile(archivoPs1, PS1_RAW, 'utf8');
      try {
        await new Promise<void>((resolver, rechazar) => {
          execFile(
            'powershell.exe',
            ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', archivoPs1, '-Printer', nombre, '-DataFile', archivoBin],
            (error, _salida, errorSalida) => {
              if (error) {
                rechazar(new Error(`No se pudo imprimir en "${nombre}": ${String(errorSalida || error.message).trim()}`));
              } else resolver();
            },
          );
        });
      } finally {
        void unlink(archivoPs1).catch(() => undefined);
      }
      return;
    }

    // macOS y Linux: CUPS acepta el crudo con -o raw.
    await new Promise<void>((resolver, rechazar) => {
      execFile('lp', ['-d', nombre, '-o', 'raw', archivoBin], (error, _s, errorSalida) => {
        if (error) {
          rechazar(new Error(`No se pudo imprimir en "${nombre}": ${String(errorSalida || error.message).trim()}`));
        } else resolver();
      });
    });
  } finally {
    void unlink(archivoBin).catch(() => undefined);
  }
}
