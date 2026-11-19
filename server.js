'use strict';
/**
 * Seguimiento de Taller · Lima Mecanizados SRL
 * Punto de entrada: levanta el servidor web y la base de datos.
 *
 *   node server.js            → http://localhost:3000
 *   PUERTO=8080 node server.js
 */
const os = require('node:os');
const path = require('node:path');

// 1) Verificar la versión de Node antes de cargar SQLite.
const [mayor, menor] = process.versions.node.split('.').map(Number);
if (mayor < 22 || (mayor === 22 && menor < 13)) {
  console.error('\n  Este sistema necesita Node.js 22.13 o superior.');
  console.error(`  Versión instalada: ${process.versions.node}`);
  console.error('  Descargá la versión LTS desde https://nodejs.org e instalala.\n');
  process.exit(1);
}

// 2) El módulo SQLite de Node avisa que es "experimental": no aporta nada al usuario.
const emitirAviso = process.emitWarning;
process.emitWarning = function filtrarAvisos(aviso, ...resto) {
  if (String(aviso && aviso.message ? aviso.message : aviso).includes('SQLite')) return;
  emitirAviso.call(process, aviso, ...resto);
};

const { crearServidor } = require('./src/servidor');

const PUERTO = Number(process.env.PUERTO) || 3000;
const RUTA_BASE = process.env.RUTA_BASE || path.join(__dirname, 'datos', 'lima.db');

const { servidor } = crearServidor({ rutaBase: RUTA_BASE });

servidor.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`\n  El puerto ${PUERTO} ya está en uso.`);
    console.error('  Puede que el sistema ya esté abierto en otra ventana. Cerrala, o iniciá con otro puerto:');
    console.error('    set PUERTO=3001 && node server.js\n');
  } else {
    console.error('\n  No se pudo iniciar el servidor:', error.message, '\n');
  }
  process.exit(1);
});

servidor.listen(PUERTO, '0.0.0.0', () => {
  const redes = Object.values(os.networkInterfaces()).flat()
    .filter((r) => r && r.family === 'IPv4' && !r.internal)
    .map((r) => `http://${r.address}:${PUERTO}`);
  console.log('\n  Seguimiento de Taller · Lima Mecanizados SRL');
  console.log('  ─────────────────────────────────────────────');
  console.log(`  En esta PC:          http://localhost:${PUERTO}`);
  for (const url of redes) console.log(`  Desde otras PC:      ${url}`);
  console.log(`  Base de datos:       ${RUTA_BASE}`);
  console.log('\n  Para detener el sistema: Ctrl + C\n');
});

function apagar() {
  servidor.close(() => process.exit(0));
  servidor.closeAllConnections();
}
process.on('SIGINT', apagar);
process.on('SIGTERM', apagar);
