/** Compras: recepción de materiales, hoja de ruta y alertas de falta de material. */
import { api } from '../api.js';
import { hojaDeRutaHTML } from '../hoja-ruta.js';
import { avisar, ayuda, codigoConUrgencia, esc, fecha, fechaHora, icono } from '../util.js';

let raiz;
let ctx;

const el = (id) => raiz.querySelector(`#${id}`);
const urlHoja = (id) => `hoja.html?id=${encodeURIComponent(id)}`;

/** Registra la recepción de los materiales indispensables y muestra la hoja de ruta para imprimir. */
async function emitirHoja(id) {
  await api.recepcion(id, { id_usuario: ctx.usuarioConRol('Compras') });
  avisar(`Recepción registrada. ${id} quedó listo para iniciar.`);
  await actualizar();
  await mostrarHoja(id);
}

/** "Registrar llegada" desde una alerta: se carga en una ventana, sin mover la pantalla. */
async function abrirLlegada(id) {
  const p = await api.proyecto(id);
  const dialogo = ctx.abrirDialogo(`
    <form id="formLlegada" novalidate autocomplete="off">
      <h2>Registrar llegada · <span class="codigo">${esc(p.id)}</span></h2>
      <p class="nota">${esc(p.nombre)}${p.pausa_actual && p.pausa_actual.causa === 'Falta de material' ? ` · faltaba: ${esc(p.pausa_actual.detalle)}` : ''}</p>
      <div class="campo"><label for="llegadaMaterial">Material recibido</label>
        <input id="llegadaMaterial" maxlength="120" placeholder="Ej.: 4 ruedas giratorias"></div>
      <p class="error" id="llegadaError" role="alert"></p>
      <div class="acciones-form">
        <button class="boton" type="submit">Registrar llegada</button>
        <button class="boton secundario" type="button" data-cerrar>Cancelar</button>
      </div>
    </form>`);
  const campo = dialogo.querySelector('#llegadaMaterial');
  campo.focus();
  dialogo.querySelector('#formLlegada').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const error = dialogo.querySelector('#llegadaError');
    error.textContent = '';
    try {
      await api.recepcionParcial(p.id, { id_usuario: ctx.usuarioConRol('Compras'), material: campo.value });
      ctx.cerrarDialogo();
      avisar(`Llegada registrada en ${p.id}. El taller ya puede continuar.`);
      await actualizar();
    } catch (e) {
      error.textContent = e.message;
    }
  });
}

/** La hoja recién emitida se muestra en una ventana encima de la pantalla: la lista no se mueve. */
async function mostrarHoja(id) {
  const proyecto = await api.proyecto(id);
  ctx.abrirDialogo(`
    <div class="dialogo-hoja">
      <div class="cabecera-tarjeta">
        <div><h2>Hoja de ruta emitida</h2><p class="nota">La hoja acompaña a los materiales al taller.</p></div>
        <button type="button" class="cajon-cerrar" data-cerrar aria-label="Cerrar">${icono('cerrar')}</button>
      </div>
      ${hojaDeRutaHTML(proyecto)}
      <div class="acciones-form">
        <a class="boton" href="${urlHoja(id)}" target="_blank" rel="noopener"><span class="ico">${icono('imprimir')}</span>Imprimir</a>
        <button class="boton secundario" type="button" data-cerrar>Cerrar</button>
      </div>
    </div>`);
}

