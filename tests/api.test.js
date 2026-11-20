'use strict';
/**
 * Pruebas de punta a punta de la API: levantan el servidor real con una base
 * de datos temporal y recorren el ciclo completo de un proyecto.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.emitWarning = () => {}; // silencia el aviso "experimental" de node:sqlite
const { crearServidor } = require('../src/servidor');

const AHORA = new Date(2026, 10, 11, 12, 0, 0); // 11/11/2026 12:00, hora local
let base;
let carpeta;
let servidor;

const pedir = async (metodo, ruta, cuerpo) => {
  const respuesta = await fetch(base + ruta, {
    method: metodo,
    headers: cuerpo ? { 'Content-Type': 'application/json' } : undefined,
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const texto = await respuesta.text();
  let datos = texto;
  try { datos = JSON.parse(texto); } catch { /* no es JSON */ }
  return { estado: respuesta.status, datos, cabeceras: respuesta.headers };
};

// Usuarios de los datos de ejemplo.
const GERENCIA = 1;
const COMPRAS = 2;
const SUPERVISOR = 3;
const OPERARIO = 4;

test.before(async () => {
  carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'lima-pruebas-'));
  ({ servidor } = crearServidor({ rutaBase: path.join(carpeta, 'pruebas.db'), ahora: () => AHORA }));
  await new Promise((listo) => servidor.listen(0, '127.0.0.1', listo));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

test.after(async () => {
  servidor.closeAllConnections();
  await new Promise((listo) => servidor.close(listo));
  fs.rmSync(carpeta, { recursive: true, force: true });
});

const nuevoProyecto = (extra = {}) => ({
  id_usuario: GERENCIA,
  cliente: 'Cliente de prueba',
  codigo_cliente: 'PRU',
  nombre: 'Carro de prueba',
  descripcion: 'Fabricar y pintar',
  nro_presupuesto: 'PP - 999999 - PRU',
  urgencia: 'E',
  plazo_entrega: '2026-11-30',
  materiales: ['Chapa 2 mm', 'Ruedas'],
  ...extra,
});

test('datos de ejemplo: semáforo y orden del panel', async () => {
  const { estado, datos } = await pedir('GET', '/api/proyectos');
  assert.equal(estado, 200);
  const porId = Object.fromEntries(datos.map((p) => [p.id, p]));
  assert.equal(porId['0641-FRN-U-01'].semaforo, 'rojo');      // plazo vencido
  assert.equal(porId['0642-FLA-E-01'].semaforo, 'rojo');      // pausado
  assert.equal(porId['0643-MPU-U-01'].semaforo, 'amarillo');  // vence mañana
  assert.equal(porId['0644-IVA-E-01'].semaforo, 'verde');
  assert.equal(porId['0640-IVA-E-01'].semaforo, 'fin');
  assert.deepEqual(datos.slice(0, 2).map((p) => p.id), ['0641-FRN-U-01', '0642-FLA-E-01'], 'urgente primero dentro del rojo');
  assert.equal(datos.at(-1).id, '0640-IVA-E-01', 'los finalizados van al final');
});

test('alta: valida los datos obligatorios', async () => {
  const casos = [
    [{ plazo_entrega: '' }, /plazo de entrega es obligatorio/],
    [{ plazo_entrega: '2026-11-10' }, /anterior a hoy/],
    [{ plazo_entrega: '2026-02-30' }, /fecha válida/],
    [{ codigo_cliente: 'PR' }, /3 letras/],
    [{ nombre: '  ' }, /nombre del proyecto/],
    [{ materiales: [] }, /material indispensable/],
    [{ urgencia: 'X' }, /urgencia/],
    [{ id_usuario: OPERARIO }, /Solo Gerencia/],
  ];
  for (const [cambio, mensaje] of casos) {
    const { estado, datos } = await pedir('POST', '/api/proyectos', nuevoProyecto(cambio));
    assert.ok(estado >= 400 && estado < 500, JSON.stringify(cambio));
    assert.match(datos.error, mensaje);
  }
});

