'use strict';
/**
 * Generador mínimo de archivos Excel (.xlsx) con varias hojas.
 * Solo usa módulos nativos de Node: no hay que instalar nada.
 *
 * Cada celda puede ser: texto, número, booleano, null (vacía)
 * o un objeto { v: valor, s: ESTILO.xxx } para fechas y duraciones.
 */
const zlib = require('node:zlib');

/** Índices de estilo definidos en styles.xml. */
const ESTILO = { normal: 0, titulo: 1, fecha: 2, fechaHora: 3, duracion: 4 };

/** 'AAAA-MM-DD' → número de serie de Excel (fecha sin hora). */
function fechaExcel(texto) {
  if (!texto) return null;
  const [a, m, d] = texto.split('-').map(Number);
  return { v: Date.UTC(a, m - 1, d) / 86400000 + 25569, s: ESTILO.fecha };
}

/** Instante ISO (UTC) → fecha y hora local en número de serie de Excel. */
function fechaHoraExcel(iso) {
  if (!iso) return null;
  const f = new Date(iso);
  return { v: (f.getTime() - f.getTimezoneOffset() * 60000) / 86400000 + 25569, s: ESTILO.fechaHora };
}

/** Horas → duración de Excel (se muestra como h:mm y se puede sumar). */
const duracionExcel = (horas) => ({ v: (horas || 0) / 24, s: ESTILO.duracion });

const escXML = (t) => String(t)
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function columna(n) { // 0 → A, 26 → AA
  let letras = '';
  for (n += 1; n > 0; n = Math.floor((n - 1) / 26)) letras = String.fromCharCode(65 + ((n - 1) % 26)) + letras;
  return letras;
}

function celdaXML(valor, ref, estiloFila) {
  let v = valor;
  let s = estiloFila;
  if (v && typeof v === 'object') { s = v.s ?? s; v = v.v; }
  const atributoS = s ? ` s="${s}"` : '';
  if (v === null || v === undefined || v === '') return s ? `<c r="${ref}"${atributoS}/>` : '';
  if (typeof v === 'boolean') return `<c r="${ref}" t="b"${atributoS}><v>${v ? 1 : 0}</v></c>`;
  if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${atributoS}><v>${v}</v></c>`;
  return `<c r="${ref}" t="inlineStr"${atributoS}><is><t xml:space="preserve">${escXML(v)}</t></is></c>`;
}

function hojaXML({ columnas, filas }, primera) {
  const todas = [columnas.map((c) => c.titulo), ...filas];
  const ultima = `${columna(columnas.length - 1)}${todas.length}`;
  const anchos = columnas.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.ancho || 12}" customWidth="1"/>`).join('');
  const datos = todas.map((fila, r) => `<row r="${r + 1}">${
    fila.map((valor, c) => celdaXML(valor, `${columna(c)}${r + 1}`, r === 0 ? ESTILO.titulo : 0)).join('')}</row>`).join('');
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + `<sheetViews><sheetView workbookViewId="0"${primera ? ' tabSelected="1"' : ''}><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    + `<cols>${anchos}</cols><sheetData>${datos}</sheetData><autoFilter ref="A1:${ultima}"/></worksheet>`;
}

const ESTILOS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  + '<numFmts count="3"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy hh:mm"/><numFmt numFmtId="166" formatCode="[h]:mm"/></numFmts>'
  + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>'
  + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FF1D5FA8"/><bgColor indexed="64"/></patternFill></fill></fills>'
  + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="5">'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
  + '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>'
  + '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
  + '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
  + '<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
  + '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

// ---------- Empaquetado ZIP (formato del .xlsx) ----------
const TABLA_CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(datos) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(datos);
  let c = 0xFFFFFFFF;
  for (const b of datos) c = TABLA_CRC[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function zip(archivos) {
  const ahora = new Date();
  const hora = (ahora.getHours() << 11) | (ahora.getMinutes() << 5) | (ahora.getSeconds() >> 1);
  const dia = ((ahora.getFullYear() - 1980) << 9) | ((ahora.getMonth() + 1) << 5) | ahora.getDate();
  const locales = [];
  const centrales = [];
  let desplazamiento = 0;
  for (const { nombre, contenido } of archivos) {
    const nombreB = Buffer.from(nombre, 'utf8');
    const crudo = Buffer.from(contenido, 'utf8');
    const comprimido = zlib.deflateRawSync(crudo);
    const crc = crc32(crudo);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8); local.writeUInt16LE(hora, 10); local.writeUInt16LE(dia, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(comprimido.length, 18); local.writeUInt32LE(crudo.length, 22);
    local.writeUInt16LE(nombreB.length, 26); local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(8, 10); central.writeUInt16LE(hora, 12);
    central.writeUInt16LE(dia, 14); central.writeUInt32LE(crc, 16); central.writeUInt32LE(comprimido.length, 20);
    central.writeUInt32LE(crudo.length, 24); central.writeUInt16LE(nombreB.length, 28);
    central.writeUInt32LE(desplazamiento, 42);
    locales.push(local, nombreB, comprimido);
    centrales.push(central, nombreB);
    desplazamiento += local.length + nombreB.length + comprimido.length;
  }
  const directorio = Buffer.concat(centrales);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(archivos.length, 8); fin.writeUInt16LE(archivos.length, 10);
  fin.writeUInt32LE(directorio.length, 12); fin.writeUInt32LE(desplazamiento, 16);
  return Buffer.concat([...locales, directorio, fin]);
}

/**
 * Arma el libro de Excel.
 * @param {{ nombre: string, columnas: {titulo: string, ancho?: number}[], filas: any[][] }[]} hojas
 * @returns {Buffer}
 */
function crearLibro(hojas) {
  const filtros = hojas.map((h, i) => `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${escXML(h.nombre)}'!$A$1:$${columna(h.columnas.length - 1)}$${h.filas.length + 1}</definedName>`).join('');
  return zip([
    { nombre: '[Content_Types].xml', contenido: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + hojas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
      + '</Types>' },
    { nombre: '_rels/.rels', contenido: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
      + '</Relationships>' },
    { nombre: 'xl/workbook.xml', contenido: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + `<sheets>${hojas.map((h, i) => `<sheet name="${escXML(h.nombre)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>`
      + `<definedNames>${filtros}</definedNames></workbook>` },
    { nombre: 'xl/_rels/workbook.xml.rels', contenido: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + hojas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
      + `<Relationship Id="rId${hojas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
      + '</Relationships>' },
    { nombre: 'xl/styles.xml', contenido: ESTILOS },
    ...hojas.map((h, i) => ({ nombre: `xl/worksheets/sheet${i + 1}.xml`, contenido: hojaXML(h, i === 0) })),
  ]);
}

module.exports = { crearLibro, fechaExcel, fechaHoraExcel, duracionExcel, ESTILO };
