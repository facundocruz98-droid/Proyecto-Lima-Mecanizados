/** Página imprimible de etiquetas de materiales: etiqueta.html?ids=0645-MPU-U-01,0645-MPU-U-02 */
import { api } from './api.js';
import { etiquetaHTML } from './etiqueta-materiales.js';
import { esc } from './util.js';

const destino = document.getElementById('etiquetas');
const boton = document.getElementById('imprimir');
const parametros = new URLSearchParams(location.search);
const ids = (parametros.get('ids') || parametros.get('id') || '').split(',').map((x) => x.trim()).filter(Boolean);

boton.addEventListener('click', () => window.print());

try {
  if (!ids.length) throw new Error('No se indicó ningún proyecto.');
  const proyectos = await Promise.all(ids.map((id) => api.proyecto(id)));
  document.title = `Etiqueta de materiales ${ids.length === 1 ? ids[0] : `(${ids.length})`} · Lima Mecanizados`;
  document.getElementById('texto').textContent = ids.length === 1
    ? 'Etiqueta para el proveedor: imprimila o guardala como PDF para mandarla con el pedido.'
    : `${ids.length} etiquetas para el proveedor (una por pieza): imprimilas o guardalas como PDF para mandarlas con el pedido.`;
  destino.innerHTML = proyectos.map(etiquetaHTML).join('');
  boton.hidden = false;
} catch (error) {
  boton.hidden = true;
  destino.innerHTML = `<div class="sin-conexion"><h2>No se pudo abrir la etiqueta</h2><p>${esc(error.message)}</p></div>`;
}
