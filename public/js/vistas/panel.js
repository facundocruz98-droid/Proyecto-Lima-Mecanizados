/** Panel de Gerencia y Supervisión: semáforo de proyectos y alertas. */
import { api } from '../api.js';
import { campoFecha } from '../calendario.js';
import { avisar, esc, fecha, fechaDeInstante, fechaHora, pastillaEstado, textoEtapa, textoPlazo } from '../util.js';

let raiz;
let ctx;
let resaltado = '';            // ID del proyecto resaltado desde una alerta
let temporizadorResaltado = null;
let alertasExpandidas = false; // con muchas alertas se ve solo la primera fila hasta tocar "Ver todas"
const ALERTAS_VISIBLES = 4;

function filaProyecto(p) {
  const pausa = p.pausa_actual
    ? `<div class="motivo">${esc(p.pausa_actual.causa)}: ${esc(p.pausa_actual.detalle)}</div>`
    : (p.cancelacion && p.cancelacion.motivo ? `<div class="chico suave">Cancelado · ${esc(p.cancelacion.motivo)}</div>` : '');
  const cerrado = p.estado === 'finalizado' || p.estado === 'cancelado';
  let plazo = `<div class="chico suave">${textoPlazo(p.dias_restantes)}</div>`;
  if (p.estado === 'finalizado') plazo = `<div class="chico suave">finalizado el ${fechaDeInstante(p.fecha_fin)}</div>`;
  if (p.estado === 'cancelado') {
    plazo = `<div class="chico suave">${p.cancelacion && p.cancelacion.fecha ? `cancelado el ${fechaDeInstante(p.cancelacion.fecha)}` : 'cancelado'}</div>`;
  }
  const estimada = cerrado
    ? '<span class="suave">—</span>'
    : `${fecha(p.fecha_estimada)}${p.dias_corrimiento
      ? `<div class="chico corrida">+${p.dias_corrimiento} ${p.dias_corrimiento === 1 ? 'día' : 'días'} por pausas</div>`
      : '<div class="chico suave">sin demoras</div>'}`;
  // Cambiar el plazo o cancelar son decisiones de los dueños: el supervisor no ve los botones.
  const reprogramar = cerrado || ctx.usuario?.rol !== 'Gerencia'
    ? ''
    : `<button class="boton secundario chico" type="button" data-reprogramar="${esc(p.id)}">Reprogramar</button>
       <button class="boton secundario chico boton-peligro" type="button" data-cancelar="${esc(p.id)}">Cancelar proyecto</button>`;
  return `
    <tr class="fila-${p.semaforo}${p.id === resaltado ? ' fila-resaltada' : ''}" data-id="${esc(p.id)}">
      <td class="celda-proyecto">
        <div class="proyecto-titulo"><strong>${esc(p.nombre)}</strong>${p.urgencia === 'U' ? '<span class="urgente" title="Urgente">URGENTE</span>' : ''}</div>
        <div class="chico suave">${esc(p.cliente)} · Pedido <span class="codigo-chico">${esc(p.id)}</span></div>${pausa}
      </td>
      <td>${pastillaEstado(p)}</td>
      <td>${textoEtapa(p)}</td>
      <td class="num">${fecha(p.plazo_entrega)}${plazo}</td>
      <td class="num">${estimada}</td>
      <td class="celda-acciones apiladas">
        <a class="boton secundario chico" href="#historial/${encodeURIComponent(p.id)}">Historial</a>${reprogramar}
      </td>
    </tr>`;
}

/** Una alerta es un botón: al tocarla se va a la fila del proyecto en la tabla. */
function tarjetaAlerta(tipo, clase, titulo, texto, p) {
  return `<button type="button" class="alerta ${clase}" data-alerta="${tipo}" data-id="${esc(p.id)}" title="Ver este proyecto en la tabla">
    <strong>${p.urgencia === 'U' ? 'URGENTE · ' : ''}${titulo} · ${esc(p.id)}</strong>
    <p>${texto}</p>
    <span class="alerta-ir">Ver en la tabla ↓</span></button>`;
}

