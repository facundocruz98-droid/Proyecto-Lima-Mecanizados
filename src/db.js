'use strict';
/**
 * Conexión a SQLite y esquema de la base de datos.
 * Usa el módulo nativo de Node (node:sqlite): no hay que instalar nada.
 */
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS cliente (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre  TEXT NOT NULL,
  codigo  TEXT NOT NULL UNIQUE CHECK (length(codigo) = 3)
);

CREATE TABLE IF NOT EXISTS usuario (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre  TEXT NOT NULL,
  rol     TEXT NOT NULL CHECK (rol IN ('Gerencia', 'Compras', 'Operario', 'Supervisor'))
);

CREATE TABLE IF NOT EXISTS proyecto (
  id               TEXT PRIMARY KEY,               -- ej. 0645-MPU-U-01
  numero           INTEGER NOT NULL,
  item             INTEGER NOT NULL,
  fecha_ingreso    TEXT NOT NULL,                  -- AAAA-MM-DD
  plazo_entrega    TEXT NOT NULL,                  -- AAAA-MM-DD
  id_cliente       INTEGER NOT NULL REFERENCES cliente(id),
  nombre           TEXT NOT NULL,
  descripcion      TEXT NOT NULL DEFAULT '',
  nro_presupuesto  TEXT NOT NULL DEFAULT '',
  urgencia         TEXT NOT NULL CHECK (urgencia IN ('E', 'U')),
  aprobado         INTEGER NOT NULL DEFAULT 1,
  estado           TEXT NOT NULL DEFAULT 'pendiente_mat'
                   CHECK (estado IN ('pendiente_mat', 'listo', 'en_proceso', 'pausado', 'finalizado')),
  etapa_actual     TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS material (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  id_proyecto      TEXT NOT NULL REFERENCES proyecto(id) ON DELETE CASCADE,
  descripcion      TEXT NOT NULL,
  indispensable    INTEGER NOT NULL DEFAULT 1,
  recibido         INTEGER NOT NULL DEFAULT 0,
  fecha_recepcion  TEXT
);

CREATE TABLE IF NOT EXISTS evento (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  id_proyecto  TEXT NOT NULL REFERENCES proyecto(id) ON DELETE CASCADE,
  tipo         TEXT NOT NULL CHECK (tipo IN ('alta', 'recepcion', 'recepcion_parcial', 'inicio',
                 'etapa', 'pausa', 'continuar', 'finalizar', 'reprogramar')),
  fecha_hora   TEXT NOT NULL,                      -- ISO 8601 (UTC)
  id_usuario   INTEGER NOT NULL REFERENCES usuario(id),
  etapa        TEXT,
  causa        TEXT,
  detalle      TEXT
);

CREATE INDEX IF NOT EXISTS idx_evento_proyecto  ON evento (id_proyecto, id);
CREATE INDEX IF NOT EXISTS idx_material_proyecto ON material (id_proyecto);
`;

/**
 * Abre (o crea) la base de datos y garantiza el esquema.
 * @param {string} ruta Ruta del archivo .db, o ':memory:' para pruebas.
 */
function abrirBase(ruta) {
  if (ruta !== ':memory:') fs.mkdirSync(path.dirname(ruta), { recursive: true });
  const db = new DatabaseSync(ruta);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(ESQUEMA);
  return db;
}

/** Ejecuta fn dentro de una transacción: si algo falla, no se guarda nada. */
function transaccion(db, fn) {
  db.exec('BEGIN');
  try {
    const resultado = fn();
    db.exec('COMMIT');
    return resultado;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

module.exports = { abrirBase, transaccion };
