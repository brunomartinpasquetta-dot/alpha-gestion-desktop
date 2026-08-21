/**
 * Tipado del puente que expone el preload en `window.alfajores`.
 *
 * Debe mantenerse en espejo con src/main/preload.ts. No se puede importar de ahi
 * porque el preload compila a CommonJS del lado Node y este proyecto de tipos es
 * el del renderer.
 */

export interface DescriptorVentana {
  readonly id: number;
  readonly clave: string;
  readonly titulo: string;
  readonly icono: string;
  readonly minimizada: boolean;
  readonly enfocada: boolean;
}

export interface ApiVentanas {
  abrir(clave: string, titulo: string, icono: string, params?: Record<string, string>): void;
  cerrar(id: number): void;
  minimizar(id: number): void;
  enfocar(id: number): void;
  listar(): Promise<DescriptorVentana[]>;
  alCambiar(callback: (lista: DescriptorVentana[]) => void): () => void;
  cerrarme(): void;
}

export interface ApiArchivos {
  /** Abre el selector del sistema. `extensiones` sin punto. null = cancelo. */
  elegir(titulo: string, extensiones: readonly string[]): Promise<string | null>;
}

export interface ResultadoChequeoActualizacion {
  versionInstalada: string;
  versionDisponible: string | null;
  hayActualizacion: boolean;
  seInstalaSola: boolean;
  mensaje: string;
  urlDescarga: string;
}

export interface ApiActualizaciones {
  verificar(): Promise<ResultadoChequeoActualizacion>;
  abrirDescargas(): void;
  instalarAhora(): void;
  alHaberActualizacion(manejador: (version: string) => void): () => void;
}

export interface ApiEventos {
  alCambiar(manejador: (tipo: string) => void): () => void;
}

export interface LineaTicketVista {
  texto: string;
  grande?: boolean;
  negrita?: boolean;
  centrado?: boolean;
  separador?: boolean;
}

export interface ApiImpresion {
  listar(): Promise<{ nombre: string; descripcion: string; pordefecto: boolean }[]>;
  ticket(impresora: string, lineas: readonly LineaTicketVista[]): Promise<{ ok: boolean; error?: string }>;
}

export interface ApiSistema {
  /** Cierra y vuelve a abrir el programa (tras restaurar un respaldo). */
  reiniciar(): void;
}

export interface ApiWhatsApp {
  /** Pide abrir el chat de un numero E.164 sin + (ej: 549342...). */
  abrirChat(telefono: string): void;
  /** El panel de la ventana principal escucha adonde navegar. */
  alNavegar(manejador: (telefono: string) => void): () => void;
}

export interface ApiAlfajores {
  readonly version: string;
  readonly plataforma: string;
  readonly ventanas: ApiVentanas;
  readonly archivos: ApiArchivos;
  readonly actualizaciones: ApiActualizaciones;
  readonly eventos: ApiEventos;
  readonly whatsapp: ApiWhatsApp;
  readonly sistema: ApiSistema;
  readonly impresion: ApiImpresion;
}

declare global {
  interface Window {
    /** Puede faltar si el renderer corre fuera de Electron (por ejemplo en el navegador). */
    readonly alfajores?: ApiAlfajores;
  }
}

export {};
