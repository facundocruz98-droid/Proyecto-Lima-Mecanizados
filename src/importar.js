'use strict';
/**
 * Importación de proyectos desde un Excel (reglas puras, sin base de datos).
 *
 * Acepta la planilla de la empresa y el Excel de proyectos del dashboard:
 *  - Columnas obligatorias: ID, FECHA IN, PLAZO ENTREGA, CLIENTE y el nombre del proyecto
 *    (NOMBRE PROYECTO, NOMBRE PROY o Columna1).
 *  - Si trae "HISTORIAL EVENTOS (JSON)", se cargan esos eventos tal cual ocurrieron.
 *  - Si no, se arma un historial mínimo a partir del estado (ESTADO OPERATIVO o Estado).
 *
 * Los proyectos cancelados también se cargan (estado "Cancelado").
 */
const reglas = require('./reglas');

const normalizar = (v) => String(v ?? '').trim().replace(/\s+/g, ' ').toLocaleUpperCase('es-AR')
  .normalize('NFD').replace(/[̀-ͯ]/g, '');
const textoCelda = (v) => (v === null || v === undefined ? '' : String(v).trim());
const recortar = (t, largo) => (t.length > largo ? `${t.slice(0, largo - 1)}…` : t);

const COLUMNAS = {
  id: ['ID'],
  ingreso: ['FECHA IN', 'FECHA INGRESO', 'FECHA DE INGRESO'],
  plazo: ['PLAZO ENTREGA', 'PLAZO DE ENTREGA'],
  cliente: ['CLIENTE'],
  nombre: ['NOMBRE PROYECTO', 'NOMBRE PROY', 'NOMBRE DEL PROYECTO', 'COLUMNA1'],
  descripcion: ['DESCRIPCION'],
  presupuesto: ['NRO PRESUPUESTO', 'N° PRESUPUESTO', 'PRESUPUESTO'],
  aprobado: ['APROB', 'APROBADO'],
  estado: ['ESTADO OPERATIVO', 'ESTADO'],
  etapa: ['ETAPA ACTUAL', 'ETAPA'],
  fin: ['FECHA FIN'],
  historial: ['HISTORIAL EVENTOS (JSON)'],
  causa: ['ULTIMA CAUSA DE PAUSA'],
  detallePausa: ['ULTIMA DESCRIPCION DE PAUSA'],
  motivo: ['MOTIVO DE DEMORA'],
};
const OBLIGATORIAS = ['id', 'ingreso', 'plazo', 'cliente', 'nombre'];
const NOMBRE_COLUMNA = { id: 'ID', ingreso: 'FECHA IN', plazo: 'PLAZO ENTREGA', cliente: 'CLIENTE', nombre: 'NOMBRE PROY (o NOMBRE PROYECTO)' };

const ESTADO_POR_TEXTO = new Map(Object.entries(reglas.ESTADOS).map(([clave, t]) => [normalizar(t), clave]));

/** Cambios de estado válidos (los mismos que permite el sistema). */
const TRANSICIONES = {
  alta: [[null], 'pendiente_mat'],
  recepcion: [['pendiente_mat'], 'listo'],
  inicio: [['listo'], 'en_proceso'],
  pausa: [['en_proceso'], 'pausado'],
  continuar: [['pausado'], 'en_proceso'],
  finalizar: [['en_proceso'], 'finalizado'],
  cancelar: [['pendiente_mat', 'listo', 'en_proceso', 'pausado'], 'cancelado'],
};
const INFORMATIVOS = new Set(['recepcion_parcial', 'etapa', 'reprogramar']);
const ROL_DEL_EVENTO = {
  alta: 'Gerencia', reprogramar: 'Gerencia', recepcion: 'Compras', recepcion_parcial: 'Compras',
  inicio: 'Operario', etapa: 'Operario', pausa: 'Operario', continuar: 'Operario', finalizar: 'Operario',
  cancelar: 'Gerencia',
};

