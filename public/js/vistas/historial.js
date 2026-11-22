/** Historial de cada proyecto: datos principales y línea de tiempo. (Las causas de pausa están en el Dashboard.) */
import { api } from '../api.js';
import { avisar, ayuda, codigoConUrgencia, duracion, esc, fecha, fechaDeInstante, fechaHora, icono, pastillaEstado, textoEtapa, textoPlazo } from '../util.js';

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

// ---------- Línea de tiempo ----------
/** Ícono y color de cada tipo de evento (trazo simple, mismo estilo que el resto del sistema). */
const ICONOS_EVENTO = {
  alta: ['neutro', '<rect x="5" y="4" width="14" height="17" rx="2"/><rect x="9" y="2.5" width="6" height="3.5" rx="1"/><path d="M9 11h6M9 15h4"/>'],
  recepcion: ['info', '<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>'],
  recepcion_parcial: ['info', '<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>'],
  inicio: ['ok', '<path d="M8 5.5v13l10.5-6.5z"/>'],
  etapa_inicio: ['ok', '<path d="M8 5.5v13l10.5-6.5z"/>'],
  continuar: ['ok', '<path d="M8 5.5v13l10.5-6.5z"/>'],
  etapa_fin: ['ok', '<path d="M5 12.5l4.5 4.5L19 7.5"/>'],
  etapa: ['neutro', '<path d="M5 12h12M12 6l6 6-6 6"/>'],
  pausa: ['mal', '<rect x="7" y="5.5" width="3.5" height="13" rx="1"/><rect x="13.5" y="5.5" width="3.5" height="13" rx="1"/>'],
  finalizar: ['fin', '<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>'],
  reprogramar: ['alerta', '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'],
  cancelar: ['neutro', '<path d="M6 6l12 12M18 6L6 18"/>'],
};

const dos = (n) => String(n).padStart(2, '0');
const diaLocal = (iso) => { const f = new Date(iso); return `${f.getFullYear()}-${dos(f.getMonth() + 1)}-${dos(f.getDate())}`; };
const horaLocal = (iso) => { const f = new Date(iso); return `${dos(f.getHours())}:${dos(f.getMinutes())}`; };

/** "Hoy", "Ayer" o "Viernes 13 de noviembre" (con el año si no es el actual). */
function tituloDia(dia) {
  const hoy = diaLocal(new Date().toISOString());
  const ayer = new Date(); ayer.setDate(ayer.getDate() - 1);
  const [a, m, d] = dia.split('-').map(Number);
  const opciones = { weekday: 'long', day: 'numeric', month: 'long' };
  if (a !== new Date().getFullYear()) opciones.year = 'numeric';
  const largo = new Date(a, m - 1, d).toLocaleDateString('es-AR', opciones).replace(',', '');
  const capital = largo.charAt(0).toUpperCase() + largo.slice(1);
  if (dia === hoy) return `Hoy <span>${esc(capital)}</span>`;
  if (dia === diaLocal(ayer.toISOString())) return `Ayer <span>${esc(capital)}</span>`;
  return esc(capital);
}

/** Cuánto duró cada pausa: hasta el siguiente "continuar", "finalizar" o "cancelar". */
function duracionesDePausas(eventos) {
  const resultado = new Map();
  eventos.forEach((e, i) => {
    if (e.tipo !== 'pausa') return;
    const cierre = eventos.slice(i + 1).find((x) => ['continuar', 'finalizar', 'cancelar'].includes(x.tipo));
    resultado.set(e, cierre ? (Date.parse(cierre.fecha_hora) - Date.parse(e.fecha_hora)) / 3600000 : null);
  });
  return resultado;
}

