/**
 * Página pública del cliente: seguimiento.html?c=<link firmado>
 * Estilo "detalle del pedido": tarjeta de la pieza, fecha de entrega destacada
 * y seguimiento vertical con íconos (Pedido recibido → En fabricación → Listo para entregar → Entregado).
 */
import { esc, fechaHora } from './util.js';

const destino = document.getElementById('contenido');
const token = new URLSearchParams(location.search).get('c') || '';

/** Íconos de trazo simple, todos en la misma grilla de 24 × 24. */
const ICONOS = {
  // Portapapeles
  recibido: '<rect x="5" y="4" width="14" height="17" rx="2"/><rect x="9" y="2.5" width="6" height="3.5" rx="1"/><path d="M9 11h6M9 15h4"/>',
  // Engranaje
  fabricacion: '<path d="M19.11 9.32L21.8 10.01L21.8 13.99L19.11 14.68L18.92 15.14L20.33 17.53L17.53 20.33L15.14 18.92L14.68 19.11L13.99 21.8L10.01 21.8L9.32 19.11L8.86 18.92L6.47 20.33L3.67 17.53L5.08 15.14L4.89 14.68L2.2 13.99L2.2 10.01L4.89 9.32L5.08 8.86L3.67 6.47L6.47 3.67L8.86 5.08L9.32 4.89L10.01 2.2L13.99 2.2L14.68 4.89L15.14 5.08L17.53 3.67L20.33 6.47L18.92 8.86Z"/><circle cx="12" cy="12" r="3"/>',
  // Caja
  listo: '<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  // Mano recibiendo una caja
  entregado: '<rect x="10" y="2.5" width="7.5" height="6.5" rx="1"/><path d="M13.75 2.5v2.5"/><path d="M2 12.5h3v8.5H2"/><path d="M5 13.5h3.5c.9 0 1.7.3 2.3.9l.6.6H15a1.6 1.6 0 0 1 0 3.2h-4"/><path d="M5 20h8.5l6.3-4.2a1.7 1.7 0 0 0-2-2.7L15 15"/>',
};
/** Ícono de la pieza cuando no hay foto (tuerca). */
const ICONO_PIEZA = '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.5l8.2 4.75v9.5L12 21.5l-8.2-4.75v-9.5z"/><circle cx="12" cy="12" r="3.6"/></svg>';

