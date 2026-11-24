'use strict';
/**
 * Ingreso al sistema: cuentas, contraseñas y sesiones.
 *
 * - Las contraseñas se guardan cifradas con scrypt (nunca en texto plano).
 * - La sesión viaja en una cookie HttpOnly + SameSite=Strict: el JavaScript de la página no puede leerla.
 * - En la base se guarda solo el hash del token de sesión: si alguien copia la base, no puede usar las sesiones.
 * - Después de varios intentos fallidos, la cuenta (y la dirección que lo intenta) quedan bloqueadas unos minutos.
 * - Cada rol ve solo su parte del sistema (RUTAS_POR_ROL). El servidor vuelve a controlar el rol en cada pedido.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');

const ESQUEMA_CUENTAS = `
CREATE TABLE IF NOT EXISTS cuenta (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario     TEXT NOT NULL UNIQUE COLLATE NOCASE,
  nombre      TEXT NOT NULL,
  rol         TEXT NOT NULL CHECK (rol IN ('Gerencia', 'Compras', 'Operario', 'Supervisor')),
  clave_hash  TEXT NOT NULL,
  clave_sal   TEXT NOT NULL,
  creada      TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sesion (
  token_hash  TEXT PRIMARY KEY,
  id_cuenta   INTEGER NOT NULL REFERENCES cuenta(id) ON DELETE CASCADE,
  expira      INTEGER NOT NULL
);
`;

/** Las 6 personas de Lima Mecanizados que usan el sistema. */
const CUENTAS_INICIALES = [
  ['dueno1', 'Dueño 1', 'Gerencia'],
  ['dueno2', 'Dueño 2', 'Gerencia'],
  ['supervisor', 'Supervisor de Taller', 'Supervisor'],
  ['compras', 'Encargado de Compras', 'Compras'],
  ['operario1', 'Operario 1', 'Operario'],
  ['operario2', 'Operario 2', 'Operario'],
];

/** Pantallas que ve cada rol (en orden: la primera es la de inicio). */
const RUTAS_POR_ROL = {
  Gerencia: ['panel', 'dashboard', 'alta', 'historial', 'planilla'],
  Supervisor: ['panel', 'historial'],
  Compras: ['compras'],
  Operario: ['taller'],
};

const COOKIE = 'lm_sesion';
const DURACION_SESION_MS = 12 * 60 * 60 * 1000;   // una jornada de trabajo
const MAX_INTENTOS = 5;                             // intentos fallidos permitidos por cuenta…
const MAX_INTENTOS_RED = 20;                        // …y por dirección (en la oficina todos comparten la misma)
const VENTANA_INTENTOS_MS = 15 * 60 * 1000;         // …dentro de 15 minutos
const BLOQUEO_MS = 5 * 60 * 1000;                   // después: 5 minutos sin poder intentar
const LARGO_MINIMO = 8;

const sha256 = (texto) => crypto.createHash('sha256').update(texto).digest('hex');

