(function (root) {
  "use strict";
  root.BlossomLab.createPublishingControls = function ({
    getRecipe,
    isDirty,
    sync,
  }) {
    const $ = (id) => document.getElementById(id);
    const core = root.BlossomLab.catalogue;
    let user = null,
      api = null,
      generation = 0,
      busy = false,
      state = "loading",
      message = "";
    let entries = new Map();
    const publicUrl = new URL("recetario/", location.href).href;
    $("publicCatalogueLink").href = publicUrl;
    function render() {
      $("publicationPanel").hidden = !user;
      if (!user) return;
      const recipe = getRecipe();
      const entry = entries.get(recipe?.id);
      const ready = state === "ready";
      $("publishRecipe").hidden = !ready;
      $("withdrawRecipe").hidden = !ready || !entry?.published;
      $("publishRecipe").disabled = busy || !recipe || isDirty();
      $("withdrawRecipe").disabled = busy || !recipe;
      $("refreshPublication").disabled = busy;
      $("prepareCatalogueSql").hidden = !["missing", "denied"].includes(state);
      $("prepareCatalogueSql").disabled = busy;
      $("publishRecipe").textContent = entry?.published
        ? "Actualizar publicación"
        : "Publicar en el recetario";
      $("publicationStatus").textContent =
        message ||
        (state === "loading"
          ? "Comprobando el recetario público…"
          : state === "missing"
            ? "Activa el recetario en Supabase una sola vez para poder publicar."
            : state === "denied"
              ? "Esta cuenta no está autorizada para publicar. La autorización se configura desde la cuenta administradora de Supabase."
              : !recipe
                ? "Guarda una copia personal de la receta antes de publicarla."
                : isDirty()
                  ? "Guarda los cambios de esta receta antes de publicar. La versión pública se conserva hasta que la actualices."
                  : entry?.published
                    ? "Esta receta está publicada. Sus cambios se comparten al pulsar «Actualizar publicación»."
                    : "Esta receta es privada. Puedes publicar sus parámetros, vertidos y agua para que otras personas la utilicen.");
    }
    async function refresh() {
      if (!user || busy) return;
      const started = generation;
      busy = true;
      message = "";
      render();
      try {
        const result = await api.catalogueRequest("status");
        if (started !== generation) return;
        if (
          typeof result?.publisher !== "boolean" ||
          !Array.isArray(result.entries)
        )
          throw new Error("No se pudo comprobar el estado del recetario.");
        entries = new Map(
          result.entries.map((entry) => [entry.source_id, entry]),
        );
        state = result.publisher ? "ready" : "denied";
        if (result.publisher) {
          $("catalogueActivation").hidden = true;
          $("catalogueSql").value = "";
        }
      } catch (error) {
        if (started !== generation) return;
        state = error.status === 404 ? "missing" : "error";
        if (state === "error") message = error.message;
      } finally {
        if (started === generation) {
          busy = false;
          render();
        }
      }
    }
    async function change(action) {
      if (!user || busy || state !== "ready") return;
      const recipe = getRecipe();
      if (!recipe || (action === "publish" && isDirty())) return;
      const source = JSON.parse(JSON.stringify(recipe));
      if (action === "publish") {
        try {
          core.publicRecipe(source);
        } catch (error) {
          message = error.message;
          render();
          return;
        }
      }
      const started = generation;
      const revision = entries.get(source.id)?.revision ?? 0;
      busy = true;
      message =
        action === "publish"
          ? "Sincronizando la receta antes de publicarla…"
          : "Retirando la receta del recetario público…";
      render();
      try {
        if (action === "publish") await sync();
        if (started !== generation) return;
        if (
          getRecipe()?.id !== source.id ||
          (action === "publish" && isDirty())
        )
          throw new Error(
            "La selección o la receta cambió. Revisa los cambios antes de publicar.",
          );
        const body = { recipe_id: source.id, expected_revision: revision };
        if (action === "publish") body.expected_recipe = source;
        const result = await api.catalogueRequest(action, body);
        if (started !== generation) return;
        if (
          result?.source_id !== source.id ||
          !Number.isInteger(result.revision) ||
          typeof result.published !== "boolean"
        )
          throw new Error(
            "No se pudo confirmar el cambio. Actualiza el estado del recetario antes de volver a intentarlo.",
          );
        entries.set(source.id, result);
        message =
          action === "publish"
            ? `Receta publicada: «${source.name}». Ya puede consultarse sin iniciar sesión desde el enlace del recetario.`
            : `Receta «${source.name}» retirada del recetario público. Tu receta personal se conserva.`;
      } catch (error) {
        if (started === generation) message = error.message;
      } finally {
        if (started === generation) {
          busy = false;
          render();
        }
      }
    }
    $("publishRecipe").addEventListener("click", () => change("publish"));
    $("withdrawRecipe").addEventListener("click", () => change("withdraw"));
    $("refreshPublication").addEventListener("click", refresh);
    $("prepareCatalogueSql").addEventListener("click", async () => {
      if (!user || busy) return;
      const started = generation,
        account = user.id;
      busy = true;
      render();
      try {
        const response = await fetch(core.MIGRATION, { cache: "no-store" });
        if (!response.ok)
          throw new Error(
            "No se pudo abrir la configuración. Vuelve a intentarlo.",
          );
        const sql = core.activationSql(await response.text(), account);
        if (started !== generation) return;
        $("catalogueSql").value = sql;
        $("catalogueActivation").hidden = false;
        try {
          await navigator.clipboard.writeText(sql);
          message =
            "Configuración copiada. Pégala en SQL Editor de tu proyecto de Supabase y pulsa Run. Después vuelve y pulsa «Actualizar estado».";
        } catch {
          $("catalogueSql").focus();
          $("catalogueSql").select();
          message =
            "Selecciona y copia la configuración que aparece abajo. Pégala en SQL Editor de Supabase y pulsa Run. Después vuelve y pulsa «Actualizar estado».";
        }
      } catch (error) {
        if (started === generation) message = error.message;
      } finally {
        if (started === generation) {
          busy = false;
          render();
        }
      }
    });
    $("copyPublicCatalogue").addEventListener("click", async () => {
      $("publicCatalogueUrl").value = publicUrl;
      $("publicCatalogueUrl").hidden = false;
      try {
        await navigator.clipboard.writeText(publicUrl);
        message =
          "Enlace del recetario copiado. Puedes usarlo en los enlaces de tu perfil de Instagram.";
      } catch {
        $("publicCatalogueUrl").focus();
        $("publicCatalogueUrl").select();
        message =
          "Copia el enlace que aparece abajo para compartir el recetario.";
      }
      render();
    });
    return {
      render,
      refresh,
      async connect(account, cloudApi) {
        generation++;
        user = account;
        api = cloudApi;
        state = "loading";
        entries = new Map();
        busy = false;
        $("catalogueActivation").hidden = true;
        $("catalogueSql").value = "";
        await refresh();
      },
      disconnect() {
        generation++;
        user = null;
        api = null;
        busy = false;
        entries = new Map();
        message = "";
        $("catalogueActivation").hidden = true;
        $("catalogueSql").value = "";
        render();
      },
    };
  };
})(globalThis);
