/**
 * Puesto de taller (Operario): se escanea la hoja de ruta y se registra
 * el avance con botones grandes. El lector de código de barras funciona
 * como un teclado: escribe el ID y presiona Enter.
 *
 * Pedidos con plan de fabricación: al tocar "Iniciar" se abre el formulario "Plan de fabricación"
 * (abrirlo no inicia nada); al confirmarlo se guarda el plan y arranca la primera etapa.
 * Después: Completar etapa → Iniciar etapa → … → Finalizar pedido.
 * Los pedidos que ya estaban en curso sin plan siguen con el flujo anterior (etapas fijas).
 */
import { api } from '../api.js';
import { esc, fecha, fechaHora, icono, pastillaEstado, textoPlazo } from '../util.js';

let raiz;
let ctx;
let actual = null;     // proyecto en pantalla
let modo = null;       // null | 'pausa' | 'plan' | 'finalizar'
let mensaje = '';
let enviando = false;  // evita dobles clics mientras el servidor responde
let plan = [];         // etapas del formulario "Plan de fabricación" (todavía sin guardar)
let sugerencias = [];  // catálogo de etapas del taller

const el = (id) => raiz.querySelector(`#${id}`);
const operario = () => Number(el('operario').value);
const igual = (a, b) => a.toLocaleLowerCase('es') === b.toLocaleLowerCase('es');

function enfocarEscaner() {
  const entrada = el('codigo');
  if (entrada && !modo) entrada.focus();
}

function pintarFichas(proyectos) {
  el('fichas').innerHTML = proyectos
    .filter((p) => p.estado !== 'finalizado' && p.estado !== 'cancelado')
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((p) => `<button class="ficha" type="button" data-ficha="${esc(p.id)}">${esc(p.id)}</button>`).join('');
}

// ---------- Formulario "Plan de fabricación" ----------
function formularioPlan() {
  const elegidas = (nombre) => plan.some((e) => igual(e, nombre));
  const bloqueSugerencias = sugerencias.length ? `
      <div class="plan-bloque">
        <p class="plan-rotulo">Etapas sugeridas <span>tocá para agregar o quitar</span></p>
        <div class="plan-sugerencias">
          ${sugerencias.map((nombre) => `<button type="button" class="plan-chip" data-sugerencia="${esc(nombre)}" aria-pressed="${elegidas(nombre)}">
            <span class="ico">${icono(elegidas(nombre) ? 'check' : 'mas')}</span>${esc(nombre)}</button>`).join('')}
        </div>
      </div>` : '';
  const lista = plan.length
    ? `<ol class="plan-lista">${plan.map((nombre, i) => `
        <li data-i="${i}" tabindex="0" title="Arrastrá para cambiar el orden" aria-label="${i + 1}. ${esc(nombre)}. Para moverla, arrastrala o usá Alt y las flechas.">
          <span class="plan-agarre" aria-hidden="true">${icono('agarrar')}</span>
          <span class="plan-num">${i + 1}</span>
          <span class="plan-nombre">${esc(nombre)}</span>
          <button type="button" class="plan-icono quitar" data-quitar="${i}" aria-label="Quitar ${esc(nombre)}" title="Quitar">${icono('cerrar')}</button>
        </li>`).join('')}</ol>`
    : `<p class="plan-vacio">Todavía no hay etapas. ${sugerencias.length ? 'Elegí una sugerida o escribí' : 'Escribí'} la primera.</p>`;
  return `
    <form class="plan" id="formPlan" novalidate autocomplete="off">
      <div class="plan-cabeza">
        <h3>Plan de fabricación</h3>
        <p>Armá las etapas en el orden en que se van a hacer. El tiempo empieza a contar recién al confirmar.</p>
      </div>
      ${bloqueSugerencias}
      <div class="plan-bloque">
        <label class="plan-rotulo" for="planNueva">${sugerencias.length ? 'Otra etapa' : 'Agregar etapa'}</label>
        <div class="plan-agregar">
          <input id="planNueva" maxlength="40" placeholder="Ej.: Corte, Perforado, Soldadura" spellcheck="false">
          <button class="boton secundario" type="button" id="planAgregar"><span class="ico">${icono('mas')}</span>Agregar</button>
        </div>
      </div>
      <div class="plan-bloque">
        <p class="plan-rotulo">Etapas de este pedido <span>${plan.length ? `${plan.length} ${plan.length === 1 ? 'etapa' : 'etapas'} · se hacen en este orden` : ''}</span></p>
        ${lista}
      </div>
      <p class="error" id="planError" role="alert"></p>
      <div class="acciones-form">
        <button class="boton boton-ok" type="submit" id="planConfirmar" ${plan.length && !enviando ? '' : 'disabled'}>
          <span class="ico">${icono('play')}</span>Guardar e iniciar fabricación</button>
        <button class="boton secundario" type="button" id="planCancelar">Cancelar</button>
      </div>
    </form>`;
}

