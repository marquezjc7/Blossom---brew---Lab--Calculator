# Publicar Blossom Brew Lab

El sitio se prepara para GitHub Pages con HTTPS y acceso público. Las recetas y sesiones siguen almacenadas en el navegador de cada persona. No se envían a GitHub ni se sincronizan entre dispositivos.

## Activación inicial

Esta configuración se realiza una vez en GitHub, con una cuenta que pueda administrar el repositorio:

1. Abre el repositorio `marquezjc7/Blossom---brew---Lab--Calculator`.
2. Entra en **Settings → Pages**.
3. En **Build and deployment → Source**, elige **GitHub Actions**.
4. Entra en **Actions → Publicar Blossom Brew Lab → Run workflow**, selecciona `main` y ejecuta el flujo.
5. Cuando el trabajo **deploy** termine correctamente, abre la dirección que muestra GitHub Pages en el resumen del flujo o en **Settings → Pages**.

La selección **Source → GitHub Actions** se guarda automáticamente. El botón **Save** de **Custom domain** corresponde únicamente a un dominio propio; para la dirección gratuita de GitHub, ese campo queda vacío. Si una ejecución anterior falló porque Pages no estaba activado, vuelve a ejecutar el flujo después de seleccionar la fuente.

Si **Settings → Pages** indica que la publicación no está disponible para el plan o la visibilidad actual del repositorio, no cambies su visibilidad automáticamente: revisa las opciones de la cuenta o elige otro alojamiento estático. Publicar la aplicación no requiere hacer público el repositorio si el plan admite Pages para repositorios privados.

## Publicaciones posteriores

Cada cambio que llega a `main` ejecuta primero las pruebas de lógica y navegador. Después prepara el sitio, guarda el artefacto y lo publica. Un fallo en las pruebas impide la publicación. También puedes repetir la publicación manualmente con **Run workflow**.

El entorno de despliegue se llama `github-pages`. Si GitHub pide una revisión por las reglas de ese entorno, revisa el commit que se va a publicar y aprueba ese despliegue desde el flujo. No se necesita crear ni compartir un token personal para que el flujo publique: utiliza el token que proporciona GitHub Actions.

## Comprobar el sitio antes de subirlo

Desde la raíz del proyecto:

```bash
npm test
BLOSSOM_BROWSER_EXECUTABLE=/usr/bin/chromium .venv/bin/python -m unittest discover -s tests -p 'test_browser.py' -v
python3 scripts/prepare_pages.py
python3 -m http.server 8000 --bind 127.0.0.1 --directory _site
```

El artefacto `_site/` contiene únicamente `index.html`, `assets/`, `src/` y `.nojekyll`. Excluye pruebas, documentación, entornos virtuales y herramientas de desarrollo. El script se puede repetir y solo reemplaza el directorio que él mismo ha generado. No modifica los archivos de la aplicación.

## Verificación después de publicar

Abre la dirección HTTPS que GitHub confirme y prueba:

- Carga de estilos, recetas y cálculos.
- Métodos Solo Spin, Orea y Paragon.
- Cambio de dosis a 18 g con ratio 1:16: 288 g de agua y vertidos 54/174/288 g.
- Selección de molino y grosor, guardado de una receta y recuperación al recargar.
- Guardado de una sesión y exportación/importación JSON.
- El formulario y las pestañas en un teléfono real.

Antes de cambiar desde un archivo local u otra dirección web, exporta JSON desde el navegador original. Importa ese respaldo en la dirección nueva: cada origen del navegador tiene almacenamiento independiente.

Publicar el entorno de Codex conserva la configuración de desarrollo. El flujo de GitHub Pages publica la aplicación para abrirla desde el teléfono; ambas publicaciones se realizan por separado.
