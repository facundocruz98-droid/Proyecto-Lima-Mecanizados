/** Comunicación con el servidor. Todas las funciones devuelven promesas. */

async function pedir(metodo, ruta, cuerpo) {
  let respuesta;
  try {
    respuesta = await fetch(ruta, {
      method: metodo,
      headers: cuerpo ? { 'Content-Type': 'application/json' } : undefined,
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
  } catch {
    throw new Error('No se pudo conectar con el servidor. Verificá que el sistema esté iniciado.');
  }
  let datos = null;
  try {
    datos = await respuesta.json();
  } catch {
    /* respuesta sin cuerpo JSON */
  }
  if (!respuesta.ok) throw new Error((datos && datos.error) || `El servidor respondió con un error (${respuesta.status}).`);
  return datos;
}

const ruta = (id, accion = '') => `/api/proyectos/${encodeURIComponent(id)}${accion ? `/${accion}` : ''}`;

export const api = {
  catalogo: () => pedir('GET', '/api/catalogo'),
  proyectos: () => pedir('GET', '/api/proyectos'),
  proyecto: (id) => pedir('GET', ruta(id)),
  alertas: () => pedir('GET', '/api/alertas'),
  indicadores: () => pedir('GET', '/api/indicadores'),
  planilla: () => pedir('GET', '/api/planilla'),

  crearProyecto: (datos) => pedir('POST', '/api/proyectos', datos),
  reprogramar: (id, datos) => pedir('POST', ruta(id, 'reprogramar'), datos),
  recepcion: (id, datos) => pedir('POST', ruta(id, 'recepcion'), datos),
  recepcionParcial: (id, datos) => pedir('POST', ruta(id, 'recepcion-parcial'), datos),
  iniciar: (id, datos) => pedir('POST', ruta(id, 'iniciar'), datos),
  pausar: (id, datos) => pedir('POST', ruta(id, 'pausar'), datos),
  continuar: (id, datos) => pedir('POST', ruta(id, 'continuar'), datos),
  finalizar: (id, datos) => pedir('POST', ruta(id, 'finalizar'), datos),
  cambiarEtapa: (id, datos) => pedir('POST', ruta(id, 'etapa'), datos),

  restablecerDemo: () => pedir('POST', '/api/demo/restablecer'),
};