/** Celda de fecha → AAAA-MM-DD ('' si no es una fecha). Acepta fecha de Excel, 31/12/2026 o 2026-12-31. */
function leerFecha(valor, fecha1904) {
  if (typeof valor === 'number' && Number.isFinite(valor) && valor > 0) {
    const base = fecha1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
    const f = new Date(base + Math.floor(valor + 1e-7) * 86400000);
    return f.toISOString().slice(0, 10);
  }
  const t = textoCelda(valor);
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  let fecha = m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
  m = /^(\d{4}-\d{2}-\d{2})(?:[ T].*)?$/.exec(t);
  if (m) fecha = m[1];
  return reglas.esFechaValida(fecha) ? fecha : '';
}

function leerSiNo(valor) {
  if (typeof valor === 'boolean') return valor;
  const t = normalizar(valor);
  if (['FALSE', 'FALSO', 'NO', '0', 'N'].includes(t)) return false;
  return true; // vacío o "Sí": aprobado
}

/** Momento local (fecha + hora) en ISO, sin pasarse del momento actual. */
function momento(fecha, hora, ahora) {
  const [a, m, d] = fecha.split('-').map(Number);
  const f = new Date(a, m - 1, d, hora, 0, 0);
  return new Date(Math.min(f.getTime(), ahora.getTime() - 60000)).toISOString();
}

/** Ubica la hoja y la fila de encabezados (busca la fila que tiene "ID" en las primeras 10). */
function ubicarTabla(libro) {
  const preferidas = ['PROYECTOS', 'RESUMEN DE PROYECTOS', 'PLANILLA'];
  const hojas = [...libro.hojas].sort((a, b) => {
    const pa = preferidas.indexOf(normalizar(a.nombre));
    const pb = preferidas.indexOf(normalizar(b.nombre));
    return (pa < 0 ? 99 : pa) - (pb < 0 ? 99 : pb);
  });
  for (const hoja of hojas) {
    for (let i = 0; i < Math.min(10, hoja.filas.length); i++) {
      const encabezado = hoja.filas[i].valores.map(normalizar);
      if (!encabezado.includes('ID')) continue;
      const indices = {};
      for (const [clave, nombres] of Object.entries(COLUMNAS)) {
        indices[clave] = encabezado.findIndex((n) => nombres.includes(n));
      }
      return { hoja, indices, datos: hoja.filas.slice(i + 1) };
    }
  }
  return null;
}

/** Eventos del JSON del Excel → eventos del sistema, validando que la historia sea coherente. */
function eventosDelHistorial(crudo) {
  let lista;
  try { lista = JSON.parse(crudo); } catch { return { error: 'el historial de eventos (JSON) no se puede leer' }; }
  if (!Array.isArray(lista)) return { error: 'el historial de eventos (JSON) no es una lista' };
  const eventos = [];
  for (const e of lista) {
    let tipo = textoCelda(e?.tipo).toLowerCase();
    if (tipo === 'etapa_fin') continue;           // el sistema registra solo el cambio a la etapa nueva
    if (tipo === 'etapa_inicio') tipo = 'etapa';
    if (!TRANSICIONES[tipo] && !INFORMATIVOS.has(tipo)) continue;
    const iso = textoCelda(e.fecha_hora);
    const instante = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(iso) ? Date.parse(iso) : NaN;
    if (!Number.isFinite(instante)) return { error: 'hay eventos sin fecha y hora válidas en el historial' };
    let causa = textoCelda(e.causa) || null;
    if (tipo === 'pausa' && !reglas.CAUSAS.includes(causa)) causa = 'Otro';
    eventos.push({
      tipo, instante, etapa: textoCelda(e.etapa) || null, causa: tipo === 'pausa' ? causa : null,
      detalle: textoCelda(e.detalle) ? recortar(textoCelda(e.detalle), 300) : null,
    });
  }
  eventos.sort((a, b) => a.instante - b.instante);
  if (!eventos.length || eventos[0].tipo !== 'alta') return { error: 'el historial no empieza con el alta del proyecto' };
  let estado = null;
  let etapa = '';
  for (const e of eventos) {
    if (TRANSICIONES[e.tipo]) {
      const [previos, siguiente] = TRANSICIONES[e.tipo];
      if (!previos.includes(estado)) return { error: `el historial tiene "${e.tipo}" cuando el proyecto estaba "${reglas.ESTADOS[estado] ?? 'sin alta'}"` };
      estado = siguiente;
    }
    if (e.etapa && ['inicio', 'etapa', 'pausa', 'continuar'].includes(e.tipo)) etapa = e.etapa;
  }
  return { eventos, estado, etapa };
}

