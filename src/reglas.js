'use strict';
/**
 * Reglas de negocio puras (sin base de datos ni red).
 * Todo lo que el sistema "permite o no permite" está definido acá,
 * para poder probarlo de forma aislada.
 */

const ETAPAS = ['Corte', 'Plegado', 'Soldadura', 'Pintura', 'Armado', 'Terminación'];

const CAUSAS = ['Falta de material', 'Máquina o herramienta', 'Espera de otro proceso', 'Otro'];

const ESTADOS = {
  pendiente_mat: 'Pendiente de materiales',
  listo: 'Listo para iniciar',
  en_proceso: 'En proceso',
  pausado: 'Pausado',
  finalizado: 'Finalizado',
};

const ROLES = ['Gerencia', 'Compras', 'Operario', 'Supervisor'];

/** Días de anticipación de la alerta preventiva (semáforo amarillo). */
const MARGEN_ALERTA_DIAS = 2;

/** Formato del ID: número de orden - código de cliente - urgencia - ítem. Ej.: 0645-MPU-U-01 */
const FORMATO_ID = /^(\d{4})-([A-Z]{3})-([EU])-(\d{2})$/;

const FORMATO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

function armarId(numero, codigoCliente, urgencia, item = 1) {
  return [
    String(numero).padStart(4, '0'),
    codigoCliente,
    urgencia,
    String(item).padStart(2, '0'),
  ].join('-');
}

/** Devuelve las partes del ID o null si el formato es inválido. */
function desarmarId(id) {
  const m = FORMATO_ID.exec(String(id || ''));
  if (!m) return null;
  return { numero: Number(m[1]), codigoCliente: m[2], urgencia: m[3], item: Number(m[4]) };
}

/** true si es una fecha real con formato AAAA-MM-DD (rechaza 2026-02-31). */
function esFechaValida(texto) {
  if (!FORMATO_FECHA.test(String(texto || ''))) return false;
  const [a, m, d] = texto.split('-').map(Number);
  const f = new Date(Date.UTC(a, m - 1, d));
  return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d;
}

/** Fecha local AAAA-MM-DD de un objeto Date. */
function fechaLocal(fecha) {
  const a = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, '0');
  const d = String(fecha.getDate()).padStart(2, '0');
  return `${a}-${m}-${d}`;
}

/** Días entre hoy y el plazo. Negativo = plazo vencido. */
function diasRestantes(plazo, hoy) {
  const aUTC = (t) => {
    const [a, m, d] = t.split('-').map(Number);
    return Date.UTC(a, m - 1, d);
  };
  return Math.round((aUTC(plazo) - aUTC(hoy)) / 86400000);
}

/**
 * Semáforo del panel:
 *  - fin:      el trabajo está finalizado
 *  - rojo:     plazo vencido sin finalizar, o trabajo pausado
 *  - amarillo: faltan MARGEN_ALERTA_DIAS días o menos
 *  - verde:    a tiempo
 */
function semaforo(estado, dias) {
  if (estado === 'finalizado') return 'fin';
  if (dias < 0 || estado === 'pausado') return 'rojo';
  if (dias <= MARGEN_ALERTA_DIAS) return 'amarillo';
  return 'verde';
}

const ORDEN_SEMAFORO = { rojo: 0, amarillo: 1, verde: 2, fin: 3 };

/** Orden del panel: color, después urgentes, después plazo más cercano. */
function compararParaPanel(a, b) {
  return (
    ORDEN_SEMAFORO[a.semaforo] - ORDEN_SEMAFORO[b.semaforo] ||
    (a.urgencia === 'U' ? 0 : 1) - (b.urgencia === 'U' ? 0 : 1) ||
    a.plazo_entrega.localeCompare(b.plazo_entrega) ||
    a.id.localeCompare(b.id)
  );
}

module.exports = {
  ETAPAS,
  CAUSAS,
  ESTADOS,
  ROLES,
  MARGEN_ALERTA_DIAS,
  FORMATO_ID,
  armarId,
  desarmarId,
  esFechaValida,
  fechaLocal,
  diasRestantes,
  semaforo,
  compararParaPanel,
};
