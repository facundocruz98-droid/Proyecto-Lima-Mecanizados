'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const reglas = require('../src/reglas');

test('semáforo: rojo si el plazo venció o el trabajo está pausado', () => {
  assert.equal(reglas.semaforo('en_proceso', -1), 'rojo');
  assert.equal(reglas.semaforo('pausado', 10), 'rojo');
  assert.equal(reglas.semaforo('pendiente_mat', -3), 'rojo');
});

test('semáforo: amarillo cuando faltan 2 días o menos, verde en el resto', () => {
  assert.equal(reglas.semaforo('en_proceso', 0), 'amarillo');
  assert.equal(reglas.semaforo('listo', 2), 'amarillo');
  assert.equal(reglas.semaforo('listo', 3), 'verde');
});

test('semáforo: un trabajo finalizado nunca queda en rojo', () => {
  assert.equal(reglas.semaforo('finalizado', -30), 'fin');
});

test('días restantes: cuenta días de calendario, sin problemas de cambio de mes o año', () => {
  assert.equal(reglas.diasRestantes('2026-11-11', '2026-11-11'), 0);
  assert.equal(reglas.diasRestantes('2026-12-01', '2026-11-30'), 1);
  assert.equal(reglas.diasRestantes('2027-01-01', '2026-12-31'), 1);
  assert.equal(reglas.diasRestantes('2026-11-01', '2026-11-11'), -10);
});

test('ID: se arma y se desarma con el formato de la empresa', () => {
  assert.equal(reglas.armarId(645, 'MPU', 'U'), '0645-MPU-U-01');
  assert.equal(reglas.armarId(37, 'ALB', 'E', 2), '0037-ALB-E-02');
  assert.deepEqual(reglas.desarmarId('0645-MPU-U-01'), { numero: 645, codigoCliente: 'MPU', urgencia: 'U', item: 1 });
});

test('ID: rechaza formatos inválidos', () => {
  for (const malo of ['', '645-MPU-U-01', '0645-MPU-U', '0645-MP-U-01', '0645-MPU-X-01', '0645-mpu-u-01', '0645-MPU-U-010', '0627-ALB-E-020SE7-ALB-E']) {
    assert.equal(reglas.desarmarId(malo), null, malo);
  }
});

test('fechas: acepta fechas reales y rechaza las imposibles', () => {
  assert.ok(reglas.esFechaValida('2026-11-30'));
  assert.ok(reglas.esFechaValida('2028-02-29'));
  assert.ok(!reglas.esFechaValida('2026-02-30'));
  assert.ok(!reglas.esFechaValida('2026-13-01'));
  assert.ok(!reglas.esFechaValida('30/11/2026'));
  assert.ok(!reglas.esFechaValida(''));
});

test('orden del panel: color, después urgentes, después plazo más cercano', () => {
  const p = (id, semaforo, urgencia, plazo) => ({ id, semaforo, urgencia, plazo_entrega: plazo });
  const lista = [
    p('D', 'verde', 'E', '2026-12-01'),
    p('B', 'rojo', 'E', '2026-11-01'),
    p('E', 'fin', 'U', '2026-10-01'),
    p('A', 'rojo', 'U', '2026-11-20'),
    p('C', 'amarillo', 'E', '2026-11-12'),
  ].sort(reglas.compararParaPanel);
  assert.deepEqual(lista.map((x) => x.id), ['A', 'B', 'C', 'D', 'E']);
});