function eventoHTML(e, duraciones, reciente) {
  const [tono, trazo] = ICONOS_EVENTO[e.tipo] || ICONOS_EVENTO.etapa;
  const conEtapa = ['etapa', 'inicio', 'etapa_inicio', 'etapa_fin', 'pausa', 'continuar'].includes(e.tipo) && e.etapa;
  const titulo = `${esc(TITULOS[e.tipo] || e.tipo)}${conEtapa ? ` <span class="tl-etapa">· ${esc(e.etapa)}</span>` : ''}`;
  let extra = '';
  const plan = e.tipo === 'inicio' && /^Plan: /.test(e.detalle || '') ? e.detalle.slice(6).split(' → ') : null;
  if (plan) {
    extra = `<div class="tl-plan">${plan.map((x, i) => `${i ? '<span class="tl-flecha">→</span>' : ''}<span class="tl-chip">${esc(x)}</span>`).join('')}</div>`;
  } else if (e.tipo === 'pausa') {
    const horas = duraciones.get(e);
    extra = `<div class="tl-chips"><span class="tl-chip mal">${esc(e.causa || 'Pausa')}</span>
        <span class="tl-chip ${horas === null ? 'alerta' : ''}">${horas === null ? 'En curso' : `Detenido ${duracion(horas)}`}</span></div>
      ${e.detalle ? `<p class="tl-nota">${esc(e.detalle)}</p>` : ''}`;
  }
  const meta = [esc(e.usuario), !plan && e.tipo !== 'pausa' && e.detalle ? esc(e.detalle) : ''].filter(Boolean).join(' · ');
  return `
    <li class="tl-item${reciente ? ' reciente' : ''}">
      <span class="tl-icono t-${tono}" aria-hidden="true"><svg viewBox="0 0 24 24">${trazo}</svg></span>
      <div class="tl-cuerpo">
        <p class="tl-titulo">${titulo}</p>
        <p class="tl-meta">${meta}</p>
        ${extra}
      </div>
      <time class="tl-hora" datetime="${esc(e.fecha_hora)}" title="${esc(fechaHora(e.fecha_hora))}">${horaLocal(e.fecha_hora)}</time>
    </li>`;
}

/** Línea de tiempo agrupada por día, lo más reciente primero. */
function pintarLineaDeTiempo(eventos) {
  const duraciones = duracionesDePausas(eventos);
  const recientes = [...eventos].reverse();
  const dias = [];
  for (const e of recientes) {
    const dia = diaLocal(e.fecha_hora);
    if (!dias.length || dias[dias.length - 1].dia !== dia) dias.push({ dia, eventos: [] });
    dias[dias.length - 1].eventos.push(e);
  }
  el('cantidadEventos').textContent = eventos.length === 1 ? '1 evento' : `${eventos.length} eventos`;
  el('linea').innerHTML = dias.map((d, i) => `
    <section class="tl-dia">
      <h4 class="tl-dia-titulo">${tituloDia(d.dia)}</h4>
      <ol class="tl-lista">${d.eventos.map((e, k) => eventoHTML(e, duraciones, i === 0 && k === 0)).join('')}</ol>
    </section>`).join('');
}

/** Link público del proyecto (usa la dirección de red si se entró por "localhost"). */
function linkCliente(p) {
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  const base = local && ctx.catalogo.direcciones_red && ctx.catalogo.direcciones_red.length
    ? ctx.catalogo.direcciones_red[0]
    : location.origin;
  return `${base}/seguimiento.html?c=${encodeURIComponent(p.token_cliente)}`;
}

