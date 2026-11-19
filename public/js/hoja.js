/** Página imprimible de la hoja de ruta: hoja.html?id=0645-MPU-U-01 */
import { api } from './api.js';
import { hojaDeRutaHTML } from './hoja-ruta.js';
import { esc } from './util.js';

const destino = document.getElementById('hoja');
const boton = document.getElementById('imprimir');
const id = new URLSearchParams(location.search).get('id') || '';

function mostrarError(titulo, detalle) {
  boton.hidden = true;
  destino.innerHTML = `<div class="sin-conexion"><h2>${esc(titulo)}</h2><p>${esc(detalle)}</p></div>`;
}

boton.addEventListener('click', () => window.print());

try {
  const proyecto = await api.proyecto(id);
  if (proyecto.estado === 'pendiente_mat') {
    mostrarError('La hoja de ruta todavía no se emitió',
      'Este proyecto está esperando sus materiales indispensables. Compras tiene que registrar la recepción.');
  } else {
    document.title = `Hoja de ruta ${proyecto.id} · Lima Mecanizados`;
    destino.innerHTML = hojaDeRutaHTML(proyecto);
  }
} catch (error) {
  mostrarError('No se pudo abrir la hoja de ruta', error.message);
}
