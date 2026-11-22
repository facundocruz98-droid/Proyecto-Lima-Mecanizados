/** Vista del cliente: muestra, dentro del sistema, la misma página que ve el cliente con su link. */
import { api } from '../api.js';
import { avisar, ayuda, esc } from '../util.js';

let raiz;
let ctx;
let elegido = '';

const el = (id) => raiz.querySelector(`#${id}`);

/** Link público del proyecto (usa la dirección de red si se entró por "localhost"). */
function linkCliente(p) {
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  const base = local && ctx.catalogo.direcciones_red && ctx.catalogo.direcciones_red.length
    ? ctx.catalogo.direcciones_red[0]
    : location.origin;
  return `${base}/seguimiento.html?c=${encodeURIComponent(p.token_cliente)}`;
}

function pintar(proyectos) {
  const ordenados = [...proyectos].sort((a, b) => a.id.localeCompare(b.id));
  const lista = el('cliProyecto');
  lista.innerHTML = ordenados.map((p) => `<option value="${esc(p.id)}">${esc(p.id)} · ${esc(p.nombre)} · ${esc(p.cliente)}</option>`).join('');
  if (!ordenados.some((p) => p.id === elegido)) elegido = ordenados.length ? ordenados[0].id : '';
  lista.value = elegido;

  const p = ordenados.find((x) => x.id === elegido);
  if (!p) {
    el('cliLink').value = '';
    el('cliMarco').removeAttribute('src');
    return;
  }
  const url = linkCliente(p);
  el('cliLink').value = url;
  el('cliAbrir').href = url;
  // En la vista previa se usa la dirección de esta misma PC, para que cargue siempre.
  const previa = `seguimiento.html?c=${encodeURIComponent(p.token_cliente)}`;
  const marco = el('cliMarco');
  if (marco.getAttribute('src') !== previa) marco.setAttribute('src', previa);
  else marco.contentWindow?.location.reload();
}

async function actualizar() {
  pintar(await api.proyectos());
}

export default {
  titulo: 'Seguimiento del cliente',
  async montar(elemento, contexto, parametro) {
    raiz = elemento;
    ctx = contexto;
    if (parametro) elegido = parametro;
    raiz.innerHTML = `
      <div class="cliente-vista">
        <section class="tarjeta">
          <div class="tarjeta-cabeza"><h2>Proyecto</h2>${ayuda('ayudaCliente', '¿Qué ve el cliente?',
            'Lo que ve el cliente con su link: estado, etapa y fecha de entrega estimada.',
            'Elegí el proyecto y copiá el link para mandárselo. No ve las operaciones internas del taller.')}</div>
          <div class="tarjeta-cuerpo">
            <div class="campo"><label for="cliProyecto">Elegí el proyecto</label>
              <select id="cliProyecto"></select></div>
            <div class="campo"><label for="cliLink">Link para enviar al cliente</label>
              <input id="cliLink" type="text" readonly></div>
            <div class="acciones-form">
              <button class="boton" type="button" id="cliCopiar">Copiar link</button>
              <a class="boton secundario" id="cliAbrir" target="_blank" rel="noopener">Abrir en otra pestaña</a>
            </div>
            <p class="nota" style="margin-top:14px">El cliente no ve los motivos internos de las pausas ni los nombres de los operarios.
              La fecha estimada se recalcula sola cada vez que el taller pausa o continúa el trabajo.</p>
            <p class="nota">El link funciona en las computadoras y celulares conectados a la red de la empresa.</p>
          </div>
        </section>
        <section class="cliente-celular" aria-label="Vista previa en un celular">
          <iframe id="cliMarco" title="Vista del cliente"></iframe>
        </section>
      </div>`;
    el('cliProyecto').addEventListener('change', async (evento) => {
      elegido = evento.target.value;
      await actualizar();
    });
    el('cliLink').addEventListener('focus', (evento) => evento.target.select());
    el('cliCopiar').addEventListener('click', async () => {
      const url = el('cliLink').value;
      if (!url) return;
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        el('cliLink').select();
        document.execCommand('copy');
      }
      avisar('Link copiado. Pegalo en WhatsApp o en un mail al cliente.');
    });
    await actualizar();
  },
  actualizar,
};
