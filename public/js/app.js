/**
 * Arranque de la aplicación: navegación entre pantallas, conexión en tiempo real,
 * tema claro/oscuro y datos compartidos (catálogo).
 */
import { api } from './api.js';
import { avisar, esc, icono, pintarIconos } from './util.js';
import panel from './vistas/panel.js';
import alta from './vistas/alta.js';
import compras from './vistas/compras.js';
import taller from './vistas/taller.js';
import historial from './vistas/historial.js';
import planilla from './vistas/planilla.js';
import dashboard from './vistas/dashboard.js';
import cliente from './vistas/cliente.js';

const RUTAS_GERENCIA = ['panel', 'dashboard', 'alta', 'historial', 'planilla'];
const VISTAS = { panel, dashboard, alta, compras, taller, historial, planilla, cliente };
const $ = (selector) => document.querySelector(selector);

let catalogo = null;
let sesion = null; // quién inició sesión: { nombre, rol, id_usuario, rutas }
let vistaActual = null;
let rutaActual = '';

/** Contexto que recibe cada pantalla. */
const contexto = {
  get catalogo() { return catalogo; },
  /** Persona que inició sesión. */
  get usuario() { return sesion; },
  /** Quién registra la acción: la persona de la sesión (el servidor igual usa siempre la sesión). */
  usuarioConRol(rol) {
    if (sesion && sesion.rol === rol) return sesion.id_usuario;
    const usuario = catalogo.usuarios.find((u) => u.rol === rol);
    return usuario ? usuario.id : 0;
  },
  navegar(ruta, parametro = '') {
    location.hash = parametro ? `#${ruta}/${encodeURIComponent(parametro)}` : `#${ruta}`;
  },
  abrirDialogo,
  cerrarDialogo,
};

// ---------- Diálogo modal ----------
function abrirDialogo(html) {
  const dialogo = $('#dialogo');
  dialogo.innerHTML = html;
  pintarIconos(dialogo);
  dialogo.querySelectorAll('[data-cerrar]').forEach((b) => b.addEventListener('click', cerrarDialogo));
  if (!dialogo.open) dialogo.showModal();
  return dialogo;
}
function cerrarDialogo() {
  const dialogo = $('#dialogo');
  if (dialogo.open) dialogo.close();
  dialogo.innerHTML = '';
}

