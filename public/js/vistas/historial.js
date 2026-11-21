/** Historial de cada proyecto y causas de demora más frecuentes (base de los KPI). */
import { api } from '../api.js';
import { campoFecha } from '../calendario.js';
import { avisar, codigoConUrgencia, duracion, esc, fecha, fechaDeInstante, fechaHora, icono, pastillaEstado, textoEtapa, textoPlazo } from '../util.js';

let raiz;
let ctx;
let elegido = '';
let detalle = null; // pedido que se está mostrando

const el = (id) => raiz.querySelector(`#${id}`);

const TITULOS = {
  alta: 'Alta del proyecto',
  recepcion: 'Recepción de materiales · hoja de ruta emitida',
  recepcion_parcial: 'Recepción parcial',
  inicio: 'Inicio del trabajo',
  etapa: 'Cambio de etapa',
  etapa_inicio: 'Inicio de etapa',
  etapa_fin: 'Etapa completada',
  pausa: 'Pausa',
  continuar: 'Trabajo continuado',
  finalizar: 'Trabajo finalizado',
  reprogramar: 'Plazo reprogramado',
  cancelar: 'Proyecto cancelado',
};

const ESTADO_ETAPA = { completada: 'Completada', en_curso: 'En curso', lista: 'Por iniciar', pendiente: 'Pendiente' };

/** Plan de fabricación del pedido: cada etapa con su inicio, fin y duración real. */
function planHistorial(p) {
  if (!p.tiene_plan) return '';
  return `
    <p class="seccion-titulo" style="margin-bottom:8px">Plan de fabricación</p>
    <div class="tabla-envoltura"><table class="tabla-plan">
      <thead><tr><th>#</th><th>Etapa</th><th>Estado</th><th>Inicio</th><th>Fin</th><th>Duración</th></tr></thead>
      <tbody>${p.plan.map((e) => `
        <tr class="plan-${e.estado}">
          <td class="num">${e.orden}</td><td><strong>${esc(e.nombre)}</strong></td><td>${ESTADO_ETAPA[e.estado]}</td>
          <td class="num">${e.inicio ? fechaHora(e.inicio) : '—'}</td><td class="num">${e.fin ? fechaHora(e.fin) : '—'}</td>
          <td class="num">${e.inicio && e.fin ? duracion((Date.parse(e.fin) - Date.parse(e.inicio)) / 3600000) : '—'}</td>
        </tr>`).join('')}
      </tbody></table></div>
    <p class="chico suave" style="margin:6px 0 4px">La duración de cada etapa incluye sus pausas. La espera entre etapas no cuenta como fabricación.</p>`;
}

const numeroDe = (p) => String(p.numero).padStart(4, '0');

/** Las piezas del mismo pedido (mismo número de orden), con link a cada una. */
function piezasHistorial(p) {
  const piezas = p.piezas_del_pedido || [];
  if (piezas.length < 2) return '';
  return `
    <p class="seccion-titulo" style="margin-bottom:8px">Piezas del pedido ${numeroDe(p)} · ${piezas.length}</p>
    <div class="piezas-pedido">${piezas.map((x) => x.id === p.id
      ? `<span class="pieza-ficha actual"><span class="codigo">${esc(x.id)}</span>${esc(x.nombre)}</span>`
      : `<a class="pieza-ficha" href="#historial/${encodeURIComponent(x.id)}"><span class="codigo">${esc(x.id)}</span>${esc(x.nombre)}</a>`).join('')}
    </div>`;
}

function sumarDias(iso, dias) {
  const [a, m, d] = iso.split('-').map(Number);
  const f = new Date(a, m - 1, d + dias);
  const dos = (n) => String(n).padStart(2, '0');
  return `${f.getFullYear()}-${dos(f.getMonth() + 1)}-${dos(f.getDate())}`;
}

/**
 * "Agregar pieza": conserva el número de orden y el cliente del pedido;
 * al guardar, el sistema asigna el siguiente ítem disponible.
 */
