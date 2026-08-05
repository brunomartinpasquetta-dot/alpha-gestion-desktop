/**
 * Entrada de la PWA de pedidos (pedidos.html).
 * Comparte los estilos y tokens del escritorio: una sola marca.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '../estilos.css';
import { AppPedidos } from './AppPedidos';

const contenedor = document.getElementById('raiz');
if (!contenedor) throw new Error('No existe el elemento #raiz en pedidos.html');

createRoot(contenedor).render(
  <StrictMode>
    <AppPedidos />
  </StrictMode>,
);

// El service worker hace que la app abra sin conexion. Solo en produccion:
// en el dev server de Vite cachear el shell solo trae confusion.
if ('serviceWorker' in navigator && !import.meta.env.DEV) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/pedidos-sw.js').catch(() => {
      // Sin SW la app funciona igual; solo pierde la apertura offline.
    });
  });
}