/** Ventana con el link de seguimiento para mandarle al cliente. */
function abrirLinkCliente(p) {
  const url = linkCliente(p);
  const dialogo = ctx.abrirDialogo(`
    <form method="dialog">
      <h2>Link para el cliente · <span class="codigo">${esc(p.id)}</span></h2>
      <p class="nota">${esc(p.cliente)} puede ver con este link el estado de su pedido y la fecha de entrega, sin usuario ni contraseña.
        No ve las operaciones internas del taller.</p>
      <div class="campo"><label for="linkCliente">Link de seguimiento</label><input id="linkCliente" type="text" readonly value="${esc(url)}"></div>
      <div class="acciones-form">
        <button class="boton" type="button" id="copiarLink"><span class="ico">${icono('copiar')}</span>Copiar link</button>
        <a class="boton secundario" href="seguimiento.html?c=${encodeURIComponent(p.token_cliente)}" target="_blank" rel="noopener">Ver como el cliente</a>
        <button class="boton secundario" type="button" data-cerrar>Cerrar</button>
      </div>
    </form>`);
  const campo = dialogo.querySelector('#linkCliente');
  campo.addEventListener('focus', () => campo.select());
  dialogo.querySelector('#copiarLink').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(url);
      avisar('Link copiado. Pegalo en WhatsApp o en un mail para el cliente.');
    } catch {
      campo.select();
      avisar('Seleccioná el link y copialo con Ctrl + C.');
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
        <button class="boton secundario chico" type="button" data-link-cliente><span class="ico">${icono('celular')}</span>Link para el cliente</button></div>
    </div>
    <dl class="resumen">
      <div><dt>Plazo de entrega</dt><dd>${fecha(p.plazo_entrega)}</dd></div>
      ${p.estado === 'finalizado' || p.estado === 'cancelado' ? '' : `<div><dt>Entrega estimada</dt><dd>${fecha(p.fecha_estimada)}${p.dias_corrimiento ? ` <span class="chico corrida">(+${p.dias_corrimiento} ${p.dias_corrimiento === 1 ? 'día' : 'días'} por pausas)</span>` : ''}</dd></div>`}
      <div><dt>${{ finalizado: 'Finalizado el', cancelado: 'Cancelado el' }[p.estado] || 'Tiempo restante'}</dt><dd>${p.estado === 'finalizado' ? fechaDeInstante(p.fecha_fin)
        : p.estado === 'cancelado' ? (p.cancelacion && p.cancelacion.fecha ? fechaDeInstante(p.cancelacion.fecha) : '—')
          : textoPlazo(p.dias_restantes)}</dd></div>
      <div><dt>Etapa actual</dt><dd>${textoEtapa(p)}</dd></div>
      ${p.listo_desde || p.inicio_real ? `<div><dt>Inicio real</dt><dd>${p.inicio_real ? fechaHora(p.inicio_real) : 'sin iniciar'}${p.listo_desde ? ` <span class="chico suave">(listo ${fechaHora(p.listo_desde)})</span>` : ''}</dd></div>` : ''}
      <div><dt>Tiempo en proceso</dt><dd>${duracion(p.tiempos.horas_en_proceso)}</dd></div>
      <div><dt>Tiempo detenido</dt><dd>${duracion(p.tiempos.horas_en_pausa)}</dd></div>
    </dl>`;

  pintarLineaDeTiempo(p.eventos);
}

async function actualizar() {
  const proyectos = await api.proyectos();
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
    el('cantidadEventos').textContent = '';
  }

}

export default {
  titulo: 'Historial',
  subtitulo: '',
  async montar(elemento, contexto, parametro) {
    raiz = elemento;
    ctx = contexto;
    elegido = String(parametro || '').toUpperCase();
    raiz.innerHTML = `
      <div class="historial-unico">
        <section class="tarjeta">
          <div class="tarjeta-cabeza"><h2>Historial del proyecto</h2>
            <div style="display:flex;gap:10px;align-items:center;flex:1 1 auto;justify-content:flex-end">
              <select id="proyecto" aria-label="Proyecto" style="max-width:360px"></select>
              ${ayuda('ayudaHistorial', '¿Qué muestra el historial?',
                'Elegí un proyecto para ver sus datos principales y todo lo que pasó, en orden: alta, llegada de materiales, inicio, etapas, pausas (con motivo y duración), cambios de plazo y fin.',
                'Cada registro dice quién lo hizo y cuándo.')}
            </div></div>
          <div class="tarjeta-cuerpo">
            <div id="resumen"></div>
            <div class="tl-cabeza"><h3>Línea de tiempo</h3><span id="cantidadEventos"></span></div>
            <div class="tl" id="linea"></div>
          </div>
        </section>
      </div>`;
    raiz.addEventListener('click', (evento) => {
      if (evento.target.closest('[data-link-cliente]') && detalle) abrirLinkCliente(detalle);
    });
    el('proyecto').addEventListener('change', async () => {
      elegido = el('proyecto').value;
      history.replaceState(null, '', `#historial/${encodeURIComponent(elegido)}`);
      pintarProyecto(await api.proyecto(elegido));
    });
    await actualizar();
  },
  actualizar,
};
