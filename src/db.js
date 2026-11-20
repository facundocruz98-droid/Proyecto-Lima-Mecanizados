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
                   CHECK (estado IN ('pendiente_mat', 'listo', 'en_proceso', 'pausado', 'finalizado', 'cancelado')),
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
                 'etapa', 'pausa', 'continuar', 'finalizar', 'reprogramar', 'cancelar',
                 'etapa_inicio', 'etapa_fin')),
  fecha_hora   TEXT NOT NULL,                      -- ISO 8601 (UTC)
  id_usuario   INTEGER NOT NULL REFERENCES usuario(id),
  etapa        TEXT,
  causa        TEXT,
  detalle      TEXT
);

-- Catálogo de etapas del taller: arranca vacío y se completa con las etapas de cada plan confirmado.
CREATE TABLE IF NOT EXISTS etapa_catalogo (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre  TEXT NOT NULL UNIQUE COLLATE NOCASE
);

-- Plan de fabricación de cada pedido: sus etapas en orden, con el inicio y el fin reales de cada una.
CREATE TABLE IF NOT EXISTS etapa_pedido (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  id_proyecto  TEXT NOT NULL REFERENCES proyecto(id) ON DELETE CASCADE,
  orden        INTEGER NOT NULL,
  nombre       TEXT NOT NULL,
  inicio       TEXT,                               -- ISO 8601 (UTC); NULL = todavía no se inició
  fin          TEXT,                               -- ISO 8601 (UTC); NULL = no se completó
  UNIQUE (id_proyecto, orden)
);

-- Configuración interna (ej. la clave con la que se firman los links de seguimiento del cliente).
CREATE TABLE IF NOT EXISTS config (
  clave  TEXT PRIMARY KEY,
  valor  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_evento_proyecto  ON evento (id_proyecto, id);
CREATE INDEX IF NOT EXISTS idx_material_proyecto ON material (id_proyecto);
CREATE INDEX IF NOT EXISTS idx_etapa_pedido ON etapa_pedido (id_proyecto, orden);
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
  migrarEsquema(db);
  return db;
}

/**
 * Las bases creadas con versiones anteriores tienen reglas (CHECK) más viejas: no aceptaban el estado
 * "cancelado" ni los eventos "cancelar", "etapa_inicio" y "etapa_fin". SQLite no permite cambiar esas
 * reglas: se rehace cada tabla desactualizada copiando todos sus datos (no se pierde nada del historial).
 */
const MARCAS = [['proyecto', "'cancelado'"], ['evento', "'etapa_fin'"]];

function migrarEsquema(db) {
  const desactualizadas = MARCAS.filter(([tabla, marca]) => {
    const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(tabla)?.sql || '';
    return !sql.includes(marca);
  }).map(([tabla]) => tabla);
  if (!desactualizadas.length) return;
  const definicion = (tabla) => {
    const inicio = ESQUEMA.indexOf(`CREATE TABLE IF NOT EXISTS ${tabla} (`);
    const fin = ESQUEMA.indexOf(');', inicio) + 2;
    return ESQUEMA.slice(inicio, fin).replace(`IF NOT EXISTS ${tabla} (`, `${tabla}_nueva (`);
  };
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec('BEGIN');
  try {
    for (const tabla of desactualizadas) {
      db.exec(definicion(tabla));
      db.exec(`INSERT INTO ${tabla}_nueva SELECT * FROM ${tabla}`);
      db.exec(`DROP TABLE ${tabla}`);
      db.exec(`ALTER TABLE ${tabla}_nueva RENAME TO ${tabla}`);
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_evento_proyecto ON evento (id_proyecto, id);');
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
  }
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
