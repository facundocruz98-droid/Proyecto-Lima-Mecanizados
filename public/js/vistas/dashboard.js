/**
 * Dashboard gerencial: estado de los proyectos, evolución de la producción y causas de pausa.
 * Toma los proyectos de la planilla del sistema (/api/dashboard) y dibuja con Chart.js.
 * Se actualiza solo cuando el taller o Compras registran algo (aviso en tiempo real).
 * Los colores salen de las variables de estilos.css, así respeta el modo claro y oscuro.
 */

const LIBRERIAS = ['https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js'];

let cargaLibrerias = null;
let controlador = null;

function cargarLibrerias() {
  cargaLibrerias ??= Promise.all(LIBRERIAS.map((src) => new Promise((resolver, rechazar) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolver;
    script.onerror = () => { script.remove(); rechazar(new Error('sin conexión')); };
    document.head.append(script);
  }))).catch((error) => { cargaLibrerias = null; throw error; });
  return cargaLibrerias;
}

function tema() {
  const css = getComputedStyle(document.documentElement);
  const v = (nombre) => css.getPropertyValue(nombre).trim();
  return {
    texto: v('--texto'), suave: v('--texto-suave'), borde: v('--borde'),
    superficie: v('--superficie'), acento: v('--acento'), fuente: v('--fuente') || 'Segoe UI, sans-serif',
  };
}

function aplicarTemaGraficos() {
  const t = tema();
  Chart.defaults.color = t.suave;
  Chart.defaults.borderColor = t.borde;
  Chart.defaults.font.family = t.fuente;
  Chart.defaults.font.size = 12;
  Chart.defaults.plugins.tooltip.backgroundColor = t.texto;
  Chart.defaults.plugins.tooltip.titleColor = t.superficie;
  Chart.defaults.plugins.tooltip.bodyColor = t.superficie;
  Chart.defaults.plugins.tooltip.padding = 10;
  Chart.defaults.plugins.tooltip.cornerRadius = 8;
}

