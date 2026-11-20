/**
 * Arranque de la aplicación: navegación entre pantallas, conexión en tiempo real,
 * tema claro/oscuro y datos compartidos (catálogo).
 */
import { api } from './api.js';
import { avisar, esc, pintarIconos } from './util.js';
import panel from './vistas/panel.js';
import alta from './vistas/alta.js';
import compras from './vistas/compras.js';
import taller from './vistas/taller.js';
import historial from './vistas/historial.js';
import planilla from './vistas/planilla.js';
import dashboard from './vistas/dashboard.js';

const VISTAS = { panel, dashboard, alta, compras, taller, historial, planilla };
const $ = (selector) => document.querySelector(selector);

let catalogo = null;
let vistaActual = null;
let rutaActual = '';

/** Contexto que recibe cada pantalla. */
const contexto = {
  get catalogo() { return catalogo; },
  /** Primer usuario con ese rol (el prototipo no tiene inicio de sesión). */
  usuarioConRol(rol) {
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
  return { ruta: VISTAS[ruta] ? ruta : 'panel', parametro };
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
  $('#subtitulo').textContent = vista.subtitulo;
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
  poner('#cuentaCompras', paraCompras, 'Proyectos esperando materiales');
}

function actualizarFecha() {
  const [a, m, d] = catalogo.hoy.split('-').map(Number);
  const texto = new Date(a, m - 1, d).toLocaleDateString('es-AR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  $('#fechaHoy').textContent = texto.charAt(0).toUpperCase() + texto.slice(1);
}

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

// ---------- Inicio ----------
async function iniciar() {
  pintarIconos();
  pintarBotonTema();
  $('#vista').innerHTML = '<p class="cargando">Cargando…</p>';
  try {
    catalogo = await api.catalogo();
  } catch (error) {
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