test('alta: el ID tiene que ser único, bien formado y coherente', async () => {
  let r = await pedir('POST', '/api/proyectos', nuevoProyecto({ id: '0643-MPU-U-01', codigo_cliente: 'MPU', urgencia: 'U' }));
  assert.equal(r.estado, 409);
  assert.match(r.datos.error, /ya existe/);

  r = await pedir('POST', '/api/proyectos', nuevoProyecto({ id: '643-PRU' }));
  assert.equal(r.estado, 400);
  assert.match(r.datos.error, /formato/);

  r = await pedir('POST', '/api/proyectos', nuevoProyecto({ id: '0700-ABC-E-01' }));
  assert.match(r.datos.error, /cliente ABC/);

  r = await pedir('POST', '/api/proyectos', nuevoProyecto({ id: '0700-PRU-U-01' }));
  assert.match(r.datos.error, /urgencia U/);
});

test('ciclo completo de un proyecto: alta → recepción → inicio → pausa → llegada → continuar → finalizar', async () => {
  // Alta: el sistema genera el ID siguiente.
  let r = await pedir('POST', '/api/proyectos', nuevoProyecto());
  assert.equal(r.estado, 201);
  const id = r.datos.id;
  assert.equal(id, '0645-PRU-E-01');
  assert.equal(r.datos.estado, 'pendiente_mat');

  // Sin materiales no se puede iniciar.
  r = await pedir('POST', `/api/proyectos/${id}/iniciar`, { id_usuario: OPERARIO });
  assert.equal(r.estado, 409);
  assert.match(r.datos.error, /faltan los materiales indispensables/);

  // Solo Compras registra la recepción.
  r = await pedir('POST', `/api/proyectos/${id}/recepcion`, { id_usuario: OPERARIO });
  assert.equal(r.estado, 403);
  r = await pedir('POST', `/api/proyectos/${id}/recepcion`, { id_usuario: COMPRAS });
  assert.equal(r.datos.estado, 'listo');
  assert.ok(r.datos.materiales.every((m) => m.recibido));
  r = await pedir('POST', `/api/proyectos/${id}/recepcion`, { id_usuario: COMPRAS });
  assert.equal(r.estado, 400, 'no se puede recibir dos veces');

  // Inicio: la planilla pasa a En Ejec = TRUE.
  r = await pedir('POST', `/api/proyectos/${id}/iniciar`, { id_usuario: OPERARIO });
  assert.equal(r.datos.estado, 'en_proceso');
  assert.equal(r.datos.etapa_actual, 'Corte');
  let fila = (await pedir('GET', '/api/planilla')).datos.find((f) => f.id === id);
  assert.equal(fila.en_ejecucion, true);
  assert.equal(fila.fecha_fin, '');

  // Cambio de etapa (lo puede hacer también el supervisor).
  r = await pedir('POST', `/api/proyectos/${id}/etapa`, { id_usuario: SUPERVISOR, etapa: 'Soldadura' });
  assert.equal(r.datos.etapa_actual, 'Soldadura');
  r = await pedir('POST', `/api/proyectos/${id}/etapa`, { id_usuario: OPERARIO, etapa: 'Lijado' });
  assert.equal(r.estado, 400);

  // Pausa: causa y descripción obligatorias.
  r = await pedir('POST', `/api/proyectos/${id}/pausar`, { id_usuario: OPERARIO });
  assert.match(r.datos.error, /causa/);
  r = await pedir('POST', `/api/proyectos/${id}/pausar`, { id_usuario: OPERARIO, causa: 'Falta de material', detalle: ' ' });
  assert.match(r.datos.error, /Sin descripción no se puede pausar/);
  r = await pedir('POST', `/api/proyectos/${id}`, {});
  assert.equal(r.estado, 404);
  assert.equal((await pedir('GET', `/api/proyectos/${id}`)).datos.estado, 'en_proceso', 'sigue en proceso');

  r = await pedir('POST', `/api/proyectos/${id}/pausar`, { id_usuario: OPERARIO, causa: 'Falta de material', detalle: 'Faltan 4 ruedas' });
  assert.equal(r.datos.estado, 'pausado');
  assert.equal(r.datos.semaforo, 'rojo');

  // Alerta a Compras y Gerencia, y motivo visible en la planilla.
  let alertas = (await pedir('GET', '/api/alertas')).datos;
  assert.ok(alertas.falta_material.some((p) => p.id === id));
  fila = (await pedir('GET', '/api/planilla')).datos.find((f) => f.id === id);
  assert.equal(fila.en_ejecucion, false);
  assert.equal(fila.motivo_demora, 'Falta de material: Faltan 4 ruedas');

  // Llega el material: la alerta se cierra.
  r = await pedir('POST', `/api/proyectos/${id}/recepcion-parcial`, { id_usuario: COMPRAS, material: '' });
  assert.match(r.datos.error, /qué material llegó/);
  r = await pedir('POST', `/api/proyectos/${id}/recepcion-parcial`, { id_usuario: COMPRAS, material: '4 ruedas' });
  assert.equal(r.estado, 200);
  alertas = (await pedir('GET', '/api/alertas')).datos;
  assert.ok(!alertas.falta_material.some((p) => p.id === id));
  assert.ok(alertas.material_recibido.some((p) => p.id === id));

  // No se puede finalizar un trabajo pausado.
  r = await pedir('POST', `/api/proyectos/${id}/finalizar`, { id_usuario: OPERARIO });
  assert.equal(r.estado, 409);

  // Continuar y finalizar: Fecha Fin se completa sola.
  r = await pedir('POST', `/api/proyectos/${id}/continuar`, { id_usuario: OPERARIO });
  assert.equal(r.datos.estado, 'en_proceso');
  r = await pedir('POST', `/api/proyectos/${id}/finalizar`, { id_usuario: OPERARIO });
  assert.equal(r.datos.estado, 'finalizado');
  assert.equal(r.datos.semaforo, 'fin');
  fila = (await pedir('GET', '/api/planilla')).datos.find((f) => f.id === id);
  assert.equal(fila.en_ejecucion, false);
  assert.equal(fila.fecha_fin, '2026-11-11');

  // Historial completo, en orden.
  const detalle = (await pedir('GET', `/api/proyectos/${id}`)).datos;
  assert.deepEqual(detalle.eventos.map((e) => e.tipo),
    ['alta', 'recepcion', 'inicio', 'etapa', 'pausa', 'recepcion_parcial', 'continuar', 'finalizar']);
  assert.equal(detalle.eventos[4].etapa, 'Soldadura', 'la pausa guarda en qué etapa ocurrió');

  // Un trabajo finalizado no admite más acciones.
  for (const accion of ['iniciar', 'pausar', 'continuar', 'finalizar']) {
    r = await pedir('POST', `/api/proyectos/${id}/${accion}`, { id_usuario: OPERARIO, causa: 'Otro', detalle: 'prueba' });
    assert.equal(r.estado, 409, accion);
  }
});

