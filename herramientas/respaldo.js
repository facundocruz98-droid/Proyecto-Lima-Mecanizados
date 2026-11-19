'use strict';
/**
 * Copia de seguridad de la base de datos.
 *   node herramientas/respaldo.js
 * Guarda una copia con fecha y hora en la carpeta "respaldos" y conserva las últimas 30.
 * Para hacerlo todas las noches, programalo con el Programador de tareas de Windows.
 */
const fs = require('node:fs');
const path = require('node:path');

const raiz = path.join(__dirname, '..');
const origen = process.env.RUTA_BASE || path.join(raiz, 'datos', 'lima.db');
const carpeta = path.join(raiz, 'respaldos');
const CONSERVAR = 30;

if (!fs.existsSync(origen)) {
  console.error(`No se encontró la base de datos en ${origen}. Iniciá el sistema al menos una vez.`);
  process.exit(1);
}

fs.mkdirSync(carpeta, { recursive: true });
const sello = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
const destino = path.join(carpeta, `lima-${sello}.db`);
fs.copyFileSync(origen, destino);
console.log(`Respaldo guardado en ${destino}`);

const anteriores = fs.readdirSync(carpeta).filter((n) => /^lima-.*\.db$/.test(n)).sort();
for (const viejo of anteriores.slice(0, Math.max(0, anteriores.length - CONSERVAR))) {
  fs.unlinkSync(path.join(carpeta, viejo));
}
