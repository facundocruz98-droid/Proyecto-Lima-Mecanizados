/** Etiqueta de materiales: Compras la manda al proveedor junto con el pedido y el proveedor la pega en la caja.
 *  Cuando llega la caja, Compras escanea la etiqueta y el sistema abre ese proyecto solo. */
import { codigoDeBarrasSVG } from './codigo128.js';
import { esc, fecha } from './util.js';

export function etiquetaHTML(p) {
  const materiales = p.materiales.length
    ? `<ul class="etiqueta-materiales">${p.materiales.map((m) => `<li>${esc(m.descripcion)}${m.indispensable ? '' : ' <small>(no indispensable)</small>'}</li>`).join('')}</ul>`
    : '<p>—</p>';
  return `
    <article class="hoja etiqueta">
      <header class="hoja-cabeza">
        <div><h3>ETIQUETA DE MATERIALES</h3><small>Lima Mecanizados SRL · Compras</small></div>
        ${p.urgencia === 'U' ? '<span class="hoja-urgente">URGENTE</span>' : ''}
      </header>
      <dl>
        <dt>Proyecto</dt><dd>${esc(p.nombre)}</dd>
        <dt>Cliente</dt><dd>${esc(p.cliente)}</dd>
        <dt>Plazo de entrega</dt><dd><strong>${fecha(p.plazo_entrega)}</strong></dd>
      </dl>
      <h4 class="etiqueta-titulo">Materiales a conseguir</h4>
      ${materiales}
      <div class="hoja-codigo">
        ${codigoDeBarrasSVG(p.id, { modulo: 2, alto: 70 })}
        <div>${esc(p.id)}</div>
      </div>
      <p class="hoja-pie"><strong>Proveedor: pegar esta etiqueta en la caja del pedido.</strong><br>Lima Mecanizados la escanea al recibir el material.</p>
    </article>`;
}
