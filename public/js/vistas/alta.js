/** Alta de proyecto (Gerencia): los mismos datos que la planilla de la empresa. */
import { api } from '../api.js';
import { campoFecha } from '../calendario.js';
import { avisar, esc } from '../util.js';

let raiz;
let ctx;
let siguienteNumero = 1;

const campo = (id) => raiz.querySelector(`#${id}`);

function sumarDias(hoy, dias) {
  const [a, m, d] = hoy.split('-').map(Number);
  const f = new Date(a, m - 1, d + dias);
  const dos = (n) => String(n).padStart(2, '0');
  return `${f.getFullYear()}-${dos(f.getMonth() + 1)}-${dos(f.getDate())}`;
}

/** Muestra el ID que se va a generar, a medida que se completa el formulario. */
function pintarVistaPrevia() {
  const codigo = campo('aCodigo').value.trim().toUpperCase();
  const urgencia = campo('aUrgencia').value;
  const propio = campo('aId').value.trim().toUpperCase();
  const destino = campo('aVistaPrevia');
  if (propio) {
    destino.innerHTML = `<span>Se va a usar el ID cargado</span><span class="codigo">${esc(propio)}</span>`;
  } else if (/^[A-Z]{3}$/.test(codigo)) {
    const id = `${String(siguienteNumero).padStart(4, '0')}-${codigo}-${urgencia}-01`;
    destino.innerHTML = `<span>ID que se va a generar</span><span class="codigo">${esc(id)}</span>`;
  } else {
    destino.innerHTML = '<span>El ID se genera solo: número de orden, código de cliente, urgencia e ítem.</span>';
  }
}

function pintarClientes() {
  campo('aClientes').innerHTML = ctx.catalogo.clientes
    .map((c) => `<option value="${esc(c.nombre)}"></option>`).join('');
}

async function actualizar() {
  const proyectos = await api.proyectos();
  siguienteNumero = proyectos.reduce((maximo, p) => Math.max(maximo, p.numero), 0) + 1;
  pintarClientes();
  pintarVistaPrevia();
}

function reiniciarFormulario() {
  campo('formAlta').reset();
  campo('aIngreso').value = ctx.catalogo.hoy;
  campo('aPlazo').value = sumarDias(ctx.catalogo.hoy, 14);
}