function cifrarClave(clave, sal = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(clave, sal, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  return { hash, sal };
}

function claveCorrecta(clave, cuenta) {
  const { hash } = cifrarClave(String(clave), cuenta.clave_sal);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(cuenta.clave_hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Contraseña inicial al azar, sin letras que se confundan (0/O, 1/l). */
function claveAlAzar(largo = 10) {
  const letras = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let clave = '';
  for (let i = 0; i < largo; i++) clave += letras[crypto.randomInt(letras.length)];
  return clave;
}

function leerCookie(req, nombre) {
  const encabezado = req.headers.cookie || '';
  for (const parte of encabezado.split(';')) {
    const [clave, ...valor] = parte.trim().split('=');
    if (clave === nombre) return decodeURIComponent(valor.join('='));
  }
  return '';
}

/** ¿La conexión llegó por HTTPS? (directo o a través de un proxy como Nginx o Cloudflare). */
function esSegura(req) {
  return Boolean(req.socket.encrypted) || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

class ErrorIngreso extends Error {
  constructor(mensaje, estado = 401) {
    super(mensaje);
    this.estado = estado;
  }
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ archivoClaves?: string }} opciones  archivo donde se anotan las contraseñas iniciales
 */
function crearAutenticacion(db, { archivoClaves } = {}) {
  db.exec(ESQUEMA_CUENTAS);
  const q = {
    cantidad: db.prepare('SELECT COUNT(*) AS n FROM cuenta'),
    porUsuario: db.prepare('SELECT * FROM cuenta WHERE usuario = ?'),
    porId: db.prepare('SELECT * FROM cuenta WHERE id = ?'),
    insertar: db.prepare('INSERT INTO cuenta (usuario, nombre, rol, clave_hash, clave_sal, creada) VALUES (?, ?, ?, ?, ?, ?)'),
    cambiarClave: db.prepare('UPDATE cuenta SET clave_hash = ?, clave_sal = ? WHERE id = ?'),
    sesion: db.prepare('SELECT * FROM sesion WHERE token_hash = ?'),
    crearSesion: db.prepare('INSERT INTO sesion (token_hash, id_cuenta, expira) VALUES (?, ?, ?)'),
    borrarSesion: db.prepare('DELETE FROM sesion WHERE token_hash = ?'),
    borrarSesionesDe: db.prepare('DELETE FROM sesion WHERE id_cuenta = ? AND token_hash <> ?'),
    borrarVencidas: db.prepare('DELETE FROM sesion WHERE expira < ?'),
    persona: db.prepare('SELECT id FROM usuario WHERE nombre = ? AND rol = ? ORDER BY id LIMIT 1'),
    nuevaPersona: db.prepare('INSERT INTO usuario (nombre, rol) VALUES (?, ?)'),
  };

  /** Crea las 6 cuentas la primera vez y anota sus contraseñas iniciales. Devuelve las creadas. */
  function asegurarCuentasIniciales() {
    if (q.cantidad.get().n > 0) return [];
    const creadas = CUENTAS_INICIALES.map(([usuario, nombre, rol]) => {
      const clave = claveAlAzar();
      const { hash, sal } = cifrarClave(clave);
      q.insertar.run(usuario, nombre, rol, hash, sal, new Date().toISOString());
      return { usuario, nombre, rol, clave };
    });
    if (archivoClaves) {
      const texto = [
        'CONTRASEÑAS INICIALES · Seguimiento de Taller · Lima Mecanizados SRL',
        '',
        'Entregale a cada persona la suya y pedile que la cambie al entrar',
        '(abajo a la izquierda: "Cambiar contraseña"). Después BORRÁ este archivo.',
        '',
        ...creadas.map((c) => `${c.nombre.padEnd(22)} usuario: ${c.usuario.padEnd(11)} contraseña: ${c.clave}`),
        '',
      ].join('\r\n');
      fs.writeFileSync(archivoClaves, texto, { encoding: 'utf8', mode: 0o600 });
    }
    return creadas;
  }

  // ----- Límite de intentos (en memoria) -----
  const intentos = new Map(); // clave → { fallos: [instantes], bloqueadoHasta }
  function controlarBloqueo(claves, ahora) {
    for (const clave of claves) {
      const registro = intentos.get(clave);
      if (registro && registro.bloqueadoHasta > ahora) {
        const minutos = Math.ceil((registro.bloqueadoHasta - ahora) / 60000);
        throw new ErrorIngreso(`Demasiados intentos fallidos. Esperá ${minutos} ${minutos === 1 ? 'minuto' : 'minutos'} y volvé a probar.`, 429);
      }
    }
  }
  function anotarFallo(claves, ahora) {
    for (const clave of claves) {
      const registro = intentos.get(clave) || { fallos: [], bloqueadoHasta: 0 };
      registro.fallos = registro.fallos.filter((t) => ahora - t < VENTANA_INTENTOS_MS).concat(ahora);
      if (registro.fallos.length >= (clave.startsWith('ip:') ? MAX_INTENTOS_RED : MAX_INTENTOS)) {
        registro.bloqueadoHasta = ahora + BLOQUEO_MS;
        registro.fallos = [];
      }
      intentos.set(clave, registro);
    }
  }

  /** Persona del historial (tabla usuario) que corresponde a la cuenta: así cada acción queda a su nombre. */
  function idPersona(cuenta) {
    const fila = q.persona.get(cuenta.nombre, cuenta.rol);
    return fila ? fila.id : Number(q.nuevaPersona.run(cuenta.nombre, cuenta.rol).lastInsertRowid);
  }

  function datosPublicos(cuenta) {
    return {
      usuario: cuenta.usuario,
      nombre: cuenta.nombre,
      rol: cuenta.rol,
      id_usuario: idPersona(cuenta),
      rutas: RUTAS_POR_ROL[cuenta.rol] || [],
    };
  }

  function cookieSesion(req, token, maxAgeSegundos) {
    return `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSegundos}${esSegura(req) ? '; Secure' : ''}`;
  }

  /** Valida usuario y contraseña. Devuelve los datos de la cuenta y la cookie a enviar. */
  function ingresar(req, datos) {
    const ahora = Date.now();
    const usuario = String(datos.usuario || '').trim().toLowerCase();
    const clave = String(datos.clave || '');
    const ip = req.socket.remoteAddress || '';
    const claves = [`u:${usuario}`, `ip:${ip}`];
    controlarBloqueo(claves, ahora);
    const cuenta = usuario && clave ? q.porUsuario.get(usuario) : null;
    // Si la cuenta no existe igual se calcula un hash: así no se puede adivinar qué usuarios existen por el tiempo de respuesta.
    const valida = cuenta ? claveCorrecta(clave, cuenta) : (cifrarClave(clave || 'x'), false);
    if (!valida) {
      anotarFallo(claves, ahora);
      throw new ErrorIngreso('Usuario o contraseña incorrectos.');
    }
    claves.forEach((c) => intentos.delete(c));
    q.borrarVencidas.run(ahora);
    const token = crypto.randomBytes(32).toString('base64url');
    q.crearSesion.run(sha256(token), cuenta.id, ahora + DURACION_SESION_MS);
    return { cuenta: datosPublicos(cuenta), cookie: cookieSesion(req, token, DURACION_SESION_MS / 1000) };
  }

  /**
   * Ingreso rápido del prototipo: entra con la primera cuenta del rol elegido, sin contraseña.
   * Se apaga con la variable de entorno INGRESO_RAPIDO=0 (entonces vuelve a pedir usuario y contraseña).
   */
  function ingresarPorRol(req, rol) {
    const cuenta = CUENTAS_INICIALES.map(([usuario]) => q.porUsuario.get(usuario)).find((c) => c && c.rol === rol);
    if (!cuenta) throw new ErrorIngreso('Ese rol no existe.', 400);
    const ahora = Date.now();
    q.borrarVencidas.run(ahora);
    const token = crypto.randomBytes(32).toString('base64url');
    q.crearSesion.run(sha256(token), cuenta.id, ahora + DURACION_SESION_MS);
    return { cuenta: datosPublicos(cuenta), cookie: cookieSesion(req, token, DURACION_SESION_MS / 1000) };
  }

  /** Cuenta de la sesión del pedido, o null si no hay sesión válida. */
  function sesionDe(req) {
    const token = leerCookie(req, COOKIE);
    if (!token) return null;
    const sesion = q.sesion.get(sha256(token));
    if (!sesion) return null;
    if (sesion.expira < Date.now()) {
      q.borrarSesion.run(sesion.token_hash);
      return null;
    }
    const cuenta = q.porId.get(sesion.id_cuenta);
    return cuenta ? { ...datosPublicos(cuenta), id_cuenta: cuenta.id, token_hash: sesion.token_hash } : null;
  }

  function salir(req) {
    const token = leerCookie(req, COOKIE);
    if (token) q.borrarSesion.run(sha256(token));
    return cookieSesion(req, '', 0);
  }

  /** Cambia la contraseña y cierra las demás sesiones abiertas de esa cuenta. */
  function cambiarClave(sesion, datos) {
    const cuenta = q.porId.get(sesion.id_cuenta);
    const actual = String(datos.actual || '');
    const nueva = String(datos.nueva || '');
    if (!cuenta || !claveCorrecta(actual, cuenta)) throw new ErrorIngreso('La contraseña actual no es correcta.', 400);
    if (nueva.length < LARGO_MINIMO) throw new ErrorIngreso(`La contraseña nueva tiene que tener al menos ${LARGO_MINIMO} caracteres.`, 400);
    if (nueva.length > 128) throw new ErrorIngreso('La contraseña nueva es demasiado larga.', 400);
    if (nueva === actual) throw new ErrorIngreso('La contraseña nueva tiene que ser distinta de la actual.', 400);
    const { hash, sal } = cifrarClave(nueva);
    q.cambiarClave.run(hash, sal, cuenta.id);
    q.borrarSesionesDe.run(cuenta.id, sesion.token_hash);
  }

  /** Para la herramienta de consola: pone una contraseña nueva al azar a una cuenta. */
  function restablecerClave(usuario) {
    const cuenta = q.porUsuario.get(String(usuario || '').trim().toLowerCase());
    if (!cuenta) throw new Error(`No existe la cuenta "${usuario}".`);
    const clave = claveAlAzar();
    const { hash, sal } = cifrarClave(clave);
    q.cambiarClave.run(hash, sal, cuenta.id);
    q.borrarSesionesDe.run(cuenta.id, '');
    return { usuario: cuenta.usuario, nombre: cuenta.nombre, clave };
  }

  return { asegurarCuentasIniciales, ingresar, ingresarPorRol, sesionDe, salir, cambiarClave, restablecerClave };
}

module.exports = { crearAutenticacion, ErrorIngreso, RUTAS_POR_ROL, CUENTAS_INICIALES };
