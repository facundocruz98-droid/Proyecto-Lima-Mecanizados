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
  cancelado: 'Cancelado',
};

const ROLES = ['Gerencia', 'Compras', 'Operario', 'Supervisor'];

/** Cómo ve el cliente cada estado en su link de seguimiento (sin datos internos). */
const ESTADOS_CLIENTE = {
  pendiente_mat: 'En preparación: esperando materiales',
  listo: 'Listo para comenzar la fabricación',
  en_proceso: 'En fabricación',
  pausado: 'Detenido momentáneamente',
  finalizado: 'Terminado',
  cancelado: 'Cancelado',
};

/**
 * Etapas que ve el cliente en su link (en lugar de Corte, Plegado, Soldadura…).
 * Salen solo del estado del proyecto:
 *  - pendiente_mat / listo      → actual: Pedido recibido
 *  - en_proceso / pausado       → actual: En fabricación
 *  - finalizado                 → línea completa: Listo para entregar y Entregado se muestran cumplidas.
 *    Es solo visual (para la demo): el sistema no registra despachos ni entregas.
 *  - cancelado                  → sin línea (la página muestra el aviso de cancelación)
 * "En camino" no se muestra porque el sistema no registra el despacho.
 */
const PASOS_CLIENTE = [
  { clave: 'recibido', titulo: 'Pedido recibido' },
  { clave: 'fabricacion', titulo: 'En fabricación' },
  { clave: 'listo', titulo: 'Listo para entregar' },
  { clave: 'entregado', titulo: 'Entregado' },
];

function pasosCliente(estado) {
  if (estado === 'cancelado') return [];
  const actual = { pendiente_mat: 0, listo: 0, en_proceso: 1, pausado: 1, finalizado: 3 }[estado] ?? 0;
  return PASOS_CLIENTE.map((p, i) => ({
    ...p,
    estado: i < actual ? 'hecha' : i === actual ? 'actual' : 'pendiente',
  }));
}

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

/** Suma (o resta) días a una fecha AAAA-MM-DD. */
function sumarDias(fecha, dias) {
  const [a, m, d] = fecha.split('-').map(Number);
  const f = new Date(Date.UTC(a, m - 1, d + dias));
  return f.toISOString().slice(0, 10);
}

/**
 * Días que se corre la entrega por el tiempo detenido.
 * Cada día (24 h) o fracción de pausa corre la fecha estimada un día:
 * es preferible avisarle al cliente una fecha un poco más tarde que una que no se cumpla.
 */
function diasDeCorrimiento(horasPausa) {
  if (!(horasPausa > 0)) return 0;
  return Math.ceil(horasPausa / 24 - 1e-9);
}

/**
 * Semáforo del panel:
 *  - fin:      el trabajo está finalizado
 *  - cancelado: el proyecto se canceló
 *  - rojo:     plazo vencido sin finalizar, o trabajo pausado
 *  - amarillo: faltan MARGEN_ALERTA_DIAS días o menos
 *  - verde:    a tiempo
 */
function semaforo(estado, dias) {
  if (estado === 'finalizado') return 'fin';
  if (estado === 'cancelado') return 'cancelado';
  if (dias < 0 || estado === 'pausado') return 'rojo';
  if (dias <= MARGEN_ALERTA_DIAS) return 'amarillo';
  return 'verde';
}

const ORDEN_SEMAFORO = { rojo: 0, amarillo: 1, verde: 2, fin: 3, cancelado: 4 };

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
  ESTADOS_CLIENTE,
  PASOS_CLIENTE,
  pasosCliente,
  ROLES,
  MARGEN_ALERTA_DIAS,
  FORMATO_ID,
  armarId,
  desarmarId,
  esFechaValida,
  fechaLocal,
  diasRestantes,
  sumarDias,
  diasDeCorrimiento,
  semaforo,
  compararParaPanel,
};
