'use strict';
/**
 * Pausas múltiples: cantidad, tiempo total detenido, motivo actual,
 * historial de pausas y exportación a Excel (dos hojas).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');

process.emitWarning = () => {}; // silencia el aviso "experimental" de node:sqlite
const { abrirBase } = require('../src/db');
const { crearServicios } = require('../src/servicios');
const { planillaExcel } = require('../src/servidor');

const GERENCIA = 1;
const COMPRAS = 2;
const OPERARIO = 4;
const HORA = 3600000;

/** Lee los archivos de un .xlsx generado por el sistema (ZIP sin descriptores). */
function leerZip(buffer) {
  const archivos = {};
  let i = 0;
  while (buffer.readUInt32LE(i) === 0x04034b50) {
    const tamano = buffer.readUInt32LE(i + 18);
    const largoNombre = buffer.readUInt16LE(i + 26);
    const nombre = buffer.toString('utf8', i + 30, i + 30 + largoNombre);
    const inicio = i + 30 + largoNombre + buffer.readUInt16LE(i + 28);
    archivos[nombre] = zlib.inflateRawSync(buffer.subarray(inicio, inicio + tamano)).toString('utf8');
    i = inicio + tamano;
  }
  return archivos;
}

test('dos pausas con motivos distintos: cantidad, tiempo total y motivo actual', () => {
  let reloj = new Date(2026, 10, 11, 8, 0, 0);
  const avanzar = (horas) => { reloj = new Date(reloj.getTime() + horas * HORA); };
  const db = abrirBase(':memory:');
  const s = crearServicios(db, { ahora: () => reloj });
  s.inicializarSiEstaVacia();

  const { id } = s.crearProyecto({
    id_usuario: GERENCIA, cliente: 'Cliente de prueba', codigo_cliente: 'PRU', nombre: 'Dos pausas',
    urgencia: 'E', plazo_entrega: '2026-11-30', materiales: ['Chapa'],
  });
  s.registrarRecepcion(id, { id_usuario: COMPRAS });
  s.iniciar(id, { id_usuario: OPERARIO });
  const fila = () => s.planilla().find((f) => f.id === id);
  assert.equal(fila().cantidad_pausas, 0);
  assert.equal(fila().horas_detenido, 0);

  // Pausa 1: 2 horas por falta de material.
  avanzar(1);
  s.pausar(id, { id_usuario: OPERARIO, causa: 'Falta de material', detalle: 'Faltan bulones' });
  avanzar(2);
  s.registrarRecepcionParcial(id, { id_usuario: COMPRAS, material: 'bulones' }); // Compras registra la llegada
  s.continuar(id, { id_usuario: OPERARIO });

  // Pausa 2: activa, por máquina. Lleva 1,5 h hasta "ahora".
  avanzar(1);
  s.pausar(id, { id_usuario: OPERARIO, causa: 'Máquina o herramienta', detalle: 'Se rompió la plegadora' });
  avanzar(1.5);
  let f = fila();
  assert.equal(f.cantidad_pausas, 2);
  assert.ok(Math.abs(f.horas_detenido - 3.5) < 1e-9, 'suma 2 h + 1,5 h (la activa, hasta ahora)');
  assert.equal(f.motivo_demora, 'Máquina o herramienta: Se rompió la plegadora', 'muestra la última pausa');
  assert.ok(Math.abs(s.obtenerProyecto(id).tiempos.horas_en_pausa - f.horas_detenido) < 1e-9,
    'coincide con el tiempo detenido del historial');

  // Al reanudar, la pausa activa se cierra sin duplicar tiempo.
  avanzar(0.5);
  s.continuar(id, { id_usuario: OPERARIO });
  avanzar(5);
  f = fila();
  assert.equal(f.cantidad_pausas, 2);
  assert.ok(Math.abs(f.horas_detenido - 4) < 1e-9, '2 h + 2 h, sin contar el tiempo posterior');
  assert.equal(f.motivo_demora, '', 'ya no está pausado');

  // El historial conserva las dos pausas por separado.
  const pausas = s.historialPausas().filter((p) => p.id_proyecto === id);
  assert.deepEqual(pausas.map((p) => [p.numero, p.causa, p.horas, p.activa]),
    [[1, 'Falta de material', 2, false], [2, 'Máquina o herramienta', 2, false]]);
  assert.ok(pausas.every((p) => p.registrada_por && p.reanudada_por && p.fin));
  assert.deepEqual(s.obtenerProyecto(id).eventos.filter((e) => e.tipo === 'pausa').length, 2);

  // Excel: dos hojas; las dos pausas en filas separadas; sin Nro de presupuesto.
  const libro = leerZip(planillaExcel(s.planilla(), s.historialPausas()));
  assert.match(libro['xl/workbook.xml'], /name="Resumen de proyectos".*name="Historial de pausas"/);
  assert.ok(!libro['xl/worksheets/sheet1.xml'].includes('Presupuesto'));
  assert.match(libro['xl/worksheets/sheet1.xml'], /Cantidad de pausas.*Tiempo total detenido/);
  const hoja2 = libro['xl/worksheets/sheet2.xml'];
  assert.equal((hoja2.match(new RegExp(`<t xml:space="preserve">${id}</t>`, 'g')) || []).length, 2);
  assert.match(hoja2, /Faltan bulones/);
  assert.match(hoja2, /Se rompió la plegadora/);
  db.close();
});

test('pausa por falta de material: Continuar recién cuando Compras registra la llegada', () => {
  const reloj = new Date(2026, 10, 11, 8, 0, 0);
  const db = abrirBase(':memory:');
  const s = crearServicios(db, { ahora: () => reloj });
  s.inicializarSiEstaVacia();
  const { id } = s.crearProyecto({
    id_usuario: GERENCIA, cliente: 'Cliente de prueba', codigo_cliente: 'PRU', nombre: 'Espera material',
    urgencia: 'E', plazo_entrega: '2026-11-30', materiales: ['Chapa'],
  });
  s.registrarRecepcion(id, { id_usuario: COMPRAS });
  s.iniciar(id, { id_usuario: OPERARIO });

  // Por falta de material: bloqueado hasta que Compras registra la llegada.
  s.pausar(id, { id_usuario: OPERARIO, causa: 'Falta de material', detalle: 'Faltan hierros' });
  assert.throws(() => s.continuar(id, { id_usuario: OPERARIO }), /Compras tiene que registrar la llegada/);
  assert.equal(s.obtenerProyecto(id).estado, 'pausado');
  s.registrarRecepcionParcial(id, { id_usuario: COMPRAS, material: '10 hierros 12 mm' });
  assert.equal(s.continuar(id, { id_usuario: OPERARIO }).estado, 'en_proceso');

  // Por otro motivo: el operario continúa cuando quiere.
  s.pausar(id, { id_usuario: OPERARIO, causa: 'Máquina o herramienta', detalle: 'Se rompió la amoladora' });
  assert.equal(s.continuar(id, { id_usuario: OPERARIO }).estado, 'en_proceso');

  // Una llegada vieja no destraba una pausa nueva por falta de material.
  s.pausar(id, { id_usuario: OPERARIO, causa: 'Falta de material', detalle: 'Faltan bulones' });
  assert.throws(() => s.continuar(id, { id_usuario: OPERARIO }), /Compras/);
});
