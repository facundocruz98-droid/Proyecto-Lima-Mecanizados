/**
 * Selector de fecha propio (sin librerías).
 *
 * Convierte un <input type="date"> en un campo donde se puede:
 *   - escribir la fecha (25/11/2026, 25-11-26 o 25112026),
 *   - elegirla en un calendario con atajos (+7 días, +15 días…),
 *   - moverse con el teclado (flechas, RePág/AvPág, Enter, Esc).
 *
 * El input original queda oculto y conserva su id y su valor AAAA-MM-DD,
 * así el resto del código lo sigue leyendo igual con `.value`.
 */
import { icono } from './util.js';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const DIAS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

const dos = (n) => String(n).padStart(2, '0');
const aISO = (a, m, d) => `${a}-${dos(m)}-${dos(d)}`;
const partes = (iso) => iso.split('-').map(Number);
const aUTC = (iso) => { const [a, m, d] = partes(iso); return Date.UTC(a, m - 1, d); };
const deUTC = (ms) => new Date(ms).toISOString().slice(0, 10);

export const sumarDias = (iso, dias) => deUTC(aUTC(iso) + dias * 86400000);
const diasEntre = (desde, hasta) => Math.round((aUTC(hasta) - aUTC(desde)) / 86400000);
/** 0 = lunes … 6 = domingo */
const diaDeSemana = (iso) => (new Date(aUTC(iso)).getUTCDay() + 6) % 7;
const aTexto = (iso) => (iso ? iso.split('-').reverse().join('/') : '');

function sumarMeses(iso, meses) {
  const [a, m, d] = partes(iso);
  const primero = new Date(Date.UTC(a, m - 1 + meses, 1));
  const ultimoDia = new Date(Date.UTC(primero.getUTCFullYear(), primero.getUTCMonth() + 1, 0)).getUTCDate();
  return aISO(primero.getUTCFullYear(), primero.getUTCMonth() + 1, Math.min(d, ultimoDia));
}

/** Interpreta lo que escribió la persona. Devuelve AAAA-MM-DD, '' si está vacío o null si no es una fecha. */
export function interpretarFecha(texto, hoy = '') {
  const limpio = String(texto || '').trim();
  if (!limpio) return '';
  let d; let m; let a;
  let partido = /^(\d{1,2})[/\-. ](\d{1,2})(?:[/\-. ](\d{2}|\d{4}))?$/.exec(limpio);
  if (partido) {
    [, d, m, a] = partido;
  } else {
    partido = /^(\d{2})(\d{2})(\d{4}|\d{2})$/.exec(limpio);
    if (!partido) return null;
    [, d, m, a] = partido;
  }
  d = Number(d); m = Number(m);
  if (a === undefined) a = hoy ? partes(hoy)[0] : new Date().getFullYear();
  a = Number(a);
  if (a < 100) a += 2000;
  const fecha = new Date(Date.UTC(a, m - 1, d));
  if (fecha.getUTCFullYear() !== a || fecha.getUTCMonth() !== m - 1 || fecha.getUTCDate() !== d) return null;
  return aISO(a, m, d);
}

function textoRelativo(iso, hoy) {
  if (!hoy) return '';
  const n = diasEntre(hoy, iso);
  if (n === 0) return 'hoy';
  if (n === 1) return 'mañana';
  if (n === -1) return 'ayer';
  return n > 0 ? `en ${n} días` : `hace ${-n} días`;
}

function textoLargo(iso, hoy) {
  const [a, m, d] = partes(iso);
  const relativo = textoRelativo(iso, hoy);
  const base = `${DIAS[diaDeSemana(iso)]} ${d} de ${MESES[m - 1]} de ${a}`;
  return relativo ? `${base} · ${relativo}` : base;
}

/**
 * @param {HTMLInputElement} entrada  El <input type="date"> a mejorar
 * @param {{ hoy?: string, atajos?: Array<[string, number]> }} opciones
 *        hoy: fecha actual AAAA-MM-DD · atajos: pares [texto, días desde hoy]
 */
