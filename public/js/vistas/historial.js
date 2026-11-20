/** Historial de cada proyecto y causas de demora más frecuentes (base de los KPI). */
import { api } from '../api.js';
import { codigoConUrgencia, duracion, esc, fecha, fechaDeInstante, fechaHora, icono, pastillaEstado, textoPlazo } from '../util.js';

let raiz;
let elegido = '';

const el = (id) => raiz.querySelector(`#${id}`);

const TITULOS = {
  alta: 'Alta del proyecto',
  recepcion: 'Recepción de materiales · hoja de ruta emitida',
  recepcion_parcial: 'Recepción parcial',
  inicio: 'Inicio del trabajo',
  etapa: 'Cambio de etapa',
  pausa: 'Pausa',
  continuar: 'Trabajo continuado',
  finalizar: 'Trabajo finalizado',
  reprogramar: 'Plazo reprogramado',
  cancelar: 'Proyecto cancelado',
};

function pintarProyecto(p) {
  el('resumen').innerHTML = `
    <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start">
      <div>${codigoConUrgencia(p)}<h3 style="font-size:18px;margin-top:2px">${esc(p.nombre)}</h3>
        <p class="chico suave">${esc(p.cliente)}${p.nro_presupuesto ? ` · ${esc(p.nro_presupuesto)}` : ''}</p></div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${pastillaEstado(p)}
        ${p.estado === 'pendiente_mat' ? '' : `<a class="boton secundario chico" href="hoja.html?id=${encodeURIComponent(p.id)}" target="_blank" rel="noopener"><span class="ico">${icono('imprimir')}</span>Hoja de ruta</a>`}</div>
    </div>
    <dl class="resumen">
      <div><dt>Plazo de entrega</dt><dd>${fecha(p.plazo_entrega)}</dd></div>
      ${p.estado === 'finalizado' || p.estado === 'cancelado' ? '' : `<div><dt>Entrega estimada</dt><dd>${fecha(p.fecha_estimada)}${p.dias_corrimiento ? ` <span class="chico corrida">(+${p.dias_corrimiento} ${p.dias_corrimiento === 1 ? 'día' : 'días'} por pausas)</span>` : ''}</dd></div>`}
      <div><dt>${{ finalizado: 'Finalizado el', cancelado: 'Cancelado el' }[p.estado] || 'Tiempo restante'}</dt><dd>${p.estado === 'finalizado' ? fechaDeInstante(p.fecha_fin)
        : p.estado === 'cancelado' ? (p.cancelacion && p.cancelacion.fecha ? fechaDeInstante(p.cancelacion.fecha) : '—')
          : textoPlazo(p.dias_restantes)}</dd></div>
      <div><dt>Etapa actual</dt><dd>${esc(p.etapa_actual || '—')}</dd></div>
      <div><dt>Tiempo en proceso</dt><dd>${duracion(p.tiempos.horas_en_proceso)}</dd></div>
      <div><dt>Tiempo detenido</dt><dd>${duracion(p.tiempos.horas_en_pausa)}</dd></div>
    </dl>`;

  const eventos = [...p.eventos].reverse();
  el('linea').innerHTML = eventos.map((e) => `
    <li>
      <span class="punto p-${esc(e.tipo)}"></span>
      <div>
        <div class="evento-titulo">${TITULOS[e.tipo] || esc(e.tipo)}${e.tipo === 'etapa' || e.tipo === 'inicio' ? ` · ${esc(e.etapa)}` : ''}${e.causa ? ` · <span style="color:var(--mal)">${esc(e.causa)}</span>` : ''}</div>
        ${e.detalle ? `<div class="evento-detalle">${esc(e.detalle)}</div>` : ''}
        <div class="evento-meta">${fechaHora(e.fecha_hora)} · ${esc(e.usuario)}</div>
      </div>
    </li>`).join('');
}

function pintarBarras(destino, filas, clave) {
  const maximo = Math.max(1, ...filas.map((f) => f.pausas));
  const mayor = Math.max(...filas.map((f) => f.pausas));
  el(destino).innerHTML = filas.map((f) => `
    <div class="barra-fila">
      <span>${esc(f[clave])}</span>
      <span class="valor">${f.pausas} ${f.pausas === 1 ? 'pausa' : 'pausas'}${f.pausas ? ` · ${duracion(f.horas)}` : ''}</span>
      <div class="barra-pista"><div class="barra-relleno ${f.pausas && f.pausas === mayor ? 'principal' : ''}" style="width:${(f.pausas / maximo) * 100}%"></div></div>
    </div>`).join('');
}

async function actualizar() {
  const [proyectos, indicadores] = await Promise.all([api.proyectos(), api.indicadores()]);
  const lista = el('proyecto');
  const ordenados = [...proyectos].sort((a, b) => a.id.localeCompare(b.id));
  lista.innerHTML = ordenados.map((p) => `<option value="${esc(p.id)}">${esc(p.id)} · ${esc(p.nombre)}</option>`).join('');

  if (!ordenados.some((p) => p.id === elegido)) elegido = ordenados.length ? ordenados[0].id : '';
  lista.value = elegido;

  if (elegido) {
    pintarProyecto(await api.proyecto(elegido));
  } else {
    el('resumen').innerHTML = '<p class="vacio">Todavía no hay proyectos.</p>';
    el('linea').innerHTML = '';
  }

  el('totales').textContent = indicadores.total_pausas
    ? `${indicadores.total_pausas} ${indicadores.total_pausas === 1 ? 'pausa registrada' : 'pausas registradas'} · ${duracion(indicadores.total_horas)} detenidas en total`
    : 'Todavía no se registraron pausas.';
  pintarBarras('causas', indicadores.causas, 'causa');
  pintarBarras('etapas', indicadores.etapas, 'etapa');
}

export default {
  titulo: 'Historial y causas',
  subtitulo: 'Todo lo que pasó con cada trabajo, y por qué se demoran.',
  async montar(elemento, _contexto, parametro) {
    raiz = elemento;
    elegido = String(parametro || '').toUpperCase();
    raiz.innerHTML = `
      <div class="rejilla dos">
        <section class="tarjeta">
          <div class="tarjeta-cabeza"><h2>Historial del proyecto</h2>
            <select id="proyecto" aria-label="Proyecto" style="max-width:360px"></select></div>
          <div class="tarjeta-cuerpo">
            <div id="resumen"></div>
            <p class="seccion-titulo" style="margin-bottom:12px">Línea de tiempo · lo más reciente primero</p>
            <ol class="linea-tiempo" id="linea"></ol>
          </div>
        </section>
        <div class="columna">
          <section class="tarjeta">
            <div class="tarjeta-cabeza"><h2>Causas de demora</h2></div>
            <div class="tarjeta-cuerpo">
              <p class="nota" id="totales" style="margin-bottom:14px"></p>
              <div class="barras" id="causas"></div>
            </div>
          </section>
          <section class="tarjeta">
            <div class="tarjeta-cabeza"><h2>Pausas por etapa</h2></div>
            <div class="tarjeta-cuerpo">
              <p class="nota" style="margin-bottom:14px">En qué etapa del taller se detienen los trabajos.</p>
              <div class="barras" id="etapas"></div>
            </div>
          </section>
        </div>
      </div>`;
    el('proyecto').addEventListener('change', async () => {
      elegido = el('proyecto').value;
      history.replaceState(null, '', `#historial/${encodeURIComponent(elegido)}`);
      pintarProyecto(await api.proyecto(elegido));
    });
    await actualizar();
  },
  actualizar,
};