/** Vuelve a dibujar solo el formulario, manteniendo lo escrito y el foco en el campo. */
function repintarPlan({ enfocar = false } = {}) {
  const viejo = el('formPlan');
  if (!viejo) return;
  const escrito = el('planNueva').value;
  const conFoco = document.activeElement === el('planNueva');
  viejo.outerHTML = formularioPlan();
  el('planNueva').value = escrito;
  conectarPlan();
  if (enfocar || conFoco) el('planNueva').focus();
}

function agregarEtapa(nombre) {
  const limpio = String(nombre || '').trim().replace(/\s+/g, ' ');
  const error = el('planError');
  if (!limpio) { error.textContent = 'Escribí el nombre de la etapa.'; return false; }
  if (limpio.length > 40) { error.textContent = 'El nombre de la etapa puede tener hasta 40 letras.'; return false; }
  if (plan.some((e) => igual(e, limpio))) { error.textContent = `"${limpio}" ya está en el plan.`; return false; }
  if (plan.length >= 20) { error.textContent = 'El plan puede tener hasta 20 etapas.'; return false; }
  // Si coincide con una sugerida, se usa como está escrita en el catálogo.
  plan.push(sugerencias.find((s) => igual(s, limpio)) || limpio);
  return true;
}

function conectarPlan() {
  const form = el('formPlan');
  const entrada = el('planNueva');
  const agregarEscrita = () => {
    if (agregarEtapa(entrada.value)) { entrada.value = ''; repintarPlan({ enfocar: true }); }
  };
  entrada.addEventListener('keydown', (evento) => {
    if (evento.key === 'Enter') { evento.preventDefault(); agregarEscrita(); }
  });
  entrada.addEventListener('input', () => { el('planError').textContent = ''; });
  el('planAgregar').addEventListener('click', agregarEscrita);
  el('planCancelar').addEventListener('click', () => { modo = null; plan = []; pintarTrabajo(); enfocarEscaner(); });
  form.addEventListener('click', (evento) => {
    const boton = evento.target.closest('button');
    if (!boton || boton.disabled) return;
    const { sugerencia, quitar } = boton.dataset;
    if (sugerencia !== undefined) {
      const i = plan.findIndex((e) => igual(e, sugerencia));
      if (i >= 0) plan.splice(i, 1); else agregarEtapa(sugerencia);
    } else if (quitar !== undefined) {
      plan.splice(Number(quitar), 1);
    } else {
      return;
    }
    repintarPlan();
  });
  conectarArrastre(form);
  form.addEventListener('submit', confirmarPlan);
}

/**
 * Cambiar el orden arrastrando cada etapa con el mouse (o el dedo) y soltándola donde se quiera.
 * Con el teclado: Alt + flecha arriba/abajo sobre la etapa seleccionada.
 */