test('otra parte del mismo pedido lleva el ítem siguiente', async () => {
  const r = await pedir('POST', '/api/proyectos', nuevoProyecto({ id: '0645-PRU-E-02', nombre: 'Segunda parte' }));
  assert.equal(r.estado, 201);
  assert.equal(r.datos.item, 2);
  const siguiente = await pedir('POST', '/api/proyectos', nuevoProyecto({ nombre: 'Otro pedido' }));
  assert.equal(siguiente.datos.id, '0646-PRU-E-01');
});

test('reprogramar: solo Gerencia y siempre con motivo', async () => {
  const id = '0641-FRN-U-01';
  let r = await pedir('POST', `/api/proyectos/${id}/reprogramar`, { id_usuario: OPERARIO, plazo_entrega: '2026-11-20', motivo: 'Cambio de terminación' });
  assert.equal(r.estado, 403);
  r = await pedir('POST', `/api/proyectos/${id}/reprogramar`, { id_usuario: GERENCIA, plazo_entrega: '2026-11-20', motivo: '' });
  assert.match(r.datos.error, /sin motivo no se puede reprogramar/);
  r = await pedir('POST', `/api/proyectos/${id}/reprogramar`, { id_usuario: GERENCIA, plazo_entrega: '2026-11-01', motivo: 'Cambio de terminación' });
  assert.match(r.datos.error, /anterior a hoy/);
  r = await pedir('POST', `/api/proyectos/${id}/reprogramar`, { id_usuario: GERENCIA, plazo_entrega: '2026-11-20', motivo: 'Cambio de terminación' });
  assert.equal(r.estado, 200);
  assert.equal(r.datos.plazo_entrega, '2026-11-20');
  assert.equal(r.datos.semaforo, 'verde', 'deja de estar vencido');
  assert.match(r.datos.eventos.at(-1).detalle, /2026-11-10 → 2026-11-20: Cambio de terminación/);
});

