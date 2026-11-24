'use strict';
/** Ingreso con usuario y contraseña, sesiones y permisos por rol. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { crearServidor } = require('../src/servidor');

let servidor;
let base;
let claves;
let carpeta;

test.before(async () => {
  carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'lima-ingreso-'));
  const creado = crearServidor({ rutaBase: path.join(carpeta, 'pruebas.db') });
  servidor = creado.servidor;
  claves = Object.fromEntries(creado.cuentasNuevas.map((c) => [c.usuario, c.clave]));
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

test.after(async () => {
  await new Promise((r) => servidor.close(r));
  fs.rmSync(carpeta, { recursive: true, force: true });
});

async function pedir(metodo, ruta, { cuerpo, cookie, origen } = {}) {
  const headers = {};
  if (cuerpo) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  if (origen) headers.Origin = origen;
  const r = await fetch(base + ruta, { method: metodo, headers, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
  let datos = null;
  try { datos = await r.json(); } catch { /* sin cuerpo */ }
  return { estado: r.status, datos, cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
}

const ingresar = async (usuario) => (await pedir('POST', '/api/sesion', { cuerpo: { usuario, clave: claves[usuario] } })).cookie;

test('se crean las 6 cuentas y sus contraseñas iniciales quedan anotadas en un archivo', () => {
  assert.deepEqual(Object.keys(claves).sort(), ['compras', 'dueno1', 'dueno2', 'operario1', 'operario2', 'supervisor']);
  const archivo = fs.readFileSync(path.join(carpeta, 'CLAVES-INICIALES.txt'), 'utf8');
  for (const [usuario, clave] of Object.entries(claves)) assert.match(archivo, new RegExp(`${usuario}.*${clave}`));
});

test('sin sesión no se puede leer ni hacer nada; el seguimiento del cliente sigue siendo público', async () => {
  assert.equal((await pedir('GET', '/api/proyectos')).estado, 401);
  assert.equal((await pedir('POST', '/api/proyectos', { cuerpo: {} })).estado, 401);
  assert.equal((await pedir('POST', '/api/demo/restablecer')).estado, 401);
  assert.equal((await pedir('GET', '/api/seguimiento/token-invalido')).estado !== 401, true);
});

test('contraseña incorrecta: mensaje genérico, sin decir si el usuario existe', async () => {
  const mal = await pedir('POST', '/api/sesion', { cuerpo: { usuario: 'dueno2', clave: 'no-es' } });
  const inexistente = await pedir('POST', '/api/sesion', { cuerpo: { usuario: 'nadie', clave: 'no-es' } });
  assert.equal(mal.estado, 401);
  assert.equal(inexistente.estado, 401);
  assert.equal(mal.datos.error, inexistente.datos.error);
});

test('la cookie de sesión es HttpOnly y SameSite=Strict', async () => {
  const r = await fetch(`${base}/api/sesion`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario: 'dueno1', clave: claves.dueno1 }),
  });
  const cookie = r.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
});

test('cada rol ve solo su parte', async () => {
  const esperado = {
    dueno1: ['panel', 'dashboard', 'alta', 'historial', 'planilla'],
    supervisor: ['panel', 'historial'],
    compras: ['compras'],
    operario1: ['taller'],
  };
  for (const [usuario, rutas] of Object.entries(esperado)) {
    const yo = await pedir('GET', '/api/sesion', { cookie: await ingresar(usuario) });
    assert.deepEqual(yo.datos.rutas, rutas, usuario);
  }
  const operario = await ingresar('operario1');
  assert.equal((await pedir('GET', '/api/proyectos', { cookie: operario })).estado, 200);
  assert.equal((await pedir('GET', '/api/dashboard', { cookie: operario })).estado, 403);
  assert.equal((await pedir('GET', '/api/planilla.xlsx', { cookie: operario })).estado, 403);
  assert.equal((await pedir('POST', '/api/demo/restablecer', { cookie: operario })).estado, 403);
  const compras = await ingresar('compras');
  assert.equal((await pedir('POST', '/api/proyectos/0641-FRN-U-01/pausar', { cookie: compras, cuerpo: {} })).estado, 403);
  assert.equal((await pedir('POST', '/api/proyectos', { cookie: compras, cuerpo: {} })).estado, 403);
});

