(function (root) {
  "use strict";
  root.BlossomLab.createAnalyticsControls = function ({ onHide }) {
    const core = root.BlossomLab.analytics,
      $ = (id) => document.getElementById(id);
    let user = null,
      api = null,
      generation = 0,
      busy = false;
    let local = null;
    try {
      local = root.localStorage;
    } catch {}
    const say = (text) => {
      $("analyticsStatus").textContent = text;
    };
    function hide() {
      $("analyticsTab").hidden = true;
      $("analyticsData").hidden = true;
      $("analyticsActivation").hidden = true;
      $("analyticsSql").value = "";
      for (const name of ["visits", "visitors", "preparations", "copies"])
        $("analytics-" + name).textContent = "0";
      for (const id of [
        "analyticsRecipes",
        "analyticsSections",
        "analyticsChannels",
        "analyticsDaily",
      ])
        $(id).replaceChildren();
      onHide();
    }
    function row(values) {
      const tr = document.createElement("tr");
      for (const value of values) {
        const td = document.createElement("td");
        td.textContent = value;
        tr.append(td);
      }
      return tr;
    }
    function render(data) {
      if (
        !data ||
        !["visits", "visitors", "preparations", "copies"].every(
          (key) => Number.isSafeInteger(data[key]) && data[key] >= 0,
        ) ||
        !["recipes", "sections", "channels", "daily"].every((key) =>
          Array.isArray(data[key]),
        )
      )
        throw new Error(
          "No se pudo comprobar el resumen. Vuelve a actualizar.",
        );
      for (const name of ["visits", "visitors", "preparations", "copies"])
        $("analytics-" + name).textContent = data[name].toLocaleString("es-ES");
      $("analyticsData").hidden = false;
      $("analyticsActivation").hidden = true;
      $("analyticsSetup").hidden = true;
      $("analyticsEmpty").hidden = data.visits !== 0;
      $("analyticsRecipes").replaceChildren(
        ...data.recipes.map((item) =>
          row([item.name, item.views, item.preparations, item.copies]),
        ),
      );
      const names = {
        recipes: "Recetario",
        preparation: "Preparación",
        extraction: "Extracción",
        water: "Agua",
        instagram: "Instagram",
        direct: "Directo / sin referencia",
        other: "Otros sitios",
      };
      for (const [key, id] of [
        ["sections", "analyticsSections"],
        ["channels", "analyticsChannels"],
      ])
        $(id).replaceChildren(
          ...data[key].map((item) =>
            row([names[item.name] || "Otro", item.visits]),
          ),
        );
      $("analyticsDaily").replaceChildren(
        ...data.daily.map((item) => {
          const column = document.createElement("div"),
            bar = document.createElement("span"),
            label = document.createElement("small");
          column.className = "usage-day";
          column.title = `${item.date}: ${item.visits} visitas`;
          column.setAttribute("aria-label", column.title);
          column.setAttribute("role", "img");
          column.tabIndex = 0;
          bar.style.height =
            Math.max(
              2,
              (Number(item.visits) /
                Math.max(1, ...data.daily.map((d) => Number(d.visits)))) *
                100,
            ) + "px";
          label.textContent = item.date.slice(5);
          column.append(bar, label);
          return column;
        }),
      );
      const time = new Date(data.until);
      say(
        `Últimos ${data.days} días, incluido hoy. Fechas en UTC. Actualizado: ${Number.isNaN(time.getTime()) ? "ahora" : time.toLocaleString("es-ES")}.`,
      );
    }
    async function refresh() {
      if (!api || !user || busy) return;
      const started = generation;
      busy = true;
      $("analyticsRefresh").disabled = true;
      $("analyticsPeriod").disabled = true;
      say("Consultando las estadísticas…");
      // A failed refresh must not leave a prior period or account presented as current.
      $("analyticsData").hidden = true;
      try {
        const data = await api.catalogueRequest("statistics", {
          period_days: Number($("analyticsPeriod").value),
        });
        if (started !== generation) return;
        render(data);
      } catch (error) {
        if (started !== generation) return;
        if (error.status === 404) {
          $("analyticsSetup").hidden = false;
          say(
            "Las estadísticas están listas para activar. Copia la configuración y ejecútala una vez en SQL Editor de Supabase. Los datos comenzarán a recopilarse desde entonces.",
          );
        } else if (error.code === "42501" || error.status === 403) {
          hide();
        } else
          say(
            "No se pudieron cargar las estadísticas. Comprueba la conexión y pulsa Actualizar.",
          );
      } finally {
        if (started === generation) {
          busy = false;
          $("analyticsRefresh").disabled = false;
          $("analyticsPeriod").disabled = false;
        }
      }
    }
    $("analyticsRefresh").addEventListener("click", refresh);
    $("analyticsPeriod").addEventListener("change", refresh);
    $("analyticsExclude").addEventListener("change", () => {
      const saved = core.write(
        local,
        core.KEYS.excluded,
        String($("analyticsExclude").checked),
      );
      $("analyticsPreferenceStatus").textContent = saved
        ? "Preferencia guardada para este navegador."
        : "El navegador no permite guardar esta preferencia. Usa «Ver recetario público» para abrir una vista previa que no se cuenta.";
    });
    $("analyticsSetup").addEventListener("click", async () => {
      if (!user || busy) return;
      const started = generation,
        account = user.id;
      busy = true;
      $("analyticsSetup").disabled = true;
      try {
        const response = await fetch(core.MIGRATION, { cache: "no-store" });
        if (!response.ok) throw new Error();
        const sql = core.activationSql(await response.text(), account);
        if (started !== generation) return;
        $("analyticsSql").value = sql;
        $("analyticsActivation").hidden = false;
        try {
          await navigator.clipboard.writeText(sql);
          say(
            "Configuración copiada. En Supabase abre SQL Editor → New query, pega y pulsa Run. Después vuelve y pulsa Actualizar.",
          );
        } catch {
          $("analyticsSql").focus();
          $("analyticsSql").select();
          say(
            "Copia la configuración de abajo y ejecútala en SQL Editor de Supabase. Después vuelve y pulsa Actualizar.",
          );
        }
      } catch {
        if (started === generation)
          say("No se pudo abrir la configuración. Vuelve a intentarlo.");
      } finally {
        if (started === generation) {
          busy = false;
          $("analyticsSetup").disabled = false;
        }
      }
    });
    return {
      async connect(account, cloudApi, publisher) {
        generation++;
        user = account;
        api = cloudApi;
        busy = false;
        hide();
        if (!user || !publisher) return;
        const preferenceMissing = core.read(local, core.KEYS.excluded) == null;
        const preferenceSaved =
          !preferenceMissing || core.write(local, core.KEYS.excluded, "true");
        $("analyticsExclude").checked =
          core.read(local, core.KEYS.excluded) !== "false";
        $("analyticsTab").hidden = false;
        $("analyticsSetup").hidden = true;
        $("analyticsPreferenceStatus").textContent = preferenceSaved
          ? ""
          : "Este navegador no permite guardar la exclusión. Usa «Ver recetario público» para abrir una vista previa que no se cuenta.";
        await refresh();
      },
      disconnect() {
        generation++;
        user = null;
        api = null;
        busy = false;
        hide();
      },
    };
  };
})(globalThis);
