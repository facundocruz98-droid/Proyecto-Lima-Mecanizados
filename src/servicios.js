'use strict';
const crypto = require('node:crypto');
/**
 * Casos de uso del sistema. Cada función valida las reglas de negocio,
 * guarda los cambios y deja registrado el evento correspondiente.
 */
const { transaccion } = require('./db');
const reglas = require('./reglas');
const { cargarDatosDeEjemplo } = require('./datos-ejemplo');
const { leerLibro, ErrorArchivo } = require('./leer-excel');
const { analizarLibro } = require('./importar');

/** Error esperado (dato inválido o regla incumplida). Se muestra tal cual al usuario. */
class ErrorNegocio extends Error {
  constructor(mensaje, estado = 400) {
    super(mensaje);
    this.name = 'ErrorNegocio';
    this.estado = estado;
  }
}

const texto = (valor) => (typeof valor === 'string' ? valor.trim() : '');

function crearServicios(db, { ahora = () => new Date() } = {}) {
  const hoy = () => reglas.fechaLocal(ahora());
  const instante = () => ahora().toISOString();

  // ---------- Consultas preparadas ----------
  const SQL_PROYECTO = `SELECT p.*, c.nombre AS cliente, c.codigo AS codigo_cliente
                        FROM proyecto p JOIN cliente c ON c.id = p.id_cliente`;
  const q = {
    proyectos: db.prepare(SQL_PROYECTO),
    proyecto: db.prepare(`${SQL_PROYECTO} WHERE p.id = ?`),
    existeProyecto: db.prepare('SELECT 1 AS si FROM proyecto WHERE id = ?'),
    maxNumero: db.prepare('SELECT COALESCE(MAX(numero), 0) AS n FROM proyecto'),
    piezasDelNumero: db.prepare('SELECT id, item, nombre, estado FROM proyecto WHERE numero = ? ORDER BY item'),
    insertarProyecto: db.prepare(`INSERT INTO proyecto
      (id, numero, item, fecha_ingreso, plazo_entrega, id_cliente, nombre, descripcion,
       nro_presupuesto, urgencia, aprobado, estado, etapa_actual)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente_mat', '')`),
    estado: db.prepare('UPDATE proyecto SET estado = ? WHERE id = ?'),
    estadoYEtapa: db.prepare('UPDATE proyecto SET estado = ?, etapa_actual = ? WHERE id = ?'),
    etapa: db.prepare('UPDATE proyecto SET etapa_actual = ? WHERE id = ?'),
    plazo: db.prepare('UPDATE proyecto SET plazo_entrega = ? WHERE id = ?'),

    clientes: db.prepare('SELECT id, nombre, codigo FROM cliente ORDER BY nombre'),
    clientePorCodigo: db.prepare('SELECT id, nombre, codigo FROM cliente WHERE codigo = ?'),
    insertarCliente: db.prepare('INSERT INTO cliente (nombre, codigo) VALUES (?, ?)'),

    usuarios: db.prepare('SELECT id, nombre, rol FROM usuario ORDER BY id'),
    usuario: db.prepare('SELECT id, nombre, rol FROM usuario WHERE id = ?'),
    cantidadUsuarios: db.prepare('SELECT COUNT(*) AS n FROM usuario'),

    materiales: db.prepare('SELECT * FROM material WHERE id_proyecto = ? ORDER BY id'),
    insertarMaterial: db.prepare(`INSERT INTO material
      (id_proyecto, descripcion, indispensable, recibido, fecha_recepcion) VALUES (?, ?, ?, ?, ?)`),
    recibirIndispensables: db.prepare(`UPDATE material SET recibido = 1, fecha_recepcion = ?
      WHERE id_proyecto = ? AND indispensable = 1 AND recibido = 0`),

    insertarEvento: db.prepare(`INSERT INTO evento
      (id_proyecto, tipo, fecha_hora, id_usuario, etapa, causa, detalle) VALUES (?, ?, ?, ?, ?, ?, ?)`),
    eventos: db.prepare(`SELECT e.*, u.nombre AS usuario, u.rol AS rol_usuario
      FROM evento e JOIN usuario u ON u.id = e.id_usuario WHERE e.id_proyecto = ? ORDER BY e.id`),
    todosLosEventos: db.prepare('SELECT * FROM evento ORDER BY id'),
    todosLosEventosConUsuario: db.prepare(`SELECT e.*, u.nombre AS usuario
      FROM evento e JOIN usuario u ON u.id = e.id_usuario ORDER BY e.id`),
    ultimoEvento: db.prepare(`SELECT e.*, u.nombre AS usuario FROM evento e JOIN usuario u ON u.id = e.id_usuario
      WHERE e.id_proyecto = ? AND e.tipo = ? ORDER BY e.id DESC LIMIT 1`),
    eventosLivianos: db.prepare('SELECT tipo, fecha_hora FROM evento WHERE id_proyecto = ? ORDER BY id'),
    ultimoMovimiento: db.prepare('SELECT MAX(fecha_hora) AS f FROM evento WHERE id_proyecto = ?'),
    leerConfig: db.prepare('SELECT valor FROM config WHERE clave = ?'),
    guardarConfig: db.prepare('INSERT INTO config (clave, valor) VALUES (?, ?)'),
    // Plan de fabricación y catálogo de etapas
    etapasPedido: db.prepare('SELECT * FROM etapa_pedido WHERE id_proyecto = ? ORDER BY orden'),
    insertarEtapaPedido: db.prepare('INSERT INTO etapa_pedido (id_proyecto, orden, nombre, inicio) VALUES (?, ?, ?, ?)'),
    iniciarEtapaPedido: db.prepare('UPDATE etapa_pedido SET inicio = ? WHERE id = ? AND inicio IS NULL'),
    completarEtapaPedido: db.prepare('UPDATE etapa_pedido SET fin = ? WHERE id = ? AND fin IS NULL'),
    catalogoEtapas: db.prepare('SELECT nombre FROM etapa_catalogo ORDER BY id'),
    agregarAlCatalogo: db.prepare('INSERT OR IGNORE INTO etapa_catalogo (nombre) VALUES (?)'),
    primerEvento: db.prepare('SELECT fecha_hora FROM evento WHERE id_proyecto = ? AND tipo = ? ORDER BY id LIMIT 1'),
    recepcionPosterior: db.prepare(`SELECT fecha_hora FROM evento
      WHERE id_proyecto = ? AND tipo IN ('recepcion', 'recepcion_parcial') AND id > ? ORDER BY id LIMIT 1`),
  };

  // ---------- Link de seguimiento del cliente ----------
  // Cada proyecto tiene un link propio, firmado con una clave secreta que se crea una sola vez.
  // Así el cliente no puede adivinar el link de otro proyecto cambiando el ID.
  let secreto = q.leerConfig.get('secreto_seguimiento')?.valor;
  if (!secreto) {
    secreto = crypto.randomBytes(32).toString('hex');
    q.guardarConfig.run('secreto_seguimiento', secreto);
  }
  const tokenCliente = (id) => crypto.createHmac('sha256', secreto).update(id).digest('base64url').slice(0, 22);

  // ---------- Auxiliares ----------
  function registrarEvento(idProyecto, tipo, idUsuario, extra = {}) {
    q.insertarEvento.run(idProyecto, tipo, instante(), idUsuario,
      extra.etapa ?? null, extra.causa ?? null, extra.detalle ?? null);
  }

  /** Verifica que el usuario exista y tenga uno de los roles permitidos. */
  function exigirRol(idUsuario, rolesPermitidos, accion) {
    const usuario = q.usuario.get(Number(idUsuario) || 0);
    if (!usuario) throw new ErrorNegocio('Elegí quién está registrando la acción.');
    if (!rolesPermitidos.includes(usuario.rol)) {
      throw new ErrorNegocio(`Solo ${rolesPermitidos.join(' o ')} puede ${accion}.`, 403);
    }
    return usuario;
  }

  function buscarProyecto(id) {
    const fila = q.proyecto.get(String(id || '').toUpperCase());
    if (!fila) {
      throw new ErrorNegocio(`El código ${String(id || '').toUpperCase() || '(vacío)'} no corresponde a ningún proyecto. Revisá la hoja de ruta.`, 404);
    }
    return fila;
  }

  /**
   * Horas que el trabajo estuvo detenido desde el último plazo acordado.
   * Si Gerencia reprogramó el plazo, las pausas anteriores ya están contempladas en la fecha nueva,
   * así que se cuenta desde la reprogramación. Una pausa abierta se cuenta hasta este momento.
   */
  function horasPausaDesdeElPlazo(eventos) {
    let horas = 0;
    let pausaDesde = null;
    for (const e of eventos) {
      if (e.tipo === 'reprogramar') {
        horas = 0;
        if (pausaDesde) pausaDesde = e.fecha_hora;
      } else if (e.tipo === 'pausa') {
        if (!pausaDesde) pausaDesde = e.fecha_hora;
      } else if (['continuar', 'finalizar', 'cancelar'].includes(e.tipo) && pausaDesde) {
        horas += horasEntre(pausaDesde, e.fecha_hora);
        pausaDesde = null;
      }
    }
    if (pausaDesde) horas += horasEntre(pausaDesde, instante());
    return horas;
  }

  /** Agrega al proyecto los datos calculados: días, semáforo, pausa actual, fecha de fin, entrega estimada. */
  function vista(p) {
    const dias = reglas.diasRestantes(p.plazo_entrega, hoy());
    const horasPausa = horasPausaDesdeElPlazo(q.eventosLivianos.all(p.id));
    const corrimiento = reglas.diasDeCorrimiento(horasPausa);
    const fechaEstimada = reglas.sumarDias(p.plazo_entrega, corrimiento);
    const v = {
      id: p.id,
      numero: p.numero,
      item: p.item,
      fecha_ingreso: p.fecha_ingreso,
      plazo_entrega: p.plazo_entrega,
      cliente: p.cliente,
      codigo_cliente: p.codigo_cliente,
      nombre: p.nombre,
      descripcion: p.descripcion,
      urgencia: p.urgencia,
      estado: p.estado,
      estado_texto: reglas.ESTADOS[p.estado],
      etapa_actual: p.etapa_actual,
      dias_restantes: dias,
      semaforo: reglas.semaforo(p.estado, dias),
      en_ejecucion: p.estado === 'en_proceso',
      pausa_actual: null,
      material_recibido_tras_pausa: false,
      fecha_fin: null,
      // Entrega estimada = plazo de la empresa + días detenidos (lo recalcula el sistema con cada pausa).
      horas_pausa_plazo: horasPausa,
      dias_corrimiento: corrimiento,
      fecha_estimada: fechaEstimada,
      dias_restantes_estimada: reglas.diasRestantes(fechaEstimada, hoy()),
      token_cliente: tokenCliente(p.id),
    };
    Object.assign(v, resumenPlan(p.id));
    // Hora en que quedó listo (Compras confirmó los materiales) e inicio real de la fabricación:
    // la espera entre una y otra no es tiempo de fabricación.
    v.listo_desde = q.primerEvento.get(p.id, 'recepcion')?.fecha_hora ?? null;
    v.inicio_real = q.primerEvento.get(p.id, 'inicio')?.fecha_hora ?? null;
    if (p.estado === 'pausado') {
      const pausa = q.ultimoEvento.get(p.id, 'pausa');
      if (pausa) {
        v.pausa_actual = { causa: pausa.causa, detalle: pausa.detalle, desde: pausa.fecha_hora, usuario: pausa.usuario };
        v.material_recibido_tras_pausa = Boolean(q.recepcionPosterior.get(p.id, pausa.id));
      }
    }
    if (p.estado === 'finalizado') {
      const fin = q.ultimoEvento.get(p.id, 'finalizar');
      v.fecha_fin = fin ? fin.fecha_hora : null;
    }
    v.cancelacion = null;
    if (p.estado === 'cancelado') {
      const cancelacion = q.ultimoEvento.get(p.id, 'cancelar');
      v.cancelacion = cancelacion ? { fecha: cancelacion.fecha_hora, motivo: cancelacion.detalle } : { fecha: null, motivo: null };
    }
    return v;
  }

  const horasEntre = (desde, hasta) => Math.max(0, (Date.parse(hasta) - Date.parse(desde)) / 3600000);

  /**
   * Plan de fabricación del pedido con el estado de cada etapa:
   *  completada · en_curso · lista (la próxima, esperando "Iniciar etapa") · pendiente.
   * Los pedidos anteriores al plan no tienen etapas: tiene_plan = false y siguen con su flujo de siempre.
   */
  function resumenPlan(idProyecto) {
    const filas = q.etapasPedido.all(idProyecto);
    let proximaMarcada = false;
    const plan = filas.map((e) => {
      let estado = 'pendiente';
      if (e.fin) estado = 'completada';
      else if (e.inicio) estado = 'en_curso';
      else if (!proximaMarcada) { estado = 'lista'; proximaMarcada = true; }
      return { orden: e.orden, nombre: e.nombre, estado, inicio: e.inicio, fin: e.fin };
    });
    const enCurso = plan.find((e) => e.estado === 'en_curso') || null;
    // Si hay una etapa en curso, "lista" no aplica: la siguiente queda pendiente hasta completar la actual.
    if (enCurso) plan.forEach((e) => { if (e.estado === 'lista') e.estado = 'pendiente'; });
    const lista = plan.find((e) => e.estado === 'lista') || null;
    const foco = enCurso || lista || plan[plan.length - 1] || null;
    return {
      tiene_plan: plan.length > 0,
      plan,
      etapas_completadas: plan.filter((e) => e.estado === 'completada').length,
      total_etapas: plan.length,
      etapa_numero: foco ? foco.orden : 0,
      etapa_en_curso: Boolean(enCurso),
      todas_completadas: plan.length > 0 && plan.every((e) => e.estado === 'completada'),
    };
  }

  /** Horas en proceso y horas en pausa de un proyecto, a partir de sus eventos. */
  function calcularTiempos(eventos) {
    let enProceso = 0;
    let enPausa = 0;
    let desde = null;
    let modo = null; // 'proceso' | 'pausa'
    const cerrar = (hasta) => {
      if (!desde) return;
      if (modo === 'proceso') enProceso += horasEntre(desde, hasta);
      if (modo === 'pausa') enPausa += horasEntre(desde, hasta);
    };
    // Se trabaja cuando hay una etapa abierta y el pedido no está pausado.
    // Entre "Completar etapa" e "Iniciar etapa" no corre ningún contador (la espera no es fabricación).
    let etapaAbierta = false;
    let pausado = false;
    const pasarA = (nuevo, cuando) => {
      if (nuevo === modo) return;
      cerrar(cuando);
      modo = nuevo;
      desde = nuevo ? cuando : null;
    };
    const modoActual = () => (pausado ? 'pausa' : etapaAbierta ? 'proceso' : null);
    for (const e of eventos) {
      if (e.tipo === 'inicio' || e.tipo === 'etapa_inicio') etapaAbierta = true;
      else if (e.tipo === 'etapa_fin') etapaAbierta = false;
      else if (e.tipo === 'pausa') pausado = true;
      else if (e.tipo === 'continuar') pausado = false;
      else if (e.tipo === 'finalizar' || e.tipo === 'cancelar') { etapaAbierta = false; pausado = false; }
      else continue;
      pasarA(modoActual(), e.fecha_hora);
    }
    cerrar(instante());
    return { horas_en_proceso: enProceso, horas_en_pausa: enPausa };
  }

  /**
   * Una entrada por cada evento "pausa" del historial (solo lectura: no modifica nada).
   * Cada pausa se cierra con el siguiente "continuar" o "finalizar" del mismo proyecto;
   * si sigue activa, su duración se cuenta hasta este momento.
   */
  function listarPausas(eventos) {
    const momento = instante();
    const pausas = [];
    const abiertas = new Map(); // id_proyecto -> pausa sin cerrar
    const cerrar = (idProyecto, evento) => {
      const pausa = abiertas.get(idProyecto);
      if (!pausa) return;
      pausa.fin = evento.fecha_hora;
      pausa.activa = false;
      pausa.reanudada_por = evento.tipo === 'pausa' ? null : (evento.usuario ?? null);
      abiertas.delete(idProyecto);
    };
    for (const e of eventos) {
      if (e.tipo === 'pausa') {
        cerrar(e.id_proyecto, e); // por seguridad: nunca dos pausas abiertas a la vez (no duplica tiempos)
        const pausa = {
          id_proyecto: e.id_proyecto,
          id_evento: e.id,
          numero: pausas.filter((x) => x.id_proyecto === e.id_proyecto).length + 1,
          inicio: e.fecha_hora,
          fin: null,
          activa: true,
          causa: e.causa,
          detalle: e.detalle,
          etapa: e.etapa,
          registrada_por: e.usuario ?? null,
          reanudada_por: null,
          horas: 0,
        };
        pausas.push(pausa);
        abiertas.set(e.id_proyecto, pausa);
      } else if (e.tipo === 'continuar' || e.tipo === 'finalizar' || e.tipo === 'cancelar') {
        cerrar(e.id_proyecto, e);
      }
    }
    for (const pausa of pausas) pausa.horas = horasEntre(pausa.inicio, pausa.fin ?? momento);
    return pausas;
  }

  /** Cantidad de pausas y horas detenidas por proyecto. */
  function resumirPausas(pausas) {
    const resumen = new Map();
    for (const pausa of pausas) {
      const r = resumen.get(pausa.id_proyecto) || { cantidad: 0, horas: 0 };
      r.cantidad += 1;
      r.horas += pausa.horas;
      resumen.set(pausa.id_proyecto, r);
    }
    return resumen;
  }

  // ---------- Consultas ----------
  function catalogo() {
    return {
      hoy: hoy(),
      margen_alerta_dias: reglas.MARGEN_ALERTA_DIAS,
      etapas: reglas.ETAPAS,
      causas: reglas.CAUSAS,
      estados: reglas.ESTADOS,
      usuarios: q.usuarios.all(),
      clientes: q.clientes.all(),
    };
  }

  /** Etapas guardadas por el taller (sugerencias del Plan de fabricación), en el orden en que se crearon. */
  function catalogoEtapas() {
    return q.catalogoEtapas.all().map((e) => e.nombre);
  }

  function listarProyectos() {
    return q.proyectos.all().map(vista).sort(reglas.compararParaPanel);
  }

  function obtenerProyecto(id) {
    const p = buscarProyecto(id);
    const eventos = q.eventos.all(p.id);
    return {
      ...vista(p),
      materiales: q.materiales.all(p.id).map((m) => ({
        id: m.id,
        descripcion: m.descripcion,
        indispensable: Boolean(m.indispensable),
        recibido: Boolean(m.recibido),
        fecha_recepcion: m.fecha_recepcion,
      })),
      eventos,
      tiempos: calcularTiempos(eventos),
      piezas_del_pedido: piezasDelPedido(p.numero),
    };
  }

  function alertas() {
    const proyectos = listarProyectos();
    const breve = (p) => ({
      id: p.id, nombre: p.nombre, cliente: p.cliente, urgencia: p.urgencia, estado: p.estado,
      estado_texto: p.estado_texto, plazo_entrega: p.plazo_entrega, dias_restantes: p.dias_restantes,
      pausa_actual: p.pausa_actual,
    });
    const porFaltaDeMaterial = proyectos.filter((p) => p.pausa_actual && p.pausa_actual.causa === 'Falta de material');
    return {
      vencidos: proyectos.filter((p) => !['finalizado', 'cancelado'].includes(p.estado) && p.dias_restantes < 0).map(breve),
      falta_material: porFaltaDeMaterial.filter((p) => !p.material_recibido_tras_pausa).map(breve),
      material_recibido: porFaltaDeMaterial.filter((p) => p.material_recibido_tras_pausa).map(breve),
      por_vencer: proyectos.filter((p) => p.semaforo === 'amarillo').map(breve),
    };
  }

  /** Causas de demora más frecuentes y horas detenidas (base de los KPI). */
  function indicadores() {
    const porCausa = new Map(reglas.CAUSAS.map((c) => [c, { causa: c, pausas: 0, horas: 0 }]));
    // Etapas del catálogo del taller (y las de pedidos anteriores que tengan pausas).
    const porEtapa = new Map(q.catalogoEtapas.all().map(({ nombre }) => [nombre, { etapa: nombre, pausas: 0, horas: 0 }]));
    const abiertas = new Map(); // id_proyecto -> evento de pausa sin cerrar
    const sumar = (pausa, hasta) => {
      const horas = horasEntre(pausa.fecha_hora, hasta);
      const c = porCausa.get(pausa.causa);
      if (c) { c.pausas += 1; c.horas += horas; }
      if (pausa.etapa) {
        if (!porEtapa.has(pausa.etapa)) porEtapa.set(pausa.etapa, { etapa: pausa.etapa, pausas: 0, horas: 0 });
        const e = porEtapa.get(pausa.etapa);
        e.pausas += 1;
        e.horas += horas;
      }
    };
    for (const e of q.todosLosEventos.all()) {
      if (e.tipo === 'pausa') abiertas.set(e.id_proyecto, e);
      else if (['continuar', 'finalizar', 'cancelar'].includes(e.tipo) && abiertas.has(e.id_proyecto)) {
        sumar(abiertas.get(e.id_proyecto), e.fecha_hora);
        abiertas.delete(e.id_proyecto);
      }
    }
    for (const pausa of abiertas.values()) sumar(pausa, instante());
    const causas = [...porCausa.values()];
    return {
      total_pausas: causas.reduce((n, c) => n + c.pausas, 0),
      total_horas: causas.reduce((n, c) => n + c.horas, 0),
      causas,
      etapas: [...porEtapa.values()],
    };
  }

  /** La planilla de la empresa, con En Ejec y Fecha Fin completadas por el escaneo. */
  function planilla() {
    const pausas = resumirPausas(listarPausas(q.todosLosEventos.all()));
    return q.proyectos.all().map(vista).sort((a, b) => a.id.localeCompare(b.id)).map((p) => ({
      fecha_ingreso: p.fecha_ingreso,
      plazo_entrega: p.plazo_entrega,
      cliente: p.cliente,
      nombre: p.nombre,
      descripcion: p.descripcion,
      urgencia: p.urgencia,
      id: p.id,
      en_ejecucion: p.en_ejecucion,
      fecha_fin: p.fecha_fin ? reglas.fechaLocal(new Date(p.fecha_fin)) : '',
      estado: p.estado_texto,
      etapa: p.etapa_actual,
      motivo_demora: p.pausa_actual ? `${p.pausa_actual.causa}: ${p.pausa_actual.detalle}`
        : (p.cancelacion && p.cancelacion.motivo ? `Cancelado: ${p.cancelacion.motivo}` : ''),
      cantidad_pausas: pausas.get(p.id)?.cantidad ?? 0,
      horas_detenido: pausas.get(p.id)?.horas ?? 0,
    }));
  }

  /** Todas las pausas registradas, una fila por pausa (para la exportación y el futuro dashboard). */
  function historialPausas() {
    const proyectos = new Map(q.proyectos.all().map((p) => [p.id, p]));
    return listarPausas(q.todosLosEventosConUsuario.all())
      .map((pausa) => ({
        ...pausa,
        nombre: proyectos.get(pausa.id_proyecto)?.nombre ?? '',
        cliente: proyectos.get(pausa.id_proyecto)?.cliente ?? '',
      }))
      .sort((a, b) => a.id_proyecto.localeCompare(b.id_proyecto) || a.id_evento - b.id_evento);
  }

  /**
   * Datos del Dashboard: cada proyecto de la planilla con su historial completo de eventos
   * (alta, recepción, inicio, pausas, finalización…), que es de donde salen los gráficos.
   */
  function datosDashboard() {
    const eventos = new Map();
    for (const e of q.todosLosEventos.all()) {
      if (!eventos.has(e.id_proyecto)) eventos.set(e.id_proyecto, []);
      eventos.get(e.id_proyecto).push({
        tipo: e.tipo, fecha_hora: e.fecha_hora, etapa: e.etapa, causa: e.causa, detalle: e.detalle,
      });
    }
    return {
      hoy: hoy(),
      proyectos: q.proyectos.all().map(vista).sort((a, b) => a.id.localeCompare(b.id)).map((p) => ({
        id: p.id,
        nombre: p.nombre,
        cliente: p.cliente,
        urgencia: p.urgencia,
        estado: p.estado_texto,
        etapa: p.etapa_actual,
        fecha_ingreso: p.fecha_ingreso,
        plazo_entrega: p.plazo_entrega,
        fecha_fin: p.fecha_fin ? reglas.fechaLocal(new Date(p.fecha_fin)) : '',
        eventos: eventos.get(p.id) ?? [],
      })),
    };
  }

  /**
   * Lo que ve el cliente con su link: estado, etapa, plazo y entrega estimada.
   * No incluye causas internas, nombres de operarios ni datos de otros proyectos.
   */
  function seguimientoCliente(token) {
    const buscado = String(token || '');
    const p = buscado.length === 22 ? q.proyectos.all().find((x) => {
      const propio = Buffer.from(tokenCliente(x.id));
      const recibido = Buffer.from(buscado);
      return propio.length === recibido.length && crypto.timingSafeEqual(propio, recibido);
    }) : null;
    if (!p) throw new ErrorNegocio('El link de seguimiento no es válido. Pedile a Lima Mecanizados que te lo vuelva a enviar.', 404);
    const v = vista(p);
    return {
      id: v.id,
      nombre: v.nombre,
      descripcion: v.descripcion,
      cliente: v.cliente,
      estado: v.estado,
      estado_texto: reglas.ESTADOS_CLIENTE[v.estado],
      // Etapas pensadas para el cliente; el detalle de operaciones (Corte, Soldadura…) queda en el panel interno.
      pasos: reglas.pasosCliente(v.estado),
      fecha_ingreso: v.fecha_ingreso,
      plazo_entrega: v.plazo_entrega,
      fecha_estimada: v.fecha_estimada,
      dias_corrimiento: v.dias_corrimiento,
      // La fecha estimada ya pasó y el trabajo no terminó: la empresa tiene que confirmar una nueva.
      en_revision: !['finalizado', 'cancelado'].includes(v.estado) && v.dias_restantes_estimada < 0,
      fecha_fin: v.fecha_fin,
      ultima_actualizacion: q.ultimoMovimiento.get(p.id)?.f ?? null,
      hoy: hoy(),
    };
  }

  // ---------- Acciones de Gerencia ----------
  /**
   * Carga los proyectos de un Excel y REEMPLAZA a los que hay en el sistema
   * (la planilla queda igual al Excel: no se suman). Los usuarios no se tocan.
   * Primero se llama sin confirmar (vista previa: no guarda nada) y después con confirmar = true.
   */
  function importarPlanilla(archivo, { id_usuario: idUsuario, confirmar = false } = {}) {
    exigirRol(idUsuario, ['Gerencia'], 'cargar proyectos desde Excel');
    let libro;
    try {
      libro = leerLibro(archivo);
    } catch (error) {
      if (error instanceof ErrorArchivo) throw new ErrorNegocio(error.message);
      throw new ErrorNegocio('No se pudo leer el archivo. Verificá que sea un Excel (.xlsx).');
    }
    // Como el Excel reemplaza todo, se analiza como si el sistema estuviera vacío.
    const analisis = analizarLibro(libro, { existentes: new Set(), clientes: new Map(), ahora: ahora() });
    if (analisis.error) throw new ErrorNegocio(analisis.error);

    const resumen = {
      hoja: analisis.hoja,
      filas: analisis.filas,
      nuevos: analisis.nuevos.length,
      actuales: q.proyectos.all().length,
      por_estado: analisis.por_estado,
      clientes_nuevos: analisis.clientes_nuevos,
      omitidos: analisis.omitidos,
      ejemplos: analisis.nuevos.slice(0, 5).map((p) => ({ id: p.id, nombre: p.nombre, estado: reglas.ESTADOS[p.estado] })),
      guardado: false,
    };
    if (!confirmar || !analisis.nuevos.length) return resumen;

    const usuarios = q.usuarios.all();
    const usuarioDe = (rol) => (usuarios.find((u) => u.rol === rol) || usuarios.find((u) => u.rol === 'Supervisor') || usuarios[0]).id;
    transaccion(db, () => {
      // Los planes de los pedidos se reemplazan junto con los pedidos; el catálogo de etapas del taller se conserva.
      db.exec('DELETE FROM etapa_pedido; DELETE FROM evento; DELETE FROM material; DELETE FROM proyecto; DELETE FROM cliente;');
      db.exec("DELETE FROM sqlite_sequence WHERE name IN ('evento', 'material', 'cliente');");
      for (const c of analisis.clientes_nuevos) q.insertarCliente.run(c.nombre, c.codigo);
      const idCliente = new Map(q.clientes.all().map((c) => [c.codigo, c.id]));
      const insertarProyecto = db.prepare(`INSERT INTO proyecto
        (id, numero, item, fecha_ingreso, plazo_entrega, id_cliente, nombre, descripcion,
         nro_presupuesto, urgencia, aprobado, estado, etapa_actual) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const p of analisis.nuevos) {
        insertarProyecto.run(p.id, p.numero, p.item, p.fecha_ingreso, p.plazo_entrega, idCliente.get(p.codigo_cliente), p.nombre,
            p.descripcion, p.nro_presupuesto, p.urgencia, p.aprobado ? 1 : 0, p.estado, p.etapa_actual);
        // Si el Excel trae la columna MATERIALES se cargan tal cual; si no, queda uno genérico.
        const recepcion = p.eventos.find((e) => e.tipo === 'recepcion');
        const materiales = p.materiales.length ? p.materiales : ['Materiales indispensables (cargado desde Excel)'];
        for (const m of materiales) {
          q.insertarMaterial.run(p.id, m, 1, recepcion ? 1 : 0, recepcion ? recepcion.fecha_hora : null);
        }
        for (const e of p.eventos) {
          q.insertarEvento.run(p.id, e.tipo, e.fecha_hora, usuarioDe(e.rol), e.etapa, e.causa, e.detalle);
        }
      }
    });
    return { ...resumen, guardado: true };
  }

  /** Valida los datos de una pieza (lo que se carga tanto al crear un pedido como al agregarle una pieza). */
  function validarPieza(datos, { urgenciaPorDefecto = 'E', que = 'del proyecto' } = {}) {
    const pieza = {
      nombre: texto(datos.nombre),
      descripcion: texto(datos.descripcion),
      urgencia: texto(datos.urgencia).toUpperCase() || urgenciaPorDefecto,
      plazo: texto(datos.plazo_entrega),
      ingreso: texto(datos.fecha_ingreso) || hoy(),
      materiales: (Array.isArray(datos.materiales) ? datos.materiales : []).map(texto).filter(Boolean),
    };
    if (!pieza.nombre) throw new ErrorNegocio(`Completá el nombre ${que}.`);
    if (!['E', 'U'].includes(pieza.urgencia)) throw new ErrorNegocio('La urgencia tiene que ser E (estándar) o U (urgente).');
    if (!pieza.plazo) throw new ErrorNegocio('El plazo de entrega es obligatorio: es la referencia de las alertas.');
    if (!reglas.esFechaValida(pieza.plazo)) throw new ErrorNegocio('El plazo de entrega no es una fecha válida.');
    if (pieza.plazo < hoy()) throw new ErrorNegocio('El plazo de entrega no puede ser anterior a hoy.');
    if (!reglas.esFechaValida(pieza.ingreso)) throw new ErrorNegocio('La fecha de ingreso no es una fecha válida.');
    if (pieza.ingreso > pieza.plazo) throw new ErrorNegocio('La fecha de ingreso no puede ser posterior al plazo de entrega.');
    if (pieza.materiales.length === 0) throw new ErrorNegocio('Indicá al menos un material indispensable para iniciar.');
    if (pieza.nombre.length > 120 || pieza.descripcion.length > 300
        || pieza.materiales.some((m) => m.length > 120) || pieza.materiales.length > 30) {
      throw new ErrorNegocio('Alguno de los textos es demasiado largo.');
    }
    return pieza;
  }

  function insertarPieza(id, numero, item, idCliente, pieza, idUsuario, detalleAlta = null) {
    q.insertarProyecto.run(id, numero, item, pieza.ingreso, pieza.plazo, idCliente, pieza.nombre, pieza.descripcion,
      '', pieza.urgencia, 1);
    for (const m of pieza.materiales) q.insertarMaterial.run(id, m, 1, 0, null);
    registrarEvento(id, 'alta', idUsuario, { detalle: detalleAlta });
    return obtenerProyecto(id);
  }

  /**
   * "Crear pedido": el sistema genera un número de orden nuevo. El pedido puede traer varias piezas
   * (lista "piezas"): todas comparten número, cliente, urgencia y fechas, y reciben los ítems
   * 01, 02, 03… en una sola operación (si una pieza tiene un error, no se guarda ninguna).
   * Sin "piezas" se toma una sola pieza con los campos sueltos (nombre, descripcion, materiales).
   */
  function crearProyecto(datos = {}) {
    const usuario = exigirRol(datos.id_usuario, ['Gerencia'], 'crear un pedido');
    const cliente = texto(datos.cliente);
    const codigo = texto(datos.codigo_cliente).toUpperCase();
    if (cliente.length < 2) throw new ErrorNegocio('Completá el nombre del cliente.');
    if (cliente.length > 80) throw new ErrorNegocio('El nombre del cliente es demasiado largo.');
    if (!/^[A-Z]{3}$/.test(codigo)) throw new ErrorNegocio('El código de cliente tiene que ser de 3 letras (ej. MPU).');
    const lista = Array.isArray(datos.piezas) && datos.piezas.length ? datos.piezas : [datos];
    if (lista.length > 99) throw new ErrorNegocio('Un pedido puede tener hasta 99 piezas.');
    const piezas = lista.map((pieza, i) => {
      try {
        return validarPieza({ ...datos, nombre: pieza.nombre, descripcion: pieza.descripcion, materiales: pieza.materiales },
          { que: lista.length > 1 ? 'de la pieza' : 'del proyecto' });
      } catch (error) {
        if (lista.length > 1 && error instanceof ErrorNegocio) throw new ErrorNegocio(`Pieza ${i + 1}: ${error.message}`, error.estado);
        throw error;
      }
    });

    return transaccion(db, () => {
      const numero = q.maxNumero.get().n + 1;
      let filaCliente = q.clientePorCodigo.get(codigo);
      if (!filaCliente) {
        const alta = q.insertarCliente.run(cliente, codigo);
        filaCliente = { id: Number(alta.lastInsertRowid) };
      }
      const ids = piezas.map((pieza, i) => {
        const id = reglas.armarId(numero, codigo, pieza.urgencia, i + 1);
        if (q.existeProyecto.get(id)) throw new ErrorNegocio(`El ID ${id} ya existe.`, 409);
        insertarPieza(id, numero, i + 1, filaCliente.id, pieza, usuario.id);
        return id;
      });
      return { ...obtenerProyecto(ids[0]), ids_creados: ids };
    });
  }

  /** Piezas del mismo pedido (mismo número de orden), para mostrarlas en el detalle. */
  function piezasDelPedido(numero) {
    return q.piezasDelNumero.all(numero).map((p) => ({ id: p.id, item: p.item, nombre: p.nombre, estado: p.estado }));
  }

  function reprogramar(id, datos = {}) {
    const usuario = exigirRol(datos.id_usuario, ['Gerencia'], 'cambiar el plazo de entrega');
    const p = buscarProyecto(id);
    const plazo = texto(datos.plazo_entrega);
    const motivo = texto(datos.motivo);
    if (p.estado === 'finalizado') throw new ErrorNegocio('El trabajo ya está finalizado: no se puede reprogramar.');
    if (p.estado === 'cancelado') throw new ErrorNegocio('El proyecto está cancelado: no se puede reprogramar.');
    if (!reglas.esFechaValida(plazo)) throw new ErrorNegocio('Elegí la nueva fecha de entrega.');
    if (plazo === p.plazo_entrega) throw new ErrorNegocio('La nueva fecha es igual a la actual.');
    if (plazo < hoy()) throw new ErrorNegocio('El nuevo plazo no puede ser anterior a hoy.');
    if (motivo.length < 5) throw new ErrorNegocio('Escribí el motivo del cambio: sin motivo no se puede reprogramar.');
    if (motivo.length > 300) throw new ErrorNegocio('El motivo es demasiado largo.');
    return transaccion(db, () => {
      q.plazo.run(plazo, p.id);
      registrarEvento(p.id, 'reprogramar', usuario.id, { detalle: `${p.plazo_entrega} → ${plazo}: ${motivo}` });
      return obtenerProyecto(p.id);
    });
  }

  /**
   * Cancela un proyecto (decisión de los dueños). No se borra nada: queda en la planilla y en el historial
   * como "Cancelado" con su motivo. Deja de aparecer en el taller, en Compras y en las alertas; si estaba
   * pausado, la pausa se cierra en este momento.
   */
  function cancelar(id, datos = {}) {
    const usuario = exigirRol(datos.id_usuario, ['Gerencia'], 'cancelar un proyecto');
    const p = buscarProyecto(id);
    const motivo = texto(datos.motivo);
    if (p.estado === 'finalizado') throw new ErrorNegocio('El trabajo ya está finalizado: no se puede cancelar.', 409);
    if (p.estado === 'cancelado') throw new ErrorNegocio('El proyecto ya está cancelado.', 409);
    if (motivo.length < 5) throw new ErrorNegocio('Escribí el motivo de la cancelación: sin motivo no se puede cancelar.');
    if (motivo.length > 300) throw new ErrorNegocio('El motivo es demasiado largo.');
    return transaccion(db, () => {
      q.estado.run('cancelado', p.id);
      registrarEvento(p.id, 'cancelar', usuario.id, { etapa: p.etapa_actual || null, detalle: motivo });
      return obtenerProyecto(p.id);
    });
  }

  // ---------- Acciones de Compras ----------
  function registrarRecepcion(id, datos = {}) {
    const usuario = exigirRol(datos.id_usuario, ['Compras'], 'registrar la recepción de materiales');
    const p = buscarProyecto(id);
    if (p.estado !== 'pendiente_mat') {
      throw new ErrorNegocio('Los materiales indispensables de este proyecto ya fueron recibidos. Usá "Recepción parcial" para lo que llegue después.');
    }
    return transaccion(db, () => {
      const detalle = q.materiales.all(p.id).filter((m) => m.indispensable).map((m) => m.descripcion).join(', ');
      q.recibirIndispensables.run(instante(), p.id);
      q.estado.run('listo', p.id);
      registrarEvento(p.id, 'recepcion', usuario.id, { detalle });
      return obtenerProyecto(p.id);
    });
  }

  function registrarRecepcionParcial(id, datos = {}) {
    const usuario = exigirRol(datos.id_usuario, ['Compras'], 'registrar la recepción de materiales');
    const p = buscarProyecto(id);
    const material = texto(datos.material);
    if (p.estado === 'pendiente_mat') {
      throw new ErrorNegocio('Este proyecto todavía espera sus materiales indispensables: registrá primero la recepción.');
    }
    if (p.estado === 'finalizado') throw new ErrorNegocio('El trabajo ya está finalizado.');
    if (p.estado === 'cancelado') throw new ErrorNegocio('El proyecto está cancelado.');
    if (!material) throw new ErrorNegocio('Escribí qué material llegó.');
    if (material.length > 120) throw new ErrorNegocio('La descripción del material es demasiado larga.');
    return transaccion(db, () => {
      q.insertarMaterial.run(p.id, material, 0, 1, instante());
      registrarEvento(p.id, 'recepcion_parcial', usuario.id, { detalle: material });
      return obtenerProyecto(p.id);
    });
  }

  // ---------- Acciones del taller ----------
  const ROLES_TALLER = ['Operario']; // el avance lo registran los operarios; el supervisor controla

  /** Valida y limpia la lista de etapas que manda el formulario "Plan de fabricación". */
  function validarPlan(lista) {
    if (!Array.isArray(lista)) return null;
    const etapas = lista.map((e) => texto(e).replace(/\s+/g, ' '));
    if (!etapas.length || etapas.some((e) => !e)) throw new ErrorNegocio('Agregá al menos una etapa al plan de fabricación.');
    if (etapas.length > reglas.MAX_ETAPAS_PLAN) throw new ErrorNegocio(`El plan puede tener hasta ${reglas.MAX_ETAPAS_PLAN} etapas.`);
    if (etapas.some((e) => e.length > 40)) throw new ErrorNegocio('El nombre de cada etapa puede tener hasta 40 letras.');
    const vistas = new Set();
    for (const e of etapas) {
      const clave = e.toLocaleLowerCase('es');
      if (vistas.has(clave)) throw new ErrorNegocio(`La etapa "${e}" está repetida en el plan.`);
      vistas.add(clave);
    }
    return etapas;
  }

  /**
   * Inicio real de la fabricación. Con plan (el flujo actual del Puesto de taller), en una sola operación:
   * guarda el plan ordenado, agrega sus etapas al catálogo, registra el inicio del pedido e inicia la primera etapa.
   * Si llega dos veces el mismo pedido (doble clic o reintento) no se duplica nada: se devuelve el estado guardado.
   * Sin plan se mantiene el inicio anterior (etapa de la lista fija), para compatibilidad.
   */
  function iniciar(id, datos = {}) {
    const usuario = exigirRol(datos.id_usuario, ROLES_TALLER, 'registrar avances del taller');
    const p = buscarProyecto(id);
    const plan = validarPlan(datos.plan);
    if (p.estado === 'pendiente_mat') {
      throw new ErrorNegocio('No se puede iniciar: faltan los materiales indispensables. Compras tiene que registrar la recepción.', 409);
    }
    if (plan && ['en_proceso', 'pausado'].includes(p.estado)) {
      const guardado = q.etapasPedido.all(p.id).map((e) => e.nombre);
      if (guardado.length === plan.length && guardado.every((e, i) => e === plan[i])) return obtenerProyecto(p.id);
    }
    if (p.estado !== 'listo') throw new ErrorNegocio(`No se puede iniciar: el trabajo está "${reglas.ESTADOS[p.estado]}".`, 409);

    if (plan) {
      return transaccion(db, () => {
        const momento = instante();
        plan.forEach((nombre, i) => {
          q.insertarEtapaPedido.run(p.id, i + 1, nombre, i === 0 ? momento : null);
          q.agregarAlCatalogo.run(nombre);
        });
        q.estadoYEtapa.run('en_proceso', plan[0], p.id);
        q.insertarEvento.run(p.id, 'inicio', momento, usuario.id, plan[0], null, `Plan: ${plan.join(' → ')}`);
        return obtenerProyecto(p.id);
      });
    }

    const etapa = texto(datos.etapa) || reglas.ETAPAS[0];
    if (!reglas.ETAPAS.includes(etapa)) throw new ErrorNegocio('La etapa elegida no existe.');
    return transaccion(db, () => {
      q.estadoYEtapa.run('en_proceso', etapa, p.id);
      registrarEvento(p.id, 'inicio', usuario.id, { etapa });
      return obtenerProyecto(p.id);
    });
  }

  /** Etapas del plan guardado, con la que está en curso y la próxima por iniciar. */
  function etapasDelPlan(idProyecto) {
    const filas = q.etapasPedido.all(idProyecto);
    return {
      filas,
      enCurso: filas.find((e) => e.inicio && !e.fin) || null,
      proxima: filas.find((e) => !e.inicio) || null,
    };
  }

  /** "Completar etapa": registra el fin de la etapa en curso; la siguiente queda lista para iniciar. */
  function completarEtapa(id, datos = {}) {
    const usuario = exigirRol(datos.id_usuario, ROLES_TALLER, 'registrar avances del taller');
    const p = buscarProyecto(id);
    const { filas, enCurso, proxima } = etapasDelPlan(p.id);
    if (!filas.length) throw new ErrorNegocio('Este pedido no tiene plan de fabricación: se trabaja con el flujo anterior.', 409);
    if (p.estado === 'pausado') throw new ErrorNegocio('El pedido está pausado: tocá "Continuar" antes de completar la etapa.', 409);
    if (p.estado !== 'en_proceso') throw new ErrorNegocio(`No se puede completar la etapa: el pedido está "${reglas.ESTADOS[p.estado]}".`, 409);
    if (!enCurso) throw new ErrorNegocio('No hay ninguna etapa en curso para completar.', 409);
    if (datos.etapa && texto(datos.etapa) !== enCurso.nombre) {
      throw new ErrorNegocio(`La etapa en curso es "${enCurso.nombre}". Actualizá la pantalla.`, 409);
    }
    return transaccion(db, () => {
      q.completarEtapaPedido.run(instante(), enCurso.id);
      if (proxima) q.etapa.run(proxima.nombre, p.id);
      registrarEvento(p.id, 'etapa_fin', usuario.id, { etapa: enCurso.nombre });
      return obtenerProyecto(p.id);
    });
  }

  /** "Iniciar etapa": la espera entre etapas termina acá, y desde acá corre el tiempo de trabajo. */
  function iniciarEtapa(id, datos = {}) {
    const usuario = exigirRol(datos.id_usuario, ROLES_TALLER, 'registrar avances del taller');
    const p = buscarProyecto(id);
    const { filas, enCurso, proxima } = etapasDelPlan(p.id);
    if (!filas.length) throw new ErrorNegocio('Este pedido no tiene plan de fabricación: se trabaja con el flujo anterior.', 409);
    if (p.estado === 'pausado') throw new ErrorNegocio('El pedido está pausado: tocá "Continuar" antes de iniciar la etapa.', 409);
    if (p.estado !== 'en_proceso') throw new ErrorNegocio(`No se puede iniciar la etapa: el pedido está "${reglas.ESTADOS[p.estado]}".`, 409);
    if (enCurso) {
      // Doble clic o reintento sobre la misma etapa: no se duplica el inicio.
      if (datos.etapa && texto(datos.etapa) === enCurso.nombre) return obtenerProyecto(p.id);
      throw new ErrorNegocio(`La etapa "${enCurso.nombre}" sigue en curso: completala antes de iniciar otra.`, 409);
    }
    if (!proxima) throw new ErrorNegocio('Todas las etapas están completadas: ya se puede finalizar el pedido.', 409);
    if (datos.etapa && texto(datos.etapa) !== proxima.nombre) {
      throw new ErrorNegocio(`La próxima etapa es "${proxima.nombre}". Actualizá la pantalla.`, 409);
    }
    return transaccion(db, () => {
      q.iniciarEtapaPedido.run(instante(), proxima.id);
      q.etapa.run(proxima.nombre, p.id);
      registrarEvento(p.id, 'etapa_inicio', usuario.id, { etapa: proxima.nombre });
      return obtenerProyecto(p.id);
    });
  }

  function pausar(id, datos = {}) {
    const usuario = exigirRol(datos.id_usuario, ROLES_TALLER, 'registrar avances del taller');
    const p = buscarProyecto(id);
    const causa = texto(datos.causa);
    const detalle = texto(datos.detalle);
    if (p.estado !== 'en_proceso') throw new ErrorNegocio(`No se puede pausar: el trabajo está "${reglas.ESTADOS[p.estado]}".`, 409);
    if (!causa) throw new ErrorNegocio('Elegí la causa de la pausa.');
    if (!reglas.CAUSAS.includes(causa)) throw new ErrorNegocio('La causa elegida no existe.');
    if (detalle.length < 3) throw new ErrorNegocio('Escribí qué pasó. Sin descripción no se puede pausar.');
    if (detalle.length > 300) throw new ErrorNegocio('La descripción es demasiado larga.');
    return transaccion(db, () => {
      q.estado.run('pausado', p.id);
      const { enCurso, proxima } = etapasDelPlan(p.id);
      const etapa = (enCurso || proxima)?.nombre ?? p.etapa_actual;
      registrarEvento(p.id, 'pausa', usuario.id, { etapa, causa, detalle });
      return obtenerProyecto(p.id);
    });
  }

  function continuar(id, datos = {}) {
    const usuario = exigirRol(datos.id_usuario, ROLES_TALLER, 'registrar avances del taller');
    const p = buscarProyecto(id);
    if (p.estado !== 'pausado') throw new ErrorNegocio(`No se puede continuar: el trabajo está "${reglas.ESTADOS[p.estado]}".`, 409);
    return transaccion(db, () => {
      q.estado.run('en_proceso', p.id);
      // Se reanuda la misma etapa que se pausó.
      const pausa = q.ultimoEvento.get(p.id, 'pausa');
      registrarEvento(p.id, 'continuar', usuario.id, { etapa: pausa?.etapa ?? p.etapa_actual });
      return obtenerProyecto(p.id);
    });
  }

  function finalizar(id, datos = {}) {
    const usuario = exigirRol(datos.id_usuario, ROLES_TALLER, 'registrar avances del taller');
    const p = buscarProyecto(id);
    if (p.estado !== 'en_proceso') throw new ErrorNegocio(`No se puede finalizar: el trabajo está "${reglas.ESTADOS[p.estado]}".`, 409);
    const { filas } = etapasDelPlan(p.id);
    const faltan = filas.filter((e) => !e.fin);
    if (faltan.length) {
      throw new ErrorNegocio(`Todavía no se puede finalizar: falta completar ${faltan.map((e) => `"${e.nombre}"`).join(', ')}.`, 409);
    }
    return transaccion(db, () => {
      q.estado.run('finalizado', p.id);
      registrarEvento(p.id, 'finalizar', usuario.id, { etapa: p.etapa_actual });
      return obtenerProyecto(p.id);
    });
  }

  // ---------- Demostración ----------
  function restablecerDemo() {
    cargarDatosDeEjemplo(db, ahora());
  }

  /**
   * Deja el sistema sin datos: borra proyectos, materiales, historial, planes de etapas,
   * catálogo de etapas y clientes. Las cuentas de usuario no se tocan.
   */
  function vaciarDatos() {
    transaccion(db, () => {
      db.exec(`DELETE FROM etapa_pedido; DELETE FROM etapa_catalogo; DELETE FROM evento; DELETE FROM material;
               DELETE FROM proyecto; DELETE FROM cliente;`);
      db.exec("DELETE FROM sqlite_sequence WHERE name IN ('evento', 'material', 'cliente', 'etapa_pedido', 'etapa_catalogo');");
    });
  }

  /** Si la base está vacía (primer arranque), carga los datos de ejemplo. */
  function inicializarSiEstaVacia() {
    if (q.cantidadUsuarios.get().n === 0) restablecerDemo();
  }

  return {
    catalogo, listarProyectos, obtenerProyecto, seguimientoCliente, alertas, indicadores, planilla, historialPausas, datosDashboard,
    crearProyecto, importarPlanilla, reprogramar, cancelar, registrarRecepcion, registrarRecepcionParcial,
    iniciar, pausar, continuar, finalizar, completarEtapa, iniciarEtapa, catalogoEtapas,
    restablecerDemo, vaciarDatos, inicializarSiEstaVacia,
  };
}

module.exports = { crearServicios, ErrorNegocio };
