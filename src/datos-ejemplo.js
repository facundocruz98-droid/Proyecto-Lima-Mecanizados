'use strict';
/**
 * Datos de ejemplo para la demostración.
 * Los clientes son ficticios. Las fechas se calculan respecto del día actual,
 * así la demo siempre muestra un trabajo vencido, uno pausado, uno por vencer, etc.
 */
const { transaccion } = require('./db');
const { fechaLocal } = require('./reglas');

function cargarDatosDeEjemplo(db, ahora = new Date()) {
  const dia = (n) => {
    const f = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() + n);
    return fechaLocal(f);
  };
  // Nunca devuelve un momento futuro (por si la demo se carga a la madrugada).
  const momento = (diasAtras, hora, minutos = 0) => {
    const f = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() - diasAtras, hora, minutos);
    return new Date(Math.min(f.getTime(), ahora.getTime() - 60000)).toISOString();
  };

  transaccion(db, () => {
    db.exec('DELETE FROM evento; DELETE FROM material; DELETE FROM proyecto; DELETE FROM cliente; DELETE FROM usuario;');
    db.exec("DELETE FROM sqlite_sequence WHERE name IN ('evento', 'material', 'cliente', 'usuario');");

    const usuario = db.prepare('INSERT INTO usuario (nombre, rol) VALUES (?, ?)');
    const U = {};
    for (const [clave, nombre, rol] of [
      ['gerencia', 'Gerencia General', 'Gerencia'],
      ['compras', 'Encargado de Compras', 'Compras'],
      ['supervisor', 'Supervisor de Taller', 'Supervisor'],
      ['op1', 'Operario 1', 'Operario'],
      ['op2', 'Operario 2', 'Operario'],
      ['op3', 'Operario 3', 'Operario'],
    ]) {
      U[clave] = Number(usuario.run(nombre, rol).lastInsertRowid);
    }

    const cliente = db.prepare('INSERT INTO cliente (nombre, codigo) VALUES (?, ?)');
    const C = {};
    for (const [codigo, nombre] of [
      ['FRN', 'Frigorífico Norte (ejemplo)'],
      ['FLA', 'Finca Los Álamos (ejemplo)'],
      ['MPU', 'Minera Puna (ejemplo)'],
      ['IVA', 'Ingenio del Valle (ejemplo)'],
    ]) {
      C[codigo] = Number(cliente.run(nombre, codigo).lastInsertRowid);
    }

    const proyecto = db.prepare(`INSERT INTO proyecto
      (id, numero, item, fecha_ingreso, plazo_entrega, id_cliente, nombre, descripcion,
       nro_presupuesto, urgencia, aprobado, estado, etapa_actual)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`);
    const material = db.prepare(`INSERT INTO material
      (id_proyecto, descripcion, indispensable, recibido, fecha_recepcion) VALUES (?, ?, ?, ?, ?)`);
    const evento = db.prepare(`INSERT INTO evento
      (id_proyecto, tipo, fecha_hora, id_usuario, etapa, causa, detalle) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    const ev = (id, tipo, cuando, quien, extra = {}) =>
      evento.run(id, tipo, cuando, quien, extra.etapa ?? null, extra.causa ?? null, extra.detalle ?? null);

    // 0640 · finalizado
    proyecto.run('0640-IVA-E-01', 640, 1, dia(-25), dia(-3), C.IVA, 'Eje mecanizado de repuesto',
      'Mecanizar en torno', 'PP - 101011 - IVA', 'E', 'finalizado', 'Terminación');
    material.run('0640-IVA-E-01', 'Barra SAE 1045', 1, 1, momento(8, 10));
    ev('0640-IVA-E-01', 'alta', momento(25, 9), U.gerencia);
    ev('0640-IVA-E-01', 'recepcion', momento(8, 10), U.compras, { detalle: 'Barra SAE 1045' });
    ev('0640-IVA-E-01', 'inicio', momento(7, 8), U.op2, { etapa: 'Corte' });
    ev('0640-IVA-E-01', 'etapa', momento(5, 9), U.op2, { etapa: 'Terminación' });
    ev('0640-IVA-E-01', 'finalizar', momento(4, 17), U.op2, { etapa: 'Terminación' });

    // 0641 · urgente, en proceso y con el plazo vencido (rojo)
    proyecto.run('0641-FRN-U-01', 641, 1, dia(-20), dia(-1), C.FRN, 'Parrilla industrial a medida',
      'Fabricar y pintar', 'PP - 101020 - FRN', 'U', 'en_proceso', 'Terminación');
    material.run('0641-FRN-U-01', 'Chapa negra 3 mm', 1, 1, momento(8, 11));
    material.run('0641-FRN-U-01', 'Planchuela 1"', 1, 1, momento(8, 11));
    ev('0641-FRN-U-01', 'alta', momento(20, 9), U.gerencia);
    ev('0641-FRN-U-01', 'recepcion', momento(8, 11), U.compras, { detalle: 'Chapa negra 3 mm, Planchuela 1"' });
    ev('0641-FRN-U-01', 'inicio', momento(6, 8), U.op1, { etapa: 'Corte' });
    ev('0641-FRN-U-01', 'etapa', momento(4, 9), U.op1, { etapa: 'Soldadura' });
    ev('0641-FRN-U-01', 'pausa', momento(3, 11), U.op1,
      { etapa: 'Soldadura', causa: 'Máquina o herramienta', detalle: 'Soldadora MIG en mantenimiento' });
    ev('0641-FRN-U-01', 'continuar', momento(2, 8), U.op1, { etapa: 'Soldadura' });
    ev('0641-FRN-U-01', 'etapa', momento(1, 10), U.op1, { etapa: 'Terminación' });

    // 0642 · pausado por falta de material (rojo + alerta a Compras)
    proyecto.run('0642-FLA-E-01', 642, 1, dia(-15), dia(3), C.FLA, 'Carro de carga x 2',
      'Fabricar, pintar, colocar ruedas', 'PP - 101034 - FLA', 'E', 'pausado', 'Armado');
    material.run('0642-FLA-E-01', 'Chapa 2 mm', 1, 1, momento(6, 12));
    material.run('0642-FLA-E-01', 'Caño estructural', 1, 1, momento(6, 12));
    ev('0642-FLA-E-01', 'alta', momento(15, 9), U.gerencia);
    ev('0642-FLA-E-01', 'recepcion', momento(6, 12), U.compras, { detalle: 'Chapa 2 mm, Caño estructural' });
    ev('0642-FLA-E-01', 'inicio', momento(5, 8), U.op3, { etapa: 'Corte' });
    ev('0642-FLA-E-01', 'etapa', momento(2, 9), U.op3, { etapa: 'Armado' });
    ev('0642-FLA-E-01', 'pausa', momento(1, 15), U.op3,
      { etapa: 'Armado', causa: 'Falta de material', detalle: 'Faltan las 4 ruedas giratorias' });

    // 0643-01 · urgente, en proceso, vence mañana (amarillo)
    proyecto.run('0643-MPU-U-01', 643, 1, dia(-12), dia(1), C.MPU, 'Tanque acero inoxidable 2000 L',
      'Fabricar cuerpo y soldar válvula', 'PP - 101041 - MPU', 'U', 'en_proceso', 'Soldadura');
    material.run('0643-MPU-U-01', 'Chapa inox 3 mm', 1, 1, momento(5, 10));
    material.run('0643-MPU-U-01', 'Válvula esférica 2"', 0, 1, momento(2, 9));
    ev('0643-MPU-U-01', 'alta', momento(12, 9), U.gerencia);
    ev('0643-MPU-U-01', 'recepcion', momento(5, 10), U.compras, { detalle: 'Chapa inox 3 mm' });
    ev('0643-MPU-U-01', 'inicio', momento(4, 8), U.op2, { etapa: 'Corte' });
    ev('0643-MPU-U-01', 'pausa', momento(3, 10), U.op2,
      { etapa: 'Corte', causa: 'Falta de material', detalle: 'La válvula esférica importada no llegó' });
    ev('0643-MPU-U-01', 'recepcion_parcial', momento(2, 9), U.compras, { detalle: 'Válvula esférica 2"' });
    ev('0643-MPU-U-01', 'continuar', momento(2, 10), U.op2, { etapa: 'Corte' });
    ev('0643-MPU-U-01', 'etapa', momento(1, 9), U.op2, { etapa: 'Soldadura' });

    // 0643-02 · segunda parte del mismo pedido, esperando materiales
    proyecto.run('0643-MPU-U-02', 643, 2, dia(-12), dia(5), C.MPU, 'Tapa y escalera del tanque',
      'Segunda parte del pedido 0643', 'PP - 101041 - MPU', 'U', 'pendiente_mat', '');
    material.run('0643-MPU-U-02', 'Chapa inox 2 mm', 1, 0, null);
    material.run('0643-MPU-U-02', 'Planchuela inox', 1, 0, null);
    ev('0643-MPU-U-02', 'alta', momento(12, 9, 5), U.gerencia);

    // 0644 · listo para iniciar (verde)
    proyecto.run('0644-IVA-E-01', 644, 1, dia(-6), dia(8), C.IVA, 'Soporte de bomba centrífuga',
      'Fabricar según plano rev. B', 'PP - 101052 - IVA', 'E', 'listo', '');
    material.run('0644-IVA-E-01', 'Perfil UPN 100', 1, 1, momento(0, 8));
    material.run('0644-IVA-E-01', 'Bulones grado 8', 1, 1, momento(0, 8));
    ev('0644-IVA-E-01', 'alta', momento(6, 9), U.gerencia);
    ev('0644-IVA-E-01', 'recepcion', momento(0, 8), U.compras, { detalle: 'Perfil UPN 100, Bulones grado 8' });
  });
}

module.exports = { cargarDatosDeEjemplo };
