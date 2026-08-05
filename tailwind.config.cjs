/**
 * Sistema de diseno de Alfajores ERP.
 *
 * Producto de escritorio de uso intensivo: pantallas densas, muchas tablas y mucha
 * lectura durante toda la jornada. La paleta es calida y sobria (reposteria artesanal),
 * con contrastes suaves para no cansar la vista y acentos reservados para el estado.
 *
 * Familias de color:
 * - `masa`   Neutro calido color masa cruda. Base de TODAS las superficies (fondos,
 *            paneles, bordes, lineas de tabla) y de los textos. Es el gris del producto:
 *            nunca se usa un gris frio.
 * - `dulce`  Marron/caramelo. Color primario de marca: encabezados, acciones primarias,
 *            enlaces y elementos seleccionados. No se usa para estados.
 * - `menta`  Verde. Estado positivo: servidor conectado, stock por encima del minimo,
 *            operaciones confirmadas.
 * - `alerta` Ambar. Advertencia sin bloqueo: stock bajo minimo, datos incompletos,
 *            vencimientos proximos.
 * - `peligro` Rojo ladrillo. Error o faltante: fallo de conexion, stock en cero,
 *            validaciones rechazadas, eliminaciones.
 *
 * Cada rampa va de 50 (fondo mas claro) a 900 (texto/borde mas oscuro). Regla de uso:
 * 50-100 para fondos, 200-300 para bordes, 500-600 para acentos solidos, 700-900 para texto.
 */
/** @type {import('tailwindcss').Config} */
const config = {
  content: ['./src/renderer/index.html', './src/renderer/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Neutro calido: superficies y textos.
        masa: {
          50: '#faf7f2',
          100: '#f3ede4',
          200: '#e7ded1',
          300: '#d6c9b7',
          400: '#b9a991',
          500: '#97876f',
          600: '#786a55',
          700: '#5b4f3f',
          800: '#3d352a',
          900: '#241f18',
        },
        // Caramelo: color primario de marca.
        dulce: {
          50: '#fdf6ec',
          100: '#f9e7cc',
          200: '#f0ce9e',
          300: '#e3ae6b',
          400: '#d18f42',
          500: '#b87333',
          600: '#9a5c28',
          700: '#7c4720',
          800: '#5e351a',
          900: '#3f2412',
        },
        // Verde: estados positivos, stock en regla.
        menta: {
          50: '#eef7f1',
          100: '#d6ebdd',
          200: '#afd8be',
          300: '#82c09b',
          400: '#57a67a',
          500: '#38885e',
          600: '#2c6e4b',
          700: '#23573c',
          800: '#1a412d',
          900: '#112b1e',
        },
        // Ambar: advertencias, stock bajo minimo.
        alerta: {
          50: '#fef8e7',
          100: '#fcedbf',
          200: '#f8da8a',
          300: '#f2c356',
          400: '#e5a92c',
          500: '#c98d14',
          600: '#a67210',
          700: '#83590d',
          800: '#60410a',
          900: '#3e2a06',
        },
        // Rojo ladrillo: errores y faltantes.
        peligro: {
          50: '#fdf0ee',
          100: '#f9d8d3',
          200: '#f1b0a7',
          300: '#e58375',
          400: '#d65b49',
          500: '#b93e2c',
          600: '#9a3123',
          700: '#7b261b',
          800: '#5c1c14',
          900: '#3d120d',
        },
      },
      fontFamily: {
        // UI: stack del sistema, sin fuentes remotas (la app corre offline en Electron).
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Inter',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
        // Numeros: cantidades, codigos y montos. Ancho fijo para que las columnas alineen.
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'Liberation Mono', 'monospace'],
      },
      // Escala apretada: prioriza densidad de datos por sobre aire.
      fontSize: {
        micro: ['0.6875rem', { lineHeight: '0.9375rem', letterSpacing: '0.03em' }],
        xs: ['0.75rem', { lineHeight: '1rem' }],
        sm: ['0.8125rem', { lineHeight: '1.125rem' }],
        base: ['0.875rem', { lineHeight: '1.25rem' }],
        lg: ['1rem', { lineHeight: '1.375rem' }],
        xl: ['1.125rem', { lineHeight: '1.5rem' }],
        '2xl': ['1.375rem', { lineHeight: '1.75rem' }],
        '3xl': ['1.75rem', { lineHeight: '2.125rem' }],
      },
      // Medidas propias del layout de escritorio.
      spacing: {
        barra: '3.25rem', // alto de la barra superior
        fila: '2.25rem', // alto de fila de tabla estandar
        'fila-densa': '1.75rem', // alto de fila en tablas comprimidas
        panel: '17rem', // ancho del panel lateral
      },
      borderRadius: {
        ficha: '0.375rem', // tarjetas, celdas destacadas
        panel: '0.625rem', // contenedores grandes
        pastilla: '9999px', // etiquetas de estado
      },
      boxShadow: {
        ficha: '0 1px 2px 0 rgb(61 53 42 / 0.08)',
        panel: '0 2px 8px -2px rgb(61 53 42 / 0.12), 0 1px 2px 0 rgb(61 53 42 / 0.06)',
        barra: '0 1px 0 0 rgb(61 53 42 / 0.10)',
      },
    },
  },
  plugins: [],
};

module.exports = config;
