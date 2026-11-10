# Blossom · Propuesta visual 01

La propuesta original se conserva en `concepto/`: portada y calculadora de recetas, adaptadas a computadora y teléfono. Tras la aprobación del propietario, la aplicación V1.8.0 aplica esta dirección visual a sus cinco secciones en su dirección habitual. Su resumen de receta es más estrecho y bajo, sin posición fija al desplazarse, conforme a la revisión recibida.

## Dirección visual

Se tomaron como referencias las dos capturas aportadas por el propietario: La Cabra y Onyx at The Preserve. La base clara, los espacios y las divisiones finas siguen la dirección editorial de la primera. La fotografía envolvente, los titulares amplios y el contraste de la portada toman la segunda como inspiración. La identidad, el logo y la paleta pertenecen a Blossom.

El logo sigue siendo el JPG oficial en color, sin modificar. La cabecera blanca permite integrarlo sin recortarlo ni redibujarlo.

La fotografía de flores y cerezas de café fue generada con IA para esta propuesta mediante `image_gen`. Es una composición creativa; no documenta una finca, cosecha o café del propietario. Ambas páginas lo identifican en el pie. El original se conserva en el entorno de generación; sus copias publicadas están en `concepto/assets/coffee-blossoms.png` y `assets/images/coffee-blossoms.png`.

Se utilizan Manrope para controles y titulares, y Cormorant Garamond para los títulos editoriales y sus acentos en cursiva. Se descargaron desde los directorios oficiales de Google Fonts y se convirtieron de TTF a WOFF2 conservando su diseño. Las licencias SIL Open Font License se incluyen con los archivos en `concepto/assets/fonts/` y `assets/fonts/`.

## Alcance y comportamiento

- La calculadora utiliza la referencia Bourbon Lavado de la aplicación y sus funciones de cálculo existentes.
- Dosis y ratio recalculan el agua; editar el agua actualiza el ratio real y el plan proporcional de vertidos de la referencia.
- Permite revisar método, molino, ajuste, molienda, bloom, tiempo objetivo y dos temperaturas.
- Copiar la preparación ofrece una alternativa de texto seleccionable si el navegador no permite el portapapeles.
- La propuesta no carga módulos de cuentas, almacenamiento ni sincronización y no lee o escribe recetas personales. Los enlaces «Mi laboratorio» abren la aplicación actual.
- Los ajustes de la maqueta son temporales. Preparación guiada, Extracción, Bitácora y Agua están disponibles con el nuevo diseño en la aplicación V1.8.0, donde también funcionan el guardado y la sincronización habituales.

## Revisión

Desde el servidor local habitual, abrir `/concepto/`. La publicación copia la carpeta completa junto a la aplicación y comprueba la dirección de la maqueta y sus recursos principales.

Revisar portada, legibilidad, separación de campos, resultados y recorrido de teléfono. Las pruebas verifican escalado, dos temperaturas, alternativa de copia, fuentes y fotografía, distintos anchos y conservación de los datos del navegador.

En V1.8.0 también se verifica el resumen compacto sin seguimiento al desplazarse, los accesos de cabecera a las secciones reales y el indicador de sincronización conectado a la cuenta. El formato de respaldos y las claves de almacenamiento existentes se conservan.
