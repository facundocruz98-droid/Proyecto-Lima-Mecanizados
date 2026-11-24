'use strict';
/** Cancelar un proyecto: solo Gerencia, con motivo, y el proyecto sale del taller, de Compras y de las alertas. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.emitWarning = () => {};
const { crearServidor } = require('../src/servidor');

const AHORA = new Date(2026, 10, 11, 12, 0, 0);
const GERENCIA = 1;
const COMPRAS = 2;
const SUPERVISOR = 3;
const OPERARIO = 4;
let base;
let carpeta;
let servidor;

const pedir = async (metodo, ruta, cuerpo) => {
  const r = await fetch(base + ruta, {
    method: metodo,
    headers: cuerpo ? { 'Content-Type': 'application/json' } : undefined,
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const texto = await r.text();
  let datos = texto;
  try { datos = JSON.parse(texto); } catch { /* no es JSON */ }
  return { estado: r.status, datos };
};

test.before(async () => {
  carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'lima-cancelar-'));
  ({ servidor } = crearServidor({ rutaBase: path.join(carpeta, 'pruebas.db'), ahora: () => AHORA, conIngreso: false }));
  await new Promise((listo) => servidor.listen(0, '127.0.0.1', listo));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

test.after(async () => {
  servidor.closeAllConnections();
  await new Promise((listo) => servidor.close(listo));
  fs.rmSync(carpeta, { recursive: true, force: true });
});

test('cancelar: solo Gerencia y siempre con motivo', async () => {
  const id = '0643-MPU-U-02'; // pendiente de materiales en los datos de ejemplo
  for (const usuario of [OPERARIO, COMPRAS, SUPERVISOR]) {
    const r = await pedir('POST', `/api/proyectos/${id}/cancelar`, { id_usuario: usuario, motivo: 'El cliente desistió' });
    assert.equal(r.estado, 403, `usuario ${usuario}`);
  }
  const sinMotivo = await pedir('POST', `/api/proyectos/${id}/cancelar`, { id_usuario: GERENCIA, motivo: '' });
  assert.equal(sinMotivo.estado, 400);
  assert.match(sinMotivo.datos.error, /sin motivo no se puede cancelar/);

  const r = await pedir('POST', `/api/proyectos/${id}/cancelar`, { id_usuario: GERENCIA, motivo: 'El cliente desistió' });
  assert.equal(r.estado, 200);
  assert.equal(r.datos.estado, 'cancelado');
  assert.equal(r.datos.cancelacion.motivo, 'El cliente desistió');
  assert.equal(r.datos.eventos.at(-1).tipo, 'cancelar');

  const otraVez = await pedir('POST', `/api/proyectos/${id}/cancelar`, { id_usuario: GERENCIA, motivo: 'El cliente desistió' });
  assert.equal(otraVez.estado, 409);
  // Ya no se le puede registrar la recepción de materiales.
  const recepcion = await pedir('POST', `/api/proyectos/${id}/recepcion`, { id_usuario: COMPRAS });
  assert.notEqual(recepcion.estado, 200);
});

test('cancelar un proyecto pausado cierra la pausa y lo saca de las alertas', async () => {
  const id = '0642-FLA-E-01'; // pausado en los datos de ejemplo
  const r = await pedir('POST', `/api/proyectos/${id}/cancelar`, { id_usuario: GERENCIA, motivo: 'Presupuesto no aprobado' });
  assert.equal(r.estado, 200);
  assert.equal(r.datos.pausa_actual, null);
  const { datos: alertas } = await pedir('GET', '/api/alertas');
  const ids = Object.values(alertas).flat().map((p) => p.id);
  assert.ok(!ids.includes(id), 'no queda en ninguna alerta');
  const continuar = await pedir('POST', `/api/proyectos/${id}/continuar`, { id_usuario: OPERARIO });
  assert.equal(continuar.estado, 409, 'el taller no puede seguir trabajando en él');
});

test('un proyecto finalizado no se puede cancelar', async () => {
  const r = await pedir('POST', '/api/proyectos/0640-IVA-E-01/cancelar', { id_usuario: GERENCIA, motivo: 'Prueba de cancelación' });
  assert.equal(r.estado, 409);
  assert.match(r.datos.error, /ya está finalizado/);
});