/** Historial mínimo cuando el Excel solo dice en qué estado está el proyecto. */
function eventosDelEstado(estado, f, ahora) {
  const orden = ['pendiente_mat', 'listo', 'en_proceso', 'pausado', 'finalizado'];
  const nivel = orden.indexOf(estado);
  const dia = f.ingreso;
  const eventos = [{ tipo: 'alta', instante: momento(dia, 9, ahora), detalle: 'Cargado desde Excel' }];
  if (nivel >= 1) eventos.push({ tipo: 'recepcion', instante: momento(dia, 10, ahora), detalle: 'Materiales indispensables (cargado desde Excel)' });
  if (nivel >= 2) eventos.push({ tipo: 'inicio', instante: momento(dia, 11, ahora), etapa: f.etapa || reglas.ETAPAS[0] });
  if (estado === 'pausado') {
    let causa = f.causa;
    let detalle = f.detallePausa;
    const motivo = /^([^:]+):\s*(.*)$/.exec(f.motivo || '');
    if (!causa && motivo) { causa = motivo[1].trim(); detalle = detalle || motivo[2].trim(); }
    if (!reglas.CAUSAS.includes(causa)) causa = 'Otro';
    eventos.push({ tipo: 'pausa', instante: momento(dia, 12, ahora), etapa: f.etapa || reglas.ETAPAS[0], causa, detalle: recortar(detalle || 'Cargado desde Excel', 300) });
  }
  if (estado === 'finalizado') {
    const fin = f.fin && f.fin >= dia ? f.fin : dia;
    eventos.push({ tipo: 'finalizar', instante: momento(fin, 17, ahora), etapa: f.etapa || null });
  }
  if (estado === 'cancelado') {
    const fin = f.fin && f.fin >= dia ? f.fin : dia;
    eventos.push({ tipo: 'cancelar', instante: momento(fin, 17, ahora), etapa: f.etapa || null, detalle: 'Cancelado (cargado desde Excel)' });
  }
  return eventos.map((e) => ({ etapa: null, causa: null, detalle: null, ...e, instante: Date.parse(e.instante) }));
}

/**
 * Analiza el libro y devuelve qué proyectos se pueden agregar y cuáles se omiten (con el motivo).
 * @param {{fecha1904:boolean, hojas:any[]}} libro  resultado de leerLibro()
 * @param {{ existentes: Set<string>, clientes: Map<string,string>, ahora: Date }} contexto
 */