test('las acciones quedan a nombre de quien inició sesión, aunque se mande otro usuario', async () => {
  const dueno = await ingresar('dueno1');
  const catalogo = (await pedir('GET', '/api/catalogo', { cookie: dueno })).datos;
  const gerencia = catalogo.usuarios.find((u) => u.rol === 'Gerencia');
  const operario = await ingresar('operario2');
  // El operario intenta registrar una pausa "como Gerencia": el servidor usa su propia sesión.
  const proyectos = (await pedir('GET', '/api/proyectos', { cookie: operario })).datos;
  const enProceso = proyectos.find((p) => p.estado === 'en_proceso');
  const r = await pedir('POST', `/api/proyectos/${enProceso.id}/pausar`, {
    cookie: operario, cuerpo: { id_usuario: gerencia.id, causa: 'Otro', detalle: 'Prueba de permisos' },
  });
  assert.equal(r.estado, 200);
  const ultima = r.datos.eventos.at(-1);
  assert.equal(ultima.tipo, 'pausa');
  assert.equal(ultima.usuario, 'Operario 2');
});

test('pedidos desde otro sitio se rechazan', async () => {
  const dueno = await ingresar('dueno1');
  const r = await pedir('POST', '/api/demo/restablecer', { cookie: dueno, origen: 'https://sitio-ajeno.com' });
  assert.equal(r.estado, 403);
});

test('cambiar la contraseña: pide la actual, exige 8 caracteres y cierra las otras sesiones', async () => {
  const otra = await ingresar('operario1');
  const actual = await ingresar('operario1');
  assert.equal((await pedir('POST', '/api/sesion/clave', { cookie: actual, cuerpo: { actual: 'mal', nueva: 'NuevaClave1' } })).estado, 400);
  assert.equal((await pedir('POST', '/api/sesion/clave', { cookie: actual, cuerpo: { actual: claves.operario1, nueva: 'corta' } })).estado, 400);
  assert.equal((await pedir('POST', '/api/sesion/clave', { cookie: actual, cuerpo: { actual: claves.operario1, nueva: 'NuevaClave1' } })).estado, 200);
  assert.equal((await pedir('GET', '/api/sesion', { cookie: otra })).estado, 401);
  assert.equal((await pedir('GET', '/api/sesion', { cookie: actual })).estado, 200);
  claves.operario1 = 'NuevaClave1';
  assert.equal((await pedir('GET', '/api/sesion', { cookie: await ingresar('operario1') })).estado, 200);
});

test('cerrar sesión invalida la cookie', async () => {
  const cookie = await ingresar('compras');
  assert.equal((await pedir('POST', '/api/sesion/salir', { cookie })).estado, 200);
  assert.equal((await pedir('GET', '/api/proyectos', { cookie })).estado, 401);
});

test('después de 5 intentos fallidos la cuenta queda bloqueada unos minutos', async () => {
  for (let i = 0; i < 5; i++) {
    await pedir('POST', '/api/sesion', { cuerpo: { usuario: 'dueno2', clave: `mal-${i}` } });
  }
  const r = await pedir('POST', '/api/sesion', { cuerpo: { usuario: 'dueno2', clave: claves.dueno2 } });
  assert.equal(r.estado, 429);
  assert.match(r.datos.error, /Demasiados intentos/);
});

test('ingreso rápido del prototipo: se elige el rol y entra sin contraseña, con los permisos de ese rol', async () => {
  assert.deepEqual((await pedir('GET', '/api/sesion/rapida')).datos, { activo: true });
  const operario = await pedir('POST', '/api/sesion/rapida', { cuerpo: { rol: 'Operario' } });
  assert.equal(operario.estado, 200);
  assert.equal(operario.datos.usuario, 'operario1');
  assert.deepEqual(operario.datos.rutas, ['taller']);
  assert.equal((await pedir('POST', '/api/datos/vaciar', { cookie: operario.cookie })).estado, 403, 'sigue sin poder hacer lo de Gerencia');
  const gerencia = await pedir('POST', '/api/sesion/rapida', { cuerpo: { rol: 'Gerencia' } });
  assert.equal(gerencia.datos.usuario, 'dueno1');
  assert.equal((await pedir('POST', '/api/sesion/rapida', { cuerpo: { rol: 'Cliente' } })).estado, 400);
  assert.equal((await pedir('POST', '/api/sesion/rapida', { cuerpo: { rol: 'Gerencia' }, origen: 'https://sitio-ajeno.com' })).estado, 403);
});

test('con INGRESO_RAPIDO=0 vuelve a pedir usuario y contraseña', async () => {
  process.env.INGRESO_RAPIDO = '0';
  try {
    assert.deepEqual((await pedir('GET', '/api/sesion/rapida')).datos, { activo: false });
    assert.equal((await pedir('POST', '/api/sesion/rapida', { cuerpo: { rol: 'Gerencia' } })).estado, 404);
  } finally {
    delete process.env.INGRESO_RAPIDO;
  }
});