function conectarArrastre(form) {
  const lista = form.querySelector('.plan-lista');
  if (!lista) return;
  const guardarOrden = (enfocar) => {
    const anterior = [...plan];
    plan = [...lista.children].map((li) => anterior[Number(li.dataset.i)]);
    repintarPlan();
    if (enfocar !== undefined) el('formPlan').querySelectorAll('.plan-lista li')[enfocar]?.focus();
  };

  // Arrastre "profesional": la etapa agarrada sigue al puntero, las demás se corren con animación
  // para hacerle lugar y, al soltar, se desliza hasta su lugar. Arranca después de mover unos píxeles.
  lista.addEventListener('pointerdown', (evento) => {
    const fila = evento.target.closest('li');
    if (!fila || evento.target.closest('button') || evento.button !== 0 || lista.classList.contains('soltando')) return;
    evento.preventDefault();
    fila.focus({ preventScroll: true });
    const puntero = evento.pointerId;
    const filas = [...lista.children];
    const desde = filas.indexOf(fila);
    const cajas = filas.map((f) => f.getBoundingClientRect());
    const separacion = cajas.length > 1 ? cajas[1].top - cajas[0].bottom : 0;
    const paso = cajas[desde].height + separacion; // lo que se corren las demás para hacerle lugar
    const yInicial = evento.clientY;
    const minimo = cajas[0].top - cajas[desde].top;
    const maximo = cajas[cajas.length - 1].bottom - cajas[desde].bottom;
    let arrastrando = false;
    let hasta = desde;

    const desplazamientoFinal = () => {
      let d = 0;
      if (hasta > desde) for (let k = desde + 1; k <= hasta; k += 1) d += cajas[k].height + separacion;
      if (hasta < desde) for (let k = hasta; k < desde; k += 1) d -= cajas[k].height + separacion;
      return d;
    };
    const pintarLugares = () => {
      filas.forEach((f, k) => {
        if (f === fila) return;
        let d = 0;
        if (desde < hasta && k > desde && k <= hasta) d = -paso;
        if (hasta < desde && k >= hasta && k < desde) d = paso;
        f.style.transform = d ? `translateY(${d}px)` : '';
      });
      // Numeración en vivo según el lugar donde caería cada etapa.
      const orden = filas.filter((f) => f !== fila);
      orden.splice(hasta, 0, fila);
      orden.forEach((f, k) => { f.querySelector('.plan-num').textContent = k + 1; });
    };

    const mover = (e) => {
      if (e.pointerId !== puntero) return;
      const dy = Math.min(maximo, Math.max(minimo, e.clientY - yInicial));
      if (!arrastrando) {
        if (Math.abs(e.clientY - yInicial) < 4) return;
        arrastrando = true;
        lista.classList.add('ordenando');
        fila.classList.add('arrastrando');
      }
      fila.style.transform = `translateY(${dy}px) scale(1.02)`;
      // Nuevo lugar (como en las listas de hoy): al bajar, pasa a una etapa cuando su borde de abajo cruza
      // la mitad de esa etapa; al subir, cuando su borde de arriba la cruza.
      const arriba = cajas[desde].top + dy;
      const abajo = cajas[desde].bottom + dy;
      hasta = cajas.reduce((n, c, k) => {
        if (k === desde) return n;
        const mitad = c.top + c.height / 2;
        return (k < desde ? arriba > mitad : abajo > mitad) ? n + 1 : n;
      }, 0);
      pintarLugares();
    };

    const terminar = () => {
      lista.classList.remove('ordenando', 'soltando');
      filas.forEach((f) => { f.style.transform = ''; f.classList.remove('arrastrando', 'aterrizando'); });
      if (hasta !== desde) {
        const anterior = [...plan];
        const nuevo = anterior.filter((_, k) => k !== desde);
        nuevo.splice(hasta, 0, anterior[desde]);
        plan = nuevo;
        repintarPlan();
        el('formPlan').querySelectorAll('.plan-lista li')[hasta]?.focus({ preventScroll: true });
      }
    };

    const soltar = (e) => {
      if (e.pointerId !== puntero) return;
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', soltar);
      window.removeEventListener('pointercancel', soltar);
      if (!arrastrando) return;
      // Se desliza hasta su lugar y recién ahí se guarda el orden (sin saltos).
      lista.classList.add('soltando');
      fila.classList.add('aterrizando');
      fila.style.transform = `translateY(${desplazamientoFinal()}px)`;
      let listo = false;
      const cerrar = () => { if (!listo) { listo = true; terminar(); } };
      fila.addEventListener('transitionend', cerrar, { once: true });
      setTimeout(cerrar, 260); // por si el navegador no anima (ej. movimiento reducido)
    };

    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
    window.addEventListener('pointercancel', soltar);
  });

  lista.addEventListener('keydown', (evento) => {
    const fila = evento.target.closest('li');
    if (!fila || evento.target !== fila || !evento.altKey || !['ArrowUp', 'ArrowDown'].includes(evento.key)) return;
    evento.preventDefault();
    const filas = [...lista.children];
    const i = filas.indexOf(fila);
    const j = evento.key === 'ArrowUp' ? i - 1 : i + 1;
    if (j < 0 || j >= filas.length) return;
    lista.insertBefore(fila, evento.key === 'ArrowUp' ? filas[j] : filas[j].nextElementSibling);
    guardarOrden(j);
  });
}

