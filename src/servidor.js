'use strict';
/**
 * Servidor HTTP: API REST + archivos de la interfaz + avisos en tiempo real.
 * Solo usa módulos nativos de Node.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { abrirBase } = require('./db');
const { crearServicios, ErrorNegocio } = require('./servicios');
const { crearLibro, fechaExcel, fechaHoraExcel, duracionExcel } = require('./excel');
const { crearAutenticacion, ErrorIngreso } = require('./autenticacion');

const CARPETA_PUBLICA = path.join(__dirname, '..', 'public');
const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};
const LIMITE_CUERPO = 100 * 1024;
const LIMITE_EXCEL = 15 * 1024 * 1024;

/** Encabezados de seguridad que van en todas las respuestas. */
const SEGURIDAD = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN', // solo el propio sistema puede mostrar sus páginas dentro de otra
  'Referrer-Policy': 'same-origin',
};

const TODOS = ['Gerencia', 'Supervisor', 'Compras', 'Operario'];
const TALLER = ['Operario'];
/** Quién puede usar cada parte de la API (el servidor lo controla siempre, no solo la pantalla). */
function rolesPermitidos(metodo, ruta) {
  if (metodo === 'GET') {
    if (['/api/catalogo', '/api/proyectos', '/api/alertas'].includes(ruta) || /^\/api\/proyectos\/[^/]+$/.test(ruta)) return TODOS;
    if (ruta === '/api/etapas') return [...TALLER, 'Gerencia', 'Supervisor'];
    return ['Gerencia']; // indicadores, planilla, pausas, dashboard y descargas
  }
  const accion = /^\/api\/proyectos\/[^/]+\/([a-z-]+)$/.exec(ruta);
  if (accion) {
    if (['recepcion', 'recepcion-parcial'].includes(accion[1])) return ['Compras'];
    if (accion[1] === 'reprogramar') return ['Gerencia'];
    return TALLER;
  }
  return ['Gerencia']; // alta de pedidos, carga de Excel y restablecer datos
}

function responderJSON(res, estado, datos, extra = {}) {
  const cuerpo = JSON.stringify(datos);
  res.writeHead(estado, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(cuerpo),
    'Cache-Control': 'no-store',
    ...SEGURIDAD,
    ...extra,
  });
  res.end(cuerpo);
}

/** Lee el cuerpo tal cual llega (archivos). */
function leerArchivo(req, limite) {
  return new Promise((resolver, rechazar) => {
    let total = 0;
    const partes = [];
    req.on('data', (parte) => {
      total += parte.length;
      if (total > limite) {
        rechazar(new ErrorNegocio('El archivo es demasiado grande (máximo 15 MB).', 413));
        req.destroy();
        return;
      }
      partes.push(parte);
    });
    req.on('end', () => resolver(Buffer.concat(partes)));
    req.on('error', rechazar);
  });
}

function leerCuerpo(req) {
  return new Promise((resolver, rechazar) => {
    let total = 0;
    const partes = [];
    req.on('data', (parte) => {
      total += parte.length;
      if (total > LIMITE_CUERPO) {
        rechazar(new ErrorNegocio('Los datos enviados son demasiado grandes.', 413));
        req.destroy();
        return;
      }
      partes.push(parte);
    });
    req.on('end', () => {
      const crudo = Buffer.concat(partes).toString('utf8').trim();
      if (!crudo) return resolver({});
      try {
        const datos = JSON.parse(crudo);
        if (datos === null || typeof datos !== 'object' || Array.isArray(datos)) throw new Error('no es un objeto');
        resolver(datos);
      } catch {
        rechazar(new ErrorNegocio('Los datos enviados no tienen un formato válido.'));
      }
    });
    req.on('error', rechazar);
  });
}

