# Blossom Brew Lab — Calculadora de recetas y extracción (V1.7.1)

**Archivo principal:** `index.html`. La calculadora funciona en el navegador sin instalar dependencias. El uso local no exige cuenta. La sincronización opcional utiliza Supabase y se habilita únicamente al conectar el proyecto de datos.

**Aplicación publicada:** [Abrir Blossom Brew Lab](https://marquezjc7.github.io/Blossom---brew---Lab--Calculator/).

La V1.7.0 añade una calculadora de agua de dos concentrados: objetivos GH y alcalinidad, escalado de lotes, texto para pesar y perfiles asociados a recetas y sesiones. Conserva la preparación guiada de V1.6.0. Conserva el acceso con contraseña, la sincronización y los datos anteriores. La conexión del servicio y los dos métodos de acceso se explican en [la guía de sincronización](docs/CLOUD_SYNC.md). Bourbon Lavado continúa como referencia inicial. El avance está en [el plan de trabajo](docs/ROADMAP.md).

## Desarrollo local

Puedes abrir `index.html` directamente, conservando las carpetas `assets/` y `src/` a su lado. Para desarrollar con un origen estable de almacenamiento, desde la raíz del repositorio ejecuta:

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

El servidor solo entrega archivos locales. Sin configuración de nube, usa el mismo navegador y origen para acceder a tus sesiones y trasládalas mediante JSON. Con la nube configurada y una sesión iniciada, la aplicación sincroniza esos datos mediante Supabase.

## Organización del proyecto

| Archivo                 | Responsabilidad                                                  |
| ----------------------- | ---------------------------------------------------------------- |
| `index.html`            | Estructura y contenido de la interfaz                            |
| `assets/css/styles.css` | Diseño y adaptación a pantallas pequeñas                         |
| `src/calculations.js`   | Ratio, agua objetivo, extracción y escalado de vertidos          |
| `src/plans.js`          | Validación, tiempos y copia del plan según el agua total         |
| `src/water.js`          | Referencias, masas de agua y validación de perfiles              |
| `src/water-ui.js`       | Controles de agua, copia, descarga y aplicación a una receta     |
| `src/preparation.js`    | Estado del cronómetro, copia del plan y validación del resultado |
| `src/preparation-ui.js` | Guía de vertidos, recuperación del progreso y evaluación         |
| `src/pour-editor.js`    | Editor de cantidades acumuladas y tiempos de inicio              |
| `src/recipes.js`        | Catálogo de recetas de referencia                                |
| `src/storage.js`        | Acceso a almacenamiento local y claves compatibles con V1        |
| `src/sync.js`           | Lotes persistentes, conciliación de cambios y sincronización     |
| `src/cloud-api.js`      | Acceso por correo y conexión autenticada al servicio de datos    |
| `src/cloud-config.js`   | Configuración pública; vacía mantiene el funcionamiento local    |
| `src/transfers.js`      | Formato de respaldo JSON y generación de CSV                     |
| `src/app.js`            | Interacciones, estado de la pantalla y renderizado               |
| `tests/`                | Pruebas de lógica y recorridos completos en Chromium y WebKit    |

Los scripts son locales y se cargan en orden con `defer`. Se usa el espacio de nombres `BlossomLab` para compartir sus funciones. No se requieren módulos ESM, descargas de CDN, paquetes para ejecutar la aplicación ni un paso de compilación; esto conserva la apertura directa mediante `file://`.

## Pruebas automáticas

Para comprobar cálculos, almacenamiento, respaldos y el esquema de sincronización se necesita Node.js 20 o posterior. PGlite es una dependencia de desarrollo para ejecutar PostgreSQL en las pruebas; no se incluye en la aplicación:

```bash
npm ci --ignore-scripts
npm test
```

Las pruebas de navegador usan Python 3.12 y Playwright. La instalación siguiente es solo para desarrollo:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -m playwright install chromium webkit
.venv/bin/python -m unittest discover -s tests -p 'test_*.py' -v
```

En Linux puede ser necesario instalar las bibliotecas del navegador con `python -m playwright install --with-deps chromium` desde ese entorno virtual. Si ya tienes un Chromium compatible, puedes indicarlo sin descargar otro:

```bash
BLOSSOM_BROWSER_EXECUTABLE=/usr/bin/chromium .venv/bin/python -m unittest discover -s tests -p 'test_*.py' -v
```

Para ejecutar la misma suite en WebKit: `BLOSSOM_BROWSER=webkit .venv/bin/python -m unittest discover -s tests -p 'test_*.py' -v`. No establezcas `BLOSSOM_BROWSER_EXECUTABLE` al usar el WebKit descargado por Playwright. GitHub Actions ejecuta ambos motores en Ubuntu 24.04 y la publicación requiere que pasen los dos. WebKit comprueba el motor usado por Safari; las pruebas en un Safari y un teléfono reales siguen siendo una comprobación adicional.

La suite inicia y cierra su propio servidor en un puerto libre y usa un perfil nuevo por prueba. No necesita el servidor del puerto 8000 ni modifica los datos de tu navegador personal. Comprueba recetas, edición de vertidos y tiempos, actualización sin duplicados, errores de almacenamiento, extracción, guardado, compatibilidad con datos V1, importación y exportaciones, pantallas pequeñas y operación sin conexión después de cargar la página.

También prueba la apertura directa de archivos. Si una política del navegador administrado prohíbe `file://`, ese caso se informa como **omitido**, sin cambiar la política ni contarlo como aprobado. Las demás pruebas siguen ejecutándose.

Para ese caso se bloquean las solicitudes HTTP/HTTPS, en lugar de usar la emulación de desconexión que también puede impedir la navegación `file://` de WebKit. Si el WebKit del runner no consigue abrir ni un archivo HTML mínimo independiente, se informa la limitación como omitida. Un fallo que solo ocurra con la aplicación sigue siendo un fallo. La apertura web, el uso sin conexión después de cargar y el guardado continúan comprobándose en ambos motores.

El flujo `.github/workflows/tests.yml` está preparado para ejecutar ambas suites en GitHub Actions al subir cambios o abrir una pull request.

## Acceso web con GitHub Pages

La publicación está preparada en `.github/workflows/pages.yml`. En `main`, el flujo ejecuta las pruebas mediante el flujo reutilizable de validación y publica solo si pasan. En otras ramas y pull requests, las pruebas se ejecutan sin publicar.

La activación inicial y la comprobación de la dirección HTTPS están explicadas paso a paso en [Publicar Blossom Brew Lab](docs/PUBLISHING.md). `python3 scripts/prepare_pages.py` genera el sitio en `_site/`, una carpeta ignorada por Git que contiene solo la aplicación. La sincronización requiere además [conectar Supabase](docs/CLOUD_SYNC.md); publicar los archivos sin esa conexión conserva el funcionamiento local.

## Abrir y probar

1. Abre `index.html` con Safari, Chrome u otro navegador moderno.
2. Selecciona la referencia Bourbon Lavado o una receta personal guardada.
3. Cambia la dosis de 15 a 18 g, conserva ratio objetivo 1:16 y selecciona «Calcular agua al ratio objetivo». Obtendrás 288 g.
4. Comprueba que los vertidos del Bourbon Lavado se escalen de 45/145/240 g a 54/174/288 g acumulados.
5. En «Extracción» introduce solo valores medidos. El botón «Ejemplo didáctico» muestra 15 g, 210 g de bebida, 1.42% TDS y EY 19.88%. Es un dato ficticio.
6. En «Bitácora» guarda una sesión y exporta CSV o JSON como respaldo.

## Editar recetas y vertidos

1. Selecciona una receta, escribe **Nombre para guardar la receta** y modifica los parámetros. Con Bourbon Lavado, usa **Guardar como nueva receta** para crear tu copia y conservar la referencia. El nombre se escribe en la página, sin una ventana emergente.
2. Al seleccionar una receta personalizada, puedes editar su nombre y parámetros. **Actualizar receta guardada** reemplaza esa receta sin crear un duplicado. **Guardar como nueva receta** crea una copia independiente.
3. Abre **Editar vertidos** para agregar, quitar o cambiar cantidades acumuladas. Deben aumentar y el último peso debe coincidir con el agua total. Puedes quitar todas las filas para dejar la receta sin plan documentado.
4. Cada inicio es opcional y se registra en `mm:ss` desde que comienza la preparación: por ejemplo, `0:00`, `0:45`, `1:30`. Deja vacíos los tiempos desconocidos. Los conocidos deben aumentar y quedar antes del tiempo final, si este está registrado.
5. Pulsa **Aplicar plan**, revisa el resultado y guarda o actualiza la receta. **Cancelar** descarta solo la edición del plan que está abierta. Si cambias el agua con el editor abierto, ajusta también el último peso antes de aplicar.
6. Para borrar una receta personalizada, selecciónala y pulsa **Eliminar receta**. La confirmación muestra su nombre: **Eliminar esta receta** completa el borrado y **Cancelar** conserva la receta y los cambios pendientes. La bitácora y las demás recetas se mantienen. Bourbon Lavado sigue siendo una referencia protegida.

La eliminación solo se refleja si el navegador confirma la escritura. Si falla el almacenamiento, la receta permanece en la lista y puedes reintentar o cancelar. Al borrar una receta, se selecciona otra disponible o la primera referencia y se recuerda esa selección al recargar. Sin cuenta, cada navegador conserva su propia lista. Con la misma cuenta conectada, el borrado se sincroniza también con los otros dispositivos.

Al cambiar el agua se escalan las cantidades del plan; los tiempos se conservan. Si una receta solo documenta el bloom, el editor no inventa los vertidos restantes. Una sesión captura su propio plan, de modo que editar la receta después no cambia el historial anterior. Los avisos de cambios sin guardar permiten cancelar al cambiar de receta o salir de la página.

Bourbon Natural y Pacas Natural ya no se incluyen en el catálogo. Si una de ellas era la última referencia seleccionada, al recargar se abre Bourbon Lavado. Retirar estas referencias no modifica las recetas personales ni las sesiones históricas del navegador.

El guardado verifica que el navegador haya almacenado la receta y muestra una confirmación persistente. La receta queda seleccionada y se recupera esa selección al recargar. Los errores señalan el campo que necesita corregirse. Si el navegador impide escribir en el almacenamiento, conserva los cambios en pantalla y ofrece **Descargar respaldo JSON** con la receta pendiente, sin afirmar que quedó guardada. Las recetas anteriores permanecen intactas.

Abrir **Editar vertidos** sin cambiar nada no impide guardar. Si editas los pesos o tiempos, **Revisar vertidos pendientes** te lleva a **Aplicar plan** y **Cancelar**. Un intento de guardado también muestra esas acciones: aplica para conservar los cambios o cancela para descartar solo esa edición; después guarda la receta. El nombre, las temperaturas y los demás parámetros se conservan al cancelar el editor.

Los respaldos JSON conservan el plan completo: `pours` sigue siendo una lista de gramos acumulados y el campo opcional `pourTimes` contiene segundos desde el inicio, con `null` para tiempos desconocidos. No se cambian las claves de recetas/sesiones ni el formato `blossom-brew-lab-v1`. Los archivos anteriores sin tiempos siguen siendo válidos. Un respaldo con tiempos incompatibles se rechaza antes de reemplazar los datos. El CSV conserva sus primeras 24 columnas, incluidas las tres de preparación guiada, y añade cinco columnas del perfil de agua; usa JSON para transferir planes y tiempos completos.

## Preparación guiada (V1.6.0)

1. Selecciona y revisa una receta. Guarda sus cambios si quieres conservarlos como receta y sincronizar sin una edición pendiente.
2. Pulsa **Preparar esta receta**, debajo del plan de vertidos. También puedes abrir **02 · Preparación** y pulsar **Cargar receta actual**.
3. Si hay dos temperaturas, asigna T1 o T2 a cada vertido. Esta selección corresponde a la sesión; la aplicación no deduce en qué etapa cambiar de temperatura.
4. Pon la balanza en cero. Pulsa **Iniciar preparación** al comenzar el bloom y sigue las cantidades **Añade** (agua de ese paso) y **Hasta** (peso acumulado en la balanza).
5. Pulsa **Comenzar vertido N** al iniciar cada vertido posterior. Los tiempos previstos orientan y muestran una cuenta atrás; los pasos no avanzan automáticamente. Los tiempos desconocidos siguen sin registrar.
6. Tras el último vertido, deja drenar y pulsa **Finalizar preparación**. Puedes añadir notas, puntuaciones y mediciones opcionales, y pulsar **Guardar resultado en bitácora**.

El reloj usa marcas de tiempo para conservar el tiempo cuando el navegador queda en segundo plano. **Pausar** excluye ese intervalo del cronómetro; el café sigue extrayéndose. El progreso, la asignación de temperaturas y la evaluación pendiente se conservan en este navegador al recargar. Una preparación en curso no se traslada a otro dispositivo; la sesión final guardada sí utiliza la sincronización existente.

La guía utiliza una copia de los parámetros al cargarla. Cambiar la receta o recibir una edición desde otro dispositivo no reescribe esa preparación. El resultado conserva el tiempo objetivo en `time`, los tiempos previstos en `pourTimes` y los datos reales en el campo opcional `preparation`: `startedAt`, `durationSeconds`, `actualStarts` y `temperatures`. Los respaldos V1 anteriores siguen funcionando sin asignarles tiempos reales.

Las puntuaciones vacías y la extracción no medida quedan sin registrar. EY solo se calcula cuando se introducen bebida obtenida y TDS válidos, usando la dosis capturada. Si falla el guardado, el resultado permanece visible y **Descargar respaldo pendiente** conserva una copia JSON. Reintentar una misma preparación no duplica su identificador de sesión.

## Calculadora de agua (V1.7.0)

1. Abre **05 · Agua** y selecciona una de las ocho referencias o un perfil conservado en tus recetas o bitácora.
2. Indica el volumen del lote, con accesos de 0.5, 1, 2, 4.5 y 5 L o un valor propio entre 0.1 y 100 L.
3. Ajusta GH y alcalinidad por separado, mediante números o deslizadores, y da un nombre a tu perfil. Todos los objetivos se expresan en ppm como CaCO₃.
4. Pesa las cantidades de concentrado buffer, concentrado de dureza y agua destilada. **Copiar receta** incluye sus concentraciones y unidades. **Descargar receta TXT** funciona también si el navegador no permite copiar.
5. Para conservar un perfil en la cuenta, pulsa **Usar esta agua en mi receta** y guarda una receta nueva o actualiza la receta de café seleccionada. El perfil se guarda y sincroniza como parte de esa receta; las sesiones conservan su propia copia. Una referencia o cálculo suelto no crea un perfil independiente en la nube.

El sistema está limitado a agua destilada con GH y alcalinidad prácticamente cero y dos soluciones separadas: NaHCO₃ a **1.68 g/L** y MgSO₄·7H₂O a **2.45 g/L**. No permite sustituir la hidratación, la concentración ni el agua base. No calcula TDS, pH, calcio, sodio o cumplimiento de una norma de agua.

Se usa la aproximación práctica del material compartido: por cada 1000 g de mezcla final, 1 g de cada concentrado aporta aproximadamente 1 ppm de su parámetro. Para un lote de `L` litros: `buffer = alcalinidad × L`, `dureza = GH × L`, `destilada = 1000 × L − buffer − dureza`. Se aproxima 1 g de solución a 1 mL. Se redondean los concentrados a 0.1 g y se calcula el agua restante después, conservando la masa final. En casos límite de redondeo se limita la dureza al peso disponible para evitar una cantidad negativa de agua.

Las ocho referencias se transcribieron del texto y captura aportados por el propietario: WOC Budapest usa 51.2 GH y 40.1 de alcalinidad de la captura; las otras siete conservan los valores redondeados de su tabla. No se verificaron independientemente contra la publicación original de Barista Hustle. «SCA (BH 2019)» conserva el nombre histórico y no se presenta como una especificación SCA vigente ni como dureza cálcica.

El ejemplo WOC de 4.5 L muestra **180.5 g de buffer + 230.4 g de dureza + 4089.1 g de destilada = 4500.0 g**. El agua destilada difiere 0.1 g de la captura porque esta redondeaba por separado los tres componentes y sumaba 4500.1 g.

El campo opcional `waterProfile` conserva versión, sistema, agua base, nombre, litros del lote, GH y alcalinidad, sin sobrescribir el agua vertida del café. Se incluye en los respaldos V1 y viaja mediante la sincronización existente de recetas/sesiones; no requiere cambiar el esquema de Supabase. Las cinco columnas CSV añadidas son `agua_perfil`, `agua_GH_ppm_CaCO3`, `agua_alcalinidad_ppm_CaCO3`, `agua_lote_L` y `agua_sistema`. Los archivos antiguos siguen sin un perfil de agua atribuido.

## Dos temperaturas

**Temperatura 1 (°C)** conserva la temperatura de las recetas anteriores. **Temperatura 2 (°C, opcional)** permite registrar otra temperatura para recetas de varias etapas. Déjala vacía si solo utilizas una. Ambas aceptan valores entre 0 y 100 °C y aparecen por separado en los cálculos en vivo y en la bitácora; no se promedian ni cambian los cálculos de extracción.

La temperatura principal sigue en `temp` dentro de los respaldos y en la columna CSV `temperatura_C`. La segunda se guarda como `temp2` (número o `null`) y en la nueva columna `temperatura_2_C`. Un archivo anterior sin ese campo no recibe una segunda temperatura inventada. Los recursos de esta versión llevan `?v=1.7.1` para actualizar estilos y scripts al recargar sin borrar los datos del navegador.

## Métodos y número de vertidos

El selector de métodos incluye **Solo Spin**, **Orea** y **Paragon**, además de los métodos anteriores. Se conservan al guardar una receta, registrar una sesión o exportar un respaldo.

Después de **Bloom (segundos)** aparece **Número de vertidos**, que cuenta los vertidos **sin incluir el bloom**. Por ejemplo, el plan 45/145/240 g contiene un bloom y dos vertidos posteriores; el campo muestra `2`. Al aplicar cambios en el editor del plan, el número se actualiza automáticamente.

El número es opcional: si conoces cuántos vertidos harás pero aún no sus pesos, puedes registrarlo sin crear una secuencia ficticia. Si solo está documentado el bloom, no se deduce cuántos vertidos faltan. Si existe un plan completo y escribes un número diferente, debes ajustar el plan con **Editar vertidos** antes de guardar. Una receta sin vertidos posteriores puede registrar `0`; si queda agua pendiente después de un bloom conocido, ese cero se rechaza.

El campo opcional `pourCount` se guarda en recetas, sesiones y JSON. En archivos anteriores se deduce del plan completo cuando existe; de lo contrario queda sin especificar. El CSV agrega `vertidos_despues_bloom` después de las columnas de molino y grosor, conservando las posiciones anteriores.

## Molino y molienda

En **Diseña tu preparación** se registran tres datos independientes:

- **Molino:** Comandante C40, Mazzer Philos I200D u otro modelo que puedes escribir.
- **Grosor de molienda:** fina, media fina, media, media gruesa, gruesa o extra gruesa. Esta descripción orientativa ayuda a compartir la receta entre personas con equipos distintos.
- **Avanzado (opcional):** debajo del grosor, despliega la sección e introduce **Grosor de molienda en µm**. Acepta un número mayor que cero, incluidos decimales, o puede quedar vacío. No exige seleccionar una categoría de grosor ni indicar un molino.
- **Ajuste del molino:** texto opcional para registrar los clics y la configuración del C40 o la posición del dial del Philos.

No se convierte automáticamente un número en un grosor ni entre molinos. Al cambiar de modelo se vacía el ajuste para que lo registres en la escala del nuevo equipo; el grosor elegido y los micrones se conservan. Los micrones son una referencia orientativa introducida por el usuario, no una conversión del dial o los clics. Cada sesión mantiene su propia referencia aunque edites la receta después.

Los respaldos antiguos que solo contienen `grind` conservan ese ajuste. Si no incluyen el molino o el grosor, estos aparecen como **Sin especificar**, sin atribuir un modelo o una molienda al número guardado. Los campos opcionales `grinder` y `grindSize` se conservan en los respaldos JSON. En CSV, `molienda` mantiene el ajuste original y las dos nuevas columnas indican el modelo y el grosor por separado.

El campo opcional `grindMicrons` conserva el valor numérico en recetas, sesiones y JSON; vacío se guarda como `null`. Los archivos anteriores sin este campo siguen funcionando sin asignar micrones a los ajustes guardados. Se rechazan valores no numéricos o no positivos antes de importar un respaldo. La bitácora muestra los micrones cuando se registran y el CSV los añade en `grosor_molienda_um`. Al seleccionar una receta con micrones, la sección avanzada se abre para que el dato quede visible.

## Cálculos

- Ratio real = masa de agua añadida / dosis de café.
- Agua objetivo = dosis × ratio deseado.
- Rendimiento de extracción EY (%) = TDS de bebida (%) × masa de bebida (g) / masa de café seca (g).
- Sólidos disueltos (g) = (TDS de bebida / 100) × masa de bebida.
- Las recetas iniciales son referencias proporcionadas por el usuario y no mediciones de TDS/EY.

## Datos y privacidad

- Las recetas personalizadas y sesiones se intentan almacenar en `localStorage`, en el navegador y dispositivo donde se abre el archivo.
- Con la nube activada, entrar con el mismo correo en ambos dispositivos sincroniza recetas y bitácora en una cuenta privada. Las recetas locales se incorporan automáticamente al conectar ese navegador. El repositorio público no recibe esos datos ni los tokens de acceso.
- El almacenamiento local de archivos `file://` puede variar entre navegadores y no sincroniza dispositivos; **exporta JSON** para conservar tus datos.
- Exporta CSV para abrir tu bitácora en Excel o Google Sheets.
- Importar JSON reemplaza las recetas personales y sesiones del navegador actual. Al sincronizar una cuenta, esos cambios también se envían a los otros dispositivos. El diálogo de importación lo indica antes de continuar.

## Solicitudes recomendadas para Codex

1. Revisar preparaciones reales en teléfono y computadora y anotar mejoras de uso.
2. Añadir comparativas A/B de una misma variedad y gráficas históricas de atributos sensoriales.
3. Permitir catálogo editable de molinos, métodos, agua GH/KH y metadatos de origen, sin presentar valores no medidos como científicos.
4. Preparar una versión instalable tipo PWA para volver a abrir recetas sin conexión después de descargarlas.
