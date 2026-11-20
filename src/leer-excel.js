'use strict';
/**
 * Lector mínimo de archivos de Excel (.xlsx), sin instalar nada.
 * Un .xlsx es un ZIP con archivos XML adentro: acá se descomprime y se leen
 * las celdas de cada hoja. Devuelve los valores "crudos" (números, textos, sí/no).
 */
const zlib = require('node:zlib');

const MAXIMO_DESCOMPRIMIDO = 60 * 1024 * 1024; // protege contra archivos dañados o "bombas zip"

class ErrorArchivo extends Error {}

/** Lista los archivos del ZIP; cada uno se descomprime recién cuando se pide. */
function abrirZip(buffer) {
  let fin = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { fin = i; break; }
  }
  if (fin < 0) throw new ErrorArchivo('El archivo no es un Excel (.xlsx) válido.');
  const cantidad = buffer.readUInt16LE(fin + 10);
  let pos = buffer.readUInt32LE(fin + 16);
  const archivos = new Map();
  for (let n = 0; n < cantidad; n++) {
    if (pos + 46 > buffer.length || buffer.readUInt32LE(pos) !== 0x02014b50) {
      throw new ErrorArchivo('El archivo de Excel está dañado.');
    }
    const metodo = buffer.readUInt16LE(pos + 10);
    const tamComprimido = buffer.readUInt32LE(pos + 20);
    const largoNombre = buffer.readUInt16LE(pos + 28);
    const largoExtra = buffer.readUInt16LE(pos + 30);
    const largoComentario = buffer.readUInt16LE(pos + 32);
    const local = buffer.readUInt32LE(pos + 42);
    const nombre = buffer.toString('utf8', pos + 46, pos + 46 + largoNombre);
    archivos.set(nombre.replace(/^\//, ''), () => {
      if (local + 30 > buffer.length) throw new ErrorArchivo('El archivo de Excel está dañado.');
      const inicio = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
      const datos = buffer.subarray(inicio, inicio + tamComprimido);
      if (metodo === 0) return datos;
      if (metodo !== 8) throw new ErrorArchivo('El Excel usa un tipo de compresión que no se puede leer.');
      try {
        return zlib.inflateRawSync(datos, { maxOutputLength: MAXIMO_DESCOMPRIMIDO });
      } catch {
        throw new ErrorArchivo('El archivo de Excel está dañado o es demasiado grande.');
      }
    });
    pos += 46 + largoNombre + largoExtra + largoComentario;
  }
  return archivos;
}

function decodificar(texto) {
  return texto.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (todo, e) => {
    if (e[0] === '#') {
      const codigo = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      return Number.isFinite(codigo) ? String.fromCodePoint(codigo) : todo;
    }
    return { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[e.toLowerCase()];
  });
}

const atributo = (atributos, nombre) => {
  const m = new RegExp(`(?:^|\\s)${nombre}="([^"]*)"`).exec(atributos);
  return m ? decodificar(m[1]) : null;
};

/** Junta el texto de un nodo con texto enriquecido (<r><t>…</t></r>), ignorando la fonética (<rPh>). */
function textoDe(xml) {
  return [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g)]
    .map((m) => decodificar(m[1] ?? '')).join('');
}

/** "AB12" → 27 (índice de columna desde 0) */
function indiceColumna(referencia) {
  const letras = /^[A-Z]+/.exec(referencia || '');
  if (!letras) return -1;
  return [...letras[0]].reduce((n, l) => n * 26 + l.charCodeAt(0) - 64, 0) - 1;
}

/**
 * Lee un libro .xlsx.
 * @returns {{ fecha1904: boolean, hojas: { nombre: string, filas: { numero: number, valores: any[] }[] }[] }}
 */
function leerLibro(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) throw new ErrorArchivo('El archivo está vacío o no es un Excel.');
  const zip = abrirZip(buffer);
  const leer = (nombre) => {
    const abrir = zip.get(nombre);
    return abrir ? abrir().toString('utf8') : null;
  };
  const libroXML = leer('xl/workbook.xml');
  if (!libroXML) throw new ErrorArchivo('El archivo no es un Excel (.xlsx) válido. Si es .xls viejo, guardalo como .xlsx.');

  const fecha1904 = /<workbookPr\b[^>]*\bdate1904="(1|true)"/.test(libroXML);
  const relaciones = new Map();
  for (const m of (leer('xl/_rels/workbook.xml.rels') || '').matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    relaciones.set(atributo(m[1], 'Id'), atributo(m[1], 'Target'));
  }
  const compartidos = [...(leer('xl/sharedStrings.xml') || '').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\s*\/>/g)]
    .map((m) => textoDe(m[1] ?? ''));

  const hojas = [];
  for (const m of libroXML.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const nombre = atributo(m[1], 'name') || `Hoja ${hojas.length + 1}`;
    let destino = relaciones.get(atributo(m[1], 'r:id')) || '';
    destino = destino.startsWith('/') ? destino.slice(1) : `xl/${destino.replace(/^\.\//, '')}`;
    const xml = leer(destino);
    if (!xml) continue;
    const filas = [];
    let numeroAnterior = 0;
    for (const fila of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const numero = Number(atributo(fila[1], 'r')) || numeroAnterior + 1;
      numeroAnterior = numero;
      const valores = [];
      let siguiente = 0;
      for (const celda of (fila[2] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const indice = indiceColumna(atributo(celda[1], 'r'));
        const columna = indice >= 0 ? indice : siguiente;
        siguiente = columna + 1;
        const tipo = atributo(celda[1], 't');
        const interior = celda[2] || '';
        const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(interior);
        let valor = null;
        if (tipo === 'inlineStr') valor = textoDe(interior);
        else if (v) {
          const crudo = decodificar(v[1]);
          if (tipo === 's') valor = compartidos[Number(crudo)] ?? '';
          else if (tipo === 'b') valor = crudo === '1' || crudo.toLowerCase() === 'true';
          else if (tipo === 'str' || tipo === 'e' || tipo === 'd') valor = crudo;
          else valor = crudo.trim() === '' ? null : Number(crudo);
        }
        valores[columna] = valor;
      }
      for (let i = 0; i < valores.length; i++) if (valores[i] === undefined) valores[i] = null;
      filas.push({ numero, valores });
    }
    hojas.push({ nombre, filas });
  }
  if (!hojas.length) throw new ErrorArchivo('El Excel no tiene hojas con datos.');
  return { fecha1904, hojas };
}

module.exports = { leerLibro, ErrorArchivo };
