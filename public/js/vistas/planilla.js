/** La planilla de la empresa, completada por el escaneo. */
import { api } from '../api.js';
import { avisar, duracion, esc, fecha, icono } from '../util.js';

let raiz;
let ctx;
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
  ['ID', (f) => f.id],
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

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

function resumenImportacion(nombreArchivo, r) {
  const estados = Object.entries(r.por_estado)
    .map(([estado, n]) => `<li><span>${esc(estado)}</span><b class="num">${n}</b></li>`).join('');
  const omitidos = r.omitidos.length ? `
    <details class="importar-omitidos"${r.nuevos ? '' : ' open'}>
      <summary>${plural(r.omitidos.length, 'fila no se carga', 'filas no se cargan')} · ver por qué</summary>
      <div class="tabla-caja"><table>
        <thead><tr><th>Fila</th><th>ID</th><th>Motivo</th></tr></thead>
        <tbody>${r.omitidos.map((o) => `<tr><td class="num">${o.fila}</td><td class="codigo">${esc(o.id)}</td><td>${esc(o.motivo)}</td></tr>`).join('')}</tbody>
      </table></div>
    </details>` : '';
  const clientes = r.clientes_nuevos.length
    ? `<p class="nota">Se crean ${plural(r.clientes_nuevos.length, 'cliente nuevo', 'clientes nuevos')}: ${r.clientes_nuevos.slice(0, 4).map((c) => `${esc(c.nombre)} (${esc(c.codigo)})`).join(', ')}${r.clientes_nuevos.length > 4 ? ` y ${r.clientes_nuevos.length - 4} más` : ''}.</p>`
    : '';
  return `
    <form method="dialog" id="formImportar">
      <h2>Reemplazar la planilla con este Excel</h2>
      <p class="nota">${esc(nombreArchivo)} · hoja «${esc(r.hoja)}» · ${plural(r.filas, 'fila', 'filas')} con datos</p>
      <dl class="resumen importar-cifras">
        <div><dt>Proyectos del Excel</dt><dd class="num">${r.nuevos}</dd></div>
        <div><dt>Se borran</dt><dd class="num">${r.actuales}</dd></div>
        <div><dt>No se cargan</dt><dd class="num">${r.omitidos.length}</dd></div>
      </dl>
      ${estados ? `<ul class="importar-estados">${estados}</ul>` : ''}
      ${clientes}
      ${omitidos}
      <p class="nota importar-aviso">${r.nuevos
        ? `<strong>Se borran los ${plural(r.actuales, 'proyecto', 'proyectos')} que hay ahora</strong> y la planilla queda igual al Excel, con su historial (pausas, causas, etapas y cancelaciones). Esta acción no se puede deshacer.`
        : 'El Excel no tiene proyectos que se puedan cargar. La planilla actual no se modifica.'}</p>
      <div class="acciones-form">
        ${r.nuevos ? `<button class="boton" type="submit" id="confirmarImportar"><span class="ico">${icono('subir')}</span>Reemplazar por ${plural(r.nuevos, 'proyecto', 'proyectos')}</button>` : ''}
        <button class="boton secundario" type="button" data-cerrar>${r.nuevos ? 'Cancelar' : 'Cerrar'}</button>
      </div>
    </form>`;
}

async function importar(archivo) {
  const boton = el('cargarExcel');
  boton.classList.add('ocupado');
  const usuario = ctx.usuarioConRol('Gerencia');
  try {
    const contenido = await archivo.arrayBuffer();
    const previa = await api.importarPlanilla(contenido, usuario);
    const dialogo = ctx.abrirDialogo(resumenImportacion(archivo.name, previa));
    dialogo.querySelector('#formImportar').addEventListener('submit', async (evento) => {
      evento.preventDefault();
      const confirmar = dialogo.querySelector('#confirmarImportar');
      confirmar.disabled = true;
      confirmar.lastChild.textContent = 'Guardando…';
      try {
        const resultado = await api.importarPlanilla(contenido, usuario, true);
        ctx.cerrarDialogo();
        avisar(`Listo: la planilla ahora tiene ${plural(resultado.nuevos, 'proyecto', 'proyectos')} del Excel.`);
        await actualizar();
      } catch (error) {
        confirmar.disabled = false;
        confirmar.lastChild.textContent = 'Reintentar';
        avisar(error.message, 'mal');
      }
    });
  } catch (error) {
    avisar(error.message, 'mal');
  } finally {
    boton.classList.remove('ocupado');
  }
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
  subtitulo: '',
  async montar(elemento, contexto) {
    raiz = elemento;
    ctx = contexto;
    raiz.innerHTML = `
      <section class="tarjeta">
        <div class="tarjeta-cabeza">
          <span class="nota"><strong id="total" style="color:var(--texto)"></strong> · Las columnas en verde son las que agrega el sistema. Nadie carga "En Ejec" ni "Fecha Fin" a mano.</span>
          <div class="barra-acciones">
            <label class="boton secundario boton-archivo" id="cargarExcel" title="Reemplazar la planilla con un archivo .xlsx">
              <span class="ico">${icono('subir')}</span>Cargar Excel
              <input type="file" id="archivoExcel" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet">
            </label>
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
    el('archivoExcel').addEventListener('change', (evento) => {
      const archivo = evento.target.files[0];
      evento.target.value = '';
      if (archivo) importar(archivo);
    });
    await actualizar();
  },
  actualizar,
};
