/** Comunicación con el servidor. Todas las funciones devuelven promesas. */

/** Sin sesión (o vencida): vuelve a la pantalla de ingreso. */
function irAlIngreso() {
  location.replace('login.html');
  return new Promise(() => {}); // la página se va: nada más que hacer
}

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
  if (respuesta.status === 401) return irAlIngreso();
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
  sesion: () => pedir('GET', '/api/sesion'),
  salir: () => pedir('POST', '/api/sesion/salir'),
  cambiarClave: (actual, nueva) => pedir('POST', '/api/sesion/clave', { actual, nueva }),
  catalogo: () => pedir('GET', '/api/catalogo'),
  proyectos: () => pedir('GET', '/api/proyectos'),
  proyecto: (id) => pedir('GET', ruta(id)),
  alertas: () => pedir('GET', '/api/alertas'),
  indicadores: () => pedir('GET', '/api/indicadores'),
  planilla: () => pedir('GET', '/api/planilla'),
  dashboard: () => pedir('GET', '/api/dashboard'),

  crearProyecto: (datos) => pedir('POST', '/api/proyectos', datos),
  reprogramar: (id, datos) => pedir('POST', ruta(id, 'reprogramar'), datos),
  recepcion: (id, datos) => pedir('POST', ruta(id, 'recepcion'), datos),
  recepcionParcial: (id, datos) => pedir('POST', ruta(id, 'recepcion-parcial'), datos),
  iniciar: (id, datos) => pedir('POST', ruta(id, 'iniciar'), datos),
  pausar: (id, datos) => pedir('POST', ruta(id, 'pausar'), datos),
  continuar: (id, datos) => pedir('POST', ruta(id, 'continuar'), datos),
  finalizar: (id, datos) => pedir('POST', ruta(id, 'finalizar'), datos),
  completarEtapa: (id, datos) => pedir('POST', ruta(id, 'completar-etapa'), datos),
  iniciarEtapa: (id, datos) => pedir('POST', ruta(id, 'iniciar-etapa'), datos),
  catalogoEtapas: () => pedir('GET', '/api/etapas'),

  restablecerDemo: () => pedir('POST', '/api/demo/restablecer'),
  vaciarDatos: () => pedir('POST', '/api/datos/vaciar'),

  /** Envía un Excel para cargar proyectos. Sin confirmar solo devuelve la vista previa. */
  async importarPlanilla(archivo, idUsuario, confirmar = false) {
    let respuesta;
    try {
      respuesta = await fetch('/api/planilla/importar', {
        method: 'POST',
        body: archivo,
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Usuario': String(idUsuario),
          ...(confirmar ? { 'X-Confirmar': 'si' } : {}),
        },
      });
    } catch {
      throw new Error('No se pudo conectar con el servidor. Verificá que el sistema esté iniciado.');
    }
    if (respuesta.status === 401) return irAlIngreso();
    let datos = null;
    try { datos = await respuesta.json(); } catch { /* sin cuerpo JSON */ }
    if (respuesta.status === 404) throw new Error('El servidor está desactualizado: cerrá el sistema y abrilo de nuevo con INICIAR.bat.');
    if (!respuesta.ok) throw new Error((datos && datos.error) || `El servidor respondió con un error (${respuesta.status}).`);
    return datos;
  },
};