function pintarAlertas(alertas) {
  const bloques = [
    ...alertas.vencidos.map((p) => tarjetaAlerta('vencido', '', 'Plazo vencido', `${esc(p.nombre)} debía entregarse el ${fecha(p.plazo_entrega)} y sigue ${esc(p.estado_texto.toLowerCase())}.`, p)),
    ...alertas.falta_material.map((p) => tarjetaAlerta('falta_material', '', 'Falta de material', `${esc(p.pausa_actual.detalle)}. Avisado a Compras el ${fechaHora(p.pausa_actual.desde)}.`, p)),
    ...alertas.material_recibido.map((p) => tarjetaAlerta('material_recibido', 'resuelta', 'Material recibido', `${esc(p.nombre)}: ya llegó lo que faltaba. El taller puede continuar.`, p)),
    ...alertas.por_vencer.map((p) => tarjetaAlerta('por_vencer', 'preventiva', 'Por vencer', `${esc(p.nombre)}: ${textoPlazo(p.dias_restantes)} y está ${esc(p.estado_texto.toLowerCase())}.`, p)),
  ];
  const ocultas = bloques.length - ALERTAS_VISIBLES;
  const visibles = alertasExpandidas || ocultas <= 0 ? bloques : bloques.slice(0, ALERTAS_VISIBLES);
  const boton = ocultas > 0
    ? `<button type="button" class="ver-mas-alertas" data-ver-alertas>${alertasExpandidas
      ? 'Mostrar menos ▴'
      : `Ver ${ocultas === 1 ? 'la alerta restante' : `las ${ocultas} alertas restantes`} ▾`}</button>`
    : '';
  raiz.querySelector('#alertas').innerHTML = bloques.length
    ? visibles.join('') + boton
    : '<p class="vacio">Sin alertas abiertas.</p>';
  raiz.querySelector('#cantidadAlertas').textContent = bloques.length ? `(${bloques.length})` : '';
}

/** Baja hasta la fila del proyecto en la tabla y la resalta unos segundos. */
function irAlProyecto(id) {
  const fila = [...raiz.querySelectorAll('#proyectos tr[data-id]')].find((tr) => tr.dataset.id === id);
  if (!fila) return;
  raiz.querySelectorAll('.fila-resaltada').forEach((tr) => tr.classList.remove('fila-resaltada'));
  resaltado = id;
  fila.classList.add('fila-resaltada');
  fila.scrollIntoView({ behavior: 'smooth', block: 'center' });
  clearTimeout(temporizadorResaltado);
  temporizadorResaltado = setTimeout(() => {
    resaltado = '';
    raiz.querySelectorAll('.fila-resaltada').forEach((tr) => tr.classList.remove('fila-resaltada'));
  }, 4000);
}

async function actualizar() {
  const [proyectos, alertas] = await Promise.all([api.proyectos(), api.alertas()]);
  const cuenta = { pausados: 0, amarillo: 0, verde: 0, fin: 0, cancelado: 0 };
  proyectos.forEach((p) => {
    if (p.estado === 'pausado') cuenta.pausados += 1;
    if (p.semaforo !== 'rojo') cuenta[p.semaforo] += 1;
  });
  raiz.querySelector('#indicadores').innerHTML = `
    <div class="tarjeta indicador rojo" title="Proyectos sin finalizar ni cancelar cuyo plazo de entrega ya pasó."><b>${alertas.vencidos.length}</b><span>Vencidos</span></div>
    <div class="tarjeta indicador amarillo" title="Proyectos actualmente en pausa, estén vencidos o no."><b>${cuenta.pausados}</b><span>Pausados</span></div>
    <div class="tarjeta indicador amarillo"><b>${cuenta.amarillo}</b><span>Por vencer</span></div>
    <div class="tarjeta indicador verde"><b>${cuenta.verde}</b><span>A tiempo</span></div>
    <div class="tarjeta indicador"><b>${cuenta.fin}</b><span>Finalizados</span></div>
    <div class="tarjeta indicador"><b>${cuenta.cancelado}</b><span>Cancelados</span></div>`;
  raiz.querySelector('#proyectos').innerHTML = proyectos.length
    ? proyectos.map(filaProyecto).join('')
    : '<tr><td colspan="6" class="vacio">Todavía no hay proyectos. Cargá el primero desde "Alta de proyecto".</td></tr>';
}