async function actualizar() {
  const [proyectos, alertas] = await Promise.all([api.proyectos(), api.alertas()]);

  const pendientes = proyectos.filter((p) => p.estado === 'pendiente_mat');
  const detalles = await Promise.all(pendientes.map((p) => api.proyecto(p.id)));
  el('pendientes').innerHTML = detalles.length
    ? detalles.map((p) => `
        <tr>
          <td>${codigoConUrgencia(p)}</td>
          <td><strong>${esc(p.nombre)}</strong><div class="chico suave">${esc(p.cliente)} · entrega ${fecha(p.plazo_entrega)}</div></td>
          <td class="chico">${p.materiales.map((m) => esc(m.descripcion)).join('<br>')}</td>
          <td class="celda-acciones"><button class="boton chico" type="button" data-recibir="${esc(p.id)}">Recibido · emitir hoja</button></td>
        </tr>`).join('')
    : '<tr><td colspan="4" class="vacio">No hay proyectos esperando materiales.</td></tr>';

  const enCurso = proyectos.filter((p) => ['listo', 'en_proceso', 'pausado'].includes(p.estado));
  const opciones = enCurso.map((p) => `<option value="${esc(p.id)}">${esc(p.id)} · ${esc(p.nombre)}</option>`).join('');
  for (const id of ['parcialProyecto', 'reimprimirProyecto']) {
    const lista = el(id);
    const elegido = lista.value;
    lista.innerHTML = opciones || '<option value="">No hay proyectos en curso</option>';
    if (enCurso.some((p) => p.id === elegido)) lista.value = elegido;
  }
  el('reimprimirEnlace').href = el('reimprimirProyecto').value ? urlHoja(el('reimprimirProyecto').value) : '#compras';

  const bloques = [];
  for (const p of alertas.falta_material) {
    bloques.push(`<div class="alerta"><strong>${p.urgencia === 'U' ? 'URGENTE · ' : ''}Taller parado · ${esc(p.id)}</strong>
      <p>${esc(p.pausa_actual.detalle)}</p>
      <p class="chico suave">${esc(p.pausa_actual.usuario)} · ${fechaHora(p.pausa_actual.desde)}</p>
      <button class="boton chico" type="button" data-llegada="${esc(p.id)}">Registrar llegada</button></div>`);
  }
  for (const p of alertas.material_recibido) {
    bloques.push(`<div class="alerta resuelta"><strong>Resuelta · ${esc(p.id)}</strong>
      <p>Ya se registró la llegada. Falta que el taller continúe el trabajo.</p></div>`);
  }
  el('alertas').innerHTML = bloques.length ? bloques.join('') : '<p class="vacio">Sin alertas de falta de material.</p>';

}