function abrirAgregarPieza(p) {
  // El pedido que se está mirando siempre es una de sus piezas (aunque el servidor no mande la lista).
  const lista = p.piezas_del_pedido || [];
  const piezas = lista.some((x) => x.id === p.id) ? lista : [...lista, { id: p.id, item: p.item, nombre: p.nombre }];
  const nombrePedido = (piezas.find((x) => x.item === 1) || piezas[0]).nombre;
  const siguienteItem = Math.max(0, ...piezas.map((x) => x.item)) + 1;
  const hoy = ctx.catalogo.hoy;
  const plazo = p.plazo_entrega >= hoy ? p.plazo_entrega : sumarDias(hoy, 14);
  const dialogo = ctx.abrirDialogo(`
    <form id="formPieza" novalidate autocomplete="off">
      <h2>Agregar pieza</h2>
      <div class="pieza-de-pedido">
        <div><span>Pedido</span><strong><span class="codigo">${numeroDe(p)}</span> · ${esc(nombrePedido)}</strong></div>
        <div><span>Cliente</span><strong>${esc(p.cliente)}</strong></div>
        <div><span>Piezas actuales</span><strong>${piezas.length}</strong></div>
      </div>
      <div class="campo"><label for="pzNombre">Nombre de la pieza</label>
        <input id="pzNombre" maxlength="120" placeholder="Ej.: Escalera de acceso"></div>
      <div class="campo"><label for="pzDescripcion">Descripción</label>
        <input id="pzDescripcion" maxlength="300" placeholder="Ej.: Fabricar y pintar"></div>
      <div class="par">
        <div class="campo"><label for="pzUrgencia">Urgencia</label>
          <select id="pzUrgencia"><option value="E">E · Estándar</option><option value="U">U · Urgente</option></select></div>
        <div class="campo"><label for="pzPlazo">Plazo de entrega</label>
          <input type="date" id="pzPlazo" value="${esc(plazo)}" min="${esc(hoy)}"></div>
      </div>
      <div class="campo"><label for="pzMateriales">Materiales indispensables para iniciar</label>
        <textarea id="pzMateriales" placeholder="Uno por línea"></textarea></div>
      <div class="vista-previa-id" id="pzVistaPrevia"></div>
      <p class="error" id="pzError" role="alert"></p>
      <div class="acciones-form">
        <button class="boton" type="submit">Agregar pieza</button>
        <button class="boton secundario" type="button" data-cerrar>Cancelar</button>
      </div>
    </form>`);
  const $ = (id) => dialogo.querySelector(`#${id}`);
  $('pzUrgencia').value = p.urgencia;
  campoFecha($('pzPlazo'), { hoy, atajos: [['+7 días', 7], ['+15 días', 15], ['+30 días', 30]] });
  const vistaPrevia = () => {
    const id = `${numeroDe(p)}-${p.codigo_cliente}-${$('pzUrgencia').value}-${String(siguienteItem).padStart(2, '0')}`;
    $('pzVistaPrevia').innerHTML = `<span>ID que se va a generar</span><span class="codigo">${esc(id)}</span>`;
  };
  $('pzUrgencia').addEventListener('change', vistaPrevia);
  vistaPrevia();
  $('pzNombre').focus();
  $('formPieza').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const boton = evento.submitter;
    $('pzError').textContent = '';
    if (boton) boton.disabled = true;
    try {
      const nueva = await api.agregarPieza(p.id, {
        id_usuario: ctx.usuarioConRol('Gerencia'),
        nombre: $('pzNombre').value,
        descripcion: $('pzDescripcion').value,
        urgencia: $('pzUrgencia').value,
        plazo_entrega: $('pzPlazo').value,
        materiales: $('pzMateriales').value.split('\n'),
      });
      ctx.cerrarDialogo();
      avisar(`Pieza ${nueva.id} agregada al pedido ${numeroDe(p)}. Queda esperando materiales en Compras.`);
      ctx.navegar('historial', nueva.id);
    } catch (e) {
      $('pzError').textContent = e.message;
      if (boton) boton.disabled = false;
    }
  });
}