function abrirReprogramar(id, proyectos) {
  const p = proyectos.find((x) => x.id === id);
  if (!p) return;
  const dialogo = ctx.abrirDialogo(`
    <form id="formReprogramar" novalidate>
      <h2>Reprogramar plazo · <span class="codigo">${esc(p.id)}</span></h2>
      <p class="nota">${esc(p.nombre)} · plazo actual ${fecha(p.plazo_entrega)}</p>
      <div class="campo"><label for="rpFecha">Nuevo plazo de entrega</label>
        <input type="date" id="rpFecha" value="${esc(p.plazo_entrega)}" min="${esc(ctx.catalogo.hoy)}"></div>
      <div class="campo"><label for="rpMotivo">Motivo del cambio (obligatorio)</label>
        <textarea id="rpMotivo" placeholder="Ej.: las válvulas importadas llegan el jueves"></textarea></div>
      <p class="error" id="rpError" role="alert"></p>
      <div class="acciones-form">
        <button class="boton" type="submit">Guardar nuevo plazo</button>
        <button class="boton secundario" type="button" data-cerrar>Cancelar</button>
      </div>
    </form>`);
  campoFecha(dialogo.querySelector('#rpFecha'), {
    hoy: ctx.catalogo.hoy,
    atajos: [['Hoy', 0], ['+3 días', 3], ['+7 días', 7], ['+15 días', 15], ['+30 días', 30]],
  });
  dialogo.querySelector('#formReprogramar').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const error = dialogo.querySelector('#rpError');
    error.textContent = '';
    try {
      await api.reprogramar(p.id, {
        id_usuario: ctx.usuarioConRol('Gerencia'),
        plazo_entrega: dialogo.querySelector('#rpFecha').value,
        motivo: dialogo.querySelector('#rpMotivo').value,
      });
      ctx.cerrarDialogo();
      avisar(`Plazo de ${p.id} reprogramado.`);
      await actualizar();
    } catch (e) {
      error.textContent = e.message;
    }
  });
}

function abrirCancelar(id, proyectos) {
  const p = proyectos.find((x) => x.id === id);
  if (!p) return;
  const dialogo = ctx.abrirDialogo(`
    <form id="formCancelar" novalidate>
      <h2>Cancelar proyecto · <span class="codigo">${esc(p.id)}</span></h2>
      <p class="nota">${esc(p.nombre)} · ${esc(p.cliente)} · ${esc(p.estado_texto)}</p>
      <div class="aviso-peligro">
        <strong>Esto no se puede deshacer.</strong>
        El proyecto sale del taller, de Compras y de las alertas. No se borra: queda en la planilla y en el
        historial como «Cancelado», con el motivo. El cliente ve en su seguimiento que el pedido fue cancelado.
      </div>
      <div class="campo"><label for="cnMotivo">Motivo de la cancelación (obligatorio)</label>
        <textarea id="cnMotivo" maxlength="300" placeholder="Ej.: el cliente desistió del pedido"></textarea></div>
      <p class="error" id="cnError" role="alert"></p>
      <div class="acciones-form">
        <button class="boton boton-peligro-lleno" type="submit">Cancelar proyecto</button>
        <button class="boton secundario" type="button" data-cerrar>Volver</button>
      </div>
    </form>`);
  const motivo = dialogo.querySelector('#cnMotivo');
  motivo.focus();
  dialogo.querySelector('#formCancelar').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const error = dialogo.querySelector('#cnError');
    error.textContent = '';
    if (motivo.value.trim().length < 5) {
      error.textContent = 'Escribí el motivo de la cancelación.';
      motivo.focus();
      return;
    }
    const boton = dialogo.querySelector('button[type="submit"]');
    boton.disabled = true;
    try {
      await api.cancelar(p.id, { id_usuario: ctx.usuarioConRol('Gerencia'), motivo: motivo.value });
      ctx.cerrarDialogo();
      avisar(`Proyecto ${p.id} cancelado.`);
      await actualizar();
    } catch (e) {
      error.textContent = e.message;
      boton.disabled = false;
    }
  });
}

