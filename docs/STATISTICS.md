# Estadísticas del recetario público

La sección **06 · Estadísticas** es privada. Mide el uso de `recetario/`, sin mezclar las ediciones, sesiones ni notas privadas de la aplicación principal. No hay datos históricos anteriores a la activación.

## Activar una sola vez

1. Entrar con la cuenta de publicación habitual en Blossom y abrir **Estadísticas**.
2. Pulsar **Copiar configuración de estadísticas**.
3. En [SQL Editor → New query](https://supabase.com/dashboard/project/vqwhkmdkouhenlgfqmvg/sql/new), pegar el texto completo y pulsar **Run**.
4. Volver a Estadísticas y pulsar **Actualizar**.
5. Compartir el enlace de **Copiar enlace para Instagram** desde Recetas. Ese enlace incluye `utm_source=instagram` y `utm_medium=bio`; la vista previa del propietario incluye `preview=1` y no se cuenta.

La configuración contiene [una migración adicional](../supabase/migrations/202611110003_usage_statistics.sql) y una autorización explícita para el UUID de la cuenta verificada. Puede repetirse sin borrar datos. Requiere el recetario público instalado y el acceso administrador al SQL Editor; la clave pública no puede ejecutar esta configuración. La aplicación no concede permisos por sí misma. El resto del recetario continúa funcionando mientras la medición esté pendiente o falle.

La migración de estadísticas no reemplaza las funciones de publicación ni el esquema privado. Su activación en el proyecto real queda pendiente de ejecución por el propietario.

## Qué se cuenta

- **Visitas:** sesiones de hasta 30 minutos desde su inicio, conservadas al recargar en la misma pestaña.
- **Visitantes aproximados:** identificadores aleatorios de navegador distintos en el período. Varias pestañas pueden iniciar visitas distintas; otros dispositivos, navegación privada, borrado o bloqueo del almacenamiento pueden aumentar la estimación. No representan personas identificadas.
- **Consultas:** cada receta una vez por visita. Cambiar dosis o ratio no suma consultas.
- **Preparaciones:** un inicio válido de la guía por receta y visita; abrir la sección o un intento con temperatura pendiente no cuenta como inicio.
- **Copias:** una copia confirmada por el portapapeles por receta y visita. La copia manual del texto alternativo no se puede confirmar y no se cuenta.
- **Secciones:** Recetario, Preparación, Extracción y Agua, una vez cada una por visita.
- **Origen:** Instagram cuando lo indica el enlace o el referente; directo/sin referencia u otros sitios. Solo se envía esta categoría, no la URL completa ni parámetros del visitante. Enlaces antiguos y navegadores que ocultan el referente pueden aparecer como directos.

Los períodos incluyen el día actual y los 6 o 29 días anteriores, con límites diarios en UTC. Las visitas se agrupan por inicio y las acciones por el momento del evento. Recargar no repite eventos ya confirmados; el servidor impone también una clave única por visita, tipo y destino. Una visita admite hasta 200 destinos de eventos distintos. Los eventos enviados por clientes públicos pueden ser manipulados por automatizaciones: son datos orientativos, no una auditoría ni una identificación de usuarios.

## Privacidad y exclusión

Al verificar una cuenta de publicación se excluye por defecto ese navegador. **Excluir este navegador de las estadísticas** permite cambiar la preferencia, que se conserva localmente, no se sincroniza con recetas y debe comprobarse en cada dispositivo de administración. **Ver recetario público** abre una vista previa que siempre queda excluida.

Los visitantes tienen una opción **No participar en las estadísticas** en **Privacidad y estadísticas**, al pie del recetario. Se respetan `doNotTrack` y `globalPrivacyControl`. El bloqueo de la medición no afecta las herramientas. El código de medición solo lee sus tres claves propias con prefijo `blossom-public-usage-v1`; no lee la sesión de acceso ni los registros privados y no manda `Authorization`, cookies ni referente HTTP.

Las tablas de medición contienen identificadores aleatorios, fecha del servidor, categoría de origen, tipo de acción y destino público. No almacenan nombres de personas, correo, IP, recetas privadas, texto copiado, dosis, notas ni evaluaciones. Los registros de más de 60 días se depuran al recibir nuevas visitas o consultar el resumen; no se utiliza una tarea programada. Los identificadores locales permanecen hasta que el navegador los borra. La página informa esta medición y permite excluirse.

## Permisos y verificación

- `blossom_analytics_admins` requiere autorización explícita; además se exige ser una cuenta de publicación vigente para consultar el resumen.
- Las tres tablas tienen RLS y ningún acceso directo para `anon` ni `authenticated`.
- `blossom_record_usage` permite a `anon` registrar solo tipos y destinos públicos permitidos. Valida el evento antes de crear una visita, fija fechas en el servidor, limita su duración y deduplica reintentos. No devuelve datos guardados.
- `blossom_usage_summary` requiere autenticación y ambos permisos. Devuelve agregados, nunca identificadores de visitantes o sesiones. La clasificación de recetas muestra solo referencias y publicaciones del administrador que consulta; una receta retirada conserva sus cifras con un nombre genérico.
- Los fallos de medición se manejan aparte de la lectura y los cálculos; una configuración ausente detiene los intentos hasta recargar.

Las pruebas de PostgreSQL cubren acceso anónimo, cuentas no autorizadas, deduplicación, períodos, retención, retiro de recetas y actualizaciones. Las pruebas del navegador cubren visitas y acciones, exclusión, privacidad, activación, filtros y pantallas pequeñas. `scripts/check_usage_statistics.py` comprueba el proyecto real sin leer eventos: exige lectura denegada y envía solo un evento inválido con identificadores nulos, que debe rechazarse sin crear una visita. `BLOSSOM_REQUIRE_USAGE_STATISTICS=1` exige que el esquema esté activado; mientras está pendiente se comunica con un aviso y se permite publicar la aplicación que facilita su instalación.