/** Convierte la planilla a CSV que Excel abre directo (separador ; y BOM). */
function planillaCSV(filas) {
  const celda = (v) => {
    const t = typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v ?? '');
    return /[";\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const fechaAR = (f) => (f ? f.split('-').reverse().join('/') : '');
  const lineas = [[
    '#', 'FECHA IN', 'PLAZO ENTREGA', 'CLIENTE', 'NOMBRE PROY', 'DESCRIPCION', 'URG',
    'ID', 'En Ejec', 'Fecha Fin', 'Estado', 'Etapa', 'Motivo de demora',
    'Cantidad de pausas', 'Tiempo total detenido (horas)',
  ]];
  for (const [n, f] of filas.entries()) {
    lineas.push([
      n + 1, fechaAR(f.fecha_ingreso), fechaAR(f.plazo_entrega), f.cliente, f.nombre, f.descripcion,
      f.urgencia, f.id, f.en_ejecucion,
      fechaAR(f.fecha_fin), f.estado, f.etapa, f.motivo_demora,
      f.cantidad_pausas, f.horas_detenido.toFixed(2).replace('.', ','),
    ]);
  }
  return '﻿' + lineas.map((l) => l.map(celda).join(';')).join('\r\n') + '\r\n';
}

/** Libro de Excel con dos hojas: resumen de proyectos e historial de pausas (una fila por pausa). */
function planillaExcel(filas, pausas) {
  const resumen = {
    nombre: 'Resumen de proyectos',
    columnas: [
      { titulo: '#', ancho: 5 }, { titulo: 'FECHA IN', ancho: 11 }, { titulo: 'PLAZO ENTREGA', ancho: 14 },
      { titulo: 'CLIENTE', ancho: 22 }, { titulo: 'NOMBRE PROY', ancho: 28 }, { titulo: 'DESCRIPCION', ancho: 34 },
      { titulo: 'URG', ancho: 6 }, { titulo: 'ID', ancho: 16 },
      { titulo: 'En Ejec', ancho: 9 }, { titulo: 'Fecha Fin', ancho: 11 },
      { titulo: 'Estado', ancho: 22 }, { titulo: 'Etapa', ancho: 13 }, { titulo: 'Motivo de demora', ancho: 40 },
      { titulo: 'Cantidad de pausas', ancho: 12 }, { titulo: 'Tiempo total detenido (h:mm)', ancho: 16 },
    ],
    filas: filas.map((f, n) => [
      n + 1, fechaExcel(f.fecha_ingreso), fechaExcel(f.plazo_entrega), f.cliente, f.nombre, f.descripcion,
      f.urgencia, f.id, f.en_ejecucion, fechaExcel(f.fecha_fin),
      f.estado, f.etapa, f.motivo_demora, f.cantidad_pausas, duracionExcel(f.horas_detenido),
    ]),
  };
  const historial = {
    nombre: 'Historial de pausas',
    columnas: [
      { titulo: 'ID proyecto', ancho: 16 }, { titulo: 'Nombre del proyecto', ancho: 28 }, { titulo: 'Cliente', ancho: 22 },
      { titulo: 'N° de pausa', ancho: 8 }, { titulo: 'Inicio de la pausa', ancho: 17 }, { titulo: 'Reanudación', ancho: 17 },
      { titulo: 'Estado de la pausa', ancho: 12 }, { titulo: 'Motivo', ancho: 24 }, { titulo: 'Descripción del operario', ancho: 40 },
      { titulo: 'Etapa', ancho: 13 }, { titulo: 'Duración (h:mm)', ancho: 12 },
      { titulo: 'Responsable (registró la pausa)', ancho: 20 }, { titulo: 'Reanudada por', ancho: 20 },
    ],
    filas: pausas.map((p) => [
      p.id_proyecto, p.nombre, p.cliente, p.numero, fechaHoraExcel(p.inicio), fechaHoraExcel(p.fin),
      p.activa ? 'Activa' : 'Cerrada', p.causa, p.detalle, p.etapa, duracionExcel(p.horas),
      p.registrada_por, p.reanudada_por,
    ]),
  };
  return crearLibro([resumen, historial]);
}

function servirArchivo(req, res, rutaURL) {
  let relativa;
  try {
    relativa = decodeURIComponent(rutaURL);
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (relativa === '/') relativa = '/index.html';
  const destino = path.normalize(path.join(CARPETA_PUBLICA, relativa));
  if (!destino.startsWith(CARPETA_PUBLICA + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(destino, (error, contenido) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('No encontrado');
      return;
    }
    res.writeHead(200, {
      'Content-Type': TIPOS[path.extname(destino).toLowerCase()] || 'application/octet-stream',
      'Content-Length': contenido.length,
      'Cache-Control': 'no-cache',
      ...SEGURIDAD,
    });
    res.end(req.method === 'HEAD' ? undefined : contenido);
  });
}

/**
 * Crea el servidor (sin ponerlo a escuchar).
 * @param {{ rutaBase: string, ahora?: () => Date, conIngreso?: boolean }} opciones
 *   conIngreso: false solo para las pruebas automáticas (sin usuario y contraseña).
 */
function crearServidor({ rutaBase, ahora, conIngreso = true } = {}) {
  const db = abrirBase(rutaBase);
  const servicios = crearServicios(db, { ahora });
  servicios.inicializarSiEstaVacia();
  const auth = crearAutenticacion(db, {
    archivoClaves: rutaBase && rutaBase !== ':memory:' ? path.join(path.dirname(rutaBase), 'CLAVES-INICIALES.txt') : undefined,
  });
  const cuentasNuevas = conIngreso ? auth.asegurarCuentasIniciales() : [];

  // ----- Avisos en tiempo real (Server-Sent Events) -----
  const suscriptores = new Set();
  function avisarCambio() {
    for (const res of suscriptores) res.write('event: cambio\ndata: {}\n\n');
  }
  const latido = setInterval(() => {
    for (const res of suscriptores) res.write(': activo\n\n');
  }, 25000);
  latido.unref();

  // ----- Rutas de la API -----
  const ACCIONES = {
    recepcion: servicios.registrarRecepcion,
    'recepcion-parcial': servicios.registrarRecepcionParcial,
    iniciar: servicios.iniciar,
    pausar: servicios.pausar,
    continuar: servicios.continuar,
    finalizar: servicios.finalizar,
    'completar-etapa': servicios.completarEtapa,
    'iniciar-etapa': servicios.iniciarEtapa,
    reprogramar: servicios.reprogramar,
  };

  async function atenderAPI(req, res, ruta) {
    const { method } = req;

    // ----- Rutas públicas: seguimiento del cliente (con su link firmado) y avisos de "hubo un cambio" -----
    const publica = method === 'GET' && (ruta === '/api/tiempo-real' || ruta === '/api/ejemplos-cliente' || /^\/api\/seguimiento\/[^/]+$/.test(ruta));

    // Pedidos que cambian datos: tienen que venir de esta misma página (protección contra sitios ajenos).
    if (method !== 'GET' && req.headers.origin) {
      let mismoOrigen = false;
      try { mismoOrigen = new URL(req.headers.origin).host === req.headers.host; } catch { /* origen inválido */ }
      if (!mismoOrigen) return responderJSON(res, 403, { error: 'Pedido rechazado.' });
    }

    // ----- Ingreso -----
    if (ruta === '/api/sesion' && method === 'POST') {
      if (!conIngreso) return responderJSON(res, 404, { error: 'El ingreso está desactivado.' });
      const { cuenta, cookie } = auth.ingresar(req, await leerCuerpo(req));
      return responderJSON(res, 200, cuenta, { 'Set-Cookie': cookie });
    }
    // Ingreso rápido del prototipo (sin contraseña): se apaga con INGRESO_RAPIDO=0.
    const ingresoRapido = conIngreso && process.env.INGRESO_RAPIDO !== '0';
    if (ruta === '/api/sesion/rapida' && method === 'GET') {
      return responderJSON(res, 200, { activo: ingresoRapido });
    }
    if (ruta === '/api/sesion/rapida' && method === 'POST') {
      if (!ingresoRapido) return responderJSON(res, 404, { error: 'El ingreso rápido está desactivado.' });
      const { cuenta, cookie } = auth.ingresarPorRol(req, String((await leerCuerpo(req)).rol || ''));
      return responderJSON(res, 200, cuenta, { 'Set-Cookie': cookie });
    }
    if (ruta === '/api/sesion/salir' && method === 'POST') {
      return responderJSON(res, 200, { ok: true }, { 'Set-Cookie': auth.salir(req) });
    }

    let sesion = null;
    if (conIngreso && !publica) {
      sesion = auth.sesionDe(req);
      if (!sesion) return responderJSON(res, 401, { error: 'Tu sesión terminó. Volvé a ingresar.' });
      if (ruta === '/api/sesion' && method === 'GET') {
        const { id_cuenta: _c, token_hash: _t, ...datos } = sesion;
        return responderJSON(res, 200, { ...datos, ingreso_rapido: ingresoRapido });
      }
      if (ruta === '/api/sesion/clave' && method === 'POST') {
        auth.cambiarClave(sesion, await leerCuerpo(req));
        return responderJSON(res, 200, { ok: true });
      }
      if (!rolesPermitidos(method, ruta).includes(sesion.rol)) {
        return responderJSON(res, 403, { error: 'Tu usuario no tiene permiso para esta parte del sistema.' });
      }
    }
    /** Cuerpo del pedido con el usuario de la sesión: nadie puede registrar acciones a nombre de otro. */
    const cuerpoConUsuario = async () => {
      const datos = await leerCuerpo(req);
      return sesion ? { ...datos, id_usuario: sesion.id_usuario } : datos;
    };

    if (method === 'GET') {
      if (ruta === '/api/catalogo') {
        // Direcciones de red de esta PC: sirven para armar el link del cliente aunque Gerencia entre por "localhost".
        const puerto = req.socket.localPort;
        const red = Object.values(os.networkInterfaces()).flat()
          .filter((r) => r && r.family === 'IPv4' && !r.internal)
          .map((r) => `http://${r.address}:${puerto}`);
        return responderJSON(res, 200, { ...servicios.catalogo(), direcciones_red: red });
      }
      // Pedidos de ejemplo para la demostración de la página del cliente.
      // Para usarlo en serio, desactivarlo iniciando con EJEMPLOS_CLIENTE=0 (así nadie ve pedidos ajenos).
      if (ruta === '/api/ejemplos-cliente') {
        if (process.env.EJEMPLOS_CLIENTE === '0') return responderJSON(res, 200, []);
        const proyectos = servicios.listarProyectos();
        const ejemplos = ['pendiente_mat', 'en_proceso', 'pausado', 'finalizado']
          .map((estado) => proyectos.find((p) => p.estado === estado)).filter(Boolean)
          .map((p) => ({ id: p.id, nombre: p.nombre, estado_texto: p.estado_texto, token_cliente: p.token_cliente }));
        return responderJSON(res, 200, ejemplos);
      }
      const seguimiento = /^\/api\/seguimiento\/([^/]+)$/.exec(ruta);
      if (seguimiento) return responderJSON(res, 200, servicios.seguimientoCliente(decodeURIComponent(seguimiento[1])));
      if (ruta === '/api/proyectos') return responderJSON(res, 200, servicios.listarProyectos());
      if (ruta === '/api/etapas') return responderJSON(res, 200, servicios.catalogoEtapas());
      if (ruta === '/api/alertas') return responderJSON(res, 200, servicios.alertas());
      if (ruta === '/api/indicadores') return responderJSON(res, 200, servicios.indicadores());
      if (ruta === '/api/planilla') return responderJSON(res, 200, servicios.planilla());
      if (ruta === '/api/pausas') return responderJSON(res, 200, servicios.historialPausas());
      if (ruta === '/api/dashboard') return responderJSON(res, 200, servicios.datosDashboard());
      if (ruta === '/api/planilla.xlsx') {
        const libro = planillaExcel(servicios.planilla(), servicios.historialPausas());
        res.writeHead(200, {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': 'attachment; filename="planilla-lima-mecanizados.xlsx"',
          'Content-Length': libro.length,
          'Cache-Control': 'no-store',
        });
        return res.end(libro);
      }
      if (ruta === '/api/planilla.csv') {
        const csv = planillaCSV(servicios.planilla());
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="planilla-lima-mecanizados.csv"',
          'Cache-Control': 'no-store',
        });
        return res.end(csv);
      }
      if (ruta === '/api/tiempo-real') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive',
        });
        res.write('retry: 3000\n\n');
        suscriptores.add(res);
        req.on('close', () => suscriptores.delete(res));
        return undefined;
      }
      const detalle = /^\/api\/proyectos\/([^/]+)$/.exec(ruta);
      if (detalle) return responderJSON(res, 200, servicios.obtenerProyecto(decodeURIComponent(detalle[1])));
    }

    if (method === 'POST') {
      if (ruta === '/api/proyectos') {
        const creado = servicios.crearProyecto(await cuerpoConUsuario());
        avisarCambio();
        return responderJSON(res, 201, creado);
      }
      if (ruta === '/api/planilla/importar') {
        const confirmar = req.headers['x-confirmar'] === 'si';
        const resultado = servicios.importarPlanilla(await leerArchivo(req, LIMITE_EXCEL), {
          id_usuario: sesion ? sesion.id_usuario : Number(req.headers['x-usuario']) || 0, confirmar,
        });
        if (resultado.guardado) avisarCambio();
        return responderJSON(res, 200, resultado);
      }
      if (ruta === '/api/datos/vaciar') {
        servicios.vaciarDatos();
        avisarCambio();
        return responderJSON(res, 200, { ok: true });
      }
      if (ruta === '/api/demo/restablecer') {
        servicios.restablecerDemo();
        avisarCambio();
        return responderJSON(res, 200, { ok: true });
      }
      const accion = /^\/api\/proyectos\/([^/]+)\/([a-z-]+)$/.exec(ruta);
      if (accion && Object.hasOwn(ACCIONES, accion[2])) {
        const resultado = ACCIONES[accion[2]](decodeURIComponent(accion[1]), await cuerpoConUsuario());
        avisarCambio();
        return responderJSON(res, 200, resultado);
      }
    }

    return responderJSON(res, 404, { error: 'La dirección pedida no existe.' });
  }

  const servidor = http.createServer(async (req, res) => {
    let ruta;
    try {
      ruta = new URL(req.url, 'http://localhost').pathname;
    } catch {
      res.writeHead(400).end();
      return;
    }
    try {
      if (ruta.startsWith('/api/')) {
        await atenderAPI(req, res, ruta);
      } else if (req.method === 'GET' || req.method === 'HEAD') {
        servirArchivo(req, res, ruta);
      } else {
        res.writeHead(405).end();
      }
    } catch (error) {
      if (res.headersSent) {
        res.end();
        return;
      }
      if (error instanceof ErrorNegocio || error instanceof ErrorIngreso) {
        responderJSON(res, error.estado, { error: error.message });
      } else if (error instanceof URIError) {
        responderJSON(res, 400, { error: 'La dirección pedida no es válida.' });
      } else {
        console.error('Error inesperado:', error);
        responderJSON(res, 500, { error: 'Ocurrió un error inesperado en el servidor. Revisá la consola.' });
      }
    }
  });

  servidor.on('close', () => {
    clearInterval(latido);
    for (const res of suscriptores) res.end();
    suscriptores.clear();
    db.close();
  });

  return { servidor, servicios, db, auth, cuentasNuevas };
}

module.exports = { crearServidor, planillaCSV, planillaExcel };