test('indicadores: cuentan las pausas por causa y por etapa', async () => {
  const { datos } = await pedir('GET', '/api/indicadores');
  const porCausa = Object.fromEntries(datos.causas.map((c) => [c.causa, c.pausas]));
  assert.equal(porCausa['Falta de material'], 3);
  assert.equal(porCausa['Máquina o herramienta'], 1);
  assert.equal(datos.total_pausas, 4);
  assert.ok(datos.total_horas > 0);
  assert.equal(datos.etapas.find((e) => e.etapa === 'Soldadura').pausas, 2);
});

test('dashboard: los mismos proyectos de la planilla, con su historial de eventos', async () => {
  const { estado, datos } = await pedir('GET', '/api/dashboard');
  assert.equal(estado, 200);
  const planilla = (await pedir('GET', '/api/planilla')).datos;
  assert.deepEqual(datos.proyectos.map((p) => p.id), planilla.map((p) => p.id));
  for (const p of datos.proyectos) {
    assert.ok(p.eventos.length >= 1, `${p.id} tiene historial`);
    assert.equal(p.eventos[0].tipo, 'alta');
    assert.match(p.eventos[0].fecha_hora, /Z$/);
    assert.equal(p.estado, planilla.find((f) => f.id === p.id).estado);
  }
  assert.match(datos.hoy, /^\d{4}-\d{2}-\d{2}$/);
});

test('cargar Excel: vista previa, confirmación y sin duplicar', async () => {
  const { crearLibro, fechaExcel } = require('../src/excel');
  const historial = JSON.stringify([
    { tipo: 'alta', fecha_hora: '2026-10-01T12:00:00Z' },
    { tipo: 'recepcion', fecha_hora: '2026-10-02T12:00:00Z' },
    { tipo: 'inicio', fecha_hora: '2026-10-03T12:00:00Z', etapa: 'Corte' },
    { tipo: 'etapa_fin', fecha_hora: '2026-10-04T12:00:00Z', etapa: 'Corte' },
    { tipo: 'etapa_inicio', fecha_hora: '2026-10-04T12:05:00Z', etapa: 'Soldadura' },
    { tipo: 'pausa', fecha_hora: '2026-10-05T12:00:00Z', causa: 'Falta de material', detalle: 'Sin electrodos', etapa: 'Soldadura' },
  ]);
  const libro = crearLibro([{
    nombre: 'Proyectos',
    columnas: ['ID', 'FECHA IN', 'PLAZO ENTREGA', 'CLIENTE', 'NOMBRE PROY', 'ESTADO OPERATIVO', 'Fecha Fin', 'HISTORIAL EVENTOS (JSON)']
      .map((titulo) => ({ titulo, ancho: 10 })),
    filas: [
      ['0900-XLS-E-01', fechaExcel('2026-10-01'), fechaExcel('2026-12-01'), 'Cliente Excel', 'Con historial', 'Pausado', '', historial],
      ['0901-XLS-U-01', '02/10/2026', '2026-12-05', 'Cliente Excel', 'Solo estado', 'Finalizado', '20/10/2026', ''],
      ['0902-XLS-E-01', '03/10/2026', '06/12/2026', 'Cliente Excel', 'Cancelado', 'Cancelado', '', ''],
      ['0640-IVA-E-01', '03/10/2026', '06/12/2026', 'Ingenio', 'Ya existe', 'Listo para iniciar', '', ''],
      ['MAL-ID', '03/10/2026', '06/12/2026', 'Cliente', 'ID inválido', '', '', ''],
    ],
  }]);
  const subir = (usuario, confirmar) => fetch(`${base}/api/planilla/importar`, {
    method: 'POST', body: libro,
    headers: { 'Content-Type': 'application/octet-stream', 'X-Usuario': String(usuario), ...(confirmar ? { 'X-Confirmar': 'si' } : {}) },
  }).then(async (r) => ({ estado: r.status, datos: await r.json() }));

  assert.equal((await subir(COMPRAS, false)).estado, 403);

  const previa = await subir(GERENCIA, false);
  assert.equal(previa.estado, 200);
  assert.equal(previa.datos.guardado, false);
  assert.equal(previa.datos.nuevos, 2);
  assert.deepEqual(previa.datos.omitidos.map((o) => o.id), ['0902-XLS-E-01', '0640-IVA-E-01', 'MAL-ID']);
  assert.equal((await pedir('GET', '/api/proyectos/0900-XLS-E-01')).estado, 404, 'la vista previa no guarda');

  const guardado = await subir(GERENCIA, true);
  assert.equal(guardado.datos.guardado, true);
  const pausado = (await pedir('GET', '/api/proyectos/0900-XLS-E-01')).datos;
  assert.equal(pausado.estado, 'pausado');
  assert.equal(pausado.etapa_actual, 'Soldadura');
  assert.equal(pausado.pausa_actual.causa, 'Falta de material');
  assert.deepEqual(pausado.eventos.map((e) => e.tipo), ['alta', 'recepcion', 'inicio', 'etapa', 'pausa']);
  const finalizado = (await pedir('GET', '/api/proyectos/0901-XLS-U-01')).datos;
  assert.equal(finalizado.estado, 'finalizado');
  assert.equal(finalizado.urgencia, 'U');

  const otraVez = await subir(GERENCIA, true);
  assert.equal(otraVez.datos.nuevos, 0, 'lo que ya se cargó no se duplica');

  const basura = await fetch(`${base}/api/planilla/importar`, { method: 'POST', body: 'esto no es un excel', headers: { 'X-Usuario': String(GERENCIA) } });
  assert.equal(basura.status, 400);
});

