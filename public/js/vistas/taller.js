/**
 * Puesto de taller (Operario): se escanea la hoja de ruta y se registra
 * el avance con botones grandes. El lector de código de barras funciona
 * como un teclado: escribe el ID y presiona Enter.
 */
import { api } from '../api.js';
import { esc, fecha, icono, pastillaEstado, textoPlazo } from '../util.js';

let raiz;
let ctx;
let actual = null;      // proyecto en pantalla
let pausando = false;   // se está completando el motivo de una pausa
let mensaje = '';

const el = (id) => raiz.querySelector(`#${id}`);
const operario = () => Number(el('operario').value);

function enfocarEscaner() {
  const entrada = el('codigo');
  if (entrada && !pausando) entrada.focus();
}

function pintarFichas(proyectos) {
  el('fichas').innerHTML = proyectos
    .filter((p) => p.estado !== 'finalizado')
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((p) => `<button class="ficha" type="button" data-ficha="${esc(p.id)}">${esc(p.id)}</button>`).join('');
}

function pintarTrabajo() {
  const caja = el('trabajo');
  if (!actual) { caja.innerHTML = ''; return; }
  const p = actual;
  const { etapas, causas } = ctx.catalogo;

  let cuerpo = '';
  if (p.estado === 'pendiente_mat') {
    cuerpo = `<div class="bloqueo"><h3>No se puede iniciar</h3>
      <p>Faltan los materiales indispensables: <strong>${p.materiales.filter((m) => m.indispensable).map((m) => esc(m.descripcion)).join(', ')}</strong>.
      Compras tiene que registrar la recepción y emitir la hoja de ruta.</p></div>`;
  } else if (p.estado === 'finalizado') {
    cuerpo = '<p class="exito">Este trabajo ya está finalizado.</p>';
  } else if (pausando) {
    cuerpo = `
      <form class="bloqueo" id="formPausa" novalidate autocomplete="off">
        <h3>Motivo de la pausa (obligatorio)</h3>
        <div class="campo" style="margin-top:10px"><label for="pausaCausa">Causa</label>
          <select id="pausaCausa"><option value="">Elegí una causa…</option>${causas.map((c) => `<option>${esc(c)}</option>`).join('')}</select></div>
        <div class="campo"><label for="pausaDetalle">Qué pasó</label>
          <textarea id="pausaDetalle" maxlength="300" placeholder="Ej.: faltan las ruedas · torno roto"></textarea></div>
        <p class="error" id="pausaError" role="alert"></p>
        <div class="acciones-form">
          <button class="boton" type="submit">Guardar pausa</button>
          <button class="boton secundario" type="button" id="pausaCancelar">Cancelar</button>
        </div>
      </form>`;
  } else {
    const pausa = p.pausa_actual
      ? `<p class="motivo" style="margin-top:12px;font-size:14.5px">Pausado · ${esc(p.pausa_actual.causa)}: ${esc(p.pausa_actual.detalle)}${p.material_recibido_tras_pausa ? ' — <strong>el material ya llegó</strong>' : ''}</p>`
      : '';
    const boton = (accion, texto, clase, nombreIcono, habilitado) =>
      `<button class="boton-taller ${clase}" type="button" data-accion="${accion}" ${habilitado ? '' : 'disabled'}><span class="ico">${icono(nombreIcono)}</span>${texto}</button>`;
    const selectorEtapas = p.estado === 'en_proceso'
      ? `<p class="seccion-titulo">Etapa actual</p>
         <div class="etapas">${etapas.map((e) => `<button class="etapa" type="button" data-etapa="${esc(e)}" aria-pressed="${p.etapa_actual === e}">${esc(e)}</button>`).join('')}</div>`
      : '';
    cuerpo = `${pausa}
      <div class="botones-taller">
        ${boton('iniciar', 'Iniciar', 'iniciar', 'play', p.estado === 'listo')}
        ${boton('pausar', 'Pausar', 'pausar', 'pausa', p.estado === 'en_proceso')}
        ${boton('continuar', 'Continuar', 'continuar', 'play', p.estado === 'pausado')}
        ${boton('finalizar', 'Finalizar', 'finalizar', 'check', p.estado === 'en_proceso')}
      </div>${selectorEtapas}`;
  }

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
        <span>Entrega <b>${fecha(p.plazo_entrega)}</b>${p.estado === 'finalizado' ? '' : ` · ${textoPlazo(p.dias_restantes)}`}</span>
        ${p.etapa_actual ? `<span>Etapa <b>${esc(p.etapa_actual)}</b></span>` : ''}
        ${p.descripcion ? `<span>${esc(p.descripcion)}</span>` : ''}
      </div>
      ${cuerpo}
      <p class="exito" id="exito" role="status">${esc(mensaje)}</p>
    </section>`;

  if (pausando) {
    el('pausaCausa').focus();
    el('pausaCancelar').addEventListener('click', () => { pausando = false; pintarTrabajo(); enfocarEscaner(); });
    el('formPausa').addEventListener('submit', guardarPausa);
  }
}

async function buscar(id) {
  const codigo = String(id || '').trim().toUpperCase();
  const error = el('codigoError');
  error.textContent = '';
  pausando = false;
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
  if (!actual) return;
  if (accion === 'pausar') { pausando = true; mensaje = ''; pintarTrabajo(); return; }
  const textos = {
    iniciar: 'Trabajo iniciado.',
    continuar: 'Trabajo continuado.',
    finalizar: 'Trabajo finalizado. Ya figura terminado en el panel y en la planilla.',
  };
  try {
    actual = await api[accion](actual.id, { id_usuario: operario() });
    mensaje = textos[accion];
    el('codigoError').textContent = '';
  } catch (e) {
    mensaje = '';
    el('codigoError').textContent = e.message;
    try { actual = await api.proyecto(actual.id); } catch { actual = null; }
  }
  pintarTrabajo();
  enfocarEscaner();
}

async function guardarPausa(evento) {
  evento.preventDefault();
  const error = el('pausaError');
  error.textContent = '';
  const causa = el('pausaCausa').value;
  try {
    actual = await api.pausar(actual.id, { id_usuario: operario(), causa, detalle: el('pausaDetalle').value });
    pausando = false;
    mensaje = causa === 'Falta de material' ? 'Pausa guardada. Se avisó a Compras y a Gerencia.' : 'Pausa guardada.';
    pintarTrabajo();
    enfocarEscaner();
  } catch (e) {
    error.textContent = e.message;
  }
}

async function cambiarEtapa(etapa) {
  try {
    actual = await api.cambiarEtapa(actual.id, { id_usuario: operario(), etapa });
    mensaje = `Etapa actualizada: ${etapa}.`;
  } catch (e) {
    mensaje = '';
    el('codigoError').textContent = e.message;
  }
  pintarTrabajo();
  enfocarEscaner();
}

async function actualizar() {
  pintarFichas(await api.proyectos());
  // Si otra PC cambió el trabajo que está en pantalla, se refresca (salvo que se esté escribiendo un motivo).
  if (actual && !pausando) {
    try {
      const fresco = await api.proyecto(actual.id);
      if (fresco.estado !== actual.estado || fresco.etapa_actual !== actual.etapa_actual
          || fresco.plazo_entrega !== actual.plazo_entrega
          || fresco.material_recibido_tras_pausa !== actual.material_recibido_tras_pausa) {
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
    pausando = false;
    mensaje = '';

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
      const ficha = evento.target.closest('[data-ficha]');
      if (ficha) { buscar(ficha.dataset.ficha); return; }
      const accion = evento.target.closest('[data-accion]');
      if (accion && !accion.disabled) { ejecutar(accion.dataset.accion); return; }
      const etapa = evento.target.closest('[data-etapa]');
      if (etapa && actual) cambiarEtapa(etapa.dataset.etapa);
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