async function abrirPlan() {
  plan = [];
  try { sugerencias = await api.catalogoEtapas(); } catch { sugerencias = []; }
  modo = 'plan';
  mensaje = '';
  pintarTrabajo();
  el('planNueva').focus();
}

async function confirmarPlan(evento) {
  evento.preventDefault();
  if (enviando) return;
  const error = el('planError');
  error.textContent = '';
  if (!plan.length) { error.textContent = 'Agregá al menos una etapa.'; return; }
  enviando = true;
  el('planConfirmar').disabled = true;
  let iniciado = null;
  try {
    iniciado = await api.iniciar(actual.id, { id_usuario: operario(), plan: [...plan] });
  } catch (e) {
    error.textContent = e.message;
  }
  enviando = false;
  if (!iniciado) { el('planConfirmar').disabled = false; return; }
  actual = iniciado;
  modo = null;
  plan = [];
  mensaje = `Fabricación iniciada · Etapa 1: ${actual.plan[0].nombre}.`;
  pintarTrabajo();
  enfocarEscaner();
}

// ---------- Avance del pedido ----------
const TEXTO_ESTADO_ETAPA = { completada: 'completada', en_curso: 'en curso', lista: 'por iniciar', pendiente: 'pendiente' };

function avancePlan(p) {
  const foco = p.plan.find((e) => e.estado === 'en_curso') || p.plan.find((e) => e.estado === 'lista');
  let titulo;
  let detalle;
  if (p.estado === 'finalizado') {
    titulo = `${p.total_etapas} de ${p.total_etapas} etapas completadas`;
    detalle = 'Pedido finalizado';
  } else if (p.todas_completadas) {
    titulo = `${p.total_etapas} de ${p.total_etapas} etapas completadas`;
    detalle = 'Listo para finalizar el pedido';
  } else {
    titulo = `Etapa ${foco.orden} de ${p.total_etapas} · ${esc(foco.nombre)}`;
    detalle = p.estado === 'pausado' ? 'en pausa' : TEXTO_ESTADO_ETAPA[foco.estado];
  }
  return `
    <div class="avance ${p.estado === 'pausado' ? 'pausado' : ''}">
      <div class="avance-cabeza"><strong>${titulo}</strong><span class="avance-estado">${detalle}</span></div>
      <ol class="avance-pasos">
        ${p.plan.map((e) => `
          <li class="${e.estado}${p.estado === 'pausado' && e === foco ? ' detenida' : ''}" title="${esc(e.nombre)} · ${TEXTO_ESTADO_ETAPA[e.estado]}">
            <span class="avance-marca">${e.estado === 'completada' ? icono('check') : e.orden}</span>
            <span class="avance-nombre">${esc(e.nombre)}</span>
            <span class="avance-hora">${e.fin ? `fin ${fechaHora(e.fin)}` : e.inicio ? `inicio ${fechaHora(e.inicio)}` : ''}</span>
          </li>`).join('')}
      </ol>
    </div>`;
}

const boton = (accion, texto, clase, nombreIcono, habilitado) =>
  `<button class="boton-taller ${clase}" type="button" data-accion="${accion}" ${habilitado && !enviando ? '' : 'disabled'}><span class="ico">${icono(nombreIcono)}</span>${texto}</button>`;