function analizarLibro(libro, { existentes, clientes, ahora }) {
  const tabla = ubicarTabla(libro);
  if (!tabla) {
    return { error: 'No se encontró la tabla de proyectos: el Excel tiene que tener una fila de títulos con la columna "ID".' };
  }
  const faltan = OBLIGATORIAS.filter((c) => tabla.indices[c] < 0).map((c) => NOMBRE_COLUMNA[c]);
  if (faltan.length) return { error: `Al Excel le faltan columnas obligatorias: ${faltan.join(', ')}.` };

  const nuevos = [];
  const omitidos = [];
  const vistos = new Set();
  const clientesNuevos = new Map();
  let filasConDatos = 0;

  for (const { numero, valores } of tabla.datos) {
    if (!valores.some((v) => textoCelda(v))) continue;
    filasConDatos++;
    const celda = (c) => (tabla.indices[c] >= 0 ? valores[tabla.indices[c]] : null);
    const id = textoCelda(celda('id')).toUpperCase();
    const omitir = (motivo) => omitidos.push({ fila: numero, id: id || '(sin ID)', motivo });

    const partes = reglas.desarmarId(id);
    if (!partes) { omitir(id ? 'el ID no tiene el formato 0645-MPU-U-01' : 'la fila no tiene ID'); continue; }
    if (vistos.has(id)) { omitir('el ID está repetido en el Excel'); continue; }
    vistos.add(id);
    if (existentes.has(id)) { omitir('ya está en el sistema'); continue; }

    const f = {
      ingreso: leerFecha(celda('ingreso'), libro.fecha1904),
      plazo: leerFecha(celda('plazo'), libro.fecha1904),
      fin: leerFecha(celda('fin'), libro.fecha1904),
      cliente: recortar(textoCelda(celda('cliente')), 80),
      nombre: recortar(textoCelda(celda('nombre')), 120),
      descripcion: recortar(textoCelda(celda('descripcion')), 300),
      presupuesto: recortar(textoCelda(celda('presupuesto')), 40),
      etapa: textoCelda(celda('etapa')),
      causa: textoCelda(celda('causa')),
      detallePausa: textoCelda(celda('detallePausa')),
      motivo: textoCelda(celda('motivo')),
    };
    if (!f.ingreso) { omitir('la FECHA IN no es una fecha válida'); continue; }
    if (!f.plazo) { omitir('el PLAZO ENTREGA no es una fecha válida'); continue; }
    if (f.ingreso > f.plazo) { omitir('la FECHA IN es posterior al PLAZO ENTREGA'); continue; }
    if (f.cliente.length < 2) { omitir('falta el CLIENTE'); continue; }
    if (!f.nombre) { omitir('falta el nombre del proyecto'); continue; }

    const textoEstado = normalizar(celda('estado'));

    let historial;
    const json = textoCelda(celda('historial'));
    if (json) {
      historial = eventosDelHistorial(json);
      if (historial.error) { omitir(historial.error); continue; }
    } else {
      const estado = textoEstado ? ESTADO_POR_TEXTO.get(textoEstado) : 'pendiente_mat';
      if (!estado) { omitir(`el estado "${textoCelda(celda('estado'))}" no existe en el sistema`); continue; }
      historial = { eventos: eventosDelEstado(estado, f, ahora), estado, etapa: estado === 'pendiente_mat' || estado === 'listo' ? '' : (f.etapa || (estado === 'cancelado' ? '' : reglas.ETAPAS[0])) };
    }
    if (historial.eventos.some((e) => e.instante > ahora.getTime())) { omitir('el historial tiene eventos con fecha futura'); continue; }

    const codigo = partes.codigoCliente;
    if (!clientes.has(codigo) && !clientesNuevos.has(codigo)) clientesNuevos.set(codigo, f.cliente);

    nuevos.push({
      id, numero: partes.numero, item: partes.item, urgencia: partes.urgencia,
      fecha_ingreso: f.ingreso, plazo_entrega: f.plazo, codigo_cliente: codigo,
      nombre: f.nombre, descripcion: f.descripcion, nro_presupuesto: '',
      aprobado: true, // la columna APROB del Excel ya no se usa
      estado: historial.estado, etapa_actual: historial.estado === 'pendiente_mat' || historial.estado === 'listo' ? '' : historial.etapa,
      eventos: historial.eventos.map((e) => ({ ...e, fecha_hora: new Date(e.instante).toISOString(), rol: ROL_DEL_EVENTO[e.tipo] })),
    });
  }

  const porEstado = {};
  for (const p of nuevos) porEstado[reglas.ESTADOS[p.estado]] = (porEstado[reglas.ESTADOS[p.estado]] || 0) + 1;
  return {
    hoja: tabla.hoja.nombre,
    filas: filasConDatos,
    nuevos,
    omitidos,
    por_estado: porEstado,
    clientes_nuevos: [...clientesNuevos].map(([codigo, nombre]) => ({ codigo, nombre })),
  };
}

module.exports = { analizarLibro, leerFecha };