function pintarProyecto(p) {
  detalle = p;
  el('resumen').innerHTML = `
    <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start">
      <div>${codigoConUrgencia(p)}<h3 style="font-size:18px;margin-top:2px">${esc(p.nombre)}</h3>
        <p class="chico suave">${esc(p.cliente)}</p></div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${pastillaEstado(p)}
        ${p.estado === 'pendiente_mat' ? '' : `<a class="boton secundario chico" href="hoja.html?id=${encodeURIComponent(p.id)}" target="_blank" rel="noopener"><span class="ico">${icono('imprimir')}</span>Hoja de ruta</a>`}
        ${p.estado === 'cancelado' ? '' : `<button class="boton chico" type="button" id="agregarPieza"><span class="ico">${icono('mas')}</span>Agregar pieza</button>`}</div>
    </div>
    <dl class="resumen">
      <div><dt>Plazo de entrega</dt><dd>${fecha(p.plazo_entrega)}</dd></div>
      ${p.estado === 'finalizado' || p.estado === 'cancelado' ? '' : `<div><dt>Entrega estimada</dt><dd>${fecha(p.fecha_estimada)}${p.dias_corrimiento ? ` <span class="chico corrida">(+${p.dias_corrimiento} ${p.dias_corrimiento === 1 ? 'día' : 'días'} por pausas)</span>` : ''}</dd></div>`}
      <div><dt>${{ finalizado: 'Finalizado el', cancelado: 'Cancelado el' }[p.estado] || 'Tiempo restante'}</dt><dd>${p.estado === 'finalizado' ? fechaDeInstante(p.fecha_fin)
        : p.estado === 'cancelado' ? (p.cancelacion && p.cancelacion.fecha ? fechaDeInstante(p.cancelacion.fecha) : '—')
          : textoPlazo(p.dias_restantes)}</dd></div>
      <div><dt>Etapa actual</dt><dd>${textoEtapa(p)}</dd></div>
      <div><dt>Listo para iniciar</dt><dd>${p.listo_desde ? fechaHora(p.listo_desde) : '—'}</dd></div>
      <div><dt>Inicio real</dt><dd>${p.inicio_real ? fechaHora(p.inicio_real) : '—'}</dd></div>
      ${p.listo_desde && p.inicio_real ? `<div><dt>Espera antes de iniciar</dt><dd>${duracion((Date.parse(p.inicio_real) - Date.parse(p.listo_desde)) / 3600000)}</dd></div>` : ''}
      <div><dt>Tiempo de fabricación</dt><dd>${duracion(p.tiempos.horas_en_proceso)}</dd></div>
      <div><dt>Tiempo detenido</dt><dd>${duracion(p.tiempos.horas_en_pausa)}</dd></div>
    </dl>${piezasHistorial(p)}${planHistorial(p)}`;

  const eventos = [...p.eventos].reverse();
  el('linea').innerHTML = eventos.map((e) => `
    <li>
      <span class="punto p-${esc(e.tipo)}"></span>
      <div>
        <div class="evento-titulo">${TITULOS[e.tipo] || esc(e.tipo)}${['etapa', 'inicio', 'etapa_inicio', 'etapa_fin'].includes(e.tipo) || (e.tipo === 'pausa' && e.etapa) ? ` · ${esc(e.etapa)}` : ''}${e.causa ? ` · <span style="color:var(--mal)">${esc(e.causa)}</span>` : ''}</div>
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
  async montar(elemento, contexto, parametro) {
    raiz = elemento;
    ctx = contexto;
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
    raiz.addEventListener('click', (evento) => {
      if (evento.target.closest('#agregarPieza') && detalle) abrirAgregarPieza(detalle);
    });
    await actualizar();
  },
  actualizar,
};
