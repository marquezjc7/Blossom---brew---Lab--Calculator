(function () {
  "use strict";
  const { catalogue, calculations, plans, water, preparation } = BlossomLab;
  const $ = (id) => document.getElementById(id);
  const nf = (value, digits = 2) =>
    Number.isFinite(value)
      ? value.toLocaleString("es-ES", { maximumFractionDigits: digits })
      : "—";
  let usageLocal = null,
    usageSession = null;
  try {
    usageLocal = window.localStorage;
  } catch {}
  try {
    usageSession = window.sessionStorage;
  } catch {}
  const privacyPreference =
    navigator.globalPrivacyControl === true || navigator.doNotTrack === "1";
  const preview = new URL(location.href).searchParams.get("preview") === "1";
  const tracker = BlossomLab.analytics.createTracker({
    config: BlossomLab.cloudConfig,
    url: location.href,
    referrer: document.referrer,
    local: usageLocal,
    session: usageSession,
    disabled: preview || privacyPreference,
  });
  $("publicUsageExclude").checked =
    preview ||
    privacyPreference ||
    BlossomLab.analytics.read(
      usageLocal,
      BlossomLab.analytics.KEYS.excluded,
    ) === "true";
  $("publicUsageExclude").disabled = preview || privacyPreference;
  if (preview || privacyPreference)
    $("publicUsagePreference").textContent = preview
      ? "Vista previa: esta visita no se cuenta."
      : "Se respeta la preferencia de no seguimiento de tu navegador.";
  $("publicUsageExclude").addEventListener("change", () => {
    tracker.setExcluded($("publicUsageExclude").checked);
    $("publicUsagePreference").textContent = $("publicUsageExclude").checked
      ? "Este navegador queda excluido."
      : "Medición activada para las próximas consultas.";
  });
  const reference = {
    ...catalogue.publicRecipe(BlossomLab.recipes[0]),
    id: "reference-bourbon-lavado",
  };
  let recipes = [reference],
    selected = reference,
    current = null,
    draft = null,
    loading = false,
    initialized = false;
  let reader = null;
  try {
    reader = catalogue.createReader({ config: BlossomLab.cloudConfig });
  } catch {
    /* Show the bundled reference. */
  }
  function notice(id, message, error = false) {
    $(id).textContent = message;
    $(id).hidden = !message;
    $(id).classList.toggle("error", error);
  }
  function tab(name) {
    const names = {
      recipes: "publicRecipes",
      preparation: "publicPreparation",
      extraction: "publicExtraction",
      water: "publicWater",
    };
    if (!names[name]) return;
    tracker.track("section", name);
    for (const button of document.querySelectorAll(".tabs [data-public-tab]")) {
      const active = button.dataset.publicTab === name;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    for (const panel of document.querySelectorAll(".panel"))
      panel.classList.toggle("active", panel.id === names[name]);
  }
  function activeBrew() {
    return draft && ["running", "paused"].includes(draft.phase);
  }
  function selectRecipe(recipe) {
    selected = recipe;
    $("publicPreset").value = recipe.id;
    $("publicDose").value = recipe.dose;
    $("publicRatio").value = recipe.water / recipe.dose;
    $("publicRecipeName").textContent = recipe.name;
    $("publicCardName").textContent = recipe.name;
    const facts = [
      ["Café / lote", recipe.coffee],
      ["Método", recipe.method],
      ["Molino", recipe.grinder || "Sin especificar"],
      ["Ajuste del molino", recipe.grind || "Sin especificar"],
      [
        "Grosor de molienda",
        [
          recipe.grindSize,
          recipe.grindMicrons ? `${nf(recipe.grindMicrons)} µm` : "",
        ]
          .filter(Boolean)
          .join(" · ") || "Sin especificar",
      ],
      [
        "Bloom",
        recipe.bloom == null ? "Sin registrar" : `${nf(recipe.bloom, 0)} s`,
      ],
      ["Tiempo objetivo", recipe.time || "Sin registrar"],
    ];
    $("publicRecipeFacts").replaceChildren(
      ...facts.map(([label, value]) => {
        const row = document.createElement("div"),
          term = document.createElement("dt"),
          detail = document.createElement("dd");
        term.textContent = label;
        detail.textContent = value;
        row.append(term, detail);
        return row;
      }),
    );
    $("publicTemperatures").replaceChildren(
      ...[recipe.temp, recipe.temp2]
        .filter((value) => value != null)
        .map((value, index) => {
          const temperature = document.createElement("span");
          temperature.textContent = `T${index + 1} ${nf(value)} °C`;
          return temperature;
        }),
    );
    const profile = recipe.waterProfile;
    $("publicWaterSummary").textContent = profile
      ? `${profile.name} · GH ≈ ${nf(profile.gh)} · Alcalinidad ≈ ${nf(profile.alkalinity)} ppm como CaCO₃`
      : "Sin perfil de agua registrado.";
    $("publicWaterDetails").hidden = !profile;
    $("publicWaterDetails").open = false;
    $("publicWaterRecipe").textContent = profile
      ? water.recipeText(profile)
      : "";
    const forLab =
      profile || water.makeProfile({ ...water.references[1], liters: 1 });
    $("guestWaterGh").value = forLab.gh;
    $("guestWaterAlkalinity").value = forLab.alkalinity;
    $("guestWaterLiters").value = forLab.liters;
    $("guestWaterPreset").value = profile ? "custom" : water.references[1].id;
    notice("publicRecipeFeedback", "");
    $("publicCopyText").hidden = true;
    renderRecipe();
    renderWater();
    tracker.track("recipe", recipe.id);
  }
  function renderRecipe() {
    const dose = $("publicDose").valueAsNumber,
      ratio = $("publicRatio").valueAsNumber;
    const total = calculations.calculateWater(dose, ratio);
    const valid =
      Number.isFinite(dose) &&
      dose > 0 &&
      dose <= 1000 &&
      Number.isFinite(ratio) &&
      ratio >= 1 &&
      ratio <= 100 &&
      total <= 20000;
    current = valid
      ? {
          ...selected,
          dose,
          ratio,
          water: total,
          ...plans.snapshotPlan(selected, total),
        }
      : null;
    $("publicDoseOut").textContent = valid ? nf(dose) : "—";
    $("publicWaterOut").textContent = valid ? nf(total) : "—";
    $("publicRatioOut").textContent = valid ? `1:${nf(ratio)}` : "—";
    $("publicPours").replaceChildren();
    if (!valid) {
      $("publicPourNote").textContent =
        "Introduce una dosis y un ratio válidos.";
      draft = null;
      renderBrew();
      return;
    }
    if (current.pours) {
      const rows = calculations.scalePours(
        selected.pours,
        selected.water,
        total,
      );
      for (let index = 0; index < rows.length; index++) {
        const row = document.createElement("tr"),
          label = document.createElement("th");
        label.scope = "row";
        label.textContent = index === 0 ? "Bloom" : `Vertido ${index}`;
        const time = plans.formatTime(selected.pourTimes?.[index]);
        if (time) {
          const small = document.createElement("small");
          small.textContent = `Inicio ${time}`;
          label.append(small);
        }
        row.append(label);
        for (const value of [
          `+${nf(rows[index].incremental)} g`,
          `${nf(rows[index].cumulative)} g`,
        ]) {
          const cell = document.createElement("td");
          cell.textContent = value;
          row.append(cell);
        }
        $("publicPours").append(row);
        if (current.pourSteps?.[index]) {
          const instructionRow = document.createElement("tr"),
            cell = document.createElement("td");
          instructionRow.className = "pour-instruction-row";
          cell.colSpan = 3;
          cell.className = "pour-instructions";
          cell.textContent = plans.pourStepText(current, index);
          instructionRow.append(cell);
          $("publicPours").append(instructionRow);
        }
      }
      $("publicPourNote").textContent =
        "Los pesos se adaptan a tu dosis; los tiempos e indicaciones se conservan." +
        (current.pourSteps ? "" : " Válvula: Sin especificar.");
    } else
      $("publicPourNote").textContent = current.bloomWater
        ? `Bloom: ${nf(current.bloomWater)} g. Los vertidos posteriores no están documentados.`
        : "Esta receta no tiene un plan de vertidos documentado.";
    $("guestEyDose").value = dose;
    renderEy();
    resetBrew();
  }
  function resetBrew() {
    draft = null;
    $("guestStepTemps").replaceChildren();
    $("guestBrewPlan").replaceChildren();
    if (current?.pours) {
      try {
        draft = preparation.createDraft(
          current,
          selected.name,
          "guest-preparation",
        );
      } catch (error) {
        notice("guestBrewMessage", error.message, true);
      }
    }
    if (draft)
      for (let i = 0; i < current.pours.length; i++) {
        const label = i === 0 ? "Bloom" : `Vertido ${i}`;
        const row = document.createElement("p");
        row.className = "step";
        row.textContent = `${label} · +${nf(current.pours[i] - (current.pours[i - 1] || 0))} g · Hasta ${nf(current.pours[i])} g`;
        const instruction = document.createElement("span");
        instruction.className = "pour-instructions";
        instruction.textContent = plans.pourStepText(current, i);
        row.append(instruction);
        row.classList.add("public-brew-step");
        $("guestBrewPlan").append(row);
        if (current.temp2 != null) {
          const field = document.createElement("div"),
            caption = document.createElement("label"),
            selector = document.createElement("select");
          field.className = "field";
          selector.id = "guestTemp" + i;
          caption.htmlFor = selector.id;
          caption.textContent = `Temperatura de ${label.toLowerCase()}`;
          for (const [value, text] of [
            ["", "Elige una temperatura"],
            [current.temp, `T1 · ${nf(current.temp)} °C`],
            [current.temp2, `T2 · ${nf(current.temp2)} °C`],
          ]) {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = text;
            selector.append(option);
          }
          selector.addEventListener("change", () => {
            if (draft?.phase === "ready")
              draft.temperatures[i] =
                selector.value === "" ? null : Number(selector.value);
          });
          field.append(caption, selector);
          $("guestStepTemps").append(field);
        }
      }
    renderBrew();
  }
  function renderBrew() {
    const phase = draft?.phase;
    const running = phase === "running",
      paused = phase === "paused",
      ready = phase === "ready";
    for (const id of [
      "publicPreset",
      "publicDose",
      "publicRatio",
      "restorePublicRecipe",
    ])
      $(id).disabled = activeBrew();
    $("reloadCatalogue").disabled = loading || activeBrew();
    $("guestBrewName").textContent = selected.name;
    $("guestBrewTarget").textContent = current
      ? `${nf(current.dose)} g de café · ${nf(current.water)} g de agua · Tiempo objetivo ${current.time || "sin registrar"}`
      : "Revisa las cantidades en Recetas.";
    $("guestBrewClock").textContent = plans.formatTime(
      draft ? Math.min(59999, preparation.elapsedSeconds(draft)) : 0,
    );
    $("guestBrewStart").hidden = !ready;
    $("guestBrewPause").hidden = !running;
    $("guestBrewResume").hidden = !paused;
    $("guestBrewNext").hidden =
      !running || draft.index >= draft.recipe.pours.length - 1;
    $("guestBrewFinish").hidden =
      !running || draft.index !== draft.recipe.pours.length - 1;
    for (const selector of $("guestStepTemps").querySelectorAll("select"))
      selector.disabled = !ready;
    notice(
      "guestBrewMessage",
      !draft
        ? "Esta receta necesita un plan completo de vertidos para utilizar la guía."
        : ready
          ? "Prepara la balanza. Elige la temperatura de cada paso si la receta utiliza dos."
          : paused
            ? "Preparación pausada. Puedes reanudarla cuando estés listo."
            : phase === "review"
              ? `Preparación terminada en ${plans.formatTime(preparation.elapsedSeconds(draft))}.`
              : "Confirma el siguiente vertido cuando lo comiences.",
    );
    const index = draft?.index || 0,
      cumulative = draft?.recipe.pours[index];
    $("guestBrewAmount").textContent = draft
      ? `${index === 0 ? "Bloom" : `Vertido ${index}`} · Añade ${nf(cumulative - (draft.recipe.pours[index - 1] || 0))} g`
      : "Sin plan completo";
    $("guestBrewCumulative").textContent = draft
      ? `Hasta ${nf(cumulative)} g acumulados en la balanza.`
      : "Consulta los parámetros disponibles en Recetas.";
    $("guestBrewTemperature").textContent =
      draft?.temperatures[index] != null
        ? `Agua a ${nf(draft.temperatures[index])} °C`
        : "";
    $("guestBrewInstruction").textContent = draft
      ? plans.pourStepText(draft.recipe, index)
      : "";
  }
  function renderEy() {
    const result = calculations.calculateExtraction(
      $("guestEyDose").valueAsNumber,
      $("guestEyCup").valueAsNumber,
      $("guestEyTds").valueAsNumber,
    );
    $("guestEyResult").textContent = result
      ? `${nf(result.yieldPercent)} %`
      : "— %";
    notice(
      "guestEyStatus",
      result
        ? `Sólidos disueltos en taza: ${nf(result.dissolvedSolids)} g.`
        : "Introduce una dosis, bebida obtenida y TDS válidos.",
    );
  }
  function renderWater() {
    try {
      const profile = water.makeProfile({
        name: "Mezcla de agua",
        gh: $("guestWaterGh").valueAsNumber,
        alkalinity: $("guestWaterAlkalinity").valueAsNumber,
        liters: $("guestWaterLiters").valueAsNumber,
      });
      $("guestWaterAmounts").textContent = water.recipeText(profile);
      notice("guestWaterStatus", "");
    } catch (error) {
      $("guestWaterAmounts").textContent = "";
      notice("guestWaterStatus", error.message, true);
    }
  }
  async function reload() {
    if (loading || activeBrew()) return;
    loading = true;
    $("reloadCatalogue").disabled = true;
    let published = [];
    notice("catalogueStatus", "Cargando las recetas publicadas…");
    try {
      if (reader) published = await reader.list();
      notice(
        "catalogueStatus",
        published.length
          ? `${published.length} ${published.length === 1 ? "receta publicada" : "recetas publicadas"} por Blossom. No necesitas una cuenta para consultarlas y prepararlas.`
          : "Aún no hay recetas publicadas. Puedes explorar la receta de referencia de Blossom.",
      );
    } catch (error) {
      notice(
        "catalogueStatus",
        error.message +
          " Puedes explorar la receta de referencia mientras tanto.",
        true,
      );
    }
    recipes = [...published, reference];
    $("publicPreset").replaceChildren(
      ...recipes.map((recipe) => {
        const option = document.createElement("option");
        option.value = recipe.id;
        option.textContent =
          recipe.name + (recipe.id === reference.id ? " · Referencia" : "");
        return option;
      }),
    );
    const requested = new URL(location.href).searchParams.get("receta");
    selectRecipe(
      recipes.find((recipe) => recipe.id === requested) ||
        (initialized && recipes.find((recipe) => recipe.id === selected.id)) ||
        recipes[0],
    );
    initialized = true;
    loading = false;
    $("reloadCatalogue").disabled = false;
  }
  for (const element of document.querySelectorAll("[data-public-tab]"))
    element.addEventListener("click", (event) => {
      event.preventDefault();
      tab(element.dataset.publicTab);
      $("recetario").scrollIntoView({ block: "start" });
    });
  $("publicPreset").addEventListener("change", () =>
    selectRecipe(
      recipes.find((recipe) => recipe.id === $("publicPreset").value) ||
        reference,
    ),
  );
  for (const id of ["publicDose", "publicRatio"])
    $(id).addEventListener("input", renderRecipe);
  $("restorePublicRecipe").addEventListener("click", () =>
    selectRecipe(selected),
  );
  $("openPublicPreparation").addEventListener("click", () => {
    tab("preparation");
    $("recetario").scrollIntoView({ block: "start" });
  });
  for (const [id, action] of [
    ["guestBrewStart", "start"],
    ["guestBrewPause", "pause"],
    ["guestBrewResume", "resume"],
    ["guestBrewNext", "advance"],
    ["guestBrewFinish", "finish"],
  ])
    $(id).addEventListener("click", () => {
      if (!draft) return;
      try {
        draft = preparation[action](draft);
        if (action === "start") tracker.track("prepare", selected.id);
        renderBrew();
      } catch (error) {
        notice("guestBrewMessage", error.message, true);
      }
    });
  $("guestBrewReset").addEventListener("click", resetBrew);
  setInterval(() => {
    if (draft?.phase === "running")
      $("guestBrewClock").textContent = plans.formatTime(
        Math.min(59999, preparation.elapsedSeconds(draft)),
      );
  }, 250);
  for (const id of ["guestEyDose", "guestEyCup", "guestEyTds"])
    $(id).addEventListener("input", renderEy);
  for (const ref of water.references) {
    const option = document.createElement("option");
    option.value = ref.id;
    option.textContent = ref.name;
    $("guestWaterPreset").append(option);
  }
  const customOption = document.createElement("option");
  customOption.value = "custom";
  customOption.textContent = "Personalizada / agua de la receta";
  $("guestWaterPreset").append(customOption);
  $("guestWaterPreset").addEventListener("change", () => {
    const ref = water.references.find(
      (ref) => ref.id === $("guestWaterPreset").value,
    );
    if (ref) {
      $("guestWaterGh").value = ref.gh;
      $("guestWaterAlkalinity").value = ref.alkalinity;
    }
    renderWater();
  });
  for (const id of ["guestWaterGh", "guestWaterAlkalinity", "guestWaterLiters"])
    $(id).addEventListener("input", () => {
      $("guestWaterPreset").value = "custom";
      renderWater();
    });
  $("reloadCatalogue").addEventListener("click", reload);
  $("copyPublicRecipe").addEventListener("click", async () => {
    if (!current)
      return notice(
        "publicRecipeFeedback",
        "Revisa las cantidades antes de copiar.",
        true,
      );
    const text =
      `Blossom · ${selected.name}\n${selected.coffee} · ${selected.method}\nDosis: ${nf(current.dose)} g · Agua: ${nf(current.water)} g · Ratio 1:${nf(current.ratio)}\n` +
      `Temperatura 1: ${nf(current.temp)} °C${current.temp2 == null ? "" : ` · Temperatura 2: ${nf(current.temp2)} °C`}\n` +
      (current.pours
        ? current.pours
            .map(
              (value, index) =>
                `${index === 0 ? "Bloom" : `Vertido ${index}`}: añade ${nf(value - (current.pours[index - 1] || 0))} g, hasta ${nf(value)} g acumulados${plans.formatTime(current.pourTimes?.[index]) ? ` · Inicio ${plans.formatTime(current.pourTimes[index])}` : ""}\n${plans.pourStepText(current, index)}`,
            )
            .join("\n")
        : $("publicPourNote").textContent) +
      `\nAgua: ${$("publicWaterSummary").textContent}`;
    try {
      await navigator.clipboard.writeText(text);
      tracker.track("copy", selected.id);
      notice("publicRecipeFeedback", "Preparación copiada.");
    } catch {
      $("publicCopyText").value = text;
      $("publicCopyText").hidden = false;
      $("publicCopyText").focus();
      $("publicCopyText").select();
      notice(
        "publicRecipeFeedback",
        "Selecciona y copia el texto de tu preparación.",
      );
    }
  });
  tracker.track("section", "recipes");
  reload();
})();
