# Blossom Brew Lab — Calculadora de recetas y extracción (V1.0)

**Archivo principal:** `index.html`. La aplicación funciona en el navegador sin instalar dependencias ni crear cuentas. No usa servicios externos.

## Abrir y probar
1. Abre `index.html` con Safari, Chrome u otro navegador moderno.
2. Elige uno de los tres ejemplos: Bourbon Natural, Bourbon Lavado o Pacas Natural.
3. Cambia la dosis de 15 a 18 g, conserva ratio objetivo 1:16 y selecciona «Calcular agua al ratio objetivo». Obtendrás 288 g.
4. Comprueba que los vertidos del Bourbon Natural se escalen de 45/145/240 g a 54/174/288 g acumulados.
5. En «Extracción» introduce solo valores medidos. El botón «Ejemplo didáctico» muestra 15 g, 210 g de bebida, 1.42% TDS y EY 19.88%. Es un dato ficticio.
6. En «Bitácora» guarda una sesión y exporta CSV o JSON como respaldo.

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
1. Separar HTML/CSS/JS en módulos, crear tests automáticos y mantener el mismo comportamiento offline.
2. Añadir edición de vertidos acumulados y control de tiempos de cada vertido.
3. Añadir comparativas A/B de una misma variedad y gráficas históricas de atributos sensoriales.
4. Permitir catálogo editable de molinos, métodos, agua GH/KH y metadatos de origen, sin presentar valores no medidos como científicos.
5. Preparar versión instalable tipo PWA; para sincronización multiplataforma necesitaría diseñarse un backend y privacidad.
