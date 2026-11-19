/** Panel de Gerencia y Supervisión: semáforo de proyectos y alertas. */
import { api } from '../api.js';
import { campoFecha } from '../calendario.js';
import { avisar, codigoConUrgencia, esc, fecha, fechaDeInstante, fechaHora, pastillaEstado, textoPlazo } from '../util.js';

let raiz;
let ctx;
let resaltado = '';            // ID del proyecto resaltado desde una alerta
let temporizadorResaltado = null;

function filaProyecto(p) {
  const pausa = p.pausa_actual
    ? `<div class="motivo">Pausado · ${esc(p.pausa_actual.causa)}: ${esc(p.pausa_actual.detalle)}</div>`
    : '';
  const plazo = p.estado === 'finalizado'
    ? `<div class="chico suave">finalizado el ${fechaDeInstante(p.fecha_fin)}</div>`
    : `<div class="chico suave">${textoPlazo(p.dias_restantes)}</div>`;
  const reprogramar = p.estado === 'finalizado'
    ? ''
    : `<button class="boton secundario chico" type="button" data-reprogramar="${esc(p.id)}">Reprogramar</button>`;
  return `
    <tr class="fila-${p.semaforo}${p.id === resaltado ? ' fila-resaltada' : ''}" data-id="${esc(p.id)}">
      <td>${codigoConUrgencia(p)}</td>
      <td><strong>${esc(p.nombre)}</strong><div class="chico suave">${esc(p.cliente)}</div>${pausa}</td>
      <td>${pastillaEstado(p)}</td>
      <td>${esc(p.etapa_actual || '—')}</td>
      <td class="num">${fecha(p.plazo_entrega)}${plazo}</td>
      <td class="celda-acciones">
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
  raiz.querySelector('#alertas').innerHTML = bloques.length
    ? bloques.join('')
    : '<p class="vacio">Sin alertas abiertas.</p>';
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
  const cuenta = { rojo: 0, amarillo: 0, verde: 0, fin: 0 };
  proyectos.forEach((p) => { cuenta[p.semaforo] += 1; });
  raiz.querySelector('#indicadores').innerHTML = `
    <div class="tarjeta indicador rojo"><b>${cuenta.rojo}</b><span>Vencidos o parados</span></div>
    <div class="tarjeta indicador amarillo"><b>${cuenta.amarillo}</b><span>Por vencer</span></div>
    <div class="tarjeta indicador verde"><b>${cuenta.verde}</b><span>A tiempo</span></div>
    <div class="tarjeta indicador"><b>${cuenta.fin}</b><span>Finalizados</span></div>`;
  raiz.querySelector('#proyectos').innerHTML = proyectos.length
    ? proyectos.map(filaProyecto).join('')
    : '<tr><td colspan="6" class="vacio">Todavía no hay proyectos. Cargá el primero desde "Alta de proyecto".</td></tr>';
  pintarAlertas(alertas);
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

export default {
  titulo: 'Panel',
  subtitulo: 'Estado de todos los trabajos en tiempo real, ordenados por lo que hay que atender primero.',
  async montar(elemento, contexto) {
    raiz = elemento;
    ctx = contexto;
    resaltado = '';
    raiz.innerHTML = `
      <div class="indicadores" id="indicadores"></div>
      <section class="tarjeta" style="margin-bottom:20px">
        <div class="tarjeta-cabeza"><h2>Alertas</h2></div>
        <div class="tarjeta-cuerpo"><div class="lista-alertas en-fila" id="alertas"></div></div>
      </section>
      <section class="tarjeta">
        <div class="tarjeta-cabeza"><h2>Proyectos</h2>
          <span class="nota">Rojo: plazo vencido o trabajo pausado · Amarillo: faltan ${ctx.catalogo.margen_alerta_dias} días o menos · Verde: a tiempo</span></div>
        <div class="tarjeta-cuerpo sin-margen"><div class="tabla-caja">
          <table>
            <thead><tr><th>ID</th><th>Trabajo</th><th>Estado</th><th>Etapa</th><th>Plazo de entrega</th><th></th></tr></thead>
            <tbody id="proyectos"></tbody>
          </table>
        </div></div>
      </section>`;
    raiz.addEventListener('click', async (evento) => {
      const alerta = evento.target.closest('[data-alerta]');
      const boton = evento.target.closest('[data-reprogramar]');
      try {
        if (alerta) irAlProyecto(alerta.dataset.id);
        else if (boton) abrirReprogramar(boton.dataset.reprogramar, await api.proyectos());
      } catch (e) {
        avisar(e.message, 'mal');
      }
    });
    await actualizar();
  },
  actualizar,
};