export function campoFecha(entrada, { hoy = '', atajos = [] } = {}) {
  const idTexto = `${entrada.id}Texto`;
  entrada.type = 'hidden';

  const caja = document.createElement('div');
  caja.className = 'fecha';
  caja.innerHTML = `
    <div class="fecha-campo">
      <input type="text" id="${idTexto}" inputmode="numeric" autocomplete="off" placeholder="dd/mm/aaaa" maxlength="10" aria-describedby="${idTexto}Ayuda">
      <button type="button" class="fecha-boton" aria-label="Abrir calendario" aria-haspopup="dialog" aria-expanded="false">${icono('calendario')}</button>
    </div>
    <small class="fecha-ayuda" id="${idTexto}Ayuda"></small>
    <div class="calendario" role="dialog" aria-label="Elegir fecha" hidden></div>`;
  entrada.after(caja);
  const etiqueta = entrada.getRootNode().querySelector(`label[for="${entrada.id}"]`);
  if (etiqueta) etiqueta.htmlFor = idTexto;

  const texto = caja.querySelector('input');
  const boton = caja.querySelector('.fecha-boton');
  const ayuda = caja.querySelector('.fecha-ayuda');
  const panel = caja.querySelector('.calendario');

  const minimo = () => entrada.getAttribute('min') || '';
  const permitida = (iso) => !minimo() || iso >= minimo();

  let abierto = false;
  let modo = 'dias';       // 'dias' | 'meses'
  let foco = '';           // día con el foco del teclado (AAAA-MM-DD)

  // ---------- Valor ----------
  const nativo = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  function reflejar() {
    const iso = nativo.get.call(entrada);
    texto.value = aTexto(iso);
    texto.classList.remove('invalida');
    ayuda.classList.remove('mal');
    ayuda.textContent = iso ? textoLargo(iso, hoy) : '';
  }
  // Si el resto del código hace `entrada.value = '2026-11-25'`, el campo visible se actualiza solo.
  Object.defineProperty(entrada, 'value', {
    configurable: true,
    get: () => nativo.get.call(entrada),
    set: (iso) => { nativo.set.call(entrada, iso || ''); reflejar(); },
  });

  function elegir(iso, avisar = true) {
    entrada.value = iso;
    if (avisar) {
      entrada.dispatchEvent(new Event('input', { bubbles: true }));
      entrada.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function marcarInvalida(mensaje) {
    texto.classList.add('invalida');
    ayuda.classList.add('mal');
    ayuda.textContent = mensaje;
  }

  /** Toma lo escrito a mano. Devuelve false si no es una fecha válida. */
  function confirmarTexto() {
    const iso = interpretarFecha(texto.value, hoy);
    if (iso === null) { marcarInvalida('No es una fecha válida. Ejemplo: 25/11/2026'); return false; }
    if (iso === entrada.value) { reflejar(); return true; } // no cambió: no hay nada que validar
    if (iso && !permitida(iso)) { marcarInvalida(`La fecha no puede ser anterior al ${aTexto(minimo())}.`); return false; }
    elegir(iso);
    return true;
  }

  // ---------- Dibujo ----------
  function dibujarDias() {
    const [a, m] = partes(foco);
    const primero = aISO(a, m, 1);
    const inicio = sumarDias(primero, -diaDeSemana(primero));
    const elegido = entrada.value;
    let celdas = '';
    for (let i = 0; i < 42; i += 1) {
      const dia = sumarDias(inicio, i);
      const [, mesDia, numero] = partes(dia);
      const clases = [
        'cal-dia',
        mesDia !== m ? 'fuera' : '',
        dia === hoy ? 'hoy' : '',
        dia === elegido ? 'elegido' : '',
        i % 7 >= 5 ? 'finde' : '',
      ].filter(Boolean).join(' ');
      celdas += `<button type="button" class="${clases}" data-dia="${dia}" tabindex="${dia === foco ? 0 : -1}"
        ${permitida(dia) ? '' : 'disabled'} aria-label="${textoLargo(dia, '')}"${dia === elegido ? ' aria-pressed="true"' : ''}>${numero}</button>`;
    }
    const botonesAtajo = atajos
      .map(([nombre, dias]) => [nombre, sumarDias(hoy, dias)])
      .filter(([, dia]) => hoy && permitida(dia))
      .map(([nombre, dia]) => `<button type="button" class="cal-atajo ${dia === elegido ? 'activo' : ''}" data-dia="${dia}">${nombre}</button>`).join('');
    panel.innerHTML = `
      <div class="cal-cabeza">
        <button type="button" class="cal-nav" data-mover="-1" aria-label="Mes anterior">${icono('izquierda')}</button>
        <button type="button" class="cal-titulo" data-modo="meses" aria-label="Elegir mes y año">${MESES[m - 1]} ${a}</button>
        <button type="button" class="cal-nav" data-mover="1" aria-label="Mes siguiente">${icono('derecha')}</button>
      </div>
      <div class="cal-semana" aria-hidden="true">${['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((d) => `<span>${d}</span>`).join('')}</div>
      <div class="cal-dias">${celdas}</div>
      ${botonesAtajo ? `<div class="cal-atajos">${botonesAtajo}</div>` : ''}`;
  }

  function dibujarMeses() {
    const [a, m] = partes(foco);
    const [aElegido, mElegido] = entrada.value ? partes(entrada.value) : [0, 0];
    const [aHoy, mHoy] = hoy ? partes(hoy) : [0, 0];
    const [aMin, mMin] = minimo() ? partes(minimo()) : [0, 0];
    panel.innerHTML = `
      <div class="cal-cabeza">
        <button type="button" class="cal-nav" data-anio="-1" aria-label="Año anterior">${icono('izquierda')}</button>
        <button type="button" class="cal-titulo" data-modo="dias" aria-label="Volver a los días">${a}</button>
        <button type="button" class="cal-nav" data-anio="1" aria-label="Año siguiente">${icono('derecha')}</button>
      </div>
      <div class="cal-meses">${MESES_CORTOS.map((nombre, i) => {
        const fueraDeRango = a < aMin || (a === aMin && i + 1 < mMin);
        const clases = ['cal-mes', a === aHoy && i + 1 === mHoy ? 'hoy' : '', a === aElegido && i + 1 === mElegido ? 'elegido' : ''].filter(Boolean).join(' ');
        return `<button type="button" class="${clases}" data-mes="${i + 1}" ${fueraDeRango ? 'disabled' : ''} tabindex="${i + 1 === m ? 0 : -1}">${nombre}</button>`;
      }).join('')}</div>`;
  }

  function dibujar(enfocar = false) {
    if (modo === 'dias') dibujarDias(); else dibujarMeses();
    if (enfocar) {
      const destino = panel.querySelector('[tabindex="0"]:not([disabled])') || panel.querySelector('.cal-titulo');
      if (destino) destino.focus({ preventScroll: true });
    }
  }

  /** Ubica el calendario debajo del campo, o arriba si no entra. */
  function ubicar() {
    const campo = caja.querySelector('.fecha-campo').getBoundingClientRect();
    const alto = panel.offsetHeight;
    const ancho = panel.offsetWidth;
    const margen = 8;
    let arriba = campo.bottom + 6;
    if (arriba + alto > window.innerHeight - margen && campo.top - alto - 6 > margen) arriba = campo.top - alto - 6;
    arriba = Math.max(margen, Math.min(arriba, window.innerHeight - alto - margen));
    const izquierda = Math.max(margen, Math.min(campo.left, window.innerWidth - ancho - margen));
    panel.style.top = `${arriba}px`;
    panel.style.left = `${izquierda}px`;
  }

  // ---------- Abrir y cerrar ----------
  function alTocarAfuera(evento) {
    if (!caja.isConnected || !caja.contains(evento.target)) cerrar(false);
  }
  function alMoverLaPagina(evento) {
    if (!caja.isConnected) { cerrar(false); return; }
    if (evento.type === 'scroll' && panel.contains(evento.target)) return;
    ubicar();
  }

  function abrir() {
    if (abierto) return;
    const base = entrada.value || hoy || deUTC(Date.now());
    foco = permitida(base) ? base : minimo();
    modo = 'dias';
    abierto = true;
    panel.hidden = false;
    boton.setAttribute('aria-expanded', 'true');
    dibujar(true);
    ubicar();
    document.addEventListener('pointerdown', alTocarAfuera, true);
    window.addEventListener('resize', alMoverLaPagina);
    window.addEventListener('scroll', alMoverLaPagina, true);
  }

  function cerrar(devolverFoco = true) {
    if (!abierto) return;
    abierto = false;
    panel.hidden = true;
    panel.innerHTML = '';
    boton.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', alTocarAfuera, true);
    window.removeEventListener('resize', alMoverLaPagina);
    window.removeEventListener('scroll', alMoverLaPagina, true);
    if (devolverFoco && caja.isConnected) texto.focus({ preventScroll: true });
  }

  function moverFoco(nuevo) {
    foco = permitida(nuevo) ? nuevo : minimo();
    dibujar(true);
    ubicar();
  }

  // ---------- Eventos ----------
  boton.addEventListener('click', () => (abierto ? cerrar() : abrir()));

  texto.addEventListener('keydown', (evento) => {
    if (evento.key === 'ArrowDown') { evento.preventDefault(); abrir(); }
    else if (evento.key === 'Enter' && !confirmarTexto()) evento.preventDefault(); // con fecha inválida no se envía el formulario
    else if (evento.key === 'Escape' && abierto) { evento.preventDefault(); evento.stopPropagation(); cerrar(); }
  });
  texto.addEventListener('input', () => {
    // Agrega las barras solas mientras se escriben solo números: 25112026 → 25/11/2026
    const soloDigitos = /^\d+$/.test(texto.value.replace(/\//g, ''));
    if (soloDigitos && texto.selectionStart === texto.value.length) {
      const d = texto.value.replace(/\D/g, '').slice(0, 8);
      texto.value = [d.slice(0, 2), d.slice(2, 4), d.slice(4)].filter(Boolean).join('/');
    }
    texto.classList.remove('invalida');
  });
  texto.addEventListener('blur', () => { if (!abierto) confirmarTexto(); });

  panel.addEventListener('click', (evento) => {
    const objetivo = evento.target.closest('button');
    if (!objetivo || objetivo.disabled) return;
    const datos = objetivo.dataset;
    if (datos.dia) { elegir(datos.dia); cerrar(); }
    else if (datos.mover) moverFoco(sumarMeses(foco, Number(datos.mover)));
    else if (datos.anio) moverFoco(sumarMeses(foco, 12 * Number(datos.anio)));
    else if (datos.modo) { modo = datos.modo; dibujar(true); ubicar(); }
    else if (datos.mes) {
      const [a, , d] = partes(foco);
      modo = 'dias';
      moverFoco(sumarMeses(aISO(a, 1, d), Number(datos.mes) - 1));
    }
  });

  panel.addEventListener('keydown', (evento) => {
    if (evento.key === 'Escape') { evento.preventDefault(); evento.stopPropagation(); cerrar(); return; }
    if (evento.key === 'Tab') { cerrar(false); return; }
    const pasos = modo === 'dias'
      ? { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }
      : { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3 };
    let nuevo = null;
    if (evento.key in pasos) nuevo = modo === 'dias' ? sumarDias(foco, pasos[evento.key]) : sumarMeses(foco, pasos[evento.key]);
    else if (evento.key === 'PageUp') nuevo = sumarMeses(foco, evento.shiftKey ? -12 : -1);
    else if (evento.key === 'PageDown') nuevo = sumarMeses(foco, evento.shiftKey ? 12 : 1);
    else if (evento.key === 'Home' && modo === 'dias') nuevo = sumarDias(foco, -diaDeSemana(foco));
    else if (evento.key === 'End' && modo === 'dias') nuevo = sumarDias(foco, 6 - diaDeSemana(foco));
    if (nuevo) { evento.preventDefault(); moverFoco(nuevo); }
  });

  reflejar();
  return { abrir, cerrar };
}
