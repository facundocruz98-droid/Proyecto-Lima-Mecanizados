'use strict';
/**
 * Entrega estimada (plazo + tiempo detenido) y link de seguimiento del cliente.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.emitWarning = () => {}; // silencia el aviso "experimental" de node:sqlite
const { abrirBase } = require('../src/db');
const { crearServicios } = require('../src/servicios');
const reglas = require('../src/reglas');

const GERENCIA = 1;
const COMPRAS = 2;
const OPERARIO = 4;
const HORA = 3600000;

function preparar() {
  let reloj = new Date(2026, 10, 11, 8, 0, 0);
  const avanzar = (horas) => { reloj = new Date(reloj.getTime() + horas * HORA); };
  const db = abrirBase(':memory:');
  const s = crearServicios(db, { ahora: () => reloj });
  s.inicializarSiEstaVacia();
  const { id } = s.crearProyecto({
    id_usuario: GERENCIA, cliente: 'Cliente de prueba', codigo_cliente: 'PRU', nombre: 'Portón',
    urgencia: 'E', plazo_entrega: '2026-11-30', materiales: ['Chapa'],
  });
  s.registrarRecepcion(id, { id_usuario: COMPRAS });
  s.iniciar(id, { id_usuario: OPERARIO });
  return { s, id, avanzar };
}

test('reglas: corrimiento por día o fracción y suma de días', () => {
  assert.equal(reglas.diasDeCorrimiento(0), 0);
  assert.equal(reglas.diasDeCorrimiento(0.5), 1);
  assert.equal(reglas.diasDeCorrimiento(24), 1);
  assert.equal(reglas.diasDeCorrimiento(25), 2);
  assert.equal(reglas.sumarDias('2026-11-30', 2), '2026-12-02');
  assert.equal(reglas.sumarDias('2026-12-31', 1), '2027-01-01');
});

test('sin pausas la entrega estimada es el plazo de la empresa', () => {
  const { s, id } = preparar();
  const p = s.obtenerProyecto(id);
  assert.equal(p.fecha_estimada, '2026-11-30');
  assert.equal(p.dias_corrimiento, 0);
});

test('las pausas corren la entrega estimada, incluida la pausa en curso', () => {
  const { s, id, avanzar } = preparar();
  avanzar(1);
  s.pausar(id, { id_usuario: OPERARIO, causa: 'Falta de material', detalle: 'Faltan bulones' });
  avanzar(30); // 30 h detenido → 2 días
  s.continuar(id, { id_usuario: OPERARIO });
  let p = s.obtenerProyecto(id);
  assert.equal(p.dias_corrimiento, 2);
  assert.equal(p.fecha_estimada, '2026-12-02');
  assert.equal(p.plazo_entrega, '2026-11-30', 'el plazo de la empresa no se toca');

  avanzar(2);
  s.pausar(id, { id_usuario: OPERARIO, causa: 'Máquina o herramienta', detalle: 'Plegadora rota' });
  avanzar(20); // en curso: 30 h + 20 h = 50 h → 3 días
  p = s.obtenerProyecto(id);
  assert.equal(p.dias_corrimiento, 3);
  assert.equal(p.fecha_estimada, '2026-12-03');
});

test('al reprogramar, el conteo vuelve a empezar desde el nuevo plazo', () => {
  const { s, id, avanzar } = preparar();
  s.pausar(id, { id_usuario: OPERARIO, causa: 'Otro', detalle: 'Cambio de plano' });
  avanzar(48);
  s.continuar(id, { id_usuario: OPERARIO });
  assert.equal(s.obtenerProyecto(id).fecha_estimada, '2026-12-02');
  s.reprogramar(id, { id_usuario: GERENCIA, plazo_entrega: '2026-12-05', motivo: 'Acordado con el cliente' });
  const p = s.obtenerProyecto(id);
  assert.equal(p.dias_corrimiento, 0);
  assert.equal(p.fecha_estimada, '2026-12-05');
});

test('el link del cliente muestra solo datos públicos y no se puede adivinar', () => {
  const { s, id, avanzar } = preparar();
  s.pausar(id, { id_usuario: OPERARIO, causa: 'Falta de material', detalle: 'Faltan bulones M10' });
  avanzar(5);
  const { token_cliente: token } = s.obtenerProyecto(id);
  assert.equal(token.length, 22);

  const c = s.seguimientoCliente(token);
  assert.equal(c.id, id);
  assert.equal(c.estado_texto, 'Detenido momentáneamente');
  assert.equal(c.plazo_entrega, '2026-11-30');
  assert.equal(c.fecha_estimada, '2026-12-01');
  assert.deepEqual(c.pasos.map((e) => `${e.clave}:${e.estado}`),
    ['recibido:hecha', 'fabricacion:actual', 'listo:pendiente', 'entregado:pendiente']);
  const texto = JSON.stringify(c);
  assert.ok(!texto.includes('Soldadura'), 'no expone las operaciones internas del taller');
  assert.ok(!texto.includes('bulones'), 'no expone el detalle interno de la pausa');
  assert.ok(!texto.includes('Falta de material'), 'no expone la causa interna');
  assert.ok(!('token_cliente' in c));

  assert.throws(() => s.seguimientoCliente(id), /no es válido/);
  assert.throws(() => s.seguimientoCliente(`${token.slice(0, 21)}x`), /no es válido/);
});

test('si la entrega estimada ya pasó y no terminó, queda en revisión', () => {
  const { s, id, avanzar } = preparar();
  avanzar(24 * 25); // 06/12, plazo 30/11 sin pausas
  const c = s.seguimientoCliente(s.obtenerProyecto(id).token_cliente);
  assert.equal(c.en_revision, true);
});

test('etapas del cliente según el estado del proyecto', () => {
  const ver = (estado) => reglas.pasosCliente(estado).map((e) => `${e.clave}:${e.estado}`);
  assert.deepEqual(ver('pendiente_mat'), ['recibido:actual', 'fabricacion:pendiente', 'listo:pendiente', 'entregado:pendiente']);
  assert.deepEqual(ver('listo'), ['recibido:actual', 'fabricacion:pendiente', 'listo:pendiente', 'entregado:pendiente']);
  assert.deepEqual(ver('en_proceso'), ['recibido:hecha', 'fabricacion:actual', 'listo:pendiente', 'entregado:pendiente']);
  assert.deepEqual(ver('pausado'), ['recibido:hecha', 'fabricacion:actual', 'listo:pendiente', 'entregado:pendiente']);
  assert.deepEqual(reglas.pasosCliente('cancelado'), []);
});

test('al finalizar, el cliente ve la línea completa hasta Entregado (solo visual)', () => {
  const { s, id, avanzar } = preparar();
  avanzar(5);
  s.finalizar(id, { id_usuario: OPERARIO });
  const c = s.seguimientoCliente(s.obtenerProyecto(id).token_cliente);
  assert.deepEqual(c.pasos.map((e) => `${e.clave}:${e.estado}`),
    ['recibido:hecha', 'fabricacion:hecha', 'listo:hecha', 'entregado:actual']);
  assert.ok(c.fecha_fin, 'muestra la fecha real de finalización');
  const eventos = s.obtenerProyecto(id).eventos.map((e) => e.tipo);
  assert.equal(eventos.at(-1), 'finalizar', 'no se registra ninguna entrega en la base');
});