const PLANTILLA = `
      <div class="dash">
        <section class="tarjeta dash-filtros" aria-label="Filtros generales">
          <form id="filtrosGenerales" class="dash-filtros-form">
            <div class="controles filtros-compartidos">
              <div class="controles" data-fechas></div>
              <label>Cliente<select name="cliente"><option value="">Todos los clientes</option></select></label>
              <button type="button" data-reset>Limpiar filtros</button>
            </div>
            <p id="periodoGeneral" class="contexto-filtros" role="status"></p>
            <div id="cruceEstado" class="cruce-estado" hidden>
              <p id="textoCruceEstado" role="status"></p>
              <button id="quitarCruce" type="button">Quitar cruce</button>
            </div>
          </form>
          <div class="dash-fuente">
            <a class="boton secundario chico" href="#planilla"><span class="ico" data-icono="tabla"></span>Ver planilla</a>
            <p id="actualizado" class="dash-actualizado">Leyendo la planilla…</p>
            <p id="estadoArchivo" class="estado-archivo" role="status"></p>
          </div>
        </section>

        <div id="resumen" hidden>
          <header class="cabecera-seccion">
            <div><h2 id="tituloResumen">Resumen ejecutivo</h2><p id="corteKpi">Leyendo los datos de la planilla…</p></div>
            <details class="ajustes">
              <summary>Configurar corte</summary>
              <div class="controles">
                <label>Fecha de corte<input id="fechaKpi" type="date"></label>
                <label>Ventana de resultados<select id="ventanaKpi"><option value="30">Últimos 30 días</option><option value="7">Últimos 7 días</option><option value="365">Últimos 365 días</option><option value="todos">Todo el historial</option></select></label>
                <button type="button" id="resetKpi">Restablecer</button>
              </div>
            </details>
          </header>
          <div id="kpis" class="kpis"></div>
        </div>

        <section id="produccion" class="dash-cuadricula" aria-label="Distribución y evolución de producción">
          <article class="tarjeta dash-tarjeta" aria-labelledby="tituloEstado">
            <header class="cabecera-tarjeta">
              <div>
                <h2 id="tituloEstado">¿En qué estado están los trabajos?</h2>
                <p id="criterioEstado" hidden></p>
              </div>
              <div class="ayuda-grafico">
                <button type="button" class="icono-tarjeta" popovertarget="ayudaEstado" aria-label="Información sobre estado de los proyectos">i</button>
                <div id="ayudaEstado" class="panel-ayuda" popover role="dialog" aria-labelledby="tituloAyudaEstado">
                  <div class="cabecera-ayuda">
                    <h3 id="tituloAyudaEstado">¿En qué estado están los trabajos?</h3>
                    <button type="button" class="cerrar-ayuda" popovertarget="ayudaEstado" popovertargetaction="hide" aria-label="Cerrar información" autofocus>×</button>
                  </div>
                  <h4>¿Qué muestra?</h4>
                  <p>Muestra cuántos proyectos están pendientes de materiales, listos para iniciar, en proceso, pausados, finalizados o cancelados, y qué proporción representa cada estado. Refleja el último día del período seleccionado. «Activos» excluye los finalizados y cancelados.</p>
                  <h4>¿Para qué sirve?</h4>
                  <p>Permite ver cuántos proyectos todavía necesitan atención.</p>
                  <h4>¿Cómo ayuda a tomar decisiones?</h4>
                  <p>Si muchos proyectos están pendientes de materiales, consultá con Compras qué falta para que puedan empezar.</p>
                </div>
              </div>
            </header>
            <form id="filtrosEstado" class="filtros">
              <fieldset class="alcance-estado">
                <legend>Mostrar proyectos</legend>
                <div class="segmentado">
                  <label><input type="radio" name="alcance" value="activos" checked><span>Activos</span></label>
                  <label><input type="radio" name="alcance" value="todos"><span>Todos</span></label>
                </div>
              </fieldset>
            </form>
            <p id="avisoEstado" class="aviso-grafico" role="status" hidden></p>
            <p id="vacioEstado" class="vacio-grafico" role="status"></p>
            <div id="graficoEstado" class="distribucion" hidden>
              <div id="zonaDona" class="zona dona"><canvas id="dona" aria-hidden="true"></canvas><div id="centroDona" class="dona-centro"><strong id="totalDona"></strong><span id="etiquetaTotalDona">Activos</span></div></div>
              <ul id="leyendaEstado" class="leyenda" aria-label="Cantidad y porcentaje por categoría"></ul>
            </div>
            <div id="detalleEstado" class="detalle" hidden></div>
          </article>

          <article class="tarjeta dash-tarjeta" aria-labelledby="tituloLinea">
            <header class="cabecera-tarjeta">
              <div>
                <h2 id="tituloLinea">¿Cómo viene la producción?</h2>
                <p id="criterioLinea" hidden></p>
              </div>
              <div class="ayuda-grafico">
                <button type="button" class="icono-tarjeta" popovertarget="ayudaLinea" aria-label="Información sobre cómo va la producción">i</button>
                <div id="ayudaLinea" class="panel-ayuda" popover role="dialog" aria-labelledby="tituloAyudaLinea">
                  <div class="cabecera-ayuda">
                    <h3 id="tituloAyudaLinea">¿Cómo viene la producción?</h3>
                    <button type="button" class="cerrar-ayuda" popovertarget="ayudaLinea" popovertargetaction="hide" aria-label="Cerrar información" autofocus>×</button>
                  </div>
                  <h4>¿Qué muestra?</h4>
                  <p>Muestra los proyectos ingresados, iniciados o finalizados, las pausas o los proyectos con pausas, según lo que elijas. «Cantidad de pausas» cuenta todas las interrupciones. «Proyectos con pausas» cuenta cada proyecto afectado una sola vez por día, semana o mes, según la agrupación.</p>
                  <h4>¿Para qué sirve?</h4>
                  <p>Sirve para comparar días, semanas o meses y detectar cambios en la actividad.</p>
                  <h4>¿Cómo ayuda a tomar decisiones?</h4>
                  <p>Si las pausas aumentan en un mes, revisá qué proyectos fueron afectados y consultá las causas.</p>
                </div>
              </div>
            </header>
            <form id="filtrosLinea" class="filtros">
              <div class="controles">
                <label>¿Qué querés ver?<select name="indicador"><option value="ingresos">Proyectos ingresados</option><option value="inicios">Proyectos iniciados</option><option value="finales">Proyectos finalizados</option><option value="pausas">Cantidad de pausas</option><option value="afectados">Proyectos con pausas</option></select></label>
                <label>Ver por<select name="unidad"><option value="mes">Mes</option><option value="semana">Semana</option><option value="dia">Día</option></select></label>
              </div>
            </form>
            <p id="avisoLinea" class="aviso-grafico" role="status" hidden></p>
            <p id="vacioLinea" class="vacio-grafico" role="status"></p>
            <div id="zonaLinea" class="zona zona-linea" hidden><canvas id="linea" aria-hidden="true"></canvas></div>
            <div id="controlesPunto" class="controles selector-detalle" hidden><label><select id="puntoLinea" aria-label="Ver el detalle de un período"></select></label></div>
            <div id="detalleLinea" class="detalle" hidden></div>
          </article>
        </section>

        <section id="demoras" class="tarjeta dash-tarjeta" aria-labelledby="tituloDemoras">
          <header class="cabecera-tarjeta">
            <div><h2 id="tituloDemoras">¿Por qué se frenan los trabajos?</h2><p id="criterioDemoras" hidden>Pausas por fecha de ocurrencia.</p></div>
            <div class="ayuda-grafico">
              <button type="button" class="icono-tarjeta" popovertarget="ayudaDemoras" aria-label="Información sobre causas de pausa">i</button>
              <div id="ayudaDemoras" class="panel-ayuda" popover role="dialog" aria-labelledby="tituloAyudaDemoras">
                <div class="cabecera-ayuda">
                  <h3 id="tituloAyudaDemoras">¿Por qué se frenan los trabajos?</h3>
                  <button type="button" class="cerrar-ayuda" popovertarget="ayudaDemoras" popovertargetaction="hide" aria-label="Cerrar información" autofocus>×</button>
                </div>
                <h4>¿Qué muestra?</h4>
                <p>Muestra los motivos registrados, como falta de material, problemas de maquinaria o espera de otro proceso. Podés ver cuántas pausas hubo por causa o cuántos proyectos fueron afectados. Un proyecto puede aparecer en varias categorías si tuvo pausas por distintos motivos.</p>
                <h4>¿Para qué sirve?</h4>
                <p>Permite identificar qué problemas se repiten y a cuántos proyectos afectan.</p>
                <h4>¿Cómo ayuda a tomar decisiones?</h4>
                <p>Si predomina la falta de material, revisá con Compras la coordinación y el abastecimiento de los trabajos.</p>
              </div>
            </div>
          </header>
          <form id="filtrosDemoras" class="filtros">
            <div class="controles">
              <label>Indicador<select name="indicador"><option value="pausas">Cantidad de pausas</option><option value="afectados">Proyectos afectados</option></select></label>
            </div>
          </form>
          <p id="avisoDemoras" class="aviso-grafico" role="status" hidden></p>
          <p id="vacioDemoras" class="vacio-grafico" role="status"></p>
          <div class="desplazable"><div id="zonaDemoras" class="zona" hidden><canvas id="barras" aria-hidden="true"></canvas></div></div>
          <div id="controlesCausa" class="controles selector-detalle" hidden><label><select id="grupoDemoras" aria-label="Ver el detalle de una causa"></select></label></div>
          <div id="detalleDemoras" class="detalle" hidden></div>
        </section>

        <section id="etapasPausa" class="tarjeta dash-tarjeta" aria-labelledby="tituloEtapas">
          <header class="cabecera-tarjeta">
            <div><h2 id="tituloEtapas">¿En qué etapa se frenan los trabajos?</h2><p id="criterioEtapas" hidden>Pausas por fecha de ocurrencia.</p></div>
            <div class="ayuda-grafico">
              <button type="button" class="icono-tarjeta" popovertarget="ayudaEtapas" aria-label="Información sobre pausas por etapa">i</button>
              <div id="ayudaEtapas" class="panel-ayuda" popover role="dialog" aria-labelledby="tituloAyudaEtapas">
                <div class="cabecera-ayuda">
                  <h3 id="tituloAyudaEtapas">¿En qué etapa se frenan los trabajos?</h3>
                  <button type="button" class="cerrar-ayuda" popovertarget="ayudaEtapas" popovertargetaction="hide" aria-label="Cerrar información" autofocus>×</button>
                </div>
                <h4>¿Qué muestra?</h4>
                <p>Muestra en qué etapa del taller estaban los trabajos cuando se pausaron (las etapas son las del plan de fabricación de cada pedido). Podés ver cuántas pausas hubo en cada etapa o cuántos proyectos fueron afectados.</p>
                <h4>¿Para qué sirve?</h4>
                <p>Permite identificar en qué parte del proceso se frena la producción.</p>
                <h4>¿Cómo ayuda a tomar decisiones?</h4>
                <p>Si una etapa concentra las pausas, revisá sus máquinas, su personal o los materiales que necesita antes de que el trabajo llegue a ella.</p>
              </div>
            </div>
          </header>
          <form id="filtrosEtapas" class="filtros">
            <div class="controles">
              <label>Indicador<select name="indicador"><option value="pausas">Cantidad de pausas</option><option value="afectados">Proyectos afectados</option></select></label>
            </div>
          </form>
          <p id="avisoEtapas" class="aviso-grafico" role="status" hidden></p>
          <p id="vacioEtapas" class="vacio-grafico" role="status"></p>
          <div class="desplazable"><div id="zonaEtapas" class="zona" hidden><canvas id="barrasEtapas" aria-hidden="true"></canvas></div></div>
          <div id="controlesEtapa" class="controles selector-detalle" hidden><label><select id="grupoEtapas" aria-label="Ver el detalle de una etapa"></select></label></div>
          <div id="detalleEtapas" class="detalle" hidden></div>
        </section>

        <template id="plantillaFechas">
          <label>Período<select name="periodo"><option value="todos">Todo el historial</option><option value="7">Últimos 7 días</option><option value="30">Últimos 30 días</option><option value="365">Últimos 365 días</option><option value="dia">Día específico</option><option value="mes">Mes específico</option><option value="anio">Año específico</option><option value="rango">Rango personalizado</option></select></label>
          <label data-fecha="dia" hidden>Día<input name="dia" type="date"></label>
          <label data-fecha="mes" hidden>Mes<select name="mes"></select></label>
          <label data-fecha="anio" hidden>Año<input name="anio" type="number" min="1900" max="9999" step="1"></label>
          <label data-fecha="rango" hidden>Desde<input name="desde" type="date"></label>
          <label data-fecha="rango" hidden>Hasta<input name="hasta" type="date"></label>
        </template>
      </div>`;