export default {
  titulo: 'Estado de Trabajos',
  async montar(elemento, contexto, parametro) {
    raiz = elemento;
    ctx = contexto;
    resaltado = '';
    alertasExpandidas = false;
    raiz.innerHTML = `
      <div class="indicadores" id="indicadores"></div>
      <section class="tarjeta">
        <div class="tarjeta-cabeza"><h2>Proyectos</h2>
          <div class="ayuda-grafico">
            <button type="button" class="icono-tarjeta" popovertarget="ayudaSemaforo" aria-label="¿Qué significan los colores?" title="¿Qué significan los colores?">i</button>
            <div id="ayudaSemaforo" class="panel-ayuda" popover role="dialog" aria-labelledby="tituloAyudaSemaforo">
              <div class="cabecera-ayuda">
                <h3 id="tituloAyudaSemaforo">¿Qué significan los colores?</h3>
                <button type="button" class="cerrar-ayuda" popovertarget="ayudaSemaforo" popovertargetaction="hide" aria-label="Cerrar información">×</button>
              </div>
              <p>La franja de color a la izquierda de cada proyecto indica cómo viene respecto a su plazo de entrega.</p>
              <ul class="leyenda-semaforo">
                <li><span class="punto rojo"></span><div><strong>Rojo</strong><span>El plazo ya venció o el trabajo está pausado.</span></div></li>
                <li><span class="punto amarillo"></span><div><strong>Amarillo</strong><span>Faltan ${ctx.catalogo.margen_alerta_dias} días o menos para el plazo.</span></div></li>
                <li><span class="punto verde"></span><div><strong>Verde</strong><span>Va a tiempo.</span></div></li>
              </ul>
            </div>
          </div></div>
        <div class="tarjeta-cuerpo sin-margen"><div class="tabla-caja">
          <table>
            <thead><tr><th>Proyecto</th><th>Estado</th><th>Etapa</th><th>Plazo de entrega</th><th title="Plazo de la empresa más el tiempo que el trabajo estuvo detenido">Entrega estimada</th><th></th></tr></thead>
            <tbody id="proyectos"></tbody>
          </table>
        </div></div>
      </section>`;
    raiz.addEventListener('click', async (evento) => {
      if (evento.target.closest('[data-ver-alertas]')) {
        alertasExpandidas = !alertasExpandidas;
        await actualizar();
        return;
      }
      const alerta = evento.target.closest('[data-alerta]');
      const boton = evento.target.closest('[data-reprogramar]');
      const cancelar = evento.target.closest('[data-cancelar]');
      try {
        if (alerta) irAlProyecto(alerta.dataset.id);
        else if (boton) abrirReprogramar(boton.dataset.reprogramar, await api.proyectos());
        else if (cancelar) abrirCancelar(cancelar.dataset.cancelar, await api.proyectos());
      } catch (e) {
        avisar(e.message, 'mal');
      }
    });
    await actualizar();
    if (parametro) irAlProyecto(parametro);
  },
  actualizar,
  irA: irAlProyecto,
};