function cuerpoTrabajo(p) {
  if (p.estado === 'pendiente_mat') {
    return `<div class="bloqueo"><h3>No se puede iniciar</h3>
      <p>Faltan los materiales indispensables: <strong>${p.materiales.filter((m) => m.indispensable).map((m) => esc(m.descripcion)).join(', ')}</strong>.
      Compras tiene que registrar la recepción y emitir la hoja de ruta.</p></div>`;
  }
  if (p.estado === 'cancelado') {
    return '<div class="bloqueo"><h3>Proyecto cancelado</h3><p>Este proyecto fue cancelado: no hay que trabajar en él.</p></div>';
  }
  if (modo === 'plan') return formularioPlan();
  if (modo === 'pausa') {
    const etapa = p.tiene_plan ? (p.plan.find((e) => e.estado === 'en_curso') || p.plan.find((e) => e.estado === 'lista')) : null;
    return `
      <form class="bloqueo" id="formPausa" novalidate autocomplete="off">
        <h3>Motivo de la pausa (obligatorio)${etapa ? ` · etapa ${esc(etapa.nombre)}` : ''}</h3>
        <div class="campo" style="margin-top:10px"><label for="pausaCausa">Causa</label>
          <select id="pausaCausa"><option value="">Elegí una causa…</option>${ctx.catalogo.causas.map((c) => `<option>${esc(c)}</option>`).join('')}</select></div>
        <div class="campo"><label for="pausaDetalle">Qué pasó</label>
          <textarea id="pausaDetalle" maxlength="300" placeholder="Ej.: faltan las ruedas · torno roto"></textarea></div>
        <p class="error" id="pausaError" role="alert"></p>
        <div class="acciones-form">
          <button class="boton" type="submit">Guardar pausa</button>
          <button class="boton secundario" type="button" id="pausaCancelar">Cancelar</button>
        </div>
      </form>`;
  }

  const pausa = p.pausa_actual
    ? `<p class="motivo" style="margin-top:12px;font-size:14.5px">Pausado · ${esc(p.pausa_actual.causa)}: ${esc(p.pausa_actual.detalle)}${p.material_recibido_tras_pausa ? ' — <strong>el material ya llegó</strong>' : ''}</p>`
    : '';

  // Pedido con plan de fabricación
  if (p.tiene_plan) {
    const proxima = p.plan.find((e) => e.estado === 'lista');
    const confirmar = modo === 'finalizar' ? `
      <div class="confirmar">
        <p><strong>¿Finalizar el pedido?</strong> Se completaron las ${p.total_etapas} etapas. Se registra la fecha y hora de finalización.</p>
        <div class="acciones-form">
          <button class="boton" type="button" data-accion="confirmar-finalizar" ${enviando ? 'disabled' : ''}>Sí, finalizar pedido</button>
          <button class="boton secundario" type="button" data-accion="cancelar-finalizar">Cancelar</button>
        </div>
      </div>` : '';
    if (p.estado === 'finalizado') return `${avancePlan(p)}<p class="exito">Este pedido ya está finalizado.</p>`;
    return `${avancePlan(p)}${pausa}
      <div class="botones-taller cinco">
        ${boton('iniciar-etapa', proxima ? `Iniciar etapa<small>${esc(proxima.nombre)}</small>` : 'Iniciar etapa', 'iniciar', 'play', p.estado === 'en_proceso' && !p.etapa_en_curso && Boolean(proxima))}
        ${boton('pausar', 'Pausar', 'pausar', 'pausa', p.estado === 'en_proceso')}
        ${boton('continuar', 'Continuar', 'continuar', 'play', p.estado === 'pausado')}
        ${boton('completar-etapa', 'Completar etapa', 'completar', 'check', p.estado === 'en_proceso' && p.etapa_en_curso)}
        ${boton('finalizar', 'Finalizar pedido', 'finalizar', 'bandera', p.estado === 'en_proceso' && p.todas_completadas && modo !== 'finalizar')}
      </div>${confirmar}`;
  }

  // Pedido sin plan: listo para iniciar (abre el plan) o pedido anterior con el flujo de etapas fijas
  if (p.estado === 'finalizado') return '<p class="exito">Este trabajo ya está finalizado.</p>';
  const listo = p.estado === 'listo' && p.listo_desde
    ? `<p class="nota" style="margin-top:14px">Materiales confirmados el ${fechaHora(p.listo_desde)}. Al tocar <strong>Iniciar</strong> se arma el plan de fabricación.</p>`
    : '';
  return `${listo}${pausa}
    <div class="botones-taller">
      ${boton('iniciar', 'Iniciar', 'iniciar', 'play', p.estado === 'listo')}
      ${boton('pausar', 'Pausar', 'pausar', 'pausa', p.estado === 'en_proceso')}
      ${boton('continuar', 'Continuar', 'continuar', 'play', p.estado === 'pausado')}
      ${boton('finalizar', 'Finalizar', 'finalizar', 'check', p.estado === 'en_proceso')}
    </div>`;
}

