/**
 * Entrada del monitor de elaboracion (elaboracion.html).
 *
 * Es la terminal de la fabrica: se abre desde una tablet o notebook en la red
 * (http://IP-de-la-maquina:4600/elaboracion) y muestra el trabajo pendiente,
 * lo que esta en marcha y lo terminado, con inicio y fin de cada tanda.
 * Comparte estilos y tokens con el escritorio: una sola marca.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '../estilos.css';
import { AppElaboracion } from './AppElaboracion';

const contenedor = document.getElementById('raiz');
if (!contenedor) throw new Error('No existe el elemento #raiz en elaboracion.html');

createRoot(contenedor).render(
  <StrictMode>
    <AppElaboracion />
  </StrictMode>,
);