test('planilla CSV: lista para Excel', async () => {
  const { estado, datos, cabeceras } = await pedir('GET', '/api/planilla.csv');
  assert.equal(estado, 200);
  assert.match(cabeceras.get('content-type'), /text\/csv/);
  const lineas = datos.replace(/^﻿/, '').trim().split('\r\n');
  assert.equal(lineas[0].split(';').length, 17);
  assert.ok(!lineas[0].includes('Presupuesto'), 'la planilla ya no muestra el Nro de presupuesto');
  assert.match(lineas[0], /Cantidad de pausas;Tiempo total detenido \(horas\)$/);
  assert.match(lineas[0], /^#;FECHA IN;PLAZO ENTREGA;CLIENTE;NOMBRE PROY/);
  assert.match(lineas[1], /^1;/);
  assert.ok(lineas.some((l) => l.includes('0640-IVA-E-01') && l.includes('07/11/2026')), 'Fecha Fin con formato argentino');
});

test('errores: código inexistente, ruta inexistente y datos mal formados', async () => {
  let r = await pedir('GET', '/api/proyectos/9999-XXX-E-01');
  assert.equal(r.estado, 404);
  assert.match(r.datos.error, /no corresponde a ningún proyecto/);
  r = await pedir('GET', '/api/no-existe');
  assert.equal(r.estado, 404);
  const cruda = await fetch(`${base}/api/proyectos`, { method: 'POST', body: '{esto no es json' });
  assert.equal(cruda.status, 400);
});

test('archivos: sirve la interfaz y no deja salir de la carpeta pública', async () => {
  let r = await pedir('GET', '/');
  assert.equal(r.estado, 200);
  assert.match(r.datos, /Seguimiento de Taller/);
  r = await pedir('GET', '/js/app.js');
  assert.equal(r.estado, 200);
  const fuera = await fetch(`${base}/..%2Fserver.js`);
  assert.ok([403, 404].includes(fuera.status));
  const fuera2 = await fetch(`${base}/%2e%2e/%2e%2e/server.js`);
  assert.ok([403, 404].includes(fuera2.status));
  const fuera3 = await fetch(`${base}/..%5C..%5Csrc%5Cdb.js`);
  assert.ok([403, 404].includes(fuera3.status));
});

test('restablecer la demo vuelve a los 6 proyectos de ejemplo', async () => {
  const r = await pedir('POST', '/api/demo/restablecer');
  assert.equal(r.estado, 200);
  const { datos } = await pedir('GET', '/api/proyectos');
  assert.equal(datos.length, 6);
});