/* ---------- Lógica del dashboard (tal cual se programó, dentro de la pantalla) ---------- */
function iniciar(raiz) {
    const ui = Object.fromEntries([...raiz.querySelectorAll("[id]")].map(nodo => [nodo.id, nodo]));
    const numero = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 });
    const porcentaje = new Intl.NumberFormat("es-AR", { style: "percent", maximumFractionDigits: 1 });
    const fechaLocal = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Argentina/Buenos_Aires" });
    const fechaCorta = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
    const fechaCorteLarga = new Intl.DateTimeFormat("es-AR", { dateStyle: "long", timeZone: "UTC" });
    const diaYMes = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "long", timeZone: "UTC" });
    const fechaCompleta = new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeZone: "UTC" });
    const mesCorto = new Intl.DateTimeFormat("es-AR", { month: "short", year: "numeric", timeZone: "UTC" });
    const mesLargo = new Intl.DateTimeFormat("es-AR", { month: "long", timeZone: "UTC" });
    const estados = [
        ["Pendiente de materiales", "#a76209"], ["Listo para iniciar", "#6250ba"],
        ["En proceso", "#176bcb"], ["Pausado", "#c33f69"],
        ["Finalizado", "#00846a"], ["Cancelado", "#5a687e"]
    ];
    const colores = ["#1b57a5", "#00846a", "#6250ba", "#a76209", "#5a687e", "#c33f69"];
    const estadosActivos = new Set(estados.slice(0, 4).map(([nombre]) => nombre));
    const cambios = {
        alta: [null, "Pendiente de materiales"],
        recepcion: [["Pendiente de materiales"], "Listo para iniciar"],
        inicio: [["Listo para iniciar"], "En proceso"],
        pausa: [["En proceso"], "Pausado"],
        continuar: [["Pausado"], "En proceso"],
        finalizar: [["En proceso"], "Finalizado"],
        cancelar: [["Pendiente de materiales", "Listo para iniciar", "En proceso", "Pausado"], "Cancelado"]
    };
    // "etapa" y "reprogramar" son eventos del sistema que no cambian el estado del proyecto.
    const eventosInformativos = new Set(["recepcion_parcial", "etapa_inicio", "etapa_fin", "etapa", "reprogramar"]);
    const charts = new Map();
    const formularios = [ui.filtrosEstado, ui.filtrosLinea, ui.filtrosDemoras, ui.filtrosEtapas];
    let datos;
    let cruceEstado = null;
    let versionCarga = 0;

    const normalizar = valor => String(valor ?? "").trim().replace(/\s+/g, " ").toLocaleUpperCase("es-AR");
    const texto = valor => String(valor ?? "").trim();
    const horasValidas = valor => Number.isFinite(valor) && valor >= 0 ? valor : null;
    const horas = valor => valor === null ? "Sin dato" : numero.format(valor) + " h";
    const fecha = clave => clave ? fechaCompleta.format(new Date(clave + "T12:00:00Z")) : "Sin dato";
    const hoy = () => fechaLocal.format(new Date());
    const incluido = (dia, periodo) => Boolean(dia && dia >= periodo.inicio && dia <= periodo.fin);
    const etiqueta = valor => texto(valor) || "Sin dato registrado";
    const campo = (form, nombre) => form.elements.namedItem(nombre);

    function crear(tag, contenido, clase) {
        const nodo = document.createElement(tag);
        if (contenido !== undefined) nodo.textContent = contenido;
        if (clase) nodo.className = clase;
        return nodo;
    }

    function diaValido(clave) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(clave)) return "";
        const d = new Date(clave + "T00:00:00Z");
        return Number.isFinite(+d) && d.toISOString().slice(0, 10) === clave ? clave : "";
    }

    function leerEventos(valor) {
        let bruto;
        try { bruto = JSON.parse(valor); } catch { return null; }
        if (!Array.isArray(bruto)) return null;

        const vistos = new Set();
        let sinFecha = 0;
        const eventos = [];
        for (const evento of bruto) {
            const tipo = texto(evento?.tipo).toLowerCase();
            const iso = texto(evento?.fecha_hora);
            const instante = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(iso) ? Date.parse(iso) : NaN;
            if (!tipo || !Number.isFinite(instante)) {
                sinFecha++;
                continue;
            }
            const causa = texto(evento.causa);
            const detalle = texto(evento.detalle);
            const etapa = texto(evento.etapa);
            const clave = JSON.stringify([tipo, instante, normalizar(causa), tipo.startsWith("etapa") ? evento.etapa : ""]);
            if (vistos.has(clave)) continue;
            vistos.add(clave);
            eventos.push({ tipo, instante, dia: fechaLocal.format(new Date(instante)), causa, detalle, etapa });
        }
        eventos.sort((a, b) => a.instante - b.instante);
        return { eventos, sinFecha };
    }

    function leerPausas(historial) {
        const pausas = [];
        let abierta;
        for (const evento of historial?.eventos ?? []) {
            if (evento.tipo === "pausa") {
                abierta = { ...evento, cierre: null };
                pausas.push(abierta);
            } else if (evento.tipo === "continuar" && abierta) {
                abierta.cierre = evento;
                abierta = null;
            } else if (evento.tipo === "finalizar" || evento.tipo === "cancelar") {
                abierta = null;
            }
        }
        return pausas;
    }

    function estadoAlCierre(proyecto, corte) {
        if (!proyecto.historial || proyecto.historial.sinFecha) return null;
        let estado = null;
        for (const evento of proyecto.historial.eventos) {
            if (evento.dia > corte) break;
            if (eventosInformativos.has(evento.tipo)) continue;
            const regla = Object.hasOwn(cambios, evento.tipo) ? cambios[evento.tipo] : undefined;
            if (!regla) return null;
            const [previos, siguiente] = regla;
            if (previos ? !previos.includes(estado) : estado !== null) return null;
            estado = siguiente;
        }
        return estado;
    }

    function armarDatos({ hoy: diaHoy, proyectos: filas }) {
        // Cada fila de la planilla trae su historial de eventos tal como lo registró el sistema.
        const proyectos = filas.map(fila => {
            const historial = leerEventos(JSON.stringify(fila.eventos ?? []));
            const inicio = historial?.eventos.find(evento => evento.tipo === "inicio");
            return {
                id: texto(fila.id), nombre: texto(fila.nombre), cliente: texto(fila.cliente),
                urgencia: texto(fila.urgencia), plazo: "",
                estado: estados.find(([nombre]) => normalizar(nombre) === normalizar(fila.estado))?.[0] ?? "",
                ingreso: diaValido(texto(fila.fecha_ingreso)), fin: diaValido(texto(fila.fecha_fin)),
                entrega: diaValido(texto(fila.plazo_entrega)), inicio: inicio?.dia ?? "",
                historial, pausas: leerPausas(historial), proceso: null, detenido: null, estimado: null
            };
        });
        const columnas = ["ID", "FECHA IN", "PLAZO ENTREGA", "FECHA FIN", "ESTADO OPERATIVO", "HISTORIAL EVENTOS (JSON)"];
        const fechas = proyectos.flatMap(p => [p.ingreso, p.fin, ...(p.historial?.eventos.map(e => e.dia) ?? [])]).filter(Boolean).sort();
        const corte = diaValido(texto(diaHoy)) || hoy();
        const ultimo = fechas.at(-1) ?? corte;
        return { hoja: "Planilla", columnas, proyectos, sinId: 0, inicio: fechas[0] ?? corte, fin: ultimo > corte ? ultimo : corte };
    }

    function moverDia(clave, dias) {
        const d = new Date(clave + "T00:00:00Z");
        d.setUTCDate(d.getUTCDate() + dias);
        return d.toISOString().slice(0, 10);
    }

    function periodoFormulario(form) {
        const modo = campo(form, "periodo").value;
        const valor = nombre => campo(form, nombre).value;
        let inicio = datos.inicio;
        let fin = datos.fin;
        if (/^\d+$/.test(modo)) inicio = moverDia(fin, 1 - Number(modo));
        if (modo === "dia") inicio = fin = diaValido(valor("dia"));
        if (modo === "rango") {
            inicio = diaValido(valor("desde"));
            fin = diaValido(valor("hasta"));
        }
        if (modo === "mes" || modo === "anio") {
            const anio = campo(form, "anio");
            if (!anio.validity.valid || !anio.value) return null;
            const y = String(anio.valueAsNumber).padStart(4, "0");
            if (modo === "anio") return { inicio: y + "-01-01", fin: y + "-12-31" };
            inicio = y + "-" + valor("mes") + "-01";
            const ultimo = new Date(inicio + "T00:00:00Z");
            ultimo.setUTCMonth(ultimo.getUTCMonth() + 1, 0);
            fin = ultimo.toISOString().slice(0, 10);
        }
        return inicio && fin && inicio <= fin ? { inicio, fin } : null;
    }

    function textoPeriodo(periodo) {
        return periodo.inicio === periodo.fin ? fecha(periodo.inicio) : fecha(periodo.inicio) + " – " + fecha(periodo.fin);
    }

    function actualizarCampos(form) {
        const modo = campo(form, "periodo").value;
        for (const control of form.querySelectorAll("[data-fecha]")) {
            control.hidden = control.dataset.fecha !== modo && !(modo === "mes" && control.dataset.fecha === "anio");
        }
    }

    function fechasIniciales(form) {
        const corte = datos?.fin ?? hoy();
        const inicio = datos?.inicio ?? corte;
        campo(form, "dia").value = corte;
        campo(form, "desde").value = inicio;
        campo(form, "hasta").value = corte;
        campo(form, "mes").value = corte.slice(5, 7);
        campo(form, "anio").value = corte.slice(0, 4);
        actualizarCampos(form);
    }

    function tablaDetalle(panel, titulo, columnas, filas, cerrar) {
        panel.replaceChildren();
        if (!filas.length) {
            panel.hidden = true;
            return;
        }
        const header = crear("div", undefined, "cabecera-detalle");
        const heading = crear("h3", titulo);
        heading.id = panel.id + "Titulo";
        header.append(heading);
        if (cerrar) {
            const boton = crear("button", "Quitar selección");
            boton.type = "button";
            boton.addEventListener("click", cerrar);
            header.append(boton);
        }
        const contenedor = crear("div", undefined, "tabla");
        contenedor.tabIndex = 0;
        contenedor.setAttribute("role", "region");
        contenedor.setAttribute("aria-labelledby", heading.id);
        const tabla = crear("table");
        const cabecera = tabla.createTHead().insertRow();
        columnas.forEach(nombre => {
            const celda = crear("th", nombre);
            celda.scope = "col";
            cabecera.append(celda);
        });
        const cuerpo = tabla.createTBody();
        for (const valores of filas) {
            const fila = cuerpo.insertRow();
            valores.forEach(valor => { fila.insertCell().textContent = valor; });
        }
        contenedor.append(tabla);
        panel.append(header, contenedor);
        panel.hidden = false;
    }

    function dibujar(canvas, tipo, data, opciones = {}, plugins = []) {
        aplicarTemaGraficos();
        const configuracion = { responsive: true, maintainAspectRatio: false, animation: false,
            ...opciones, plugins: { legend: { display: false }, ...opciones.plugins } };
        // Gráficos que se pueden tocar: manito al pasar el mouse y una pista al pie del cartelito.
        if (opciones.onClick) {
            configuracion.onHover = (evento, elementos) => {
                evento.native.target.style.cursor = elementos.length ? "pointer" : "default";
            };
            const tooltip = configuracion.plugins.tooltip || {};
            configuracion.plugins.tooltip = { ...tooltip,
                footerColor: tema().superficie, footerFont: { weight: "normal", size: 11.5 }, footerMarginTop: 8,
                callbacks: { footer: () => "Clic para ver el detalle", ...tooltip.callbacks } };
        }
        let chart = charts.get(canvas);
        if (chart && chart.config.type !== tipo) {
            chart.destroy();
            charts.delete(canvas);
            chart = null;
        }
        if (!chart) {
            chart = new Chart(canvas, { type: tipo, data, options: configuracion, plugins });
            charts.set(canvas, chart);
        } else {
            chart.data = data;
            chart.options = configuracion;
            chart.resize();
            chart.update();
        }
        return chart;
    }

    function estadoVisual(sufijo, zona, mensaje = "", aviso = "") {
        const vacio = ui["vacio" + sufijo];
        const nota = ui["aviso" + sufijo];
        vacio.hidden = !mensaje;
        vacio.textContent = mensaje;
        nota.hidden = !aviso;
        nota.textContent = aviso;
        zona.hidden = Boolean(mensaje);
    }

    const sinArchivo = "Leyendo los datos de la planilla…";
    const periodoInvalido = "Ingresá un período válido.";
    const faltaColumna = (nombre) => "La planilla no incluye " + nombre + ".";

    function mostrarKpis() {
        const corte = diaValido(ui.fechaKpi.value);
        const ventana = ui.ventanaKpi.value;
        const periodo = datos && corte ? {
            inicio: ventana === "todos" ? datos.inicio : moverDia(corte, 1 - Number(ventana)), fin: corte
        } : null;
        let valores = [];
        let sinEstado = 0;
        if (periodo) {
            const activos = [];
            let pausados = 0;
            const finales = [];
            let horasCerradas = 0;
            let historiales = 0;
            for (const proyecto of datos.proyectos) {
                if (!proyecto.ingreso || proyecto.ingreso <= corte) {
                    const estado = estadoAlCierre(proyecto, corte);
                    if (!estado) sinEstado++;
                    else if (estadosActivos.has(estado)) {
                        activos.push(proyecto);
                        if (estado === "Pausado") pausados++;
                    }
                }
                if (incluido(proyecto.fin, periodo)) finales.push(proyecto);
                if (proyecto.historial) historiales++;
                for (const pausa of proyecto.pausas) {
                    if (incluido(pausa.cierre?.dia, periodo)) horasCerradas += (pausa.cierre.instante - pausa.instante) / 3_600_000;
                }
            }
            const atrasados = activos.filter(p => p.entrega && p.entrega < corte);
            const medibles = finales.filter(p => p.entrega);
            const aTiempo = medibles.filter(p => p.fin <= p.entrega);
            const estimables = sinEstado < datos.proyectos.length || datos.proyectos.every(p => p.ingreso > corte);
            valores = [
                estimables ? numero.format(activos.length) : "—",
                estimables ? numero.format(pausados) : "—",
                estimables && datos.columnas.includes("PLAZO ENTREGA") ? numero.format(atrasados.length) : "—",
                datos.columnas.includes("FECHA FIN") ? numero.format(finales.length) : "—",
                medibles.length ? porcentaje.format(aTiempo.length / medibles.length) : "—",
                historiales ? horas(horasCerradas) : "—"
            ];
            ui.corteKpi.textContent = "Corte al " + fecha(corte) + " · Resultados del " + textoPeriodo(periodo)
                + (sinEstado ? " · " + numero.format(sinEstado) + " estados sin reconstruir" : "");
        } else {
            ui.corteKpi.textContent = datos ? "Ingresá una fecha de corte válida." : "Leyendo los datos de la planilla…";
        }
        const definiciones = [
            ["Proyectos activos", "Con estado abierto al corte.", "base"],
            ["Proyectos pausados", "Con una pausa vigente al corte.", "alerta"],
            ["Proyectos atrasados", "Activos con entrega anterior al corte.", "alerta"],
            ["Proyectos finalizados", "Con Fecha Fin dentro de la ventana.", "positivo"],
            ["Cumplimiento de plazos", "Finalizados a tiempo entre los que tenían fecha de entrega.", "positivo"],
            ["Tiempo de pausa", "Horas de pausas reanudadas dentro de la ventana.", "base"]
        ];
        ui.kpis.replaceChildren(...definiciones.map(([titulo, detalle, tono], i) => {
            const tarjeta = crear("article", undefined, "kpi");
            tarjeta.dataset.tono = tono;
            tarjeta.append(crear("h3", titulo), crear("strong", valores[i] ?? "—"), crear("p", detalle));
            return tarjeta;
        }));
    }

    function cuotasSumables(grupos, total) {
        // Distribuye el último decimal por mayores restos para sumar exactamente 100 %.
        const partes = grupos.map((g, i) => {
            const exacto = g.registros.length * 1000 / total;
            const base = Math.floor(exacto);
            return { i, base, resto: exacto - base };
        });
        const faltan = 1000 - partes.reduce((suma, p) => suma + p.base, 0);
        const prioridad = [...partes].sort((a, b) => b.resto - a.resto);
        for (let i = 0; i < faltan; i++) prioridad[i].base++;
        return partes.map(p => porcentaje.format(p.base / 1000));
    }

    function mostrarEstado() {
        const form = ui.filtrosEstado;
        const soloActivos = campo(form, "alcance").value === "activos";
        ui.detalleEstado.hidden = true;
        ui.criterioEstado.textContent = "";
        ui.leyendaEstado.replaceChildren();
        if (!datos) return estadoVisual("Estado", ui.graficoEstado, sinArchivo);

        const periodo = periodoFormulario(ui.filtrosGenerales);
        if (!periodo) return estadoVisual("Estado", ui.graficoEstado, periodoInvalido);
        ui.criterioEstado.textContent = periodoLargo(periodo);

        const estadosVisibles = soloActivos ? estados.filter(([nombre]) => estadosActivos.has(nombre)) : estados;
        const grupos = new Map(estadosVisibles.map(([nombre, color]) => [nombre, { nombre, color, registros: [] }]));
        let sinEstado = 0;
        let sinIngreso = 0;
        for (const proyecto of proyectosFiltrados()) {
            if (!proyecto.ingreso) {
                sinIngreso++;
                continue;
            }
            if (proyecto.ingreso > periodo.fin) continue;
            const estado = estadoAlCierre(proyecto, periodo.fin);
            if (!estado) {
                sinEstado++;
                continue;
            }
            grupos.get(estado)?.registros.push({ proyecto, estado });
        }
        const categorias = [...grupos.values()];
        const total = categorias.reduce((suma, grupo) => suma + grupo.registros.length, 0);
        const aviso = [
            sinEstado ? numero.format(sinEstado) + " proyectos sin estado verificable para esta vista." : "",
            sinIngreso ? numero.format(sinIngreso) + " proyectos sin fecha de ingreso válida." : ""
        ].filter(Boolean).join(" ");
        estadoVisual("Estado", ui.graficoEstado, total ? "" : soloActivos ? "No hay proyectos activos para esta selección." : "No hay proyectos con datos para esta vista.", aviso);
        if (!total) return;

        const cuotas = cuotasSumables(categorias, total);
        ui.totalDona.textContent = numero.format(total);
        ui.etiquetaTotalDona.textContent = soloActivos ? "Activos" : "Proyectos";
        let seleccion = -1;
        let grafico;
        const botones = categorias.map((grupo, i) => {
            const li = crear("li");
            const boton = crear("button");
            boton.type = "button";
            boton.disabled = !grupo.registros.length;
            boton.setAttribute("aria-pressed", "false");
            const muestra = crear("span", undefined, "muestra");
            muestra.style.background = grupo.color;
            muestra.setAttribute("aria-hidden", "true");
            boton.append(muestra, crear("span", grupo.nombre), crear("strong", numero.format(grupo.registros.length)), crear("span", cuotas[i], "cuota"));
            boton.addEventListener("click", () => elegir(i));
            li.append(boton);
            ui.leyendaEstado.append(li);
            return boton;
        });

        function elegir(i) {
            seleccion = seleccion === i ? -1 : i;
            botones.forEach((boton, j) => boton.setAttribute("aria-pressed", String(j === seleccion)));
            grafico.data.datasets[0].backgroundColor = categorias.map((g, j) => g.color + (seleccion < 0 || seleccion === j ? "" : "55"));
            grafico.update("none");
            const grupo = categorias[seleccion];
            if (!grupo) {
                ui.detalleEstado.hidden = true;
                return;
            }
            tablaDetalle(ui.detalleEstado, grupo.nombre + " · " + numero.format(grupo.registros.length) + " proyectos",
                ["ID", "Nombre del proyecto", "Cliente", "Estado", "Plazo de entrega"],
                grupo.registros.map(({ proyecto: p, estado }) => [p.id, etiqueta(p.nombre), etiqueta(p.cliente), etiqueta(estado), fecha(p.entrega)]),
                () => { elegir(i); botones[i].focus(); });
            const aplicado = cruceEstado?.estado === grupo.nombre;
            const aplicar = crear("button", aplicado ? "Cruce aplicado" : "Analizar este estado en evolución y pausas", "aplicar-cruce");
            aplicar.type = "button";
            aplicar.disabled = aplicado;
            aplicar.addEventListener("click", () => {
                cruceEstado = { estado: grupo.nombre, corte: periodo.fin, ids: new Set(grupo.registros.map(({ proyecto }) => proyecto.id)) };
                mostrarCruce();
                mostrarLinea();
                mostrarDemoras();
                mostrarEtapas();
                aplicar.textContent = "Cruce aplicado";
                aplicar.disabled = true;
                ui.quitarCruce.focus();
            });
            ui.detalleEstado.append(aplicar);
        }

        grafico = dibujar(ui.dona, "doughnut", {
            labels: categorias.map(g => g.nombre),
            datasets: [{ data: categorias.map(g => g.registros.length), backgroundColor: categorias.map(g => g.color),
                borderWidth: 2, borderColor: tema().superficie }]
        }, {
            cutout: "72%",
            onClick: (_, elementos) => { if (elementos.length) elegir(elementos[0].index); },
            plugins: { tooltip: { callbacks: { label: ({ dataIndex, raw }) => numero.format(raw) + " proyectos · " + cuotas[dataIndex] } } }
        });
        const activo = categorias.findIndex(g => cruceEstado?.estado === g.nombre);
        if (activo >= 0) elegir(activo);
    }

    const indicadoresLinea = {
        ingresos: ["Fecha de ingreso", "Proyectos", "ingreso"],
        inicios: ["Primer inicio de producción", "Proyectos", "inicio", "HISTORIAL EVENTOS (JSON)"],
        finales: ["Fecha de finalización", "Proyectos", "fin", "FECHA FIN"],
        pausas: ["Fecha de inicio de cada pausa", "Eventos", "pausas", "HISTORIAL EVENTOS (JSON)"],
        afectados: ["Fecha de inicio de cada pausa", "Proyectos", "pausas", "HISTORIAL EVENTOS (JSON)"]
    };

    function inicioIntervalo(dia, unidad) {
        if (unidad === "mes") return dia.slice(0, 7) + "-01";
        if (unidad === "dia") return dia;
        const d = new Date(dia + "T00:00:00Z");
        return moverDia(dia, -((d.getUTCDay() + 6) % 7));
    }

    function finIntervalo(inicio, unidad) {
        if (unidad !== "mes") return unidad === "semana" ? moverDia(inicio, 6) : inicio;
        const d = new Date(inicio + "T00:00:00Z");
        d.setUTCMonth(d.getUTCMonth() + 1, 0);
        return d.toISOString().slice(0, 10);
    }

    function serieTemporal(proyectos, periodo, indicador, unidad) {
        const campoFecha = indicadoresLinea[indicador][2];
        const agrupados = new Map();
        let sinDatos = 0;
        for (const proyecto of proyectos) {
            if ((campoFecha === "pausas" || campoFecha === "inicio") && (!proyecto.historial || proyecto.historial.sinFecha)) sinDatos++;
            if (campoFecha === "ingreso" && !proyecto.ingreso) sinDatos++;
            if (campoFecha === "fin" && !proyecto.fin && proyecto.historial?.eventos.some(e => e.tipo === "finalizar")) sinDatos++;
            const fechas = campoFecha === "pausas" ? proyecto.pausas.map(p => p.dia) : [proyecto[campoFecha]];
            for (const dia of fechas) {
                if (!incluido(dia, periodo)) continue;
                const clave = inicioIntervalo(dia, unidad);
                if (!agrupados.has(clave)) agrupados.set(clave, { proyectos: new Map(), suma: 0 });
                const grupo = agrupados.get(clave);
                const existente = grupo.proyectos.get(proyecto.id);
                const valor = 1;
                if (existente) existente.valor += valor;
                else grupo.proyectos.set(proyecto.id, { proyecto, valor });
                grupo.suma += valor;
            }
        }

        const puntos = [];
        let inicio = inicioIntervalo(periodo.inicio, unidad);
        while (inicio <= periodo.fin) {
            const fin = finIntervalo(inicio, unidad);
            const desde = inicio < periodo.inicio ? periodo.inicio : inicio;
            const hasta = fin > periodo.fin ? periodo.fin : fin;
            const grupo = agrupados.get(inicio);
            const registros = [...(grupo?.proyectos.values() ?? [])];
            const cuenta = registros.length;
            const valor = indicador === "afectados" ? cuenta : grupo?.suma ?? 0;
            const eje = unidad === "mes" ? mesCorto.format(new Date(inicio))
                : unidad === "dia" ? fechaCorta.format(new Date(desde))
                : fechaCorta.format(new Date(desde)) + "–" + fechaCorta.format(new Date(hasta));
            puntos.push({ eje, desde, hasta, titulo: periodoLargo({ inicio: desde, fin: hasta }), registros, valor });
            if (fin >= periodo.fin) break;
            inicio = moverDia(fin, 1);
        }
        return { puntos, sinDatos };
    }

    function opcionesDetalle(select, opciones, textoInicial, seleccionar) {
        select.replaceChildren(new Option(textoInicial, ""), ...opciones.map(({ titulo, valor }, i) => new Option(titulo, String(valor ?? i))));
        select.onchange = () => seleccionar(select.value === "" ? -1 : Number(select.value));
    }

    function periodoLargo({ inicio, fin }) {
        const desde = new Date(inicio + "T12:00:00Z");
        const hasta = new Date(fin + "T12:00:00Z");
        const finLargo = fechaCorteLarga.format(hasta);
        if (inicio === fin) return "El " + finLargo;
        const inicioLargo = inicio.slice(0, 7) === fin.slice(0, 7) ? desde.getUTCDate()
            : inicio.slice(0, 4) === fin.slice(0, 4) ? diaYMes.format(desde)
            : fechaCorteLarga.format(desde);
        return "Del " + inicioLargo + " al " + finLargo;
    }

    function mostrarLinea() {
        ui.criterioLinea.textContent = "";
        ui.detalleLinea.hidden = true;
        ui.controlesPunto.hidden = true;
        if (!datos) return estadoVisual("Linea", ui.zonaLinea, sinArchivo);
        const form = ui.filtrosLinea;
        const periodo = periodoFormulario(ui.filtrosGenerales);
        if (!periodo) return estadoVisual("Linea", ui.zonaLinea, periodoInvalido);
        const indicador = campo(form, "indicador").value;
        const unidad = campo(form, "unidad").value;
        const [, medida, , columna] = indicadoresLinea[indicador];
        ui.criterioLinea.textContent = periodoLargo(periodo);
        if (columna && !datos.columnas.includes(columna)) return estadoVisual("Linea", ui.zonaLinea, faltaColumna(columna));
        const proyectos = proyectosFiltrados(true);
        if (columna === "HISTORIAL EVENTOS (JSON)" && proyectos.length && !proyectos.some(p => p.historial)) {
            return estadoVisual("Linea", ui.zonaLinea, "No hay historiales de eventos legibles.");
        }
        const dias = (new Date(periodo.fin) - new Date(periodo.inicio)) / 86_400_000;
        if ((unidad === "dia" && dias > 1100) || (unidad === "semana" && dias > 7700) || (unidad === "mes" && dias > 33000)) {
            return estadoVisual("Linea", ui.zonaLinea, "Reducí el rango o elegí una agrupación más amplia.");
        }
        const { puntos, sinDatos } = serieTemporal(proyectos, periodo, indicador, unidad);
        const aviso = sinDatos ? numero.format(sinDatos) + " proyectos tienen registros incompletos para este indicador." : "";
        estadoVisual("Linea", ui.zonaLinea, "", aviso);
        let chart;
        function elegir(i) {
            ui.puntoLinea.value = i < 0 ? "" : String(i);
            chart.data.datasets[0].pointRadius = puntos.map((_, indice) => i === indice ? 7 : puntos.length > 25 ? 2 : 4);
            chart.update("none");
            const punto = puntos[i];
            if (!punto) {
                ui.detalleLinea.hidden = true;
                return;
            }
            tablaDetalle(ui.detalleLinea, punto.titulo + " · " + numero.format(punto.registros.length) + " proyectos",
                ["Proyecto", "Cliente", "Ingreso", indicador === "pausas" || indicador === "afectados" ? "Pausas" : "Fecha del indicador"],
                punto.registros.map(({ proyecto: p, valor }) => [
                    p.id, etiqueta(p.cliente), fecha(p.ingreso),
                    indicador === "pausas" || indicador === "afectados" ? numero.format(valor) : fecha(p[indicadoresLinea[indicador][2]])
                ]), () => { elegir(-1); ui.puntoLinea.focus(); });
        }
        const cantidad = puntos.filter(p => p.registros.length).length;
        ui.controlesPunto.hidden = !cantidad;
        opcionesDetalle(ui.puntoLinea, puntos.flatMap((p, i) => p.registros.length
            ? [{ titulo: p.titulo + " · " + numero.format(p.registros.length) + " proyectos", valor: i }] : []), "Ver detalle de un período", elegir);
        chart = dibujar(ui.linea, "line", {
            labels: puntos.map(p => p.eje),
            datasets: [{ data: puntos.map(p => p.valor), label: medida, borderColor: tema().acento,
                backgroundColor: tema().acento + "1f", fill: true, borderWidth: 2, tension: .18,
                pointRadius: puntos.length > 25 ? 2 : 4, pointHoverRadius: 7, spanGaps: false }]
        }, {
            onClick: (_, e) => { if (puntos[e[0]?.index]?.registros.length) elegir(e[0].index); },
            interaction: { mode: "index", intersect: false },
            scales: {
                x: { grid: { display: false }, ticks: { maxTicksLimit: 8, maxRotation: 0 } },
                y: { beginAtZero: true, title: { display: true, text: medida }, ticks: { precision: 0 } }
            },
            plugins: { tooltip: { callbacks: {
                title: ([item]) => puntos[item.dataIndex].titulo,
                label: ({ raw, dataIndex }) => numero.format(raw) + " " + medida.toLowerCase() + " · " + numero.format(puntos[dataIndex].registros.length) + " IDs únicos"
            } } }
        });
    }

    const rotulosBarras = {
        id: "rotulosBarras",
        afterDatasetsDraw(chart) {
            const { ctx } = chart;
            ctx.save();
            ctx.font = "600 12px " + tema().fuente;
            ctx.textBaseline = "middle";
            ctx.fillStyle = tema().texto;
            chart.getDatasetMeta(0).data.forEach((barra, i) => {
                ctx.fillText(numero.format(chart.data.datasets[0].data[i]), barra.x + 5, barra.y);
            });
            ctx.restore();
        }
    };

    /** Gráfico de barras de pausas agrupadas por causa o por etapa (misma lógica, mismos filtros, mismo detalle). */
    const vistasPausas = {
        Demoras: { form: ui.filtrosDemoras, zona: ui.zonaDemoras, criterio: ui.criterioDemoras, canvas: ui.barras,
            controles: ui.controlesCausa, grupo: ui.grupoDemoras, detalle: ui.detalleDemoras,
            clave: pausa => pausa.causa, columna: "Causa" },
        Etapas: { form: ui.filtrosEtapas, zona: ui.zonaEtapas, criterio: ui.criterioEtapas, canvas: ui.barrasEtapas,
            controles: ui.controlesEtapa, grupo: ui.grupoEtapas, detalle: ui.detalleEtapas,
            clave: pausa => pausa.etapa, columna: "Etapa" }
    };

    function mostrarPausasPor(sufijo) {
        const v = vistasPausas[sufijo];
        v.detalle.hidden = true;
        v.controles.hidden = true;
        if (!datos) return estadoVisual(sufijo, v.zona, sinArchivo);
        const form = v.form;
        const periodo = periodoFormulario(ui.filtrosGenerales);
        if (!periodo) return estadoVisual(sufijo, v.zona, periodoInvalido);
        const proyectos = proyectosFiltrados(true);
        if (proyectos.length && !proyectos.some(p => p.historial)) return estadoVisual(sufijo, v.zona, "No hay historiales de eventos legibles.");
        const indicador = campo(form, "indicador").value;
        const eje = indicador === "afectados" ? "Proyectos únicos" : "Pausas";
        v.criterio.textContent = periodoLargo(periodo);
        const grupos = new Map();
        let abiertas = 0;
        let incompletos = 0;
        for (const p of proyectos) {
            if (!p.historial || p.historial.sinFecha) incompletos++;
            for (const pausa of p.pausas) {
                if (!incluido(pausa.dia, periodo)) continue;
                const cierre = pausa.cierre?.dia <= periodo.fin ? pausa.cierre : null;
                const duracion = cierre ? (cierre.instante - pausa.instante) / 3_600_000 : null;
                if (!cierre) abiertas++;
                const nombre = etiqueta(v.clave(pausa));
                const clave = normalizar(nombre);
                if (!grupos.has(clave)) grupos.set(clave, { nombre, ids: new Set(), registros: [] });
                const g = grupos.get(clave);
                g.ids.add(p.id);
                g.registros.push({ p, pausa, cierre, duracion });
            }
        }
        const valor = g => indicador === "afectados" ? g.ids.size : g.registros.length;
        const barras = [...grupos.values()]
            .sort((a, b) => valor(b) - valor(a) || a.nombre.localeCompare(b.nombre, "es-AR"));
        const avisos = [
            incompletos ? numero.format(incompletos) + " proyectos con historial incompleto." : ""
        ].filter(Boolean).join(" ");
        const mensaje = barras.length ? "" : "No hay pausas para estos filtros.";
        estadoVisual(sufijo, v.zona, mensaje, avisos);
        v.zona.style.height = Math.max(255, 65 + barras.length * 35) + "px";

        function elegir(i) {
            v.grupo.value = i < 0 ? "" : String(i);
            const g = barras[i];
            if (!g) {
                v.detalle.hidden = true;
                return;
            }
            const otra = sufijo === "Etapas" ? ["Causa", pausa => pausa.causa] : ["Etapa", pausa => pausa.etapa];
            tablaDetalle(v.detalle, g.nombre + " · " + numero.format(g.ids.size) + " proyectos",
                ["Proyecto", "Cliente", v.columna, otra[0], "Pausa", "Reanudación", "Duración", "Detalle del evento"],
                g.registros.map(({ p, pausa, cierre, duracion }) => [p.id, etiqueta(p.cliente), etiqueta(v.clave(pausa)), etiqueta(otra[1](pausa)),
                    fecha(pausa.dia), cierre ? fecha(cierre.dia) : "Abierta al cierre", horas(duracion), etiqueta(pausa.detalle)]),
                () => { elegir(-1); v.grupo.focus(); });
        }
        v.controles.hidden = !barras.length;
        opcionesDetalle(v.grupo, barras.map(g => ({ titulo: g.nombre })), sufijo === "Etapas" ? "Ver detalle de una etapa" : "Ver detalle de una causa", elegir);
        if (mensaje) return;
        dibujar(v.canvas, "bar", {
            labels: barras.map(g => g.nombre),
            datasets: [{ data: barras.map(valor), backgroundColor: barras.map((_, i) => colores[i % colores.length]), borderRadius: 5, maxBarThickness: 26 }]
        }, {
            indexAxis: "y", layout: { padding: { right: 60 } },
            onClick: (_, e) => { if (e.length) elegir(e[0].index); },
            scales: { x: { beginAtZero: true, title: { display: true, text: eje }, ticks: { precision: 0 } },
                y: { grid: { display: false }, ticks: { autoSkip: false, font: { size: 12 } } } },
            plugins: { tooltip: { callbacks: { label: ({ raw, dataIndex }) => {
                const g = barras[dataIndex];
                const ids = g.ids.size;
                return numero.format(raw) + " " + eje.toLowerCase() + " · " + numero.format(ids) + " proyectos";
            } } } }
        }, [rotulosBarras]);
    }

    function mostrarDemoras() { mostrarPausasPor("Demoras"); }
    function mostrarEtapas() { mostrarPausasPor("Etapas"); }

    function proyectosFiltrados(aplicarCruce = false) {
        const cliente = campo(ui.filtrosGenerales, "cliente").value;
        return datos.proyectos.filter(p => (!cliente || p.cliente === cliente)
            && (!aplicarCruce || !cruceEstado || cruceEstado.ids.has(p.id)));
    }

    function mostrarCruce() {
        ui.cruceEstado.hidden = !cruceEstado;
        ui.textoCruceEstado.textContent = cruceEstado
            ? "Evolución y pausas · " + numero.format(cruceEstado.ids.size) + " proyectos en estado «"
                + cruceEstado.estado + "» al " + fecha(cruceEstado.corte) + ". Los eventos se cuentan dentro del período."
            : "";
    }

    function actualizarPaneles() {
        const periodo = datos && periodoFormulario(ui.filtrosGenerales);
        ui.periodoGeneral.textContent = periodo ? periodoLargo(periodo) : "";
        ui.periodoGeneral.title = periodo && periodo.fin > datos.fin ? "Hay actividad registrada hasta " + fecha(datos.fin) : "";
        mostrarCruce();
        mostrarEstado();
        mostrarLinea();
        mostrarDemoras();
        mostrarEtapas();
    }

    const generales = ui.filtrosGenerales;
    generales.querySelector("[data-fechas]").append(ui.plantillaFechas.content.cloneNode(true));
    const meses = Array.from({ length: 12 }, (_, i) => {
        const value = String(i + 1).padStart(2, "0");
        return new Option(mesLargo.format(new Date("2020-" + value + "-01")), value);
    });
    campo(generales, "mes").replaceChildren(...meses);
    fechasIniciales(generales);
    for (const form of [generales, ...formularios]) {
        form.addEventListener("submit", evento => evento.preventDefault());
    }

    function cambiarFiltrosGenerales() {
        cruceEstado = null;
        actualizarCampos(generales);
        actualizarPaneles();
    }
    generales.addEventListener("input", cambiarFiltrosGenerales);
    generales.querySelector("[data-reset]").addEventListener("click", () => {
        generales.reset();
        fechasIniciales(generales);
        cambiarFiltrosGenerales();
    });
    ui.quitarCruce.addEventListener("click", () => {
        cruceEstado = null;
        actualizarPaneles();
        ui.leyendaEstado.querySelector("button:not(:disabled)")?.focus();
    });

    ui.filtrosEstado.addEventListener("input", () => {
        if (cruceEstado && campo(ui.filtrosEstado, "alcance").value === "activos" && !estadosActivos.has(cruceEstado.estado)) {
            cruceEstado = null;
            actualizarPaneles();
        } else {
            mostrarEstado();
        }
    });
    ui.filtrosLinea.addEventListener("input", mostrarLinea);
    ui.filtrosDemoras.addEventListener("input", mostrarDemoras);
    ui.filtrosEtapas.addEventListener("input", mostrarEtapas);

    ui.fechaKpi.addEventListener("input", mostrarKpis);
    ui.ventanaKpi.addEventListener("input", mostrarKpis);
    ui.resetKpi.addEventListener("click", () => {
        ui.fechaKpi.value = datos?.fin ?? hoy();
        ui.ventanaKpi.value = "30";
        mostrarKpis();
    });

    const horaCorta = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

    function aplicarDatos(nuevos, conservarFiltros) {
        const clienteElegido = campo(generales, "cliente").value;
        datos = nuevos;
        ui.estadoArchivo.dataset.error = "false";
        ui.estadoArchivo.textContent = "Datos de la planilla actualizados.";
        const clientes = [...new Set(datos.proyectos.map(p => p.cliente).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es-AR"));
        campo(generales, "cliente").replaceChildren(new Option("Todos los clientes", ""), ...clientes.map(c => new Option(c, c)));
        if (conservarFiltros) {
            // Llegó un cambio del taller o de Compras: se redibuja sin tocar lo que el usuario eligió.
            campo(generales, "cliente").value = clientes.includes(clienteElegido) ? clienteElegido : "";
        } else {
            ui.fechaKpi.value = datos.fin;
            ui.ventanaKpi.value = "30";
            generales.reset();
            fechasIniciales(generales);
            formularios.forEach(form => form.reset());
            cruceEstado = null;
        }
        const cantidad = datos.proyectos.length;
        ui.actualizado.textContent = numero.format(cantidad) + (cantidad === 1 ? " proyecto" : " proyectos")
            + " de la planilla · actualizado " + horaCorta.format(new Date());
        mostrarKpis();
        actualizarPaneles();
    }

    async function cargarDatos(conservarFiltros = false) {
        const carga = ++versionCarga;
        try {
            if (!globalThis.Chart) throw new Error("No se pudo descargar Chart.js: revisá la conexión a internet.");
            const respuesta = await fetch("/api/dashboard", { cache: "no-store" });
            if (!respuesta.ok) throw new Error("El servidor respondió con un error (" + respuesta.status + ").");
            const recibidos = await respuesta.json();
            if (carga !== versionCarga) return;
            aplicarDatos(armarDatos(recibidos), conservarFiltros);
        } catch (error) {
            if (carga !== versionCarga) return;
            ui.estadoArchivo.dataset.error = "true";
            ui.estadoArchivo.textContent = "No se pudieron mostrar los datos. " + (error instanceof TypeError ? "No hay conexión con el servidor." : error.message);
            ui.actualizado.textContent = datos ? "Se muestran los últimos datos leídos." : "";
        }
    }

    mostrarKpis();
    actualizarPaneles();
    cargarDatos();

    // Si cambia el tema (claro/oscuro), se vuelven a dibujar los gráficos con los colores nuevos.
    const observador = new MutationObserver(() => { if (datos) actualizarPaneles(); });
    observador.observe(document.documentElement, { attributes: true, attributeFilter: ["data-tema"] });
    const sistemaOscuro = matchMedia("(prefers-color-scheme: dark)");
    const alCambiarSistema = () => { if (datos) actualizarPaneles(); };
    sistemaOscuro.addEventListener("change", alCambiarSistema);

    return {
        actualizar: () => cargarDatos(true),
        limpiar() {
            versionCarga++;
            observador.disconnect();
            sistemaOscuro.removeEventListener("change", alCambiarSistema);
            charts.forEach(chart => chart.destroy());
            charts.clear();
        }
    };
}

export default {
  titulo: 'Resumen de Producción',
  async montar(elemento) {
    elemento.innerHTML = PLANTILLA;
    try {
      await cargarLibrerias();
    } catch {
      /* Si no hay internet, el propio dashboard avisa que no pudo cargar Chart.js. */
    }
    if (!elemento.isConnected) return;
    controlador = iniciar(elemento);
  },
  async actualizar() {
    if (controlador) await controlador.actualizar();
  },
  desmontar() {
    if (controlador) controlador.limpiar();
    controlador = null;
  },
};