// ---------- Navegación ----------
function leerHash() {
  const [ruta, ...resto] = location.hash.replace(/^#/, '').split('/');
  let parametro = '';
  try { parametro = decodeURIComponent(resto.join('/')); } catch { parametro = ''; }
  // Cada rol ve solo sus pantallas: si pide otra, va a su pantalla de inicio.
  const permitidas = sesion ? sesion.rutas : Object.keys(VISTAS);
  if (!VISTAS[ruta] || !permitidas.includes(ruta)) return { ruta: permitidas[0], parametro: '' };
  return { ruta, parametro };
}

async function mostrarVista() {
  if (!catalogo) return;
  const { ruta, parametro } = leerHash();
  const vista = VISTAS[ruta];
  const contenedor = $('#vista');

  if (vistaActual && vistaActual.desmontar) vistaActual.desmontar();
  cerrarDialogo();
  vistaActual = vista;
  rutaActual = ruta;

  document.querySelectorAll('.menu a').forEach((a) => {
    if (a.dataset.ruta === ruta) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  $('#titulo').textContent = vista.titulo;
  $('#subtitulo').textContent = vista.subtitulo || '';
  $('#subtitulo').hidden = !vista.subtitulo;
  // Cada pantalla puede ajustar su encabezado con CSS (ej. "Alta de proyecto" lo centra junto al formulario).
  document.querySelector('.contenido').dataset.vista = ruta;
  // La campana de alertas es solo para Gerencia y Supervisión (no para Compras, Taller ni el cliente).
  const conCampana = RUTAS_GERENCIA.includes(ruta) && ['Gerencia', 'Supervisor'].includes(sesion?.rol);
  $('#campana').hidden = !conCampana;
  if (!conCampana) abrirCajon(false);
  document.title = `${vista.titulo} · Seguimiento de Taller`;

  // Cada pantalla recibe un marco nuevo: así sus manejadores de eventos no se acumulan.
  const marco = document.createElement('div');
  contenedor.replaceChildren(marco);
  try {
    await vista.montar(marco, contexto, parametro);
    pintarIconos(marco);
  } catch (error) {
    marco.innerHTML = `<div class="sin-conexion"><h2>No se pudo cargar la pantalla</h2><p>${esc(error.message)}</p></div>`;
  }
}

/** Vuelve a pedir los datos de la pantalla abierta (sin tocar los formularios). */
async function refrescar() {
  try {
    catalogo = await api.catalogo();
    actualizarFecha();
    await actualizarContadores();
    if (vistaActual && vistaActual.actualizar && rutaActual === leerHash().ruta) {
      await vistaActual.actualizar();
      pintarIconos($('#vista'));
    }
  } catch {
    /* Si falla, el indicador de conexión ya lo muestra. */
  }
}

async function actualizarContadores() {
  const [alertas, proyectos] = await Promise.all([api.alertas(), api.proyectos()]);
  const criticas = alertas.vencidos.length + alertas.falta_material.length;
  const paraCompras = proyectos.filter((p) => p.estado === 'pendiente_mat').length + alertas.falta_material.length;
  const poner = (id, n, titulo) => {
    const el = $(id);
    el.hidden = n === 0;
    el.textContent = n;
    el.title = titulo;
  };
  poner('#cuentaAlertas', criticas, 'Trabajos vencidos o parados por falta de material');
  pintarCampana(alertas);
  poner('#cuentaCompras', paraCompras, 'Proyectos esperando materiales');
}

function actualizarFecha() {
  const [a, m, d] = catalogo.hoy.split('-').map(Number);
  const texto = new Date(a, m - 1, d).toLocaleDateString('es-AR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  $('#fechaHoy').textContent = texto.charAt(0).toUpperCase() + texto.slice(1);
}

// ---------- Campana de alertas ----------
/* Como en las webs grandes: un contador arriba a la derecha y la lista completa en un panel lateral. */
const GRUPOS_ALERTA = [
  ['vencidos', 'Plazo vencido', 'rojo', (p) => `${esc(p.nombre)} · debía entregarse el ${fechaCorta(p.plazo_entrega)}`],
  ['falta_material', 'Falta de material', 'rojo', (p) => `${esc(p.pausa_actual.detalle)} · avisado a Compras`],
  ['material_recibido', 'Material recibido', 'verde', (p) => `${esc(p.nombre)} · el taller puede continuar`],
  ['por_vencer', 'Por vencer', 'amarillo', (p) => `${esc(p.nombre)} · vence el ${fechaCorta(p.plazo_entrega)}`],
];
const fechaCorta = (iso) => { const [a, m, d] = iso.split('-'); return `${d}/${m}/${a}`; };

function pintarCampana(alertas) {
  const total = GRUPOS_ALERTA.reduce((n, [clave]) => n + alertas[clave].length, 0);
  const cuenta = $('#campanaCuenta');
  cuenta.hidden = total === 0;
  cuenta.textContent = total > 99 ? '99+' : total;
  $('#cajonTotal').textContent = total ? `(${total})` : '';
  const grupos = GRUPOS_ALERTA.filter(([clave]) => alertas[clave].length).map(([clave, titulo, color, texto]) => {
    // Las urgentes primero dentro de cada grupo.
    const lista = [...alertas[clave]].sort((a, b) => (b.urgencia === 'U') - (a.urgencia === 'U'));
    return `
      <section class="cajon-grupo">
        <h3><span class="punto ${color}"></span>${titulo} <span class="suave">${lista.length}</span></h3>
        ${lista.map((p) => `
          <button type="button" class="cajon-item" data-ir="${esc(p.id)}">
            <span class="cajon-item-linea"><span class="codigo">${esc(p.id)}</span>${p.urgencia === 'U' ? '<span class="urgente">URG</span>' : ''}</span>
            <span class="cajon-item-texto">${texto(p)}</span>
          </button>`).join('')}
      </section>`;
  });
  $('#cajonLista').innerHTML = grupos.length ? grupos.join('') : '<p class="vacio">Sin alertas abiertas.</p>';
}

function abrirCajon(abrir) {
  $('#cajonAlertas').hidden = !abrir;
  $('#cajonFondo').hidden = !abrir;
  $('#campana').setAttribute('aria-expanded', String(abrir));
}
$('#campana').addEventListener('click', () => abrirCajon($('#cajonAlertas').hidden));
$('#cajonCerrar').addEventListener('click', () => abrirCajon(false));
$('#cajonFondo').addEventListener('click', () => abrirCajon(false));
document.addEventListener('keydown', (evento) => {
  if (evento.key === 'Escape' && !$('#cajonAlertas').hidden) abrirCajon(false);
});
// Tocar una alerta lleva a la fila del proyecto en "Estado de Trabajos" y la resalta.
$('#cajonLista').addEventListener('click', (evento) => {
  const item = evento.target.closest('[data-ir]');
  if (!item) return;
  abrirCajon(false);
  // Si ya estamos en "Estado de Trabajos", solo baja hasta la fila (sin recargar la pantalla).
  if (rutaActual === 'panel' && vistaActual && vistaActual.irA) {
    vistaActual.irA(item.dataset.ir);
    return;
  }
  location.hash = `#panel/${encodeURIComponent(item.dataset.ir)}`;
});

// ---------- Tiempo real ----------
let temporizador = null;
function conectarTiempoReal() {
  const fuente = new EventSource('/api/tiempo-real');
  const marcar = (clase, texto) => {
    $('#conexion').className = `conexion ${clase}`;
    $('#conexionTexto').textContent = texto;
  };
  let seCayo = false;
  fuente.addEventListener('open', () => {
    marcar('activa', 'Conectado · en tiempo real');
    if (seCayo) { seCayo = false; refrescar(); }
  });
  fuente.addEventListener('error', () => {
    seCayo = true;
    marcar('caida', 'Sin conexión · reintentando…');
  });
  fuente.addEventListener('cambio', () => {
    clearTimeout(temporizador);
    temporizador = setTimeout(refrescar, 120);
  });
}

// ---------- Tema ----------
function temaEfectivo() {
  const elegido = document.documentElement.dataset.tema;
  if (elegido) return elegido;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'oscuro' : 'claro';
}
function pintarBotonTema() {
  $('#temaTexto').textContent = temaEfectivo() === 'oscuro' ? 'Modo claro' : 'Modo oscuro';
}
$('#botonTema').addEventListener('click', () => {
  const nuevo = temaEfectivo() === 'oscuro' ? 'claro' : 'oscuro';
  document.documentElement.dataset.tema = nuevo;
  try { localStorage.setItem('lima-tema', nuevo); } catch { /* sin almacenamiento */ }
  pintarBotonTema();
});

// ---------- Datos de ejemplo ----------
$('#botonDemo').addEventListener('click', () => {
  const dialogo = abrirDialogo(`
    <form method="dialog" id="formDemo">
      <h2>Restablecer datos de ejemplo</h2>
      <p class="nota">Se borran todos los proyectos cargados y se vuelven a crear los 6 proyectos de ejemplo. Esta acción no se puede deshacer.</p>
      <div class="acciones-form">
        <button class="boton" type="submit">Restablecer</button>
        <button class="boton secundario" type="button" data-cerrar>Cancelar</button>
      </div>
    </form>`);
  dialogo.querySelector('#formDemo').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    try {
      await api.restablecerDemo();
      cerrarDialogo();
      avisar('Datos de ejemplo restablecidos.');
      await mostrarVista();
    } catch (error) {
      avisar(error.message, 'mal');
    }
  });
});

// ---------- Sesión ----------
/** Muestra solo las pantallas del rol, el nombre de quien entró y los botones de su cuenta. */
function aplicarSesion() {
  document.querySelectorAll('.menu a[data-ruta]').forEach((a) => { a.hidden = !sesion.rutas.includes(a.dataset.ruta); });
  // Títulos de grupo (Gerencia, Compras…) que quedaron sin ninguna pantalla visible.
  document.querySelectorAll('.menu .menu-grupo').forEach((titulo) => {
    let siguiente = titulo.nextElementSibling;
    let visible = false;
    while (siguiente && !siguiente.classList.contains('menu-grupo')) {
      if (!siguiente.hidden) visible = true;
      siguiente = siguiente.nextElementSibling;
    }
    titulo.hidden = !visible;
  });
  $('#botonDemo').hidden = sesion.rol !== 'Gerencia';
  const pie = document.querySelector('.lateral-pie');
  pie.querySelector('.sesion-usuario')?.remove();
  pie.querySelectorAll('[data-cuenta]').forEach((b) => b.remove());
  pie.insertAdjacentHTML('beforeend', `
    <div class="sesion-usuario"><span class="ico">${icono('usuario')}</span>
      <div><strong>${esc(sesion.nombre)}</strong><small>${esc(sesion.rol === 'Gerencia' ? 'Dueño' : sesion.rol)}</small></div></div>
    <button class="boton-lateral" type="button" data-cuenta="clave"><span class="ico">${icono('llave')}</span><span>Cambiar contraseña</span></button>
    <button class="boton-lateral" type="button" data-cuenta="salir"><span class="ico">${icono('salir')}</span><span>Cerrar sesión</span></button>`);
}

document.querySelector('.lateral-pie').addEventListener('click', async (evento) => {
  const boton = evento.target.closest('[data-cuenta]');
  if (!boton) return;
  if (boton.dataset.cuenta === 'salir') {
    try { await api.salir(); } finally { location.replace('login.html'); }
    return;
  }
  const dialogo = abrirDialogo(`
    <form id="formClave" novalidate>
      <h2>Cambiar contraseña</h2>
      <p class="nota">Usá al menos 8 caracteres. Al cambiarla se cierra tu sesión en las demás computadoras.</p>
      <div class="campo"><label for="claveActual">Contraseña actual</label><input id="claveActual" type="password" autocomplete="current-password"></div>
      <div class="campo"><label for="claveNueva">Contraseña nueva</label><input id="claveNueva" type="password" autocomplete="new-password"></div>
      <div class="campo"><label for="claveRepetir">Repetí la contraseña nueva</label><input id="claveRepetir" type="password" autocomplete="new-password"></div>
      <p class="error" id="claveError" role="alert"></p>
      <div class="acciones-form">
        <button class="boton" type="submit">Guardar contraseña</button>
        <button class="boton secundario" type="button" data-cerrar>Cancelar</button>
      </div>
    </form>`);
  dialogo.querySelector('#claveActual').focus();
  dialogo.querySelector('#formClave').addEventListener('submit', async (e) => {
    e.preventDefault();
    const error = dialogo.querySelector('#claveError');
    const nueva = dialogo.querySelector('#claveNueva').value;
    error.textContent = '';
    if (nueva !== dialogo.querySelector('#claveRepetir').value) { error.textContent = 'Las dos contraseñas nuevas no coinciden.'; return; }
    try {
      await api.cambiarClave(dialogo.querySelector('#claveActual').value, nueva);
      cerrarDialogo();
      avisar('Contraseña cambiada.');
    } catch (err) {
      error.textContent = err.message;
    }
  });
});

// ---------- Tecla Enter ----------
/*
 * En los campos de texto largos (motivos, "qué pasó") y en las listas desplegables, Enter no hace
 * nada por defecto. Acá Enter envía el formulario, igual que el botón principal (Guardar, Registrar…).
 * Shift + Enter sigue haciendo un salto de línea. Los campos marcados con data-multilinea
 * (ej.: materiales "uno por línea") conservan Enter para escribir varias líneas.
 */
document.addEventListener('keydown', (evento) => {
  if (evento.key !== 'Enter' || evento.shiftKey || evento.ctrlKey || evento.altKey || evento.isComposing) return;
  const campo = evento.target;
  if (!(campo instanceof HTMLTextAreaElement || campo instanceof HTMLSelectElement)) return;
  if (campo.hasAttribute('data-multilinea')) return;
  const formulario = campo.form;
  if (!formulario || !formulario.querySelector('[type="submit"]:not([disabled])')) return;
  evento.preventDefault();
  formulario.requestSubmit();
});

// ---------- Inicio ----------
async function iniciar() {
  pintarIconos();
  pintarBotonTema();
  $('#vista').innerHTML = '<p class="cargando">Cargando…</p>';
  try {
    sesion = await api.sesion(); // sin sesión, api lleva a la pantalla de ingreso
    aplicarSesion();
    document.documentElement.classList.remove('verificando-sesion');
    catalogo = await api.catalogo();
  } catch (error) {
    document.documentElement.classList.remove('verificando-sesion');
    $('#vista').innerHTML = `
      <div class="sin-conexion">
        <h2>No se pudo conectar con el servidor</h2>
        <p>${esc(error.message)}</p>
        <p style="margin-top:12px"><button class="boton" type="button" id="reintentar">Reintentar</button></p>
      </div>`;
    $('#reintentar').addEventListener('click', iniciar);
    return;
  }
  actualizarFecha();
  actualizarContadores().catch(() => {});
  window.addEventListener('hashchange', mostrarVista);
  conectarTiempoReal();
  await mostrarVista();
}

iniciar();