export default {
  titulo: 'Alta de proyecto',
  subtitulo: 'Gerencia carga el trabajo y su plazo de entrega. Ese plazo es la referencia de todas las alertas.',
  async montar(elemento, contexto) {
    raiz = elemento;
    ctx = contexto;
    raiz.innerHTML = `
      <div class="rejilla dos">
        <section class="tarjeta">
          <div class="tarjeta-cabeza"><h2>Nuevo proyecto</h2></div>
          <div class="tarjeta-cuerpo">
            <form id="formAlta" novalidate autocomplete="off">
              <div class="par">
                <div class="campo"><label for="aCliente">Cliente</label>
                  <input id="aCliente" list="aClientes" maxlength="80" placeholder="Ej.: Minera Puna">
                  <datalist id="aClientes"></datalist></div>
                <div class="campo"><label for="aCodigo">Código de cliente</label>
                  <input id="aCodigo" class="mono mayus" maxlength="3" placeholder="MPU">
                  <small>3 letras. Forma parte del ID.</small></div>
              </div>
              <div class="campo"><label for="aNombre">Nombre del proyecto</label>
                <input id="aNombre" maxlength="120" placeholder="Ej.: Tanque de acero inoxidable 2000 L"></div>
              <div class="campo"><label for="aDescripcion">Descripción</label>
                <input id="aDescripcion" maxlength="300" placeholder="Ej.: Fabricar, pintar, montar"></div>
              <div class="par">
                <div class="campo"><label for="aPresupuesto">Nro. de presupuesto</label>
                  <input id="aPresupuesto" maxlength="40" placeholder="PP - 101060 - MPU"></div>
                <div class="campo"><label for="aUrgencia">Urgencia</label>
                  <select id="aUrgencia"><option value="E">E · Estándar</option><option value="U">U · Urgente</option></select></div>
              </div>
              <div class="par">
                <div class="campo"><label for="aIngreso">Fecha de ingreso</label><input type="date" id="aIngreso"></div>
                <div class="campo"><label for="aPlazo">Plazo de entrega</label><input type="date" id="aPlazo"></div>
              </div>
              <div class="campo"><label for="aMateriales">Materiales indispensables para iniciar</label>
                <textarea id="aMateriales" placeholder="Uno por línea&#10;Chapa inox 3 mm&#10;Válvula esférica 2&quot;"></textarea>
                <small>El taller no puede iniciar el trabajo hasta que Compras registre su recepción.</small></div>
              <div class="campo"><label for="aId">ID existente (opcional)</label>
                <input id="aId" class="mono mayus" maxlength="13" placeholder="Dejar vacío para generarlo">
                <small>Para otra parte de un pedido ya cargado, usá el ítem siguiente. Ej.: 0643-MPU-U-02</small></div>
              <label class="casilla"><input type="checkbox" id="aAprobado" checked> Presupuesto aprobado por el cliente</label>
              <div class="vista-previa-id" id="aVistaPrevia"></div>
              <p class="error" id="aError" role="alert"></p>
              <div class="acciones-form">
                <button class="boton" type="submit">Dar de alta</button>
                <button class="boton secundario" type="button" id="aLimpiar">Limpiar</button>
              </div>
            </form>
          </div>
        </section>
        <section class="tarjeta">
          <div class="tarjeta-cabeza"><h2>Qué pasa después</h2></div>
          <div class="tarjeta-cuerpo">
            <ol class="pasos">
              <li><span>El proyecto queda <strong>Pendiente de materiales</strong> y aparece en la pantalla de Compras.</span></li>
              <li><span>Compras registra la recepción e imprime la <strong>hoja de ruta</strong> con el ID en código de barras.</span></li>
              <li><span>El taller escanea la hoja para <strong>iniciar, pausar, continuar y finalizar</strong>.</span></li>
              <li><span>El panel calcula el semáforo contra el plazo que cargaste acá. Los urgentes van primero.</span></li>
            </ol>
          </div>
        </section>
      </div>`;

    campoFecha(campo('aIngreso'), { hoy: ctx.catalogo.hoy, atajos: [['Hoy', 0], ['Ayer', -1], ['Hace 7 días', -7]] });
    campo('aPlazo').setAttribute('min', ctx.catalogo.hoy);
    campoFecha(campo('aPlazo'), { hoy: ctx.catalogo.hoy, atajos: [['+7 días', 7], ['+15 días', 15], ['+30 días', 30], ['+60 días', 60]] });
    reiniciarFormulario();

    // Si el cliente ya existe, completa su código.
    campo('aCliente').addEventListener('input', () => {
      const conocido = ctx.catalogo.clientes.find((c) => c.nombre === campo('aCliente').value.trim());
      if (conocido) campo('aCodigo').value = conocido.codigo;
      pintarVistaPrevia();
    });
    ['aCodigo', 'aUrgencia', 'aId'].forEach((id) => campo(id).addEventListener('input', pintarVistaPrevia));
    campo('aLimpiar').addEventListener('click', () => {
      campoFecha(campo('aIngreso'), { hoy: ctx.catalogo.hoy, atajos: [['Hoy', 0], ['Ayer', -1], ['Hace 7 días', -7]] });
    campo('aPlazo').setAttribute('min', ctx.catalogo.hoy);
    campoFecha(campo('aPlazo'), { hoy: ctx.catalogo.hoy, atajos: [['+7 días', 7], ['+15 días', 15], ['+30 días', 30], ['+60 días', 60]] });
    reiniciarFormulario();
      campo('aError').textContent = '';
      pintarVistaPrevia();
    });

    campo('formAlta').addEventListener('submit', async (evento) => {
      evento.preventDefault();
      const error = campo('aError');
      const boton = evento.submitter;
      error.textContent = '';
      if (boton) boton.disabled = true;
      try {
        const creado = await api.crearProyecto({
          id_usuario: ctx.usuarioConRol('Gerencia'),
          cliente: campo('aCliente').value,
          codigo_cliente: campo('aCodigo').value,
          nombre: campo('aNombre').value,
          descripcion: campo('aDescripcion').value,
          nro_presupuesto: campo('aPresupuesto').value,
          urgencia: campo('aUrgencia').value,
          fecha_ingreso: campo('aIngreso').value,
          plazo_entrega: campo('aPlazo').value,
          materiales: campo('aMateriales').value.split('\n'),
          id: campo('aId').value,
          aprobado: campo('aAprobado').checked,
        });
        avisar(`Proyecto ${creado.id} creado. Queda esperando materiales en Compras.`);
        campoFecha(campo('aIngreso'), { hoy: ctx.catalogo.hoy, atajos: [['Hoy', 0], ['Ayer', -1], ['Hace 7 días', -7]] });
    campo('aPlazo').setAttribute('min', ctx.catalogo.hoy);
    campoFecha(campo('aPlazo'), { hoy: ctx.catalogo.hoy, atajos: [['+7 días', 7], ['+15 días', 15], ['+30 días', 30], ['+60 días', 60]] });
    reiniciarFormulario();
        await actualizar();
        campo('aCliente').focus();
      } catch (e) {
        error.textContent = e.message;
      } finally {
        if (boton) boton.disabled = false;
      }
    });

    await actualizar();
  },
  actualizar,
};
