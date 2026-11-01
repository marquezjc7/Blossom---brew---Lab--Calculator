# Desarrollo de Blossom Brew Lab

## Punto de partida

La V1.0 permite elegir y guardar recetas, calcular agua y extracción, escalar vertidos de referencia, registrar sesiones y exportar/importar respaldos. Los datos pertenecen al navegador actual; no hay cuentas ni sincronización entre dispositivos.

## V1.1 — Etapa 1: base organizada

- [x] Separar HTML, CSS, lógica de cálculos, recetas, almacenamiento y respaldos.
- [x] Conservar las claves de datos y el formato de respaldo V1.
- [x] Incorporar pruebas de lógica y recorridos de navegador al repositorio.
- [x] Documentar cómo ejecutar la aplicación y las pruebas.
- [x] Preparar un flujo de pruebas para GitHub Actions.

Esta etapa organizó la V1.0 sin cambiar sus funciones. La apertura `file://` continúa prevista; su comprobación en navegadores administrados puede omitirse únicamente si una política la prohíbe, con el motivo visible en el resultado.

## V1.1 — Etapa 2: recetas y vertidos

- [x] Editar recetas personalizadas guardadas y conservar las referencias originales.
- [x] Definir y validar pesos acumulados de vertidos.
- [x] Registrar tiempos de vertidos sin inventar secuencias para recetas incompletas.
- [x] Probar guardado, recuperación y compatibilidad de los nuevos campos con respaldos anteriores.

La interfaz se identifica como V1.1. El formato de respaldo sigue siendo V1 con el campo opcional `pourTimes` (segundos o `null`); los archivos anteriores siguen funcionando. Las sesiones nuevas capturan su propio plan y los cambios posteriores a una receta no reescriben el historial. La sincronización y la publicación todavía pertenecen a las siguientes etapas.

### Molino y molienda

- [x] Separar el molino, su ajuste y el grosor de molienda.
- [x] Ofrecer Comandante C40, Mazzer Philos I200D y otro modelo editable.
- [x] Describir la molienda desde fina hasta extra gruesa, sin conversiones automáticas de ajustes.
- [x] Conservar esos datos en recetas, sesiones y respaldos JSON/CSV, con lectura de archivos anteriores.

### Métodos y número de vertidos

- [x] Añadir Solo Spin, Orea y Paragon al selector de métodos.
- [x] Registrar el número de vertidos después de Bloom, sin incluir el bloom en el conteo.
- [x] Sincronizar el número con el plan y conservarlo en recetas, sesiones y respaldos, permitiendo cantidades desconocidas.

## Etapa 3: acceso desde el teléfono

- [ ] Revisar los flujos completos en dispositivos móviles reales.
- [x] Elegir GitHub Pages como alojamiento público y preparar la publicación con HTTPS, condicionada a las pruebas.
- [ ] Verificar la dirección publicada y el manejo de respaldos al cambiar de origen.
- [ ] Evaluar instalación como PWA y uso sin conexión después de la primera visita.

Publicar una web y sincronizar datos son tareas distintas. La sincronización requiere definir cuentas, almacenamiento compartido y privacidad antes de implementarla.

## Mejoras posteriores

- Comparaciones A/B y gráficas sensoriales.
- Catálogos editables de molinos, métodos, agua y origen del café.
- Sincronización, si el uso del laboratorio la requiere.
