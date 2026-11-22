'use strict';
/**
 * Pone una contraseña nueva (al azar) a una cuenta, por si alguien se la olvidó.
 *
 *   node herramientas/clave.js operario1
 *
 * Cierra las sesiones abiertas de esa cuenta. La persona entra con la nueva y la cambia.
 */
const path = require('node:path');

const emitirAviso = process.emitWarning;
process.emitWarning = function filtrarAvisos(aviso, ...resto) {
  if (String(aviso && aviso.message ? aviso.message : aviso).includes('SQLite')) return;
  emitirAviso.call(process, aviso, ...resto);
};

const { abrirBase } = require('../src/db');
const { crearAutenticacion, CUENTAS_INICIALES } = require('../src/autenticacion');

const usuario = process.argv[2];
if (!usuario) {
  console.log('\n  Uso: node herramientas/clave.js <usuario>');
  console.log(`  Usuarios: ${CUENTAS_INICIALES.map(([u]) => u).join(', ')}\n`);
  process.exit(1);
}
const db = abrirBase(process.env.RUTA_BASE || path.join(__dirname, '..', 'datos', 'lima.db'));
try {
  const r = crearAutenticacion(db).restablecerClave(usuario);
  console.log(`\n  Nueva contraseña de ${r.nombre} (usuario: ${r.usuario}): ${r.clave}`);
  console.log('  Entregásela y pedile que la cambie al entrar.\n');
} catch (error) {
  console.error(`\n  ${error.message}\n`);
  process.exitCode = 1;
} finally {
  db.close();
}
