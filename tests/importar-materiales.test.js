'use strict';
/** Excel con columna MATERIALES: los que esperan materiales aparecen en Compras con su lista real. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.emitWarning = () => {};
const { crearServidor } = require('../src/servidor');
const { crearLibro } = require('../src/excel');
const { leerMateriales } = require('../src/importar');

const AHORA = new Date(2026, 10, 24, 12, 0, 0);
const GERENCIA = 1;
const COMPRAS = 2;
let base;
let carpeta;
let servidor;

test.before(async () => {
  carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'lima-materiales-'));
  ({ servidor } = crearServidor({ rutaBase: path.join(carpeta, 'pruebas.db'), ahora: () => AHORA, conIngreso: false }));
  await new Promise((listo) => servidor.listen(0, '127.0.0.1', listo));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

test.after(async () => {
  servidor.closeAllConnections();
  await new Promise((listo) => servidor.close(listo));
  fs.rmSync(carpeta, { recursive: true, force: true });
});

test('leerMateriales: uno por renglón o separados por punto y coma', () => {
  assert.deepEqual(leerMateriales('2 chapas 3 mm; 4 ruedas\n 10 kg electrodos  7018 ;;'), ['2 chapas 3 mm', '4 ruedas', '10 kg electrodos 7018']);
  assert.deepEqual(leerMateriales(''), []);
  assert.deepEqual(leerMateriales(null), []);
});

test('importar con MATERIALES: Compras ve la lista de los pendientes', async () => {
  const libro = crearLibro([{
    nombre: 'PROYECTOS',
    columnas: ['ID', 'FECHA IN', 'PLAZO ENTREGA', 'CLIENTE', 'NOMBRE PROYECTO', 'ESTADO OPERATIVO', 'MATERIALES'].map((titulo) => ({ titulo })),
    filas: [
      ['0950-XLS-E-01', '20/11/2026', '20/12/2026', 'Cliente Excel', 'Espera', 'Pendiente de materiales', '2 chapas inox 3 mm; 4 bridas DN100'],
      ['0951-XLS-E-01', '18/11/2026', '20/12/2026', 'Cliente Excel', 'Listo', 'Listo para iniciar', '6 caños 40 x 40'],
      ['0952-XLS-E-01', '18/11/2026', '20/12/2026', 'Cliente Excel', 'Sin columna llena', 'Listo para iniciar', ''],
    ],
  }]);
  const r = await fetch(`${base}/api/planilla/importar`, {
    method: 'POST', body: libro,
    headers: { 'Content-Type': 'application/octet-stream', 'X-Usuario': String(GERENCIA), 'X-Confirmar': 'si' },
  });
  assert.equal(r.status, 200);
  const ver = async (id) => (await fetch(`${base}/api/proyectos/${id}`, { headers: { 'X-Usuario': String(COMPRAS) } })).json();

  const espera = await ver('0950-XLS-E-01');
  assert.equal(espera.estado, 'pendiente_mat');
  assert.deepEqual(espera.materiales.map((m) => [m.descripcion, !!m.recibido]), [['2 chapas inox 3 mm', false], ['4 bridas DN100', false]]);

  const listo = await ver('0951-XLS-E-01');
  assert.equal(listo.estado, 'listo');
  assert.deepEqual(listo.materiales.map((m) => [m.descripcion, !!m.recibido]), [['6 caños 40 x 40', true]]);

  const generico = await ver('0952-XLS-E-01');
  assert.deepEqual(generico.materiales.map((m) => m.descripcion), ['Materiales indispensables (cargado desde Excel)']);

  // Compras recibe: pasa a "Listo para iniciar"
  const recibir = await fetch(`${base}/api/proyectos/0950-XLS-E-01/recepcion`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id_usuario: COMPRAS }),
  });
  assert.equal(recibir.status, 200);
  assert.equal((await recibir.json()).estado, 'listo');
});

test('el Excel de 20 proyectos entra entero: 15 listos y 5 esperando materiales', async () => {
  const archivo = path.join(__dirname, '..', 'datos', 'proyectos-20-con-compras.xlsx');
  if (!fs.existsSync(archivo)) return;
  const r = await fetch(`${base}/api/planilla/importar`, {
    method: 'POST', body: fs.readFileSync(archivo),
    headers: { 'Content-Type': 'application/octet-stream', 'X-Usuario': String(GERENCIA), 'X-Confirmar': 'si' },
  });
  const datos = await r.json();
  assert.equal(r.status, 200, JSON.stringify(datos));
  assert.equal(datos.nuevos, 20);
  assert.deepEqual(datos.omitidos, []);
  assert.deepEqual(datos.por_estado, { 'Listo para iniciar': 15, 'Pendiente de materiales': 5 });
  const lista = await (await fetch(`${base}/api/proyectos`, { headers: { 'X-Usuario': String(COMPRAS) } })).json();
  const pendientes = lista.filter((p) => p.estado === 'pendiente_mat').map((p) => p.id).sort();
  assert.deepEqual(pendientes, ['0754-TRN-E-01', '0755-FLA-E-01', '0756-PSA-E-01', '0757-MSA-U-01', '0758-IVA-E-01']);
  const balde = await (await fetch(`${base}/api/proyectos/0757-MSA-U-01`, { headers: { 'X-Usuario': String(COMPRAS) } })).json();
  console.log('  0757 →', balde.materiales.map((m) => m.descripcion).join(' | '));
  assert.equal(balde.materiales.length, 3);
});
