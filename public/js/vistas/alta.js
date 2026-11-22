/**
 * Alta de proyecto (Gerencia): "Crear pedido". Los datos del pedido se cargan una vez
 * (cliente, urgencia, fechas) y abajo sus piezas: con "+ Agregar otra pieza" se suman más.
 * Al guardar, cada pieza recibe el mismo número de orden y su ítem: 01, 02, 03…
 */
import { api } from '../api.js';
import { campoFecha } from '../calendario.js';
import { avisar, ayuda, esc, icono } from '../util.js';

let raiz;
let ctx;
let siguienteNumero = 1;
let contadorPiezas = 0; // para ids únicos de los campos de cada pieza

const campo = (id) => raiz.querySelector(`#${id}`);

function sumarDias(hoy, dias) {
  const [a, m, d] = hoy.split('-').map(Number);
  const f = new Date(a, m - 1, d + dias);
  const dos = (n) => String(n).padStart(2, '0');
  return `${f.getFullYear()}-${dos(f.getMonth() + 1)}-${dos(f.getDate())}`;
}

/** Bloque de una pieza: nombre, descripción y materiales indispensables. */
function bloquePieza() {
  contadorPiezas += 1;
  const n = contadorPiezas;
  const bloque = document.createElement('fieldset');
  bloque.className = 'alta-pieza';
  bloque.innerHTML = `
    <div class="alta-pieza-cabeza">
      <span class="codigo alta-pieza-id"></span>
      <button type="button" class="plan-icono quitar" data-quitar-pieza aria-label="Quitar esta pieza" title="Quitar esta pieza">${icono('cerrar')}</button>
    </div>
    <div class="campo"><label for="pz${n}Nombre">Nombre de la pieza</label>
      <input id="pz${n}Nombre" class="pz-nombre" maxlength="120" placeholder="Ej.: Tanque de acero inoxidable 2000 L"></div>
    <div class="campo"><label for="pz${n}Descripcion">Descripción</label>
      <input id="pz${n}Descripcion" class="pz-descripcion" maxlength="300" placeholder="Ej.: Fabricar, pintar, montar"></div>
    <div class="campo"><label for="pz${n}Materiales">Materiales indispensables para iniciar</label>
      <textarea id="pz${n}Materiales" class="pz-materiales" data-multilinea placeholder="Uno por línea&#10;Chapa inox 3 mm&#10;Válvula esférica 2&quot;"></textarea></div>`;
  return bloque;
}

const bloques = () => [...campo('aPiezas').querySelectorAll('.alta-pieza')];

/** Numera las piezas y muestra el ID que va a recibir cada una (mismo número de orden, ítem 01, 02…). */
function pintarPiezas() {
  const codigo = campo('aCodigo').value.trim().toUpperCase();
  const urgencia = campo('aUrgencia').value;
  const valido = /^[A-Z]{3}$/.test(codigo);
  const lista = bloques();
  lista.forEach((bloque, i) => {
    const id = bloque.querySelector('.alta-pieza-id');
    id.hidden = !valido;
    id.textContent = valido ? `${String(siguienteNumero).padStart(4, '0')}-${codigo}-${urgencia}-${String(i + 1).padStart(2, '0')}` : '';
    bloque.querySelector('[data-quitar-pieza]').hidden = lista.length === 1;
    // Sin ID para mostrar y sin botón de quitar, el renglón de arriba no ocupa lugar.
    bloque.querySelector('.alta-pieza-cabeza').hidden = !valido && lista.length === 1;
  });
}

function agregarPieza({ enfocar = false } = {}) {
  const bloque = bloquePieza();
  campo('aPiezas').append(bloque);
  pintarPiezas();
  if (enfocar) bloque.querySelector('.pz-nombre').focus();
}

function pintarClientes() {
  campo('aClientes').innerHTML = ctx.catalogo.clientes
    .map((c) => `<option value="${esc(c.nombre)}"></option>`).join('');
}

async function actualizar() {
  const proyectos = await api.proyectos();
  siguienteNumero = proyectos.reduce((maximo, p) => Math.max(maximo, p.numero), 0) + 1;
  pintarClientes();
  pintarPiezas();
}

function reiniciarFormulario() {
  campo('formAlta').reset();
  campo('aPiezas').replaceChildren();
  agregarPieza();
  campo('aIngreso').value = ctx.catalogo.hoy;
  campo('aPlazo').value = sumarDias(ctx.catalogo.hoy, 14);
}

export default {
  titulo: 'Alta de proyecto',
  subtitulo: '',
  async montar(elemento, contexto) {
    raiz = elemento;
    ctx = contexto;
    raiz.innerHTML = `
      <div class="alta-unica">
        <section class="tarjeta">
          <div class="tarjeta-cabeza"><h2>Nuevo pedido</h2>${ayuda('ayudaAlta', '¿Cómo se carga un pedido?',
            'Cargá una sola vez los datos del pedido (cliente, urgencia y fechas) y abajo sus piezas. Con «Agregar otra pieza» sumás más.',
            'Cada pieza recibe su propio código con el mismo número de orden (ítem 01, 02…). Al crear el pedido, queda esperando materiales en Compras.')}</div>
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
              <div class="par tres">
                <div class="campo"><label for="aUrgencia">Urgencia</label>
                  <select id="aUrgencia"><option value="E">E · Estándar</option><option value="U">U · Urgente</option></select></div>
                <div class="campo"><label for="aIngreso">Fecha de ingreso</label><input type="date" id="aIngreso"></div>
                <div class="campo"><label for="aPlazo">Plazo de entrega</label><input type="date" id="aPlazo"></div>
              </div>
              <div id="aPiezas" class="alta-piezas"></div>
              <button class="boton secundario alta-mas" type="button" id="aMasPieza"><span class="ico">${icono('mas')}</span>Agregar otra pieza</button>
              <p class="error" id="aError" role="alert"></p>
              <div class="acciones-form">
                <button class="boton" type="submit">Crear pedido</button>
                <button class="boton secundario" type="button" id="aLimpiar">Limpiar</button>
              </div>
            </form>
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
      pintarPiezas();
    });
    ['aCodigo', 'aUrgencia'].forEach((id) => campo(id).addEventListener('input', pintarPiezas));
    campo('aMasPieza').addEventListener('click', () => agregarPieza({ enfocar: true }));
    campo('aPiezas').addEventListener('click', (evento) => {
      const quitar = evento.target.closest('[data-quitar-pieza]');
      if (!quitar || bloques().length === 1) return;
      quitar.closest('.alta-pieza').remove();
      pintarPiezas();
    });
    campo('aLimpiar').addEventListener('click', () => {
      reiniciarFormulario();
      campo('aError').textContent = '';
      pintarPiezas();
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
          urgencia: campo('aUrgencia').value,
          fecha_ingreso: campo('aIngreso').value,
          plazo_entrega: campo('aPlazo').value,
          piezas: bloques().map((b) => ({
            nombre: b.querySelector('.pz-nombre').value,
            descripcion: b.querySelector('.pz-descripcion').value,
            materiales: b.querySelector('.pz-materiales').value.split('\n'),
          })),
        });
        const ids = creado.ids_creados || [creado.id];
        avisar(ids.length === 1
          ? `Pedido ${ids[0]} creado. Queda esperando materiales en Compras.`
          : `Pedido ${String(creado.numero).padStart(4, '0')} creado con ${ids.length} piezas (${ids[0]} a ${ids.at(-1)}). Quedan esperando materiales en Compras.`);
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
