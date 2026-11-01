# Blossom Brew Lab — Calculadora de recetas y extracción (V1.4.1)

**Archivo principal:** `index.html`. La aplicación funciona en el navegador sin instalar dependencias ni crear cuentas. No usa servicios externos.

**Aplicación publicada:** [Abrir Blossom Brew Lab](https://marquezjc7.github.io/Blossom---brew---Lab--Calculator/).

La V1.4.1 retira Bourbon Natural y Pacas Natural del catálogo de referencias, a petición del propietario. Bourbon Lavado continúa como referencia inicial. Se conservan las recetas personales, la bitácora y las funciones de molienda en micrones, dos temperaturas y edición de vertidos. El avance y las siguientes etapas están en [el plan de trabajo](docs/ROADMAP.md).

## Desarrollo local

Puedes abrir `index.html` directamente, conservando las carpetas `assets/` y `src/` a su lado. Para desarrollar con un origen estable de almacenamiento, desde la raíz del repositorio ejecuta:

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

El servidor solo entrega archivos locales; no es un backend y no sincroniza datos. Usa siempre el mismo navegador y origen para acceder a tus sesiones. Antes de cambiar de dispositivo, dirección o forma de apertura, exporta un respaldo JSON.

## Organización del proyecto

| Archivo                 | Responsabilidad                                               |
| ----------------------- | ------------------------------------------------------------- |
| `index.html`            | Estructura y contenido de la interfaz                         |
| `assets/css/styles.css` | Diseño y adaptación a pantallas pequeñas                      |
| `src/calculations.js`   | Ratio, agua objetivo, extracción y escalado de vertidos       |
| `src/plans.js`          | Validación, tiempos y copia del plan según el agua total      |
| `src/pour-editor.js`    | Editor de cantidades acumuladas y tiempos de inicio           |
| `src/recipes.js`        | Catálogo de recetas de referencia                             |
| `src/storage.js`        | Acceso a almacenamiento local y claves compatibles con V1     |
| `src/transfers.js`      | Formato de respaldo JSON y generación de CSV                  |
| `src/app.js`            | Interacciones, estado de la pantalla y renderizado            |
| `tests/`                | Pruebas de lógica y recorridos completos en Chromium y WebKit |

Los scripts son locales y se cargan en orden con `defer`. Se usa el espacio de nombres `BlossomLab` para compartir sus funciones. No se requieren módulos ESM, descargas de CDN, paquetes para ejecutar la aplicación ni un paso de compilación; esto conserva la apertura directa mediante `file://`.

## Pruebas automáticas

Para comprobar cálculos, almacenamiento y formatos de respaldo se necesita Node.js 20 o posterior. No hay que ejecutar `npm install`:

```bash
npm test
```

Las pruebas de navegador usan Python 3.12 y Playwright. La instalación siguiente es solo para desarrollo:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -m playwright install chromium webkit
.venv/bin/python -m unittest discover -s tests -p 'test_browser.py' -v
```

En Linux puede ser necesario instalar las bibliotecas del navegador con `python -m playwright install --with-deps chromium` desde ese entorno virtual. Si ya tienes un Chromium compatible, puedes indicarlo sin descargar otro:

```bash
BLOSSOM_BROWSER_EXECUTABLE=/usr/bin/chromium .venv/bin/python -m unittest discover -s tests -p 'test_browser.py' -v
```

Para ejecutar la misma suite en WebKit: `BLOSSOM_BROWSER=webkit .venv/bin/python -m unittest discover -s tests -p 'test_browser.py' -v`. No establezcas `BLOSSOM_BROWSER_EXECUTABLE` al usar el WebKit descargado por Playwright. GitHub Actions ejecuta ambos motores en Ubuntu 24.04 y la publicación requiere que pasen los dos. WebKit comprueba el motor usado por Safari; las pruebas en un Safari y un teléfono reales siguen siendo una comprobación adicional.

La suite inicia y cierra su propio servidor en un puerto libre y usa un perfil nuevo por prueba. No necesita el servidor del puerto 8000 ni modifica los datos de tu navegador personal. Comprueba recetas, edición de vertidos y tiempos, actualización sin duplicados, errores de almacenamiento, extracción, guardado, compatibilidad con datos V1, importación y exportaciones, pantallas pequeñas y operación sin conexión después de cargar la página.

También prueba la apertura directa de archivos. Si una política del navegador administrado prohíbe `file://`, ese caso se informa como **omitido**, sin cambiar la política ni contarlo como aprobado. Las demás pruebas siguen ejecutándose.

Para ese caso se bloquean las solicitudes HTTP/HTTPS, en lugar de usar la emulación de desconexión que también puede impedir la navegación `file://` de WebKit. Si el WebKit del runner no consigue abrir ni un archivo HTML mínimo independiente, se informa la limitación como omitida. Un fallo que solo ocurra con la aplicación sigue siendo un fallo. La apertura web, el uso sin conexión después de cargar y el guardado continúan comprobándose en ambos motores.

El flujo `.github/workflows/tests.yml` está preparado para ejecutar ambas suites en GitHub Actions al subir cambios o abrir una pull request.

## Acceso web con GitHub Pages

La publicación está preparada en `.github/workflows/pages.yml`. En `main`, el flujo ejecuta las pruebas mediante el flujo reutilizable de validación y publica solo si pasan. En otras ramas y pull requests, las pruebas se ejecutan sin publicar.

La activación inicial y la comprobación de la dirección HTTPS están explicadas paso a paso en [Publicar Blossom Brew Lab](docs/PUBLISHING.md). `python3 scripts/prepare_pages.py` genera el sitio en `_site/`, una carpeta ignorada por Git que contiene solo la aplicación. Publicar no sincroniza las recetas personales: se conservan en el navegador y se trasladan mediante JSON.

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

La eliminación solo se refleja si el navegador confirma la escritura. Si falla el almacenamiento, la receta permanece en la lista y puedes reintentar o cancelar. Al borrar una receta, se selecciona otra disponible o la primera referencia y se recuerda esa selección al recargar. Cada navegador tiene su propia lista: borrar en el teléfono no borra los datos de la computadora.

Al cambiar el agua se escalan las cantidades del plan; los tiempos se conservan. Si una receta solo documenta el bloom, el editor no inventa los vertidos restantes. Una sesión captura su propio plan, de modo que editar la receta después no cambia el historial anterior. Los avisos de cambios sin guardar permiten cancelar al cambiar de receta o salir de la página.

Bourbon Natural y Pacas Natural ya no se incluyen en el catálogo. Si una de ellas era la última referencia seleccionada, al recargar se abre Bourbon Lavado. Retirar estas referencias no modifica las recetas personales ni las sesiones históricas del navegador.

El guardado verifica que el navegador haya almacenado la receta y muestra una confirmación persistente. La receta queda seleccionada y se recupera esa selección al recargar. Los errores señalan el campo que necesita corregirse. Si el navegador impide escribir en el almacenamiento, conserva los cambios en pantalla y ofrece **Descargar respaldo JSON** con la receta pendiente, sin afirmar que quedó guardada. Las recetas anteriores permanecen intactas.

Abrir **Editar vertidos** sin cambiar nada no impide guardar. Si editas los pesos o tiempos, **Revisar vertidos pendientes** te lleva a **Aplicar plan** y **Cancelar**. Un intento de guardado también muestra esas acciones: aplica para conservar los cambios o cancela para descartar solo esa edición; después guarda la receta. El nombre, las temperaturas y los demás parámetros se conservan al cancelar el editor.

Los respaldos JSON conservan el plan completo: `pours` sigue siendo una lista de gramos acumulados y el campo opcional `pourTimes` contiene segundos desde el inicio, con `null` para tiempos desconocidos. No se cambian las claves de recetas/sesiones ni el formato `blossom-brew-lab-v1`. Los archivos anteriores sin tiempos siguen siendo válidos. Un respaldo con tiempos incompatibles se rechaza antes de reemplazar los datos. El CSV conserva sus primeras 20 columnas y añade `grosor_molienda_um` al final; usa JSON para transferir planes y tiempos completos.

## Dos temperaturas

**Temperatura 1 (°C)** conserva la temperatura de las recetas anteriores. **Temperatura 2 (°C, opcional)** permite registrar otra temperatura para recetas de varias etapas. Déjala vacía si solo utilizas una. Ambas aceptan valores entre 0 y 100 °C y aparecen por separado en los cálculos en vivo y en la bitácora; no se promedian ni cambian los cálculos de extracción.

La temperatura principal sigue en `temp` dentro de los respaldos y en la columna CSV `temperatura_C`. La segunda se guarda como `temp2` (número o `null`) y en la nueva columna `temperatura_2_C`. Un archivo anterior sin ese campo no recibe una segunda temperatura inventada. Los recursos de esta versión llevan `?v=1.4.1` para actualizar estilos y scripts al recargar sin borrar los datos del navegador.

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
- El almacenamiento local de archivos `file://` puede variar entre navegadores y no sincroniza dispositivos; **exporta JSON** para conservar tus datos.
- Exporta CSV para abrir tu bitácora en Excel o Google Sheets.
- Importar JSON reemplaza las recetas personalizadas y sesiones del navegador actual.

## Solicitudes recomendadas para Codex

1. Preparar alojamiento HTTPS y comprobar la experiencia móvil en dispositivos reales.
2. Añadir comparativas A/B de una misma variedad y gráficas históricas de atributos sensoriales.
3. Permitir catálogo editable de molinos, métodos, agua GH/KH y metadatos de origen, sin presentar valores no medidos como científicos.
4. Preparar versión instalable tipo PWA; para sincronización multiplataforma necesitaría diseñarse un backend y privacidad.
