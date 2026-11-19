/** Utilidades compartidas por todas las pantallas. */

/** Escapa texto para insertarlo en HTML sin riesgo. */
export function esc(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/** AAAA-MM-DD → DD/MM/AAAA */
export function fecha(iso) {
  if (!iso) return '';
  const [a, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

/** Instante ISO → fecha local DD/MM/AAAA */
export function fechaDeInstante(iso) {
  if (!iso) return '';
  const f = new Date(iso);
  const dos = (n) => String(n).padStart(2, '0');
  return `${dos(f.getDate())}/${dos(f.getMonth() + 1)}/${f.getFullYear()}`;
}

/** Fecha y hora local corta a partir de un instante ISO: 11/11 14:05 */
export function fechaHora(iso) {
  if (!iso) return '';
  const f = new Date(iso);
  const dos = (n) => String(n).padStart(2, '0');
  return `${dos(f.getDate())}/${dos(f.getMonth() + 1)} ${dos(f.getHours())}:${dos(f.getMinutes())}`;
}

/** Texto del plazo: "vencido hace 2 días", "vence hoy", "faltan 3 días". */
export function textoPlazo(dias) {
  if (dias < 0) return `vencido hace ${-dias} ${-dias === 1 ? 'día' : 'días'}`;
  if (dias === 0) return 'vence hoy';
  return dias === 1 ? 'falta 1 día' : `faltan ${dias} días`;
}

/** Horas → "3 h 20 min", "2 d 4 h". */
export function duracion(horas) {
  const minutos = Math.round(horas * 60);
  if (minutos < 1) return 'menos de 1 min';
  if (minutos < 60) return `${minutos} min`;
  const h = Math.floor(minutos / 60);
  if (h < 24) return minutos % 60 ? `${h} h ${minutos % 60} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d} d ${h % 24} h` : `${d} d`;
}

const TRAZOS = {
  panel: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  mas: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  reloj: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  tabla: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16"/>',
  caja: '<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  escaner: '<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M8 8v8M11 8v8M14 8v8M16.5 8v8"/>',
  tema: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
  reiniciar: '<path d="M4 12a8 8 0 1 0 2.6-5.9"/><path d="M4 4v4.5h4.5"/>',
  imprimir: '<path d="M7 8V4h10v4"/><rect x="4" y="8" width="16" height="8" rx="2"/><rect x="7" y="13" width="10" height="7" rx="1"/>',
  descargar: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 20h14"/>',
  copiar: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  play: '<path d="M7 5l12 7-12 7z" fill="currentColor"/>',
  pausa: '<rect x="6" y="5" width="4.5" height="14" rx="1" fill="currentColor"/><rect x="13.5" y="5" width="4.5" height="14" rx="1" fill="currentColor"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  calendario: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  izquierda: '<path d="M14.5 6l-6 6 6 6"/>',
  derecha: '<path d="M9.5 6l6 6-6 6"/>',
};

/** Ícono SVG en línea (hereda el color del texto). */
export function icono(nombre) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${TRAZOS[nombre] || ''}</svg>`;
}

/** Completa los <span data-icono="..."> que haya dentro de un elemento. */
export function pintarIconos(raiz = document) {
  raiz.querySelectorAll('[data-icono]').forEach((el) => {
    el.innerHTML = icono(el.dataset.icono);
    el.removeAttribute('data-icono');
  });
}

/** Aviso emergente abajo a la derecha. */
export function avisar(mensaje, tipo = 'ok') {
  const caja = document.getElementById('avisos');
  if (!caja) return;
  const aviso = document.createElement('div');
  aviso.className = `aviso ${tipo === 'mal' ? 'mal' : ''}`;
  aviso.textContent = mensaje;
  caja.append(aviso);
  setTimeout(() => aviso.remove(), tipo === 'mal' ? 6000 : 3500);
}

export function pastillaEstado(p) {
  return `<span class="pastilla ${esc(p.estado)}">${esc(p.estado_texto)}</span>`;
}

export function codigoConUrgencia(p) {
  return `<span class="codigo">${esc(p.id)}</span>${p.urgencia === 'U' ? '<span class="urgente" title="Urgente">URG</span>' : ''}`;
}