function pintarTrabajo() {
  const caja = el('trabajo');
  if (!actual) { caja.innerHTML = ''; return; }
  const p = actual;
  const etapaDato = p.tiene_plan
    ? ''
    : (p.etapa_actual ? `<span>Etapa <b>${esc(p.etapa_actual)}</b></span>` : '');
  caja.innerHTML = `
    <section class="trabajo ${esc(p.semaforo)}">
      <div class="trabajo-cabeza">
        <div>
          <span class="codigo">${esc(p.id)}</span>${p.urgencia === 'U' ? '<span class="urgente">URGENTE</span>' : ''}
          <h2>${esc(p.nombre)}</h2>
        </div>
        ${pastillaEstado(p)}
      </div>
      <div class="trabajo-datos">
        <span>${esc(p.cliente)}</span>
        <span>Entrega <b>${fecha(p.plazo_entrega)}</b>${p.estado === 'finalizado' || p.estado === 'cancelado' ? '' : ` · ${textoPlazo(p.dias_restantes)}`}</span>
        ${etapaDato}
        ${p.descripcion ? `<span>${esc(p.descripcion)}</span>` : ''}
      </div>
      ${cuerpoTrabajo(p)}
      <p class="exito" id="exito" role="status">${esc(mensaje)}</p>
    </section>`;

  if (modo === 'pausa' && el('formPausa')) {
    el('pausaCausa').focus();
    el('pausaCancelar').addEventListener('click', () => { modo = null; pintarTrabajo(); enfocarEscaner(); });
    el('formPausa').addEventListener('submit', guardarPausa);
  }
  if (modo === 'plan' && el('formPlan')) conectarPlan();
}

async function buscar(id) {
  const codigo = String(id || '').trim().toUpperCase();
  const error = el('codigoError');
  error.textContent = '';
  modo = null;
  plan = [];
  mensaje = '';
  if (!codigo) { error.textContent = 'Escaneá o escribí el código de la hoja de ruta.'; return; }
  try {
    actual = await api.proyecto(codigo);
  } catch (e) {
    actual = null;
    error.textContent = e.message;
  }
  el('codigo').value = '';
  pintarTrabajo();
  enfocarEscaner();
}

async function ejecutar(accion) {
  if (!actual || enviando) return;
  if (accion === 'pausar') { modo = 'pausa'; mensaje = ''; pintarTrabajo(); return; }
  // Pedido sin plan listo para empezar: "Iniciar" abre el plan (no inicia nada todavía).
  if (accion === 'iniciar' && !actual.tiene_plan) { await abrirPlan(); return; }
  if (accion === 'finalizar' && actual.tiene_plan) { modo = 'finalizar'; mensaje = ''; pintarTrabajo(); return; }
  if (accion === 'cancelar-finalizar') { modo = null; pintarTrabajo(); enfocarEscaner(); return; }

  const llamadas = {
    continuar: () => api.continuar(actual.id, { id_usuario: operario() }),
    finalizar: () => api.finalizar(actual.id, { id_usuario: operario() }),
    'confirmar-finalizar': () => api.finalizar(actual.id, { id_usuario: operario() }),
    'completar-etapa': () => api.completarEtapa(actual.id, { id_usuario: operario(), etapa: actual.plan.find((e) => e.estado === 'en_curso')?.nombre }),
    'iniciar-etapa': () => api.iniciarEtapa(actual.id, { id_usuario: operario(), etapa: actual.plan.find((e) => e.estado === 'lista')?.nombre }),
  };
  if (!llamadas[accion]) return;
  const antes = actual;
  enviando = true;
  pintarTrabajo();
  try {
    actual = await llamadas[accion]();
    modo = null;
    el('codigoError').textContent = '';
    if (accion === 'continuar') mensaje = actual.tiene_plan ? `Trabajo continuado · ${actual.etapa_actual}.` : 'Trabajo continuado.';
    else if (accion === 'completar-etapa') {
      const terminada = antes.plan.find((e) => e.estado === 'en_curso')?.nombre;
      mensaje = actual.todas_completadas
        ? `Etapa "${terminada}" completada. Ya se puede finalizar el pedido.`
        : `Etapa "${terminada}" completada. Cuando arranques, tocá "Iniciar etapa".`;
    } else if (accion === 'iniciar-etapa') mensaje = `Etapa ${actual.etapa_numero} de ${actual.total_etapas} iniciada: ${actual.etapa_actual}.`;
    else mensaje = 'Pedido finalizado. Ya figura terminado en el panel y en la planilla.';
  } catch (e) {
    mensaje = '';
    el('codigoError').textContent = e.message;
    try { actual = await api.proyecto(antes.id); } catch { actual = null; }
  } finally {
    enviando = false;
  }
  pintarTrabajo();
  enfocarEscaner();
}

