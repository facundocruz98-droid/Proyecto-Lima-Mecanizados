'use strict';
/**
 * Plan de fabricación: catálogo de etapas, inicio real, avance por etapas y lo que ve el cliente.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.emitWarning = () => {}; // silencia el aviso "experimental" de node:sqlite
const { abrirBase } = require('../src/db');
const { crearServicios } = require('../src/servicios');

const GERENCIA = 1;
const COMPRAS = 2;
const OPERARIO = 4;
const HORA = 3600000;

function preparar(ruta = ':memory:') {
  let reloj = new Date(2026, 10, 11, 8, 0, 0);
  const avanzar = (horas) => { reloj = new Date(reloj.getTime() + horas * HORA); };
  const db = abrirBase(ruta);
  const s = crearServicios(db, { ahora: () => reloj });
  s.inicializarSiEstaVacia();
  const alta = (nombre) => s.crearProyecto({
    id_usuario: GERENCIA, cliente: 'Cliente de prueba', codigo_cliente: 'PRU', nombre,
    urgencia: 'E', plazo_entrega: '2026-11-30', materiales: ['Chapa'],
  }).id;
  return { db, s, alta, avanzar };
}

const tipos = (s, id) => s.obtenerProyecto(id).eventos.map((e) => e.tipo);

test('sin materiales esenciales el backend no deja iniciar, ni siquiera con plan', () => {
  const { s, alta } = preparar();
  const id = alta('Portón');
  assert.equal(s.obtenerProyecto(id).estado, 'pendiente_mat');
  assert.throws(() => s.iniciar(id, { id_usuario: OPERARIO, plan: ['Corte'] }), /faltan los materiales/);
});

test('al confirmar materiales queda listo con fecha y hora, sin inicio real', () => {
  const { s, alta, avanzar } = preparar();
  const id = alta('Portón');
  avanzar(1);
  s.registrarRecepcion(id, { id_usuario: COMPRAS });
  const p = s.obtenerProyecto(id);
  assert.equal(p.estado, 'listo');
  assert.equal(p.listo_desde, new Date(2026, 10, 11, 9).toISOString());
  assert.equal(p.inicio_real, null);
  assert.equal(p.tiene_plan, false);
});

test('el catálogo arranca vacío y se completa con el plan confirmado', () => {
  const { s, alta, avanzar } = preparar();
  assert.deepEqual(s.catalogoEtapas(), []);
  const id = alta('Portón');
  s.registrarRecepcion(id, { id_usuario: COMPRAS });
  avanzar(3); // espera previa al inicio: no es fabricación
  const p = s.iniciar(id, { id_usuario: OPERARIO, plan: ['Corte', ' Perforado ', 'Soldadura', 'Pintura'] });
  assert.deepEqual(s.catalogoEtapas(), ['Corte', 'Perforado', 'Soldadura', 'Pintura']);
  assert.equal(p.estado, 'en_proceso');
  assert.equal(p.etapa_actual, 'Corte');
  assert.equal(p.etapa_numero, 1);
  assert.equal(p.total_etapas, 4);
  assert.deepEqual(p.plan.map((e) => e.estado), ['en_curso', 'pendiente', 'pendiente', 'pendiente']);
  assert.equal(p.inicio_real, new Date(2026, 10, 11, 11).toISOString());
  assert.notEqual(p.listo_desde, p.inicio_real, 'listo e inicio real son distintos');
  assert.equal(p.tiempos.horas_en_proceso, 0, 'la espera previa no cuenta');
});

test('un doble clic o reintento no duplica el inicio', () => {
  const { s, alta } = preparar();
  const id = alta('Portón');
  s.registrarRecepcion(id, { id_usuario: COMPRAS });
  s.iniciar(id, { id_usuario: OPERARIO, plan: ['Corte', 'Pintura'] });
  const otra = s.iniciar(id, { id_usuario: OPERARIO, plan: ['Corte', 'Pintura'] });
  assert.equal(otra.estado, 'en_proceso');
  assert.equal(tipos(s, id).filter((t) => t === 'inicio').length, 1);
  assert.equal(otra.plan.length, 2);
  assert.throws(() => s.iniciar(id, { id_usuario: OPERARIO, plan: ['Otro'] }), /En proceso/);
  // Iniciar dos veces la misma etapa tampoco duplica
  s.completarEtapa(id, { id_usuario: OPERARIO });
  s.iniciarEtapa(id, { id_usuario: OPERARIO, etapa: 'Pintura' });
  s.iniciarEtapa(id, { id_usuario: OPERARIO, etapa: 'Pintura' });
  assert.equal(tipos(s, id).filter((t) => t === 'etapa_inicio').length, 1);
});

test('planes inválidos se rechazan', () => {
  const { s, alta } = preparar();
  const id = alta('Portón');
  s.registrarRecepcion(id, { id_usuario: COMPRAS });
  assert.throws(() => s.iniciar(id, { id_usuario: OPERARIO, plan: [] }), /al menos una etapa/);
  assert.throws(() => s.iniciar(id, { id_usuario: OPERARIO, plan: ['Corte', ''] }), /al menos una etapa/);
  assert.throws(() => s.iniciar(id, { id_usuario: OPERARIO, plan: ['Corte', 'corte'] }), /repetida/);
  assert.equal(s.obtenerProyecto(id).estado, 'listo', 'nada se guardó');
  assert.deepEqual(s.catalogoEtapas(), []);
});

test('avance por etapas: la espera entre etapas no es tiempo de trabajo', () => {
  const { s, alta, avanzar } = preparar();
  const id = alta('Portón');
  s.registrarRecepcion(id, { id_usuario: COMPRAS });
  s.iniciar(id, { id_usuario: OPERARIO, plan: ['Corte', 'Perforado'] });
  avanzar(2);
  let p = s.completarEtapa(id, { id_usuario: OPERARIO });
  assert.deepEqual(p.plan.map((e) => e.estado), ['completada', 'lista']);
  assert.equal(p.etapa_actual, 'Perforado');
  assert.equal(p.etapa_en_curso, false);
  assert.throws(() => s.completarEtapa(id, { id_usuario: OPERARIO }), /ninguna etapa en curso/);
  assert.throws(() => s.finalizar(id, { id_usuario: OPERARIO }), /falta completar "Perforado"/);

  avanzar(3); // espera entre etapas
  p = s.iniciarEtapa(id, { id_usuario: OPERARIO });
  assert.deepEqual(p.plan.map((e) => e.estado), ['completada', 'en_curso']);
  avanzar(1);
  p = s.completarEtapa(id, { id_usuario: OPERARIO });
  assert.equal(p.todas_completadas, true);
  assert.throws(() => s.iniciarEtapa(id, { id_usuario: OPERARIO }), /Todas las etapas están completadas/);
  avanzar(5);
  p = s.finalizar(id, { id_usuario: OPERARIO });
  assert.equal(p.estado, 'finalizado');
  assert.equal(p.fecha_fin, new Date(2026, 10, 11, 19).toISOString());
  assert.ok(Math.abs(p.tiempos.horas_en_proceso - 3) < 1e-9, `3 h de trabajo, no ${p.tiempos.horas_en_proceso}`);
});

test('la pausa queda vinculada a la etapa activa y "Continuar" reanuda esa etapa', () => {
  const { s, alta, avanzar } = preparar();
  const id = alta('Portón');
  s.registrarRecepcion(id, { id_usuario: COMPRAS });
  s.iniciar(id, { id_usuario: OPERARIO, plan: ['Corte', 'Perforado'] });
  avanzar(1);
  assert.throws(() => s.pausar(id, { id_usuario: OPERARIO, causa: 'Otro', detalle: '' }), /descripción/);
  s.pausar(id, { id_usuario: OPERARIO, causa: 'Máquina o herramienta', detalle: 'Sierra sin hoja' });
  assert.throws(() => s.completarEtapa(id, { id_usuario: OPERARIO }), /pausado/);
  avanzar(2);
  let p = s.continuar(id, { id_usuario: OPERARIO });
  assert.equal(p.etapa_actual, 'Corte');
  assert.deepEqual(p.plan.map((e) => e.estado), ['en_curso', 'pendiente']);
  const eventos = p.eventos.filter((e) => ['pausa', 'continuar'].includes(e.tipo));
  assert.deepEqual(eventos.map((e) => e.etapa), ['Corte', 'Corte']);
  assert.equal(s.historialPausas().find((x) => x.id_proyecto === id).etapa, 'Corte');

  // Entre etapas, la pausa (ej. falta un insumo de la etapa siguiente) queda en la próxima etapa.
  s.completarEtapa(id, { id_usuario: OPERARIO });
  s.pausar(id, { id_usuario: OPERARIO, causa: 'Falta de material', detalle: 'Faltan mechas de 12 mm' });
  p = s.continuar(id, { id_usuario: OPERARIO });
  assert.equal(p.eventos.filter((e) => e.tipo === 'pausa').at(-1).etapa, 'Perforado');
  assert.deepEqual(p.plan.map((e) => e.estado), ['completada', 'lista'], 'vuelve a esperar "Iniciar etapa"');
  assert.ok(s.indicadores().etapas.some((e) => e.etapa === 'Perforado' && e.pausas === 1));
});

test('cada pedido conserva su plan y las etapas nuevas se suman al catálogo', () => {
  const { s, alta } = preparar();
  const uno = alta('Primero');
  const dos = alta('Segundo');
  s.registrarRecepcion(uno, { id_usuario: COMPRAS });
  s.registrarRecepcion(dos, { id_usuario: COMPRAS });
  s.iniciar(uno, { id_usuario: OPERARIO, plan: ['Corte', 'Perforado', 'Soldadura', 'Pintura'] });
  s.iniciar(dos, { id_usuario: OPERARIO, plan: ['Corte', 'Desbarbado', 'Perforado'] });
  assert.deepEqual(s.obtenerProyecto(uno).plan.map((e) => e.nombre), ['Corte', 'Perforado', 'Soldadura', 'Pintura']);
  assert.deepEqual(s.obtenerProyecto(dos).plan.map((e) => e.nombre), ['Corte', 'Desbarbado', 'Perforado']);
  assert.deepEqual(s.catalogoEtapas(), ['Corte', 'Perforado', 'Soldadura', 'Pintura', 'Desbarbado']);
});

test('el catálogo se conserva al reiniciar la aplicación', () => {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'lima-plan-'));
  const ruta = path.join(carpeta, 'prueba.db');
  try {
    const primero = preparar(ruta);
    const id = primero.alta('Portón');
    primero.s.registrarRecepcion(id, { id_usuario: COMPRAS });
    primero.s.iniciar(id, { id_usuario: OPERARIO, plan: ['Corte', 'Plegado'] });
    primero.db.close();

    const segundo = preparar(ruta);
    assert.deepEqual(segundo.s.catalogoEtapas(), ['Corte', 'Plegado']);
    assert.deepEqual(segundo.s.obtenerProyecto(id).plan.map((e) => e.estado), ['en_curso', 'pendiente']);
    segundo.db.close();
  } finally {
    fs.rmSync(carpeta, { recursive: true, force: true });
  }
});

test('el cliente ve solo los 4 pasos: ni el plan de etapas ni los motivos de pausa', () => {
  const { s, alta } = preparar();
  const id = alta('Portón');
  const ver = () => s.seguimientoCliente(s.obtenerProyecto(id).token_cliente);
  const pasos = () => ver().pasos.map((e) => `${e.clave}:${e.estado}`);
  s.registrarRecepcion(id, { id_usuario: COMPRAS });
  s.iniciar(id, { id_usuario: OPERARIO, plan: ['Perforado', 'Desbarbado'] });
  s.pausar(id, { id_usuario: OPERARIO, causa: 'Falta de material', detalle: 'Faltan bulones M10' });
  const textoPublico = JSON.stringify(ver());
  for (const interno of ['Perforado', 'Desbarbado', 'bulones', 'Falta de material', 'Operario']) {
    assert.ok(!textoPublico.includes(interno), `no expone "${interno}"`);
  }
  assert.deepEqual(pasos(), ['recibido:hecha', 'fabricacion:actual', 'listo:pendiente', 'entregado:pendiente']);
  s.continuar(id, { id_usuario: OPERARIO });
  s.completarEtapa(id, { id_usuario: OPERARIO });
  s.iniciarEtapa(id, { id_usuario: OPERARIO });
  s.completarEtapa(id, { id_usuario: OPERARIO });
  s.finalizar(id, { id_usuario: OPERARIO });
  assert.deepEqual(pasos(), ['recibido:hecha', 'fabricacion:hecha', 'listo:hecha', 'entregado:actual']);
});

test('los pedidos anteriores sin plan siguen operando con el flujo de siempre', () => {
  const { s } = preparar();
  const enCurso = s.listarProyectos().find((p) => p.estado === 'en_proceso');
  assert.equal(enCurso.tiene_plan, false);
  s.cambiarEtapa(enCurso.id, { id_usuario: OPERARIO, etapa: 'Pintura' });
  const p = s.finalizar(enCurso.id, { id_usuario: OPERARIO });
  assert.equal(p.estado, 'finalizado');
  assert.throws(() => s.completarEtapa(enCurso.id, { id_usuario: OPERARIO }), /no tiene plan/);
});