export default {
  titulo: 'Recepción y hoja de ruta',
  async montar(elemento, contexto, parametro) {
    raiz = elemento;
    ctx = contexto;
    raiz.innerHTML = `
      <div class="rejilla dos">
        <div class="columna">
          <section class="tarjeta">
            <div class="tarjeta-cabeza"><h2>Esperando materiales</h2>
              <div class="ayuda-grafico">
                <button type="button" class="icono-tarjeta" popovertarget="ayudaCompras" aria-label="¿Para qué sirve esta pantalla?" title="¿Para qué sirve esta pantalla?">i</button>
                <div id="ayudaCompras" class="panel-ayuda" popover role="dialog" aria-labelledby="tituloAyudaCompras">
                  <div class="cabecera-ayuda">
                    <h3 id="tituloAyudaCompras">¿Para qué sirve esta pantalla?</h3>
                    <button type="button" class="cerrar-ayuda" popovertarget="ayudaCompras" popovertargetaction="hide" aria-label="Cerrar información">×</button>
                  </div>
                  <p>Compras registra la llegada de los materiales y emite la hoja de ruta que acompaña al trabajo hasta el taller.</p>
                </div>
              </div></div>
            <div class="tarjeta-cuerpo sin-margen"><div class="tabla-caja">
              <table>
                <thead><tr><th>ID</th><th>Trabajo</th><th>Materiales indispensables</th><th></th></tr></thead>
                <tbody id="pendientes"></tbody>
              </table>
            </div></div>
          </section>

          <section class="tarjeta">
            <div class="tarjeta-cabeza"><h2>Recepción parcial</h2>${ayuda('ayudaParcial', '¿Para qué sirve la recepción parcial?',
              'Para registrar material que llega cuando el trabajo ya está en marcha, aunque no haya una alerta (por ejemplo, un segundo envío).',
              'Queda anotado en el Historial del proyecto. Si el trabajo estaba pausado por falta de material, el taller recibe el aviso de que puede continuar.')}</div>
            <div class="tarjeta-cuerpo">
              <form id="formParcial" novalidate autocomplete="off">
                <div class="par">
                  <div class="campo"><label for="parcialProyecto">Proyecto</label><select id="parcialProyecto"></select></div>
                  <div class="campo"><label for="parcialMaterial">Material recibido</label>
                    <input id="parcialMaterial" maxlength="120" placeholder="Ej.: 4 ruedas giratorias"></div>
                </div>
                <p class="error" id="parcialError" role="alert"></p>
                <button class="boton" type="submit">Registrar recepción</button>
              </form>
            </div>
          </section>

          <section class="tarjeta">
            <div class="tarjeta-cabeza"><h2>Reimprimir hoja de ruta</h2>${ayuda('ayudaReimprimir', '¿Cuándo se reimprime?',
              'Si la hoja de ruta de un trabajo en curso se pierde o se rompe, elegí el proyecto y abrila para imprimirla de nuevo.',
              'Es la misma hoja, con el mismo código de barras: el taller la sigue escaneando igual.')}</div>
            <div class="tarjeta-cuerpo">
              <div class="escaner">
                <select id="reimprimirProyecto" aria-label="Proyecto" style="flex:1 1 260px"></select>
                <a class="boton secundario" id="reimprimirEnlace" target="_blank" rel="noopener"><span class="ico">${icono('imprimir')}</span>Abrir hoja</a>
              </div>
            </div>
          </section>
        </div>

        <div class="columna">
          <section class="tarjeta">
            <div class="tarjeta-cabeza"><h2>Alertas de falta de material</h2>${ayuda('ayudaAlertasCompras', '¿Qué son estas alertas?',
              'Trabajos que el taller pausó porque les falta material.',
              'Cuando el material llegue, tocá «Registrar llegada»: queda anotado y el taller recibe el aviso de que puede continuar.')}</div>
            <div class="tarjeta-cuerpo"><div class="lista-alertas" id="alertas"></div></div>
          </section>
        </div>
      </div>`;

    raiz.addEventListener('click', async (evento) => {
      const recibir = evento.target.closest('[data-recibir]');
      if (recibir) {
        recibir.disabled = true;
        try {
          await emitirHoja(recibir.dataset.recibir);
        } catch (e) {
          avisar(e.message, 'mal');
          recibir.disabled = false;
        }
        return;
      }
      const llegada = evento.target.closest('[data-llegada]');
      if (llegada) await abrirLlegada(llegada.dataset.llegada);
    });

    el('reimprimirProyecto').addEventListener('change', () => {
      el('reimprimirEnlace').href = urlHoja(el('reimprimirProyecto').value);
    });

    el('formParcial').addEventListener('submit', async (evento) => {
      evento.preventDefault();
      const error = el('parcialError');
      error.textContent = '';
      const id = el('parcialProyecto').value;
      if (!id) { error.textContent = 'No hay proyectos en curso.'; return; }
      try {
        await api.recepcionParcial(id, {
          id_usuario: ctx.usuarioConRol('Compras'),
          material: el('parcialMaterial').value,
        });
        el('parcialMaterial').value = '';
        avisar(`Recepción registrada en ${id}. El taller ya puede continuar.`);
        await actualizar();
      } catch (e) {
        error.textContent = e.message;
      }
    });

    await actualizar();
    if (parametro) {
      history.replaceState(null, '', '#compras');
      const id = String(parametro).toUpperCase();
      const lista = el('parcialProyecto');
      if ([...lista.options].some((o) => o.value === id)) {
        lista.value = id;
        const formulario = el('formParcial').closest('.tarjeta');
        formulario.classList.add('resaltada');
        formulario.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el('parcialMaterial').focus({ preventScroll: true });
      }
    }
  },
  actualizar,
};
