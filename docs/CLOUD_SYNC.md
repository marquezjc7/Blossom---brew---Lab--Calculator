# Sincronización de Blossom Brew Lab

El código está preparado para Supabase Auth y PostgreSQL. **No se activa hasta conectar un proyecto de Supabase y publicar su configuración.** GitHub Pages continúa entregando los archivos de la aplicación; las recetas privadas se guardan en el proyecto de datos, separadas por cuenta.

La V1.9.0 añade una publicación opcional y separada de recetas. El [recetario público](PUBLIC_RECIPES.md) utiliza copias elegidas por una cuenta autorizada; no cambia los permisos de los registros privados ni expone la bitácora.

## Activación inicial del propietario

1. Crear o elegir un proyecto de Supabase de la cuenta del propietario. No hace falta cambiar el alojamiento de GitHub Pages.
2. En el SQL Editor del proyecto, ejecutar [la migración](../supabase/migrations/202611010001_cloud_sync.sql). Incluye las tablas, los permisos por cuenta y la función que recibe los cambios. Puede ejecutarse de nuevo sin borrar recetas.
3. En Authentication → URL Configuration, usar como Site URL y Redirect URL permitida la dirección exacta: `https://marquezjc7.github.io/Blossom---brew---Lab--Calculator/`.
4. Habilitar el acceso mediante enlaces por correo. Verificar la entrega de un enlace a la cuenta del propietario. El servicio de correo de prueba de Supabase tiene restricciones; para atender otros usuarios debe configurarse un remitente SMTP autorizado.
5. Obtener la dirección del proyecto y su clave **publishable** (o la clave antigua **anon**). Son valores públicos de conexión. Nunca usar `service_role`, una clave `sb_secret_`, una contraseña de PostgreSQL ni un token de administración en la aplicación.
6. En GitHub → Settings → Secrets and variables → Actions → Variables, configurar `BLOSSOM_SUPABASE_URL` y `BLOSSOM_SUPABASE_PUBLISHABLE_KEY`. Publicar la versión que contiene esta integración. El constructor rechaza claves de servidor y configuraciones incompletas.
7. Comprobar el acceso real por correo y el recorrido entre computadora y teléfono antes de dar la sincronización por activada. Las pruebas locales con un servicio simulado no reemplazan esta comprobación del proyecto real.

Solo hace falta realizar esta conexión una vez. No hay credenciales de servidor en el repositorio ni en el navegador. El esquema de respaldo y las claves de almacenamiento local de versiones anteriores se conservan.

Antes de publicar, GitHub Actions exige las dos variables y comprueba el proyecto real: Auth accesible, correo y registro habilitados, y acceso anónimo denegado tanto a `blossom_records` como a `blossom_sync`. Estas comprobaciones no envían correos ni leen recetas. Tras desplegar, también comprueba que la página muestra V1.5 y que su configuración pública coincide con las variables del proyecto. El primer acceso por correo del propietario sigue siendo necesario para incorporar los datos guardados en su navegador.

## Uso en la aplicación

En la computadora y el navegador donde ya están las recetas, escribir el correo en «Tus recetas, en tus dispositivos», solicitar el enlace y abrirlo en ese mismo navegador. Las recetas personales y la bitácora locales se incorporan automáticamente a la cuenta. Entrar con el mismo correo en el teléfono para recibirlas. No se requiere exportar ni importar JSON para ese traslado.

El estado distingue sincronización completada, cambios pendientes, edición en curso y fallos de conexión. Guardar una receta sigue funcionando sin conexión: se conserva un lote local y se vuelve a intentar al recuperar la conexión, volver a la pestaña o durante la comprobación periódica de 15 segundos mientras la página está visible. Una página cerrada no ejecuta tareas de fondo; los cambios se reciben al abrirla otra vez.

### Acceso con contraseña

Desde una computadora que ya tiene sesión iniciada, abrir «Configurar o cambiar contraseña», escribir una contraseña nueva de al menos 12 caracteres, repetirla y pulsar «Guardar contraseña». En otro dispositivo, abrir «Entrar con contraseña» y usar el mismo correo y esa contraseña. Este acceso utiliza el endpoint de contraseña de Supabase y no solicita un correo de acceso. No crea una cuenta diferente ni cambia las recetas.

La contraseña se envía por HTTPS al servicio de autenticación y no se guarda en `localStorage`, en las tablas de recetas ni en los respaldos. La aplicación verifica la identidad antes de conectar la sincronización. Si Supabase requiere una autenticación reciente para cambiar la contraseña, muestra esa condición y conserva los datos locales.

### Límites de correo

El servicio de correo de prueba de Supabase impone una cuota por proyecto y esperas entre solicitudes. La aplicación distingue `over_email_send_rate_limit` de otras respuestas 429 y respeta `Retry-After` cuando está disponible. Bloquea nuevos envíos durante la espera y conserva ese bloqueo al recargar. Si el servidor no indica un plazo, aplica una espera conservadora de una hora para la cuota de correo o de 60 segundos para otras limitaciones; tras un envío correcto espera 60 segundos antes de permitir otro. El contador indica cuándo se permite otro intento local, sin garantizar que se haya renovado la cuota del proveedor. No se reintentan envíos automáticamente.

El límite de correo no bloquea el formulario de contraseña. Para usar enlaces por correo con más usuarios o mayor frecuencia, configurar un SMTP propio según [la documentación de Supabase](https://supabase.com/docs/guides/auth/auth-smtp). La aplicación no cambia las cuotas del proyecto.

Las ediciones que aún no se han guardado y el editor de vertidos detienen la aplicación de cambios remotos hasta guardar o cancelar. Si dos dispositivos cambian el mismo registro, se conservan ambas versiones; las recetas en conflicto se identifican con «copia conservada». Un borrado antiguo no elimina una edición nueva de otro dispositivo. Los borrados guardan una marca en la nube para evitar que una copia antigua reaparezca al reconectar.

Cerrar sesión conserva las recetas locales y retira el acceso a la nube de ese navegador. El navegador recuerda a qué cuenta pertenecen sus datos: no los sube automáticamente a una cuenta distinta. El respaldo JSON sigue disponible y contiene solo recetas y sesiones, sin tokens de acceso.

## Verificación técnica

- Pruebas de autenticación, renovación, claves públicas y cambio de cuenta.
- Pruebas del motor de sincronización con pérdida de conexión, reintentos, ediciones simultáneas y fallos de almacenamiento.
- Ejecución de la migración en PostgreSQL embebido con PGlite: permisos de usuario/anónimo, aislamiento entre cuentas, versiones, copias de conflictos y transacciones.
- Recorridos de dos perfiles de navegador con el contrato HTTP simulado, incluidos edición, borrado, recuperación tras recargar sin conexión y cierre de sesión.
- Pruebas de configuración de la publicación que evitan incluir claves de servidor.
