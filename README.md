# Blossom Brew Lab — Calculadora de recetas y extracción (V1.1)

**Archivo principal:** `index.html`. La aplicación funciona en el navegador sin instalar dependencias ni crear cuentas. No usa servicios externos.

**Aplicación publicada:** [Abrir Blossom Brew Lab](https://marquezjc7.github.io/Blossom---brew---Lab--Calculator/).

La V1.1 incorpora edición de recetas personalizadas, pesos acumulados y tiempos opcionales de inicio de vertidos. Conserva las recetas de referencia, los datos guardados y los respaldos V1. El avance y las siguientes etapas están en [el plan de trabajo](docs/ROADMAP.md).

## Desarrollo local

Puedes abrir `index.html` directamente, conservando las carpetas `assets/` y `src/` a su lado. Para desarrollar con un origen estable de almacenamiento, desde la raíz del repositorio ejecuta:

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

El servidor solo entrega archivos locales; no es un backend y no sincroniza datos. Usa siempre el mismo navegador y origen para acceder a tus sesiones. Antes de cambiar de dispositivo, dirección o forma de apertura, exporta un respaldo JSON.

## Organización del proyecto

| Archivo                 | Responsabilidad                                           |
| ----------------------- | --------------------------------------------------------- |
| `index.html`            | Estructura y contenido de la interfaz                     |
| `assets/css/styles.css` | Diseño y adaptación a pantallas pequeñas                  |
| `src/calculations.js`   | Ratio, agua objetivo, extracción y escalado de vertidos   |
| `src/plans.js`          | Validación, tiempos y copia del plan según el agua total  |
| `src/pour-editor.js`    | Editor de cantidades acumuladas y tiempos de inicio       |
| `src/recipes.js`        | Tres recetas iniciales y sus datos de referencia          |
| `src/storage.js`        | Acceso a almacenamiento local y claves compatibles con V1 |
| `src/transfers.js`      | Formato de respaldo JSON y generación de CSV              |
| `src/app.js`            | Interacciones, estado de la pantalla y renderizado        |
| `tests/`                | Pruebas de lógica y recorridos completos en Chromium      |

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
.venv/bin/python -m playwright install chromium
.venv/bin/python -m unittest discover -s tests -p 'test_browser.py' -v
```

En Linux puede ser necesario instalar las bibliotecas del navegador con `python -m playwright install --with-deps chromium` desde ese entorno virtual. Si ya tienes un Chromium compatible, puedes indicarlo sin descargar otro:

```bash
BLOSSOM_BROWSER_EXECUTABLE=/usr/bin/chromium python3 -m unittest discover -s tests -p 'test_browser.py' -v
```

La suite inicia y cierra su propio servidor en un puerto libre y usa un perfil nuevo por prueba. No necesita el servidor del puerto 8000 ni modifica los datos de tu navegador personal. Comprueba recetas, edición de vertidos y tiempos, actualización sin duplicados, errores de almacenamiento, extracción, guardado, compatibilidad con datos V1, importación y exportaciones, pantallas pequeñas y operación sin conexión después de cargar la página.

También prueba la apertura directa de archivos. Si una política del navegador administrado prohíbe `file://`, ese caso se informa como **omitido**, sin cambiar la política ni contarlo como aprobado. Las demás pruebas siguen ejecutándose.

El flujo `.github/workflows/tests.yml` está preparado para ejecutar ambas suites en GitHub Actions al subir cambios o abrir una pull request.

## Acceso web con GitHub Pages

La publicación está preparada en `.github/workflows/pages.yml`. En `main`, el flujo ejecuta las pruebas mediante el flujo reutilizable de validación y publica solo si pasan. En otras ramas y pull requests, las pruebas se ejecutan sin publicar.

La activación inicial y la comprobación de la dirección HTTPS están explicadas paso a paso en [Publicar Blossom Brew Lab](docs/PUBLISHING.md). `python3 scripts/prepare_pages.py` genera el sitio en `_site/`, una carpeta ignorada por Git que contiene solo la aplicación. Publicar no sincroniza las recetas personales: se conservan en el navegador y se trasladan mediante JSON.

## Abrir y probar

1. Abre `index.html` con Safari, Chrome u otro navegador moderno.
2. Elige uno de los tres ejemplos: Bourbon Natural, Bourbon Lavado o Pacas Natural.
3. Cambia la dosis de 15 a 18 g, conserva ratio objetivo 1:16 y selecciona «Calcular agua al ratio objetivo». Obtendrás 288 g.
4. Comprueba que los vertidos del Bourbon Natural se escalen de 45/145/240 g a 54/174/288 g acumulados.
5. En «Extracción» introduce solo valores medidos. El botón «Ejemplo didáctico» muestra 15 g, 210 g de bebida, 1.42% TDS y EY 19.88%. Es un dato ficticio.
6. En «Bitácora» guarda una sesión y exporta CSV o JSON como respaldo.

## Editar recetas y vertidos

1. Selecciona una receta y modifica los parámetros. Con una referencia inicial, usa **Guardar como nueva receta** para crear tu copia. Las tres referencias originales se mantienen.
2. Al seleccionar una receta personalizada, puedes editar su nombre y parámetros. **Actualizar receta guardada** reemplaza esa receta sin crear un duplicado. **Guardar como nueva receta** crea una copia independiente.
3. Abre **Editar vertidos** para agregar, quitar o cambiar cantidades acumuladas. Deben aumentar y el último peso debe coincidir con el agua total. Puedes quitar todas las filas para dejar la receta sin plan documentado.
4. Cada inicio es opcional y se registra en `mm:ss` desde que comienza la preparación: por ejemplo, `0:00`, `0:45`, `1:30`. Deja vacíos los tiempos desconocidos. Los conocidos deben aumentar y quedar antes del tiempo final, si este está registrado.
5. Pulsa **Aplicar plan**, revisa el resultado y guarda o actualiza la receta. **Cancelar** descarta solo la edición del plan que está abierta. Si cambias el agua con el editor abierto, ajusta también el último peso antes de aplicar.

Al cambiar el agua se escalan las cantidades del plan; los tiempos se conservan. Para Pacas Natural solo se conoce el bloom: el editor no inventa los vertidos restantes. Una sesión captura su propio plan, de modo que editar la receta después no cambia el historial anterior. Los avisos de cambios sin guardar permiten cancelar al cambiar de receta o salir de la página.

Los respaldos JSON conservan el plan completo: `pours` sigue siendo una lista de gramos acumulados y el campo opcional `pourTimes` contiene segundos desde el inicio, con `null` para tiempos desconocidos. No se cambian las claves de almacenamiento ni el formato `blossom-brew-lab-v1`. Los archivos anteriores sin tiempos siguen siendo válidos. Un respaldo con tiempos incompatibles se rechaza antes de reemplazar los datos. El CSV conserva sus primeras 16 columnas y agrega `molino`, `grosor_molienda` y `vertidos_despues_bloom` al final; usa JSON para transferir planes y tiempos completos.

## Métodos y número de vertidos

El selector de métodos incluye **Solo Spin**, **Orea** y **Paragon**, además de los métodos anteriores. Se conservan al guardar una receta, registrar una sesión o exportar un respaldo.

Después de **Bloom (segundos)** aparece **Número de vertidos**, que cuenta los vertidos **sin incluir el bloom**. Por ejemplo, el plan 45/145/240 g contiene un bloom y dos vertidos posteriores; el campo muestra `2`. Al aplicar cambios en el editor del plan, el número se actualiza automáticamente.

El número es opcional: si conoces cuántos vertidos harás pero aún no sus pesos, puedes registrarlo sin crear una secuencia ficticia. Para Pacas Natural queda vacío inicialmente, porque solo está documentado el bloom. Si existe un plan completo y escribes un número diferente, debes ajustar el plan con **Editar vertidos** antes de guardar. Una receta sin vertidos posteriores puede registrar `0`; si queda agua pendiente después de un bloom conocido, ese cero se rechaza.

El campo opcional `pourCount` se guarda en recetas, sesiones y JSON. En archivos anteriores se deduce del plan completo cuando existe; de lo contrario queda sin especificar. El CSV agrega `vertidos_despues_bloom` después de las columnas de molino y grosor, conservando las posiciones anteriores.

## Molino y molienda

En **Diseña tu preparación** se registran tres datos independientes:

- **Molino:** Comandante C40, Mazzer Philos I200D u otro modelo que puedes escribir.
- **Grosor de molienda:** fina, media fina, media, media gruesa, gruesa o extra gruesa. Esta descripción orientativa ayuda a compartir la receta entre personas con equipos distintos.
- **Ajuste del molino:** texto opcional para registrar los clics y la configuración del C40 o la posición del dial del Philos.

No se convierte automáticamente un número en un grosor ni entre molinos. Al cambiar de modelo se vacía el ajuste para que lo registres en la escala del nuevo equipo; el grosor elegido se conserva. Las recetas y sesiones incluyen los tres datos, y cada sesión mantiene su propia referencia aunque edites la receta después.

Los respaldos antiguos que solo contienen `grind` conservan ese ajuste. Si no incluyen el molino o el grosor, estos aparecen como **Sin especificar**, sin atribuir un modelo o una molienda al número guardado. Los campos opcionales `grinder` y `grindSize` se conservan en los respaldos JSON. En CSV, `molienda` mantiene el ajuste original y las dos nuevas columnas indican el modelo y el grosor por separado.

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
