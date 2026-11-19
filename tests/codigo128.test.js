'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const modulo = import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'codigo128.js')).href);

test('Code 128: la tabla de patrones cumple la norma', async () => {
  const { _PATRONES } = await modulo;
  assert.equal(_PATRONES.length, 107);
  assert.equal(new Set(_PATRONES).size, 107, 'no puede haber patrones repetidos');
  _PATRONES.forEach((patron, valor) => {
    const anchos = [...patron].map(Number);
    const total = anchos.reduce((a, b) => a + b, 0);
    assert.ok(anchos.every((n) => n >= 1 && n <= 4), `anchos entre 1 y 4 (valor ${valor})`);
    if (valor === 106) {
      assert.equal(anchos.length, 7);
      assert.equal(total, 13);
    } else {
      assert.equal(anchos.length, 6);
      assert.equal(total, 11, `el símbolo ${valor} tiene que sumar 11 módulos`);
      // En Code 128, la suma de las tres barras de cada símbolo es par.
      assert.equal((anchos[0] + anchos[2] + anchos[4]) % 2, 0, `barras pares (valor ${valor})`);
    }
  });
});

test('Code 128: dígito verificador del ejemplo de referencia "PJJ123C"', async () => {
  const { codificar } = await modulo;
  const valores = codificar('PJJ123C');
  assert.equal(valores[0], 104, 'empieza con Inicio B');
  // El ejemplo clásico da 54 con Inicio A (103). Con Inicio B (104) la suma sube en 1: 879 mod 103 = 55.
  assert.deepEqual(valores.slice(1, -2), [48, 42, 42, 17, 18, 19, 35]);
  assert.equal(valores.at(-2), 55);
  assert.equal(valores.at(-1), 106, 'termina con Parada');
});

test('Code 128: un ID del sistema genera un SVG con el ancho esperado', async () => {
  const { codigoDeBarrasSVG, codificar } = await modulo;
  const id = '0645-MPU-U-01';
  assert.equal(codificar(id).length, id.length + 3);
  const svg = codigoDeBarrasSVG(id, { modulo: 2, alto: 80, margen: 10 });
  // (inicio + 13 datos + verificador) × 11 + parada 13 = 178 módulos, más 10 de margen por lado.
  assert.match(svg, /viewBox="0 0 396 80"/);
  assert.match(svg, /^<svg /);
});

test('Code 128: rechaza caracteres que el lector no puede leer', async () => {
  const { codificar } = await modulo;
  assert.throws(() => codificar('ñ'));
});
