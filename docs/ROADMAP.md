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

## V1.2 — temperaturas y guardado

- [x] Registrar Temperatura 1 y una Temperatura 2 opcional en recetas, bitácora y respaldos.
- [x] Escribir el nombre de la receta en el formulario, eliminando la dependencia de `prompt()`.
- [x] Mostrar errores y confirmaciones persistentes, verificar la escritura y ofrecer un respaldo del intento si falla el almacenamiento.
- [x] Recuperar la última receta seleccionada al recargar y conservar las claves de datos anteriores.
- [x] Permitir guardar con el editor de vertidos abierto sin cambios y llevar a Aplicar/Cancelar cuando hay cambios pendientes, conservando los demás parámetros.
- [x] Añadir comprobaciones de guardado y recuperación en Chromium y WebKit a la publicación automática.

La causa exacta del fallo reportado en los dispositivos del propietario no se había reproducido en Chromium. El nuevo flujo permite ver el error concreto y guardar sin ventanas emergentes; la confirmación final en sus dispositivos queda pendiente de una nueva prueba tras publicar V1.2.

## V1.3 — gestión de recetas personales

- [x] Eliminar una receta personalizada con una confirmación que identifica la receta dentro de la página.
- [x] Conservar la bitácora, las demás recetas y las referencias iniciales al eliminar una receta.
- [x] Conservar las ediciones al cancelar y evitar un borrado aparente si falla el almacenamiento.
- [x] Cerrar la confirmación al cambiar de receta y recuperar una selección válida al recargar.

## V1.4 — grosor en micrones

- [x] Añadir «Avanzado (opcional)» debajo del grosor de molienda, con un campo numérico en µm.
- [x] Permitir registrar micrones sin categoría ni molino, sin conversiones automáticas.
- [x] Guardar, editar y recuperar el valor en recetas, bitácora y respaldos JSON/CSV, conservando los datos anteriores.
- [x] Validar valores positivos o vacíos y conservar las sesiones anteriores al editar una receta.

## V1.4.1 — retirar referencias

- [x] Retirar Bourbon Natural y Pacas Natural del catálogo incluido en la aplicación, a petición del propietario.
- [x] Mantener Bourbon Lavado como referencia y recuperar una selección válida si estaba seleccionada alguna de las retiradas.
- [x] Conservar las recetas personales, las sesiones y las pruebas de recetas con planes incompletos.

## V1.5 — sincronización entre dispositivos

- [x] Preparar acceso por enlace de correo y sincronización privada de recetas y bitácora.
- [x] Incorporar las recetas locales al conectar la cuenta y conservar cambios pendientes sin conexión.
- [x] Proteger las ediciones sin guardar, propagar borrados y conservar ambas versiones ante ediciones simultáneas.
- [x] Probar permisos entre cuentas y acceso anónimo mediante PostgreSQL embebido, además del contrato de dos navegadores.
- [x] Conectar el proyecto de Supabase del propietario, aplicar el esquema y configurar el correo y la URL pública.
- [x] Publicar la configuración y confirmar el acceso y el mensaje de sincronización en la computadora del propietario.
- [x] Confirmar el acceso y la recuperación de recetas en el teléfono del propietario; también confirmó la sincronización entre ambos dispositivos.

## V1.5.1 — acceso entre dispositivos

- [x] Distinguir las cuotas de correo y las solicitudes frecuentes, conservar las esperas y evitar reenvíos durante el bloqueo.
- [x] Configurar una contraseña desde una sesión verificada y entrar con ella desde otro dispositivo sin solicitar otro correo.
- [x] Conservar las recetas ante credenciales inválidas y comprobar que las contraseñas no se almacenen con los datos del navegador.

## V1.6.0 — preparación guiada

- [x] Cargar una copia del plan actual y mostrar cantidades incrementales y acumuladas.
- [x] Iniciar, pausar y reanudar un cronómetro recuperable al recargar, sin avance automático de vertidos.
- [x] Registrar inicios reales y asignar explícitamente una de las dos temperaturas a cada paso cuando corresponda.
- [x] Conservar el progreso y la evaluación pendiente en el navegador; sincronizar la sesión final con la cuenta existente.
- [x] Guardar tiempo real, temperaturas y evaluación sin modificar los objetivos de la receta ni inventar mediciones.
- [x] Mantener respaldos V1 y columnas CSV anteriores; ofrecer un respaldo del resultado si falla el guardado.
- [ ] Confirmar una preparación real con el propietario después de publicar.

## V1.7.0 — formulación de agua

- [x] Incorporar ocho referencias del material compartido y objetivos independientes de GH y alcalinidad.
- [x] Calcular masas para dos concentrados fijos (NaHCO₃ 1.68 g/L y MgSO₄·7H₂O 2.45 g/L), con agua destilada y conservación del total al redondear.
- [x] Ofrecer volumen personalizado, deslizadores, copia con alternativa y descarga TXT.
- [x] Asociar un perfil a una receta de café, recuperarlo y quitarlo conservando la historia de las sesiones.
- [x] Sincronizar el perfil con su receta y sesión sin migrar el esquema de nube.
- [x] Conservar el formato JSON V1 y las primeras 24 columnas CSV; añadir cinco columnas de agua.
- [ ] Confirmar una mezcla y un guardado reales con el propietario después de publicar.

## V1.7.1 — lote de cinco litros

- [x] Añadir el acceso rápido de 5 L a la calculadora de agua para escalar cualquier referencia o perfil personalizado.

## Etapa 3: acceso desde el teléfono

- [ ] Revisar los flujos completos en dispositivos móviles reales.
- [x] Elegir GitHub Pages como alojamiento público y preparar la publicación con HTTPS, condicionada a las pruebas.
- [x] Hacer público el repositorio con autorización del propietario y seleccionar GitHub Actions como fuente de Pages.
- [x] Completar la publicación y confirmar la carga de la dirección HTTPS en Safari de computadora y en teléfono, según la prueba del propietario.
- [ ] Comprobar guardado, recarga y traslado de respaldos JSON entre los dispositivos del propietario.
- [ ] Evaluar instalación como PWA y uso sin conexión después de la primera visita.

La publicación y la sincronización ya están activas y confirmadas por el propietario. La instalación como PWA y la apertura completa sin conexión siguen pendientes.

## Mejoras posteriores

- Comparaciones A/B y gráficas sensoriales.
- Catálogos editables de molinos, métodos, agua y origen del café.
- Compartir recetas concretas mediante enlaces o QR, conservando la bitácora privada.
