/** La planilla de la empresa, completada por el escaneo. */
import { api } from '../api.js';
import { avisar, duracion, esc, fecha, icono } from '../util.js';

let raiz;
let filas = [];

const el = (id) => raiz.querySelector(`#${id}`);
const logico = (valor) => (valor ? 'TRUE' : 'FALSE');

const COLUMNAS = [
  ['FECHA IN', (f) => fecha(f.fecha_ingreso)],
  ['PLAZO ENTREGA', (f) => fecha(f.plazo_entrega)],
  ['CLIENTE', (f) => f.cliente],
  ['NOMBRE PROY', (f) => f.nombre],
  ['DESCRIPCION', (f) => f.descripcion],
  ['URG', (f) => f.urgencia],
  ['GEN. ID', (f) => logico(f.id_generado)],
  ['ID', (f) => f.id],
  ['APROB', (f) => logico(f.aprobado)],
  ['En Ejec', (f) => logico(f.en_ejecucion)],
  ['Fecha Fin', (f) => fecha(f.fecha_fin)],
  ['Estado', (f) => f.estado],
  ['Etapa', (f) => f.etapa],
  ['Motivo de demora', (f) => f.motivo_demora],
  ['Cantidad de pausas', (f) => f.cantidad_pausas],
  ['Tiempo total detenido', (f) => (f.cantidad_pausas ? duracion(f.horas_detenido) : '—')],
];
const PRIMERA_NUEVA = 11;          // desde "Estado" son columnas que agrega el sistema
const ANCHAS = new Set([3, 4, 13]); // columnas de texto largo

async function actualizar() {
  filas = await api.planilla();
  el('cuerpo').innerHTML = filas.length
    ? filas.map((f, n) => `<tr><td class="num numero-fila">${n + 1}</td>${COLUMNAS.map(([, valor], i) => {
        const clases = [i >= PRIMERA_NUEVA ? 'nueva' : '', ANCHAS.has(i) ? 'ancha' : '', i === 7 ? 'codigo' : '', [0, 1, 10, 14, 15].includes(i) ? 'num' : ''].filter(Boolean).join(' ');
        return `<td class="${clases}">${esc(valor(f))}</td>`;
      }).join('')}</tr>`).join('')
    : `<tr><td colspan="${COLUMNAS.length + 1}" class="vacio">Todavía no hay proyectos.</td></tr>`;
  el('total').textContent = filas.length === 1 ? '1 proyecto' : `${filas.length} proyectos`;
}

async function copiar() {
  const texto = [['#', ...COLUMNAS.map(([titulo]) => titulo)], ...filas.map((f, n) => [n + 1, ...COLUMNAS.map(([, valor]) => String(valor(f)).replace(/[\t\r\n]+/g, ' '))])]
    .map((linea) => linea.join('\t')).join('\n');
  try {
    await navigator.clipboard.writeText(texto);
    avisar('Planilla copiada. Pegala en Excel o en Google Sheets.');
  } catch {
    avisar('El navegador no permitió copiar. Usá "Descargar para Excel".', 'mal');
  }
}

export default {
  titulo: 'Planilla',
  subtitulo: 'La planilla de siempre, con "En Ejec" y "Fecha Fin" completadas por el escaneo del taller.',
  async montar(elemento) {
    raiz = elemento;
    raiz.innerHTML = `
      <section class="tarjeta">
        <div class="tarjeta-cabeza">
          <span class="nota"><strong id="total" style="color:var(--texto)"></strong> · Las columnas en verde son las que agrega el sistema. Nadie carga "En Ejec" ni "Fecha Fin" a mano.</span>
          <div class="barra-acciones">
            <a class="boton" href="/api/planilla.xlsx" download="planilla-lima-mecanizados.xlsx"><span class="ico">${icono('descargar')}</span>Descargar para Excel</a>
            <button class="boton secundario" type="button" id="copiar"><span class="ico">${icono('copiar')}</span>Copiar</button>
          </div>
        </div>
        <div class="tarjeta-cuerpo sin-margen"><div class="tabla-caja">
          <table class="planilla">
            <thead><tr><th>#</th>${COLUMNAS.map(([titulo], i) => `<th class="${i >= PRIMERA_NUEVA ? 'nueva' : ''}">${esc(titulo)}</th>`).join('')}</tr></thead>
            <tbody id="cuerpo"></tbody>
          </table>
        </div></div>
      </section>`;
    el('copiar').addEventListener('click', copiar);
    await actualizar();
  },
  actualizar,
};
