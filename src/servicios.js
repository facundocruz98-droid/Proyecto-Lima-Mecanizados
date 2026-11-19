'use strict';
/**
 * Casos de uso del sistema. Cada función valida las reglas de negocio,
 * guarda los cambios y deja registrado el evento correspondiente.
 */
const { transaccion } = require('./db');
const reglas = require('./reglas');
const { cargarDatosDeEjemplo } = require('./datos-ejemplo');

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
    recepcionPosterior: db.prepare(`SELECT fecha_hora FROM evento
      WHERE id_proyecto = ? AND tipo IN ('recepcion', 'recepcion_parcial') AND id > ? ORDER BY id LIMIT 1`),
  };

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

  /** Agrega al proyecto los datos calculados: días, semáforo, pausa actual, fecha de fin. */
  function vista(p) {
    const dias = reglas.diasRestantes(p.plazo_entrega, hoy());
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
      nro_presupuesto: p.nro_presupuesto,
      urgencia: p.urgencia,
      aprobado: Boolean(p.aprobado),
      estado: p.estado,
      estado_texto: reglas.ESTADOS[p.estado],
      etapa_actual: p.etapa_actual,
      dias_restantes: dias,
      semaforo: reglas.semaforo(p.estado, dias),
      en_ejecucion: p.estado === 'en_proceso',
      pausa_actual: null,
      material_recibido_tras_pausa: false,
      fecha_fin: null,
    };
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
    return v;
  }

  const horasEntre = (desde, hasta) => Math.max(0, (Date.parse(hasta) - Date.parse(desde)) / 3600000);

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
    for (const e of eventos) {
      if (e.tipo === 'inicio' || e.tipo === 'continuar') { cerrar(e.fecha_hora); desde = e.fecha_hora; modo = 'proceso'; }
      else if (e.tipo === 'pausa') { cerrar(e.fecha_hora); desde = e.fecha_hora; modo = 'pausa'; }
      else if (e.tipo === 'finalizar') { cerrar(e.fecha_hora); desde = null; modo = null; }
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
      } else if (e.tipo === 'continuar' || e.tipo === 'finalizar') {
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
      vencidos: proyectos.filter((p) => p.estado !== 'finalizado' && p.dias_restantes < 0).map(breve),
      falta_material: porFaltaDeMaterial.filter((p) => !p.material_recibido_tras_pausa).map(breve),
      material_recibido: porFaltaDeMaterial.filter((p) => p.material_recibido_tras_pausa).map(breve),
      por_vencer: proyectos.filter((p) => p.semaforo === 'amarillo').map(breve),
    };
  }

  /** Causas de demora más frecuentes y horas detenidas (base de los KPI). */
  function indicadores() {
    const porCausa = new Map(reglas.CAUSAS.map((c) => [c, { causa: c, pausas: 0, horas: 0 }]));
    const porEtapa = new Map(reglas.ETAPAS.map((e) => [e, { etapa: e, pausas: 0, horas: 0 }]));
    const abiertas = new Map(); // id_proyecto -> evento de pausa sin cerrar
    const sumar = (pausa, hasta) => {
      const horas = horasEntre(pausa.fecha_hora, hasta);
      const c = porCausa.get(pausa.causa);
      if (c) { c.pausas += 1; c.horas += horas; }
      const e = porEtapa.get(pausa.etapa);
      if (e) { e.pausas += 1; e.horas += horas; }
    };
    for (const e of q.todosLosEventos.all()) {
      if (e.tipo === 'pausa') abiertas.set(e.id_proyecto, e);
      else if ((e.tipo === 'continuar' || e.tipo === 'finalizar') && abiertas.has(e.id_proyecto)) {
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
      id_generado: true,
      id: p.id,
      aprobado: p.aprobado,
      en_ejecucion: p.en_ejecucion,
      fecha_fin: p.fecha_fin ? reglas.fechaLocal(new Date(p.fecha_fin)) : '',
      estado: p.estado_texto,
      etapa: p.etapa_actual,
      motivo_demora: p.pausa_actual ? `${p.pausa_actual.causa}: ${p.pausa_actual.detalle}` : '',
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

  // ---------- Acciones de Gerencia ----------
  function crearProyecto(datos = {}) {
    const usuario = exigirRol(datos.id_usuario, ['Gerencia'], 'dar de alta un proyecto');
    const cliente = texto(datos.cliente);
    const codigo = texto(datos.codigo_cliente).toUpperCase();
    const nombre = texto(datos.nombre);
    const descripcion = texto(datos.descripcion);
    const presupuesto = texto(datos.nro_presupuesto);
    const urgencia = texto(datos.urgencia).toUpperCase() || 'E';
    const plazo = texto(datos.plazo_entrega);
    const ingreso = texto(datos.fecha_ingreso) || hoy();
    const idIngresado = texto(datos.id).toUpperCase();
    const materiales = (Array.isArray(datos.materiales) ? datos.materiales : [])
      .map(texto).filter(Boolean);

    if (cliente.length < 2) throw new ErrorNegocio('Completá el nombre del cliente.');
    if (!/^[A-Z]{3}$/.test(codigo)) throw new ErrorNegocio('El código de cliente tiene que ser de 3 letras (ej. MPU).');
    if (!nombre) throw new ErrorNegocio('Completá el nombre del proyecto.');
    if (!['E', 'U'].includes(urgencia)) throw new ErrorNegocio('La urgencia tiene que ser E (estándar) o U (urgente).');
    if (!plazo) throw new ErrorNegocio('El plazo de entrega es obligatorio: es la referencia de las alertas.');
    if (!reglas.esFechaValida(plazo)) throw new ErrorNegocio('El plazo de entrega no es una fecha válida.');
    if (plazo < hoy()) throw new ErrorNegocio('El plazo de entrega no puede ser anterior a hoy.');
    if (!reglas.esFechaValida(ingreso)) throw new ErrorNegocio('La fecha de ingreso no es una fecha válida.');
    if (ingreso > plazo) throw new ErrorNegocio('La fecha de ingreso no puede ser posterior al plazo de entrega.');
    if (materiales.length === 0) throw new ErrorNegocio('Indicá al menos un material indispensable para iniciar.');
    if (cliente.length > 80 || nombre.length > 120 || descripcion.length > 300 || presupuesto.length > 40
        || materiales.some((m) => m.length > 120) || materiales.length > 30) {
      throw new ErrorNegocio('Alguno de los textos es demasiado largo.');
    }

    return transaccion(db, () => {
      let numero;
      let item;
      let id;
      if (idIngresado) {
        const partes = reglas.desarmarId(idIngresado);
        if (!partes) {
          throw new ErrorNegocio('El ID no tiene el formato correcto. Ejemplo: 0645-MPU-U-01 (número-cliente-urgencia-ítem).');
        }
        if (partes.codigoCliente !== codigo) {
          throw new ErrorNegocio(`El ID dice cliente ${partes.codigoCliente}, pero el código de cliente cargado es ${codigo}.`);
        }
        if (partes.urgencia !== urgencia) {
          throw new ErrorNegocio(`El ID dice urgencia ${partes.urgencia}, pero la urgencia elegida es ${urgencia}.`);
        }
        ({ numero, item } = partes);
        id = idIngresado;
      } else {
        numero = q.maxNumero.get().n + 1;
        item = 1;
        id = reglas.armarId(numero, codigo, urgencia, item);
      }
      if (q.existeProyecto.get(id)) {
        throw new ErrorNegocio(`El ID ${id} ya existe. Si es otra parte del mismo pedido, usá el ítem siguiente (ej. -02).`, 409);
      }

      let filaCliente = q.clientePorCodigo.get(codigo);
      if (!filaCliente) {
        const alta = q.insertarCliente.run(cliente, codigo);
        filaCliente = { id: Number(alta.lastInsertRowid) };
      }

      q.insertarProyecto.run(id, numero, item, ingreso, plazo, filaCliente.id, nombre, descripcion,
        presupuesto, urgencia, datos.aprobado === false ? 0 : 1);
      for (const m of materiales) q.insertarMaterial.run(id, m, 1, 0, null);
      registrarEvento(id, 'alta', usuario.id);
      return obtenerProyecto(id);
    });
  }

  function reprogramar(id, datos = {}) {
    const usuario = exigirRol(datos.id_usuario, ['Gerencia'], 'cambiar el plazo de entrega');
    const p = buscarProyecto(id);
    const plazo = texto(datos.plazo_entrega);
    const motivo = texto(datos.motivo);
    if (p.estado === 'finalizado') throw new ErrorNegocio('El trabajo ya está finalizado: no se puede reprogramar.');
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
    if (!material) throw new ErrorNegocio('Escribí qué material llegó.');
    if (material.length > 120) throw new ErrorNegocio('La descripción del material es demasiado larga.');
    return transaccion(db, () => {
      q.insertarMaterial.run(p.id, material, 0, 1, instante());
      registrarEvento(p.id, 'recepcion_parcial', usuario.id, { detalle: material });
      return obtenerProyecto(p.id);
    });
  }

  // ---------- Acciones del taller ----------
  const ROLES_TALLER = ['Operario', 'Supervisor'];

  function iniciar(id, datos = {}) {
    const usuario = exigirRol(datos.id_usuario, ROLES_TALLER, 'registrar avances del taller');
    const p = buscarProyecto(id);
    if (p.estado === 'pendiente_mat') {
      throw new ErrorNegocio('No se puede iniciar: faltan los materiales indispensables. Compras tiene que registrar la recepción.', 409);
    }
    if (p.estado !== 'listo') throw new ErrorNegocio(`No se puede iniciar: el trabajo está "${reglas.ESTADOS[p.estado]}".`, 409);
    const etapa = texto(datos.etapa) || reglas.ETAPAS[0];
    if (!reglas.ETAPAS.includes(etapa)) throw new ErrorNegocio('La etapa elegida no existe.');
    return transaccion(db, () => {
      q.estadoYEtapa.run('en_proceso', etapa, p.id);
      registrarEvento(p.id, 'inicio', usuario.id, { etapa });
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
      registrarEvento(p.id, 'pausa', usuario.id, { etapa: p.etapa_actual, causa, detalle });
      return obtenerProyecto(p.id);
    });
  }

  function continuar(id, datos = {}) {
    const usuario = exigirRol(datos.id_usuario, ROLES_TALLER, 'registrar avances del taller');
    const p = buscarProyecto(id);
    if (p.estado !== 'pausado') throw new ErrorNegocio(`No se puede continuar: el trabajo está "${reglas.ESTADOS[p.estado]}".`, 409);
    return transaccion(db, () => {
      q.estado.run('en_proceso', p.id);
      registrarEvento(p.id, 'continuar', usuario.id, { etapa: p.etapa_actual });
      return obtenerProyecto(p.id);
    });
  }

  function finalizar(id, datos = {}) {
    const usuario = exigirRol(datos.id_usuario, ROLES_TALLER, 'registrar avances del taller');
    const p = buscarProyecto(id);
    if (p.estado !== 'en_proceso') throw new ErrorNegocio(`No se puede finalizar: el trabajo está "${reglas.ESTADOS[p.estado]}".`, 409);
    return transaccion(db, () => {
      q.estado.run('finalizado', p.id);
      registrarEvento(p.id, 'finalizar', usuario.id, { etapa: p.etapa_actual });
      return obtenerProyecto(p.id);
    });
  }

  function cambiarEtapa(id, datos = {}) {
    const usuario = exigirRol(datos.id_usuario, ROLES_TALLER, 'registrar avances del taller');
    const p = buscarProyecto(id);
    const etapa = texto(datos.etapa);
    if (p.estado !== 'en_proceso') throw new ErrorNegocio('La etapa solo se puede cambiar con el trabajo en proceso.', 409);
    if (!reglas.ETAPAS.includes(etapa)) throw new ErrorNegocio('La etapa elegida no existe.');
    if (etapa === p.etapa_actual) return obtenerProyecto(p.id);
    return transaccion(db, () => {
      q.etapa.run(etapa, p.id);
      registrarEvento(p.id, 'etapa', usuario.id, { etapa });
      return obtenerProyecto(p.id);
    });
  }

  // ---------- Demostración ----------
  function restablecerDemo() {
    cargarDatosDeEjemplo(db, ahora());
  }

  /** Si la base está vacía (primer arranque), carga los datos de ejemplo. */
  function inicializarSiEstaVacia() {
    if (q.cantidadUsuarios.get().n === 0) restablecerDemo();
  }

  return {
    catalogo, listarProyectos, obtenerProyecto, alertas, indicadores, planilla, historialPausas,
    crearProyecto, reprogramar, registrarRecepcion, registrarRecepcionParcial,
    iniciar, pausar, continuar, finalizar, cambiarEtapa,
    restablecerDemo, inicializarSiEstaVacia,
  };
}

module.exports = { crearServicios, ErrorNegocio };
