# Recetario público de Blossom

El enlace para Instagram es `https://marquezjc7.github.io/Blossom---brew---Lab--Calculator/recetario/`.

Los visitantes entran sin cuenta. Pueden consultar las recetas publicadas, adaptar dosis y ratio, copiar la preparación y utilizar preparación guiada, extracción y agua. Los ajustes y el cronómetro permanecen en memoria mientras la página está abierta. Esta vista no carga almacenamiento, sincronización ni bitácora, no utiliza la sesión guardada del propietario y solo llama al servicio anónimo de lectura. La referencia Bourbon Lavado se incluye y se identifica como referencia; no representa una receta personal compartida automáticamente.

## Activación una sola vez

La clave pública existente permite consultar y utilizar las funciones autorizadas, pero no administrar el esquema de Supabase. Esta versión incluye una ampliación independiente de la sincronización privada; debe ejecutarla el administrador del proyecto desde SQL Editor.

1. Abrir la aplicación habitual y entrar con la cuenta que administrará las publicaciones.
2. En Recetas, buscar «Comparte tu receta». Pulsar **Copiar configuración de Supabase**. Si el navegador impide el portapapeles, seleccionar y copiar el texto mostrado.
3. Abrir el proyecto de Supabase → **SQL Editor → New query**, pegar la configuración y pulsar **Run**.
4. Volver a Blossom y pulsar **Actualizar estado**.

La configuración combina [la migración base](../supabase/migrations/202611110001_public_catalogue.sql), [la ampliación de indicaciones](../supabase/migrations/202611110002_pour_steps.sql) y una autorización para el UUID de la cuenta verificada. No incluye su correo, tokens ni contraseñas. Solo se ejecuta con acceso administrador a Supabase; la aplicación no puede conceder el permiso por sí misma. La migración no autoriza cuentas automáticamente y puede repetirse sin borrar registros existentes.

Mientras no se ejecute, la aplicación conserva sus recetas y sincronización privadas. La página pública comunica que el recetario está en preparación y permite explorar solamente la referencia incluida.

## Actualización de válvulas e indicaciones (V1.10.0)

Si el recetario ya está activado, las recetas privadas admiten los nuevos campos inmediatamente. Para compartirlos, pulsa **Copiar configuración de Supabase**, pega el texto completo en **SQL Editor → New query → Run** y vuelve a **Actualizar estado**. Esta ampliación conserva las recetas, publicaciones y cuentas autorizadas. La aplicación detecta la capacidad del servidor y bloquea la publicación de indicaciones hasta actualizar, evitando compartir un plan incompleto sin aviso. No hace falta repetir la conexión ni configurar el login.

Las copias públicas anteriores conservan su contenido. Después de guardar la válvula y las indicaciones de una receta, pulsa **Actualizar publicación** para compartirlas. El servidor permite únicamente `valve` y `note` dentro de cada paso; campos adicionales permanecen privados. Las recetas sin ese dato muestran «Sin especificar», sin deducir válvulas por método. La ampliación real queda pendiente de ejecución por el administrador; las pruebas de PostgreSQL y navegador verifican la instalación y la transición desde el esquema anterior.

## Elegir qué compartir

1. Guardar o seleccionar una receta personal. Si se está utilizando una referencia, guardar primero una copia con nombre.
2. Guardar las modificaciones pendientes y esperar la sincronización.
3. Pulsar **Publicar en el recetario** en «Comparte tu receta».
4. Abrir **Ver recetario público** para comprobarla sin depender del login.
5. Pulsar **Copiar enlace para Instagram** y usar ese enlace en el perfil de Instagram.

Se publican nombre, café, método, cantidades, temperaturas, molienda, bloom, tiempos, vertidos, válvula e indicaciones por paso y perfil de agua. Las notas personales, evaluaciones, sesiones, identificadores de cuenta y campos desconocidos se excluyen en el servidor mediante una lista explícita de campos. El agua se proyecta también por campos permitidos.

Una modificación privada guardada no altera la copia pública. **Actualizar publicación** reemplaza esa copia de forma explícita. **Retirar del recetario** elimina su visibilidad y conserva la receta personal. Borrar y sincronizar la receta personal también retira su publicación. La bitácora anterior se conserva.

## Permisos y versiones

- `blossom_publishers` autoriza cuentas explícitas; los clientes anónimos y autenticados no pueden asignarse ese permiso.
- `blossom_publications` conserva una copia pública y una revisión por receta. No tiene permisos directos de lectura o escritura para clientes.
- `blossom_public_catalogue()` expone únicamente recetas elegidas, mediante lectura anónima. No expone propietarios ni identificadores privados.
- Las funciones de estado, publicación y retirada requieren una sesión. El servidor comprueba además que la cuenta tenga autorización y que la receta le pertenezca.
- Publicar exige que la copia privada esperada coincida con la receta sincronizada. Publicar o retirar exige la revisión pública vigente; una pestaña antigua no puede sobrescribir ni resucitar una publicación retirada.
- Revocar una cuenta de `blossom_publishers` retira inmediatamente del servicio de lectura sus publicaciones.
- El esquema privado, los respaldos V1 y los datos locales anteriores no cambian.

## Verificación

`npm test` verifica las reglas en PostgreSQL embebido, aislamiento entre cuentas, notas excluidas, revisión, retirada y borrado. Las pruebas de navegador cubren la publicación real contra el servicio simulado, el lector sin cuenta ni acceso al almacenamiento privado, los ajustes temporales, la preparación con dos temperaturas y la configuración de activación.

`scripts/check_public_catalogue.py` comprueba el servicio real sin cuenta y no imprime recetas ni credenciales. Si la función de lectura todavía no existe, informa de activación pendiente; cualquier fallo distinto o un permiso de escritura anónimo inesperado detiene la comprobación. Con `BLOSSOM_REQUIRE_PUBLIC_CATALOGUE=1` también se exige que el recetario esté activado. `BLOSSOM_REQUIRE_POUR_STEPS=1` exige además la ampliación de indicaciones; mientras está pendiente, la comprobación lo comunica sin bloquear la publicación de la aplicación que ofrece la configuración para instalarla.

La publicación de Pages verifica la dirección pública, su versión y el archivo de configuración. La activación del esquema y una publicación elegida por el propietario deben confirmarse en el proyecto real antes de dar el recetario personal por habilitado.
