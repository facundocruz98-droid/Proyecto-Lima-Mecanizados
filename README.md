# Seguimiento de Taller · Lima Mecanizados SRL

Prototipo del sistema de seguimiento de proyectos por **código de barras**.
Trabajo de Campo 2026 · Sistemas de Información · UNJu · Grupo 7 SYNTECH.

Conecta **Gerencia**, **Compras** y el **Taller**: cada trabajo tiene una hoja de ruta con su ID
en código de barras, y el taller la escanea para iniciar, pausar (con motivo obligatorio),
continuar y finalizar. El panel muestra en tiempo real qué trabajos están vencidos, parados o por vencer.

## Cómo iniciarlo

**Requisito:** tener instalado [Node.js](https://nodejs.org) versión **22.13 o superior** (la LTS actual sirve).
No hay que instalar nada más: el sistema no usa librerías externas.

1. Doble clic en **`INICIAR.bat`**. Se abre una ventana negra (no la cierres) y el navegador en `http://localhost:3000`.
2. Para detenerlo: cerrá la ventana negra o apretá `Ctrl + C`.

También se puede iniciar desde una terminal:

```
node server.js
```

La primera vez se crea la base de datos `datos/lima.db` con **6 proyectos de ejemplo** (clientes ficticios).
El botón "Restablecer datos de ejemplo" vuelve a ese estado en cualquier momento.

### Usarlo desde otras computadoras

Al iniciar, la ventana muestra una dirección del tipo `http://192.168.x.x:3000`.
Cualquier PC conectada a la misma red puede abrir esa dirección en su navegador:
así Compras, el Taller y Gerencia trabajan sobre los mismos datos, y lo que escanea
el taller aparece al instante en el panel de Gerencia.

### Lector de código de barras

Cualquier lector USB o Bluetooth en modo teclado funciona sin configuración:
escribe el ID y presiona Enter. En "Puesto de taller" el cursor queda siempre listo para escanear.
Sin lector, se puede tipear el ID o tocar los códigos de ejemplo.
La hoja de ruta se imprime desde Compras (tamaño A5) con código **Code 128**.

## Pantallas

| Pantalla | Rol | Qué se hace |
| --- | --- | --- |
| Panel | Gerencia / Supervisión | Semáforo de todos los trabajos, alertas y reprogramación de plazos (con motivo) |
| Alta de proyecto | Gerencia | Carga los datos de la planilla; el sistema genera el ID |
| Historial y causas | Gerencia / Supervisión | Línea de tiempo de cada trabajo, causas de demora y pausas por etapa |
| Planilla | Gerencia | La planilla de siempre, con "En Ejec" y "Fecha Fin" completadas por el escaneo; se descarga para Excel. "Cargar Excel" **reemplaza** todos los proyectos por los del archivo (incluidos los cancelados) |
| Recepción y hoja de ruta | Compras | Registra la llegada de materiales, emite e imprime la hoja de ruta, atiende alertas |
| Puesto de taller | Operario | Escanea, arma el **Plan de fabricación** al iniciar y avanza etapa por etapa: iniciar etapa, pausar, continuar, completar etapa y finalizar pedido |
| Seguimiento del cliente | Cliente | Vista previa de lo que ve el cliente y su link; la página pública es `seguimiento.html` |

## Reglas de negocio

1. Un trabajo no se puede iniciar sin la recepción de sus materiales indispensables.
2. Una pausa no se guarda sin **causa y descripción**.
3. Solo Gerencia carga o cambia el plazo de entrega, y todo cambio pide un motivo.
4. El ID es único y sigue el formato `número-cliente-urgencia-ítem` (ej. `0645-MPU-U-01`).
   Otra parte del mismo pedido lleva el ítem siguiente (`-02`).
5. "En Ejec" y "Fecha Fin" no se cargan a mano: los completa el escaneo.
6. Semáforo: **rojo** si el plazo venció o el trabajo está pausado; **amarillo** si faltan 2 días o menos;
   **verde** en el resto. Dentro de cada color van primero los urgentes (U).
7. Si la causa de la pausa es "Falta de material", se alerta a Compras y a Gerencia;
   la alerta se cierra cuando Compras registra la llegada.

8. **Entrega estimada:** el sistema suma al plazo de entrega el tiempo que el trabajo estuvo pausado
   (cada día o fracción de pausa corre la fecha un día, incluida la pausa en curso). El plazo cargado
   por la empresa no se modifica. Si Gerencia reprograma el plazo, el conteo vuelve a empezar desde ahí.
9. **Link del cliente:** cada proyecto tiene un link propio (pantalla "Seguimiento del cliente" o botón "Vista cliente" en el Panel).
   La página tiene estilo "detalle del pedido" para el celular: la pieza, la fecha de entrega destacada y un seguimiento
   con íconos (Pedido recibido → En fabricación → Listo para entregar → Entregado) que sale del estado del proyecto.
   Si hay demora muestra la nueva fecha y la acordada. Al finalizar, la línea se completa hasta "Entregado"
   (solo visual para la demo: no se registra ninguna entrega). Las operaciones del taller (Corte, Soldadura…),
   las causas internas y los operarios no se muestran.
   El link está firmado con una clave secreta, así que no se puede adivinar el de otro proyecto.

10. **Proyectos cancelados:** quedan con estado "Cancelado", no generan alertas y el taller no puede trabajarlos.
    Se cargan desde el Excel (columna de estado "Cancelado" o evento `cancelar` en el historial).

11. **Plan de fabricación.** Al tocar "Iniciar" en un pedido listo se abre el formulario "Plan de fabricación";
    abrirlo o cerrarlo no inicia nada. "Guardar e iniciar fabricación" guarda el plan ordenado, registra el inicio real
    e inicia la primera etapa en una sola operación (un doble clic o un reintento no duplica el inicio).
12. **Catálogo de etapas.** Arranca vacío. Las etapas de cada plan confirmado quedan como sugerencias para los pedidos
    siguientes (compartido por todo el taller, se guarda en la base). Cada pedido conserva su propio plan y orden.
13. **Avance por etapas.** "Completar etapa" registra su fin y deja la siguiente lista; su tiempo empieza recién con
    "Iniciar etapa", así la espera entre etapas no cuenta como fabricación. Cada pausa queda vinculada a la etapa activa
    (o a la próxima, si se pausa entre etapas) y "Continuar" vuelve a esa misma etapa.
    "Finalizar pedido" se habilita con todas las etapas completadas y pide confirmación.
14. **Listo vs. inicio real.** La hora en que Compras confirmó los materiales ("listo") y la del inicio real se muestran
    por separado en el Panel y en el Historial; la espera previa no es tiempo de fabricación.
15. **Pedidos anteriores sin plan** se siguen mostrando y operando con el flujo anterior (etapas fijas).
16. **Cliente.** Sigue viendo solo los 4 pasos (Pedido recibido → En fabricación → Listo para entregar → Entregado):
    el plan de etapas es interno del taller. La página se actualiza sola con el aviso en tiempo real del sistema.

El margen de 2 días, la lista de etapas y el cálculo de la entrega estimada están en `src/reglas.js`.

## Estructura del proyecto

```
INICIAR.bat              Inicio con doble clic (Windows)
server.js                Punto de entrada
src/
  reglas.js              Reglas de negocio puras (semáforo, formato de ID, fechas)
  db.js                  Conexión a SQLite y esquema de tablas
  servicios.js           Casos de uso: alta, recepción, iniciar, pausar, continuar, finalizar…
  servidor.js            API REST, archivos de la interfaz y avisos en tiempo real
  datos-ejemplo.js       Proyectos de ejemplo para la demostración
public/                  Interfaz web (HTML, CSS y JavaScript sin librerías)
  index.html, hoja.html
  css/estilos.css
  js/app.js              Navegación, tiempo real, tema claro/oscuro
  js/api.js              Llamadas al servidor
  js/codigo128.js        Generador propio de códigos de barras Code 128
  js/calendario.js       Selector de fecha propio (atajos, teclado, escritura directa)
  js/hoja-ruta.js        Dibujo de la hoja de ruta
  js/vistas/             Una pantalla por archivo
tests/                   Pruebas automáticas
herramientas/respaldo.js Copia de seguridad de la base de datos
datos/                   Base de datos (se crea sola)
```

## Base de datos

SQLite, 8 tablas: `cliente`, `usuario`, `proyecto`, `material`, `evento`, `etapa_catalogo` (etapas sugeridas del taller),
`etapa_pedido` (plan de cada pedido, con inicio y fin reales de cada etapa) y `config`
(guarda la clave con la que se firman los links de seguimiento).
Cada acción queda guardada como un **evento** con fecha, hora, usuario, etapa, causa y detalle;
de ahí salen el historial, las alertas y los indicadores.

## API

| Método | Ruta | Qué hace |
| --- | --- | --- |
| GET | `/api/catalogo` | Etapas, causas, usuarios, clientes y fecha de hoy |
| GET | `/api/proyectos` | Proyectos con semáforo, ordenados para el panel |
| GET | `/api/proyectos/:id` | Detalle: materiales, eventos y tiempos |
| POST | `/api/proyectos` | Alta de proyecto (Gerencia) |
| POST | `/api/proyectos/:id/reprogramar` | Cambia el plazo con motivo (Gerencia) |
| POST | `/api/proyectos/:id/recepcion` | Recepción de materiales indispensables (Compras) |
| POST | `/api/proyectos/:id/recepcion-parcial` | Material que llega después (Compras) |
| POST | `/api/proyectos/:id/iniciar` · `pausar` · `continuar` · `finalizar` · `etapa` | Acciones del taller (`iniciar` recibe `plan`: la lista ordenada de etapas) |
| POST | `/api/proyectos/:id/completar-etapa` · `iniciar-etapa` | Avance por etapas del plan de fabricación |
| GET | `/api/etapas` | Catálogo de etapas sugeridas |
| GET | `/api/seguimiento/:link` | Datos públicos de un proyecto para el cliente |
| GET | `/api/alertas` | Vencidos, falta de material, material recibido y por vencer |
| GET | `/api/indicadores` | Pausas y horas detenidas por causa y por etapa |
| GET | `/api/planilla` · `/api/planilla.csv` | Planilla en JSON o CSV (con cantidad de pausas y tiempo detenido) |
| GET | `/api/planilla.xlsx` | Excel con dos hojas: "Resumen de proyectos" e "Historial de pausas" |
| GET | `/api/pausas` | Todas las pausas registradas, una por fila, con su duración |
| GET | `/api/tiempo-real` | Avisos de cambios (Server-Sent Events) |
| POST | `/api/demo/restablecer` | Vuelve a los datos de ejemplo |

## Pruebas

```
npm test
```

Corre 45 pruebas automáticas: reglas de negocio, plan de fabricación por etapas, generador de código de barras y el ciclo completo
de un proyecto contra el servidor real (con una base de datos temporal).

## Copia de seguridad

```
npm run respaldo
```

Guarda una copia de la base en la carpeta `respaldos/` (conserva las últimas 30).
Para hacerla todas las noches se puede programar con el Programador de tareas de Windows.

## Qué es de prototipo

- **No hay inicio de sesión.** El rol se elige por pantalla; el servidor igual verifica que cada acción
  la haga el rol que corresponde (por ejemplo, solo Gerencia reprograma).
- **Los datos son de ejemplo**, con clientes ficticios.
- **El link del cliente funciona dentro de la red de la empresa.** Para que un cliente lo abra desde su casa,
  el sistema tendría que estar publicado en internet (hosting o un servidor con dirección pública).
- **No cubre** los trabajos in situ, el control de inventario ni las áreas de Presupuesto, Calidad,
  Expedición, Facturación y Cobro.
- El significado de las urgencias (E = estándar, U = urgente) y el margen de la alerta preventiva
  están pendientes de confirmar con la empresa.
