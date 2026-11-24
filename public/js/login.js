/** Pantalla de ingreso: usuario y contraseña. Si ya hay una sesión abierta, entra directo. */
import { icono, pintarIconos } from './util.js';

const formulario = document.getElementById('formIngreso');
const error = document.getElementById('error');
const boton = document.getElementById('botonIngresar');
const clave = document.getElementById('clave');
const verClave = document.getElementById('verClave');
const avisoMayus = document.getElementById('avisoMayus');

pintarIconos();

// Si ya hay una sesión abierta, entra directo.
try {
  const yo = await fetch('/api/sesion', { cache: 'no-store' });
  if (yo.ok) location.replace('/');
} catch { /* sin conexión: se muestra el formulario igual */ }

// Ingreso rápido para demostraciones: el formulario de usuario y contraseña es la entrada principal,
// y si el servidor tiene el ingreso rápido activo aparece un botón que muestra los roles.
const roles = document.getElementById('roles');
const modoDemo = document.getElementById('modoDemo');
const conClave = document.getElementById('conClave');
const abrirDemo = document.getElementById('abrirDemo');
const subtitulo = document.getElementById('subtituloIngreso');

function mostrarDemo(si) {
  modoDemo.hidden = !si;
  conClave.hidden = si;
  error.textContent = '';
  subtitulo.textContent = si ? 'Ingreso rápido para la demostración: elegí un rol.'
    : 'Ingresá con el usuario que te dio la empresa.';
  (si ? roles.querySelector('button') : formulario.usuario).focus();
}
abrirDemo.addEventListener('click', () => mostrarDemo(true));
document.getElementById('volverClave').addEventListener('click', () => mostrarDemo(false));

fetch('/api/sesion/rapida', { cache: 'no-store' })
  .then((r) => r.json())
  .then((rapida) => { if (rapida.activo) abrirDemo.hidden = false; })
  .catch(() => { /* sin ingreso rápido: queda solo usuario y contraseña */ });

roles.addEventListener('click', async (evento) => {
  const elegido = evento.target.closest('[data-rol]');
  if (!elegido) return;
  error.textContent = '';
  roles.querySelectorAll('button').forEach((b) => { b.disabled = true; });
  elegido.classList.add('cargando');
  try {
    const respuesta = await fetch('/api/sesion/rapida', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rol: elegido.dataset.rol }),
    });
    const datos = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok) throw new Error(datos.error || 'No se pudo ingresar.');
    location.replace('/');
  } catch (e) {
    error.textContent = e.message === 'Failed to fetch' ? 'No se pudo conectar con el servidor.' : e.message;
    roles.querySelectorAll('button').forEach((b) => { b.disabled = false; });
    elegido.classList.remove('cargando');
  }
});

// Mostrar / ocultar la contraseña.
verClave.addEventListener('click', () => {
  const visible = clave.type === 'text';
  clave.type = visible ? 'password' : 'text';
  verClave.innerHTML = icono(visible ? 'ojo' : 'ojoTachado');
  verClave.setAttribute('aria-label', visible ? 'Mostrar contraseña' : 'Ocultar contraseña');
  verClave.title = verClave.getAttribute('aria-label');
  clave.focus();
});

// Aviso de mayúsculas activadas (error típico al escribir la contraseña).
const revisarMayus = (evento) => { if (evento.getModifierState) avisoMayus.hidden = !evento.getModifierState('CapsLock'); };
clave.addEventListener('keydown', revisarMayus);
clave.addEventListener('keyup', revisarMayus);
clave.addEventListener('blur', () => { avisoMayus.hidden = true; });

function cargando(si) {
  boton.disabled = si;
  boton.innerHTML = si ? '<span class="girando" aria-hidden="true"></span>Ingresando…' : 'Ingresar';
}

formulario.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  error.textContent = '';
  const usuario = formulario.usuario.value.trim();
  // Atajo: un cliente que escribe "cliente" va directo a consultar su pedido (no necesita contraseña).
  if (usuario.toLowerCase() === 'cliente') { location.href = 'seguimiento.html'; return; }
  if (!usuario || !clave.value) {
    error.textContent = 'Escribí tu usuario y tu contraseña.';
    (usuario ? clave : formulario.usuario).focus();
    return;
  }
  cargando(true);
  try {
    const respuesta = await fetch('/api/sesion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario, clave: clave.value }),
    });
    const datos = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok) throw new Error(datos.error || 'No se pudo ingresar.');
    location.replace('/');
  } catch (e) {
    error.textContent = e.message === 'Failed to fetch' ? 'No se pudo conectar con el servidor.' : e.message;
    clave.value = '';
    clave.focus();
    cargando(false);
  }
});