const svg = (clave) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONOS[clave]}</svg>`;

/** "2026-11-30" → "lunes 30 de noviembre" (agrega el año si no es el actual). */
function fechaLarga(iso, hoyIso) {
  const [a, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  const opciones = { weekday: 'long', day: 'numeric', month: 'long' };
  if (hoyIso && Number(hoyIso.slice(0, 4)) !== a) opciones.year = 'numeric';
  return new Date(a, m - 1, d).toLocaleDateString('es-AR', opciones).replace(',', '');
}

/** Instante ISO → fecha local AAAA-MM-DD */
function diaDeInstante(iso) {
  const f = new Date(iso);
  const dos = (n) => String(n).padStart(2, '0');
  return `${f.getFullYear()}-${dos(f.getMonth() + 1)}-${dos(f.getDate())}`;
}

/** Frase breve debajo de la etapa actual. */
function frase(t) {
  return {
    pendiente_mat: 'Estamos preparando los materiales para tu pieza',
    listo: 'Ya tenemos todo para empezar a fabricar tu pieza',
    en_proceso: 'Estamos trabajando en tu pieza',
    pausado: 'La fabricación está detenida momentáneamente',
    finalizado: 'Pedido completado',
  }[t.estado] || '';
}

/** Bloque de la fecha de entrega (lo primero que se ve en la tarjeta principal). */
function bloqueEntrega(t) {
  if (t.estado === 'finalizado') {
    return `
      <p class="entrega-fecha lista">Tu pieza está lista</p>
      ${t.fecha_fin ? `<p class="entrega-detalle">Terminada el ${esc(fechaLarga(diaDeInstante(t.fecha_fin), t.hoy))}</p>` : ''}`;
  }
  const acordada = `<p class="entrega-detalle">La fecha acordada era el ${esc(fechaLarga(t.plazo_entrega, t.hoy))}</p>`;
  if (t.en_revision) {
    return `
      <p class="entrega-aviso">Se actualizó la entrega</p>
      <p class="entrega-fecha">Estamos confirmando la nueva fecha</p>
      ${acordada}`;
  }
  if (t.dias_corrimiento > 0) {
    return `
      <p class="entrega-aviso">Se actualizó la entrega</p>
      <p class="entrega-fecha">Entrega estimada para el ${esc(fechaLarga(t.fecha_estimada, t.hoy))}</p>
      ${acordada}`;
  }
  return `
    <p class="entrega-etiqueta">Entrega estimada</p>
    <p class="entrega-fecha">${esc(fechaLarga(t.fecha_estimada, t.hoy))}</p>`;
}

/** Fecha real que respalda una etapa ya cumplida (si el sistema la tiene). */
function fechaDelPaso(t, paso) {
  if (paso.clave === 'recibido' && t.fecha_ingreso) return fechaLarga(t.fecha_ingreso, t.hoy);
  if (paso.clave === 'listo' && t.fecha_fin) return fechaLarga(diaDeInstante(t.fecha_fin), t.hoy);
  return '';
}

function lineaDeSeguimiento(t) {
  const pasos = t.pasos;
  return `
    <ol class="seguimiento" aria-label="Seguimiento del pedido">
      ${pasos.map((p, i) => {
        const siguiente = pasos[i + 1];
        const clases = [p.estado, siguiente && siguiente.estado !== 'pendiente' ? 'linea-verde' : ''].join(' ');
        const cuando = p.estado === 'hecha' ? fechaDelPaso(t, p) : '';
        return `
        <li class="paso ${clases}"${p.estado === 'actual' ? ' aria-current="step"' : ''}>
          <span class="icono">${svg(p.clave)}</span>
          <div class="paso-texto">
            <p class="paso-titulo">${esc(p.titulo)}</p>
            ${p.estado === 'actual' ? `<p class="paso-frase">${esc(frase(t))}</p>` : ''}
            ${cuando ? `<p class="paso-fecha">${esc(cuando)}</p>` : ''}
          </div>
        </li>`;
      }).join('')}
    </ol>`;
}

function pintar(t) {
  document.title = `${t.nombre} · Detalle del pedido · Lima Mecanizados`;
  const principal = t.estado === 'cancelado'
    ? `<div class="cancelado"><h2>Pedido cancelado</h2>
         <p>Este pedido fue cancelado. Ante cualquier duda, comunicate con Lima Mecanizados.</p></div>`
    : `<div class="entrega">${bloqueEntrega(t)}</div>${lineaDeSeguimiento(t)}`;

  destino.innerHTML = `
    <section class="tarjeta pieza">
      <div class="pieza-foto">${ICONO_PIEZA}</div>
      <div class="pieza-datos">
        <p class="pieza-nombre">${esc(t.nombre)}</p>
        <p class="pieza-empresa">Lima Mecanizados</p>
        <p class="pieza-numero">Pedido <b>${esc(t.id)}</b></p>
      </div>
    </section>

    <section class="tarjeta">${principal}</section>

    <p class="pie">Última actualización: ${t.ultima_actualizacion ? esc(fechaHora(t.ultima_actualizacion)) : '—'}<br>
      Esta página se actualiza sola.</p>`;
}

function mostrarError(mensaje) {
  destino.innerHTML = `<section class="tarjeta error"><h2>No pudimos mostrar el pedido</h2><p>${esc(mensaje)}</p>
    <p><a href="seguimiento.html">Probar con otro link o código</a></p></section>`;
}

async function cargar() {
  try {
    const respuesta = await fetch(`/api/seguimiento/${encodeURIComponent(token)}`, { cache: 'no-store' });
    const datos = await respuesta.json().catch(() => null);
    if (!respuesta.ok) return mostrarError((datos && datos.error) || 'El link no es válido.');
    pintar(datos);
  } catch {
    mostrarError('No se pudo conectar. Revisá tu conexión e intentá de nuevo en unos minutos.');
  }
}

/** Sin código: el cliente pega el link o el código que le mandaron. */
function pedirCodigo(error = '') {
  destino.innerHTML = `
    <section class="tarjeta consulta">
      <h2>Seguí tu pedido</h2>
      <p>Pegá el link o el código de seguimiento que te envió Lima Mecanizados.</p>
      <form id="formCodigo" novalidate>
        <input id="codigoCliente" autocomplete="off" spellcheck="false" placeholder="Link o código de seguimiento" aria-label="Link o código de seguimiento">
        <p class="consulta-error" role="alert">${esc(error)}</p>
        <button type="submit">Ver mi pedido</button>
      </form>
      <p class="consulta-nota">¿No lo tenés? Pedíselo a la empresa: te lo mandan por WhatsApp o mail.</p>
      <div id="ejemplosCliente"></div>
    </section>`;
  mostrarEjemplos();
  const campo = document.getElementById('codigoCliente');
  campo.focus();
  document.getElementById('formCodigo').addEventListener('submit', (evento) => {
    evento.preventDefault();
    const texto = campo.value.trim();
    let codigo = texto;
    try { codigo = new URL(texto).searchParams.get('c') || ''; } catch { /* no es un link: es el código */ }
    if (!codigo) { pedirCodigo('Pegá el link completo o el código que te enviaron.'); return; }
    location.href = `seguimiento.html?c=${encodeURIComponent(codigo)}`;
  });
}

/** Pedidos de ejemplo para probar la página (versión de demostración). */
async function mostrarEjemplos() {
  try {
    const elegidos = await (await fetch('/api/ejemplos-cliente', { cache: 'no-store' })).json();
    const caja = document.getElementById('ejemplosCliente');
    if (!caja || !Array.isArray(elegidos) || !elegidos.length) return;
    caja.innerHTML = `
      <div class="ejemplos">
        <p>Pedidos de ejemplo <small>(versión de demostración)</small></p>
        ${elegidos.map((p) => `<a href="seguimiento.html?c=${encodeURIComponent(p.token_cliente)}">
          <b>${esc(p.id)}</b><span>${esc(p.nombre)} · ${esc(p.estado_texto)}</span></a>`).join('')}
      </div>`;
  } catch { /* sin conexión: no se muestran ejemplos */ }
}

if (!token) pedirCodigo();
else cargar();
// Se actualiza sola: el servidor avisa cada cambio del taller (el mismo aviso en tiempo real que usan las pantallas
// internas) y la página vuelve a pedir sus datos públicos. Por las dudas, también consulta cada 30 segundos.
if (token) {
  try {
    const avisos = new EventSource('/api/tiempo-real');
    avisos.addEventListener('cambio', () => cargar());
  } catch { /* navegador sin tiempo real: queda la consulta periódica */ }
}
if (token) setInterval(cargar, 30000);