async function guardarPausa(evento) {
  evento.preventDefault();
  if (enviando) return;
  const error = el('pausaError');
  error.textContent = '';
  const causa = el('pausaCausa').value;
  enviando = true;
  let pausado = null;
  try {
    pausado = await api.pausar(actual.id, { id_usuario: operario(), causa, detalle: el('pausaDetalle').value });
  } catch (e) {
    error.textContent = e.message;
  }
  enviando = false;
  if (!pausado) return;
  actual = pausado;
  modo = null;
  mensaje = causa === 'Falta de material' ? 'Pausa guardada. Se avisó a Compras y a Gerencia.' : 'Pausa guardada.';
  pintarTrabajo();
  enfocarEscaner();
}

/** Lo que importa para saber si otra PC cambió el pedido que está en pantalla. */
const firma = (p) => JSON.stringify([p.estado, p.etapa_actual, p.plazo_entrega, p.material_recibido_tras_pausa,
  p.plan.map((e) => e.estado)]);

async function actualizar() {
  pintarFichas(await api.proyectos());
  // Si otra PC cambió el trabajo que está en pantalla, se refresca (salvo que se esté completando un formulario).
  if (actual && !modo && !enviando) {
    try {
      const fresco = await api.proyecto(actual.id);
      if (firma(fresco) !== firma(actual)) {
        actual = fresco;
        mensaje = '';
        pintarTrabajo();
      }
    } catch {
      actual = null;
      pintarTrabajo();
    }
  }
}

export default {
  titulo: 'Puesto de taller',
  subtitulo: 'Escaneá la hoja de ruta y registrá el avance del trabajo.',
  async montar(elemento, contexto, parametro) {
    raiz = elemento;
    ctx = contexto;
    actual = null;
    modo = null;
    plan = [];
    mensaje = '';
    enviando = false;

    const personal = ctx.catalogo.usuarios.filter((u) => u.rol === 'Operario' || u.rol === 'Supervisor');
    raiz.innerHTML = `
      <section class="tarjeta">
        <div class="tarjeta-cuerpo">
          <form class="escaner" id="formCodigo" novalidate autocomplete="off">
            <div class="escaner-entrada">
              <span class="ico">${icono('escaner')}</span>
              <input id="codigo" placeholder="0000-ABC-E-01" aria-label="Código de la hoja de ruta" maxlength="20" spellcheck="false">
            </div>
            <select id="operario" aria-label="Quién registra">
              ${personal.map((u) => `<option value="${u.id}">${esc(u.nombre)}</option>`).join('')}
            </select>
            <button class="boton" type="submit">Buscar</button>
          </form>
          <p class="nota" style="margin-top:10px">El lector escribe el código y presiona Enter solo. Para probar sin lector, tocá un código:</p>
          <div class="fichas" id="fichas"></div>
          <p class="error" id="codigoError" role="alert" style="margin:12px 0 0"></p>
          <div id="trabajo"></div>
        </div>
      </section>`;

    try {
      const guardado = localStorage.getItem('lima-operario');
      if (guardado && personal.some((u) => String(u.id) === guardado)) el('operario').value = guardado;
    } catch { /* sin almacenamiento */ }
    el('operario').addEventListener('change', () => {
      try { localStorage.setItem('lima-operario', el('operario').value); } catch { /* sin almacenamiento */ }
      enfocarEscaner();
    });

    el('formCodigo').addEventListener('submit', (evento) => { evento.preventDefault(); buscar(el('codigo').value); });
    raiz.addEventListener('click', (evento) => {
      if (evento.target.closest('#formPlan')) return; // el formulario del plan maneja sus propios botones
      const ficha = evento.target.closest('[data-ficha]');
      if (ficha) { buscar(ficha.dataset.ficha); return; }
      const accion = evento.target.closest('[data-accion]');
      if (accion && !accion.disabled) ejecutar(accion.dataset.accion);
    });

    await actualizar();
    if (parametro) {
      history.replaceState(null, '', '#taller');
      await buscar(parametro);
    } else {
      enfocarEscaner();
    }
  },
  actualizar,
};
