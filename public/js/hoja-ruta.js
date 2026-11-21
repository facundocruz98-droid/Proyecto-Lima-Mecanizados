/** Dibujo de la hoja de ruta (se usa en la vista previa de Compras y en la página imprimible). */
import { codigoDeBarrasSVG } from './codigo128.js';
import { esc, fecha, fechaHora } from './util.js';

const MARCA = { completada: '■', en_curso: '▶', lista: '□', pendiente: '□' };
const ESTADO = { completada: 'completada', en_curso: 'en curso', lista: 'próxima', pendiente: '' };

/** Plan de fabricación en la hoja: se define en el Puesto de taller al iniciar el pedido. */
function planHoja(p) {
  if (!p.tiene_plan) return '';
  return `
    <section class="hoja-plan">
      <h4>Plan de fabricación · ${p.etapas_completadas} de ${p.total_etapas} etapas completadas</h4>
      <ol>${p.plan.map((e) => `
        <li class="${e.estado}"><span class="hoja-plan-marca">${MARCA[e.estado]}</span>${e.orden}. ${esc(e.nombre)}
          <small>${ESTADO[e.estado]}${e.fin ? ` · ${fechaHora(e.fin)}` : e.inicio ? ` · desde ${fechaHora(e.inicio)}` : ''}</small></li>`).join('')}
      </ol>
    </section>`;
}

export function hojaDeRutaHTML(p) {
  const indispensables = p.materiales.filter((m) => m.indispensable).map((m) => esc(m.descripcion)).join(', ');
  const emision = p.eventos.find((e) => e.tipo === 'recepcion');
  return `
    <article class="hoja">
      <header class="hoja-cabeza">
        <div><h3>HOJA DE RUTA</h3><small>Lima Mecanizados SRL · Seguimiento de Taller</small></div>
        ${p.urgencia === 'U' ? '<span class="hoja-urgente">URGENTE</span>' : ''}
      </header>
      <dl>
        <dt>Proyecto</dt><dd>${esc(p.nombre)}</dd>
        <dt>Descripción</dt><dd>${esc(p.descripcion || '—')}</dd>
        <dt>Cliente</dt><dd>${esc(p.cliente)}</dd>
        <dt>Plazo de entrega</dt><dd><strong>${fecha(p.plazo_entrega)}</strong></dd>
        <dt>Materiales</dt><dd>${indispensables || '—'}</dd>
        <dt>Emitida</dt><dd>${emision ? fechaHora(emision.fecha_hora) : '—'}</dd>
      </dl>
      ${planHoja(p)}
      <div class="hoja-codigo">
        ${codigoDeBarrasSVG(p.id, { modulo: 2, alto: 84 })}
        <div>${esc(p.id)}</div>
      </div>
      <p class="hoja-pie">Escanear en la PC del sector al iniciar, pausar, continuar y finalizar el trabajo.</p>
    </article>`;
}
