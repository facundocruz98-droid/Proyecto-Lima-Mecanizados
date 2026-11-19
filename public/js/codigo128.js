/**
 * Generador de códigos de barras Code 128 (subconjunto B) en SVG.
 * Implementación propia: el sistema no depende de internet ni de librerías externas.
 *
 * Cada símbolo son 6 anchos (barra, espacio, barra, espacio, barra, espacio) que suman 11 módulos.
 * El símbolo de parada tiene 7 anchos y suma 13.
 */
const PATRONES = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];
const INICIO_B = 104;
const PARADA = 106;

/** Devuelve los valores de símbolo (inicio, datos, verificación, parada) para un texto. */
export function codificar(texto) {
  const valores = [INICIO_B];
  let suma = INICIO_B;
  [...String(texto)].forEach((caracter, i) => {
    const codigo = caracter.charCodeAt(0);
    if (codigo < 32 || codigo > 126) throw new Error(`Carácter no admitido en el código de barras: "${caracter}"`);
    const valor = codigo - 32;
    valores.push(valor);
    suma += valor * (i + 1);
  });
  valores.push(suma % 103, PARADA);
  return valores;
}

/**
 * Dibuja el código de barras como SVG.
 * @param {string} texto  Contenido del código (ej. "0645-MPU-U-01")
 * @param {{ modulo?: number, alto?: number, margen?: number }} opciones  Medidas en píxeles
 */
export function codigoDeBarrasSVG(texto, { modulo = 2, alto = 80, margen = 10 } = {}) {
  const anchos = codificar(texto).map((v) => PATRONES[v]).join('');
  let x = margen * modulo;
  let barras = '';
  [...anchos].forEach((digito, i) => {
    const ancho = Number(digito) * modulo;
    if (i % 2 === 0) barras += `<rect x="${x}" y="0" width="${ancho}" height="${alto}"/>`;
    x += ancho;
  });
  const anchoTotal = x + margen * modulo;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${anchoTotal} ${alto}" width="${anchoTotal}" height="${alto}" role="img" aria-label="Código de barras ${texto}"><rect width="${anchoTotal}" height="${alto}" fill="#fff"/><g fill="#000">${barras}</g></svg>`;
}

export const _PATRONES = PATRONES;
