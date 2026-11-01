(function () {
  "use strict";
  const {
    calculateRatio,
    calculateWater,
    calculateExtraction,
    scalePours,
    isPositive: valid,
  } = BlossomLab.calculations;
  const { createBackup, parseBackup, sessionsToCsv } = BlossomLab.transfers;
  const {
    formatTime,
    validatePlan,
    snapshotPlan,
    getPourCount,
    validatePourCount,
  } = BlossomLab.plans;
  const {
    RECIPE_KEY: STORAGE_R,
    SESSION_KEY: STORAGE_S,
    SELECTED_RECIPE_KEY,
    createStore,
  } = BlossomLab.storage;
  const store = createStore();
  const defaults = BlossomLab.recipes;
  const builtInGrinders = ["Comandante C40", "Mazzer Philos I200D"];

  const $ = (id) => document.getElementById(id);
  const nf = (n, d = 1) =>
    Number.isFinite(n)
      ? Number(n.toFixed(d)).toLocaleString("es-ES", {
          maximumFractionDigits: d,
        })
      : "—";
  const escapeHtml = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );

  let customRecipes = [],
    sessions = [],
    selected = defaults[0],
    planReference = defaults[0],
    recipeDirty = false,
    pendingRecipeBackup = null,
    deletionTarget = null;
  const editor = BlossomLab.createPourEditor({
    getRecipe: current,
    onDraftChange() {
      clearRecipeFeedback();
      updateRecipeStatus();
    },
    onApply(plan) {
      planReference = { ...plan, water: current().water };
      $("pourCount").value = getPourCount(plan) ?? "";
      markRecipeDirty();
      render();
      flash(
        "Plan aplicado. Guarda una receta nueva o actualiza la receta guardada para conservarlo.",
      );
    },
  });

  function isCustomRecipe() {
    return customRecipes.includes(selected);
  }
  function updateRecipeStatus() {
    const custom = isCustomRecipe();
    $("updateRecipe").disabled = !custom || (!recipeDirty && !editor.isDirty);
    const deleteButton = $("deleteRecipe");
    if (deleteButton) deleteButton.disabled = !custom;
    const reviewButton = $("reviewPours");
    if (reviewButton) reviewButton.hidden = !editor.isOpen || !editor.isDirty;
    $("recipeStatus").textContent = editor.isOpen
      ? editor.isDirty
        ? "Tienes cambios en los vertidos. Pulsa «Aplicar plan» para conservarlos o «Cancelar» para descartarlos antes de guardar."
        : "El editor de vertidos está abierto sin cambios; puedes guardar la receta."
      : recipeDirty
        ? custom
          ? "Cambios sin guardar. Actualiza esta receta o guarda una copia nueva."
          : "Cambios sin guardar. Guarda una receta nueva para conservar esta preparación."
        : custom
          ? "Receta personalizada guardada. Puedes actualizar sus datos o eliminarla."
          : "Receta de referencia. Guarda una copia para conservar tus ajustes; la referencia original se mantiene.";
  }
  function markRecipeDirty() {
    clearRecipeFeedback();
    recipeDirty = true;
    updateRecipeStatus();
  }
  function clearRecipeFeedback() {
    $("recipeFeedback").hidden = true;
    $("downloadPendingRecipe").hidden = true;
    pendingRecipeBackup = null;
    document
      .querySelectorAll("#recipe .field-error")
      .forEach((error) => error.remove());
    document
      .querySelectorAll('#recipe [aria-invalid="true"]')
      .forEach((field) => {
        field.removeAttribute("aria-invalid");
        field.removeAttribute("aria-errormessage");
      });
  }
  function recipeFeedback(message, error = false) {
    const feedback = $("recipeFeedback");
    feedback.textContent = message;
    feedback.hidden = false;
    feedback.classList.toggle("error", error);
    feedback.setAttribute("role", error ? "alert" : "status");
  }
  function recipeError(message, fieldId) {
    recipeFeedback(message, true);
    flash(message);
    setTab("recipe");
    const field = fieldId ? $(fieldId) : null;
    if (field?.closest("details")) field.closest("details").open = true;
    if (field?.closest(".field")) {
      const error = document.createElement("span");
      error.id = field.id + "Error";
      error.className = "field-error";
      error.textContent = message;
      field.closest(".field").append(error);
      field.setAttribute("aria-invalid", "true");
      field.setAttribute("aria-errormessage", error.id);
      field.focus();
    } else if (field) {
      field.focus();
      field.scrollIntoView({ block: "center" });
    } else {
      $("recipeFeedback").focus();
    }
    return null;
  }
  function recipeStorageError(recipes) {
    recipeError(
      "No se pudo guardar en este navegador. Tus cambios siguen en pantalla; puedes descargar un respaldo JSON para conservarlos.",
    );
    pendingRecipeBackup = createBackup(recipes, sessions);
    $("downloadPendingRecipe").hidden = false;
  }
  function currentPlan() {
    return snapshotPlan(planReference, current().water);
  }
  function getStored(key) {
    return store.read(key);
  }
  function persist(key, value) {
    const saved = store.write(key, value);
    if (!saved)
      flash(
        "No se pudo guardar en este navegador. Exporta tus datos como respaldo.",
      );
    return saved;
  }
  function flash(message) {
    const t = $("toast");
    t.textContent = message;
    t.style.display = "block";
    clearTimeout(flash.timer);
    flash.timer = setTimeout(() => (t.style.display = "none"), 3600);
  }
  function current() {
    return {
      coffee: $("coffee").value.trim(),
      method: $("method").value,
      dose: Number($("dose").value),
      water: Number($("water").value),
      ratio: Number($("targetRatio").value),
      temp: $("temp").valueAsNumber,
      temp2:
        $("temp2").value === "" && !$("temp2").validity.badInput
          ? null
          : $("temp2").valueAsNumber,
      bloom: $("bloom").valueAsNumber,
      pourCount:
        $("pourCount").value === "" && !$("pourCount").validity.badInput
          ? null
          : $("pourCount").valueAsNumber,
      time: $("time").value,
      grind: $("grind").value.trim(),
      grinder:
        $("grinder").value === "other"
          ? $("otherGrinder").value.trim()
          : $("grinder").value,
      grindSize: $("grindSize").value,
      grindMicrons:
        $("grindMicrons").value === "" && !$("grindMicrons").validity.badInput
          ? null
          : $("grindMicrons").valueAsNumber,
    };
  }
  function updateGrindingFields() {
    const grinder = $("grinder").value;
    $("otherGrinderField").hidden = grinder !== "other";
    $("grindLabel").textContent =
      grinder === "Comandante C40"
        ? "Ajuste del C40 (clics)"
        : grinder === "Mazzer Philos I200D"
          ? "Ajuste del Philos (dial)"
          : "Ajuste del molino (opcional)";
    $("grind").placeholder =
      grinder === "Comandante C40"
        ? "Clics y configuración"
        : "Ajuste de tu molino";
    $("grindHint").textContent =
      grinder === "Comandante C40"
        ? "Registra los clics y la configuración utilizada. Al cambiar de molino, vuelve a introducir su ajuste."
        : grinder === "Mazzer Philos I200D"
          ? "Registra la posición del dial. Al cambiar de molino, vuelve a introducir su ajuste."
          : "Identifica el molino para dar contexto al ajuste guardado. Selecciona el grosor según la molienda que utilizas.";
  }
  function recipeItems() {
    return [...defaults, ...customRecipes];
  }
  function fillPresets() {
    const keep = selected?.id || defaults[0].id;
    $("preset").innerHTML = recipeItems()
      .map(
        (r) =>
          `<option value="${escapeHtml(r.id)}">${escapeHtml(r.name)}</option>`,
      )
      .join("");
    $("preset").value = keep;
  }
  function loadRecipe(r) {
    clearDeleteConfirmation();
    clearRecipeFeedback();
    selected = r;
    planReference = r;
    recipeDirty = false;
    editor.close(false);
    for (const id of [
      "coffee",
      "method",
      "dose",
      "water",
      "temp",
      "temp2",
      "bloom",
      "time",
      "grind",
      "grindMicrons",
    ])
      $(id).value = r[id] ?? "";
    const grinder = typeof r.grinder === "string" ? r.grinder : "";
    $("grinder").value = builtInGrinders.includes(grinder)
      ? grinder
      : grinder
        ? "other"
        : "";
    $("otherGrinder").value =
      grinder && !builtInGrinders.includes(grinder) ? grinder : "";
    $("grindSize").value = r.grindSize ?? "";
    $("grindingAdvanced").open = r.grindMicrons != null;
    $("pourCount").value = getPourCount(r) ?? "";
    updateGrindingFields();
    $("targetRatio").value = r.ratio ?? r.water / r.dose;
    $("recipeName").value = isCustomRecipe() ? r.name : "";
    fillPresets();
    render();
    updateRecipeStatus();
    // Remember the choice separately; existing V1 recipe/session keys stay intact.
    store.write(SELECTED_RECIPE_KEY, r.id);
  }
  function render() {
    const r = current(),
      ratio = calculateRatio(r.dose, r.water);
    const target = calculateWater(r.dose, r.ratio);
    $("ratioOut").textContent = valid(ratio) ? "1:" + nf(ratio, 2) : "—";
    $("waterOut").textContent = nf(target);
    $("doseOut").textContent = nf(r.dose);
    $("tempOut").textContent = Number.isFinite(r.temp) ? nf(r.temp) + "°" : "—";
    $("temp2Metric").hidden = r.temp2 === null;
    $("temp2Out").textContent = Number.isFinite(r.temp2)
      ? nf(r.temp2) + "°"
      : "—";
    const delta = ratio - r.ratio;
    $("ratioStatus").textContent =
      !valid(ratio) || !valid(r.ratio)
        ? "Introduce una dosis, un volumen y un ratio válidos."
        : Math.abs(delta) < 0.02
          ? "La relación actual coincide con tu ratio objetivo."
          : `Ratio actual 1:${nf(ratio, 2)}; objetivo 1:${nf(r.ratio, 2)}. Puedes mantenerlo así o recalcular el agua.`;
    $("referenceNotes").textContent =
      selected?.notes || "Receta personalizada.";
    $("referenceLabel").textContent =
      "Receta de referencia, no un resultado de extracción medido.";
    renderPours(r);
    const plan = currentPlan();
    const countError = validatePourCount({ ...r, ...plan });
    const knownCount = getPourCount(plan);
    $("pourCountHint").textContent =
      countError ||
      (knownCount === null
        ? "Sin incluir el bloom. Deja vacío si no conoces el número; los pesos restantes se definen en «Editar vertidos»."
        : `Sin incluir el bloom. El plan actual tiene ${knownCount} ${knownCount === 1 ? "vertido posterior" : "vertidos posteriores"}. Al aplicar un plan, este número se actualiza.`);
    calcEy();
  }
  function renderPours(r) {
    const base = planReference,
      pours = base?.pours;
    const holder = $("pours");
    holder.innerHTML = "";
    if (!valid(r.water) || !valid(base?.water)) {
      holder.textContent = "Introduzca un peso de agua válido.";
      return;
    }
    const k = r.water / base.water;
    if (Array.isArray(pours) && pours.length) {
      const arr = scalePours(pours, base.water, r.water).map(
        ({ cumulative: cum, incremental: inc }, i) => {
          const start = formatTime(base.pourTimes?.[i]);
          return `<div class="step"><span>${i === 0 ? "Bloom" : `Vertido ${i}`} · <span class="mini">+${nf(inc, 2)} g</span>${start ? `<span class="pour-time">Inicio ${start}</span>` : ""}</span><strong>${nf(cum, 2)} g acumulados</strong></div>`;
        },
      );
      holder.innerHTML = arr.join("");
      $("pourNote").textContent =
        `Bloom: ${nf(r.bloom, 0)} s. Los pesos se escalan proporcionalmente con el agua. Los tiempos de inicio registrados se conservan; los campos vacíos siguen sin registrar.`;
    } else if (valid(base?.bloomWater)) {
      let first = base.bloomWater * k;
      holder.innerHTML = `<div class="step"><span>Bloom · <span class="mini">${nf(r.bloom, 0)} s</span></span><strong>${nf(first)} g</strong></div><div class="step"><span>Agua restante · <span class="mini">sin plan detallado</span></span><strong>${nf(r.water - first)} g</strong></div>`;
      $("pourNote").textContent =
        "Solo se conoce el peso del bloom. No inventamos número ni secuencia de vertidos posteriores.";
    } else {
      holder.textContent =
        "No hay un plan documentado de vertidos para esta receta.";
      $("pourNote").textContent =
        "Puedes definir los vertidos conocidos con «Editar vertidos». Los tiempos de inicio son opcionales.";
    }
  }
  function calcEy() {
    const dose = Number($("eyDose").value),
      cup = Number($("cup").value),
      tds = Number($("tds").value),
      result = calculateExtraction(dose, cup, tds),
      ready = result !== null;
    const ey = result?.yieldPercent ?? NaN;
    $("ey").innerHTML = ready
      ? nf(ey, 2) + " <small>%</small>"
      : "— <small>%</small>";
    $("eyStatus").textContent = !ready
      ? "Introduce dosis, bebida obtenida y TDS válidos."
      : ey < 18
        ? "Extracción por debajo del rango histórico de referencia (18–22%). Evalúa la taza antes de modificar variables."
        : ey <= 22
          ? "Dentro del rango histórico de referencia (18–22%). La evaluación sensorial sigue siendo necesaria."
          : "Extracción por encima del rango histórico de referencia (18–22%). No implica automáticamente un defecto sensorial.";
    $("solubles").textContent = ready
      ? "Sólidos disueltos en taza: " + nf(result.dissolvedSolids, 2) + " g"
      : "Sólidos disueltos: —";
    return ready ? ey : null;
  }
  function exportFile(data, name, mime) {
    const blob = new Blob([data], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
  function recipeForSaving() {
    clearRecipeFeedback();
    if (editor.isOpen) {
      if (editor.isDirty) {
        return recipeError(
          "Aplica o cancela la edición del plan antes de guardar: pulsa «Aplicar plan» para conservar los vertidos que editaste o «Cancelar» para descartarlos. Después guarda la receta.",
          "applyPours",
        );
      }
      editor.close(false);
    }
    const r = current();
    if ($("grinder").value === "other" && !r.grinder) {
      return recipeError(
        "Escribe la marca y el modelo del otro molino.",
        "otherGrinder",
      );
    }
    for (const [invalid, message, field] of [
      [!r.coffee, "Escribe el nombre del café o lote.", "coffee"],
      [
        !valid(r.dose) || r.dose > 1000,
        "La dosis de café debe ser mayor que 0 y no superar 1000 g.",
        "dose",
      ],
      [
        !valid(r.water) || r.water > 20000,
        "El agua total debe ser mayor que 0 y no superar 20000 g.",
        "water",
      ],
      [
        !Number.isFinite(r.ratio) || r.ratio < 1 || r.ratio > 100,
        "El ratio objetivo debe estar entre 1 y 100.",
        "targetRatio",
      ],
      [
        !Number.isFinite(r.temp) || r.temp < 0 || r.temp > 100,
        "La temperatura 1 debe estar entre 0 y 100 °C.",
        "temp",
      ],
      [
        r.temp2 !== null &&
          (!Number.isFinite(r.temp2) || r.temp2 < 0 || r.temp2 > 100),
        "La temperatura 2 debe estar entre 0 y 100 °C, o quedar vacía.",
        "temp2",
      ],
      [
        r.grindMicrons !== null &&
          (!Number.isFinite(r.grindMicrons) || r.grindMicrons <= 0),
        "El grosor en µm debe ser un número mayor que 0, o quedar vacío.",
        "grindMicrons",
      ],
      [
        !Number.isInteger(r.bloom) || r.bloom < 0 || r.bloom > 900,
        "El bloom debe ser un número entero entre 0 y 900 segundos.",
        "bloom",
      ],
    ]) {
      if (invalid) return recipeError(message, field);
    }
    const plan = currentPlan();
    const candidate = {
      ...r,
      ...plan,
      pourCount: r.pourCount ?? getPourCount(plan),
    };
    const planError = validatePlan(plan.pours, plan.pourTimes, r.water, r.time);
    if (planError)
      return recipeError(
        planError,
        planError.includes("tiempo final") ? "time" : null,
      );
    const countError = validatePourCount(candidate);
    if (countError) return recipeError(countError, "pourCount");
    return candidate;
  }
  function saveNewRecipe() {
    const r = recipeForSaving();
    if (!r) return;
    const name = $("recipeName").value.trim().slice(0, 100);
    if (!name) {
      return recipeError(
        "Escribe un nombre para guardar la receta.",
        "recipeName",
      );
    }
    const copy = {
      ...r,
      id: "custom-" + (globalThis.crypto?.randomUUID?.() ?? Date.now()),
      name,
      notes: "Receta personalizada creada en Blossom Brew Lab.",
    };
    const next = [...customRecipes, copy];
    if (!store.write(STORAGE_R, next)) return recipeStorageError(next);
    customRecipes = next;
    loadRecipe(copy);
    flash("Nueva receta guardada.");
    recipeFeedback(
      `Receta «${name}» guardada en este navegador. Ya aparece seleccionada en la lista de recetas.`,
    );
  }
  function updateRecipe() {
    if (!isCustomRecipe()) return;
    const r = recipeForSaving();
    if (!r) return;
    const name = $("recipeName").value.trim();
    if (!name) {
      return recipeError("La receta necesita un nombre.", "recipeName");
    }
    // Replace only the selected custom recipe. Old sessions hold their own plan.
    const updated = { ...selected, ...r, name };
    delete updated.bloomWater;
    delete updated.pourTimes;
    Object.assign(updated, currentPlan());
    const next = customRecipes.map((recipe) =>
      recipe === selected ? updated : recipe,
    );
    if (!store.write(STORAGE_R, next)) return recipeStorageError(next);
    customRecipes = next;
    loadRecipe(updated);
    flash("Receta actualizada.");
    recipeFeedback(`Receta «${name}» actualizada en este navegador.`);
  }
  function clearDeleteConfirmation(focus = false) {
    deletionTarget = null;
    const panel = $("deleteRecipePanel");
    if (panel) panel.hidden = true;
    if (focus) $("deleteRecipe")?.focus();
  }
  function requestRecipeDeletion() {
    if (!isCustomRecipe()) return;
    clearRecipeFeedback();
    deletionTarget = selected;
    $("deleteRecipeTitle").textContent =
      `¿Eliminar la receta «${selected.name}»?`;
    $("deleteRecipePanel").hidden = false;
    $("cancelDeleteRecipe").focus();
    $("deleteRecipePanel").scrollIntoView({ block: "center" });
  }
  function confirmRecipeDeletion() {
    const target = deletionTarget;
    const index = customRecipes.indexOf(target);
    if (!target || selected !== target || index < 0) {
      clearDeleteConfirmation();
      return;
    }
    const next = customRecipes.filter((recipe) => recipe !== target);
    if (!store.write(STORAGE_R, next)) {
      return recipeError(
        "No se pudo eliminar la receta en este navegador. Sigue en tu lista; puedes volver a intentarlo o cancelar.",
      );
    }
    customRecipes = next;
    loadRecipe(next[Math.min(index, next.length - 1)] ?? defaults[0]);
    recipeFeedback(
      `Receta «${target.name}» eliminada de este navegador. Tus sesiones guardadas se conservan.`,
    );
    flash("Receta eliminada.");
  }
  function saveSession() {
    const r = recipeForSaving();
    if (!r) return;
    const ey = calcEy();
    if (ey !== null && Math.abs(Number($("eyDose").value) - r.dose) > 0.0001) {
      flash(
        "La dosis del cálculo EY no coincide con la receta. En Extracción, selecciona «Usar dosis de la receta activa».",
      );
      return;
    }
    const session = {
      id: Date.now().toString(),
      date: new Date().toISOString(),
      ...r,
      realRatio: r.water / r.dose,
      tds: ey === null ? null : Number($("tds").value),
      cup: ey === null ? null : Number($("cup").value),
      extraction: ey,
      score: {
        sweet: Number($("sweet").value),
        acid: Number($("acid").value),
        body: Number($("body").value),
      },
      notes: $("notes").value.trim().slice(0, 2000),
    };
    const next = [session, ...sessions];
    if (!persist(STORAGE_S, next)) return;
    sessions = next;
    renderSessions();
    flash("Sesión guardada en el historial.");
  }
  function renderSessions() {
    const holder = $("sessions");
    $("count").textContent =
      `${sessions.length} ${sessions.length === 1 ? "sesión" : "sesiones"}`;
    if (!sessions.length) {
      holder.innerHTML =
        '<div class="empty">Todavía no hay sesiones registradas.</div>';
      return;
    }
    holder.innerHTML = sessions
      .slice(0, 100)
      .map((s) => {
        const date = new Date(s.date);
        const plan =
          Array.isArray(s.pours) && s.pours.length
            ? `<details class="session-plan"><summary>Ver vertidos registrados</summary><ol>${s.pours.map((weight, index) => `<li>${nf(Number(weight), 2)} g acumulados · ${formatTime(s.pourTimes?.[index]) ? `inicio ${formatTime(s.pourTimes[index])}` : "inicio sin registrar"}</li>`).join("")}</ol></details>`
            : "";
        const microns =
          Number.isFinite(s.grindMicrons) && s.grindMicrons > 0
            ? ` · Grosor: ${s.grindMicrons.toLocaleString("es-ES", { maximumSignificantDigits: 15 })} µm`
            : "";
        const grinding = `<div class="logmeta grinding-summary">Molino: ${escapeHtml(s.grinder || "sin especificar")} · Molienda: ${escapeHtml(s.grindSize || "sin especificar")}${s.grind ? ` · Ajuste: ${escapeHtml(s.grind)}` : ""}${microns}</div>`;
        const count = `<div class="logmeta pour-count-summary">Vertidos después del bloom: ${getPourCount(s) ?? "sin especificar"}</div>`;
        return `<article class="logitem"><div class="headrow"><div class="logtitle">${escapeHtml(s.coffee)}</div><span class="pill">${escapeHtml(s.method)}</span></div><div class="logmeta">${isNaN(date.getTime()) ? "Fecha no disponible" : date.toLocaleString("es-ES")} · ${nf(Number(s.dose))} g / ${nf(Number(s.water))} g · 1:${nf(Number(s.realRatio), 2)} · T1 ${nf(Number(s.temp))} °C${s.temp2 == null ? "" : ` · T2 ${nf(Number(s.temp2))} °C`} · ${escapeHtml(s.time)}</div>${grinding}${count}<div class="logmeta">Dulzura ${escapeHtml(s.score?.sweet ?? "—")}/10 · Acidez ${escapeHtml(s.score?.acid ?? "—")}/10 · Cuerpo ${escapeHtml(s.score?.body ?? "—")}/10 · EY ${s.extraction == null ? "no medido" : nf(Number(s.extraction), 2) + "%"}</div>${s.notes ? `<div class="lognotes">${escapeHtml(s.notes)}</div>` : ""}${plan}</article>`;
      })
      .join("");
  }
  function downloadCsv() {
    exportFile(
      sessionsToCsv(sessions),
      "blossom_sesiones.csv",
      "text/csv;charset=utf-8",
    );
    flash("Sesiones exportadas a CSV.");
  }
  function exportJson() {
    const data = createBackup(customRecipes, sessions);
    exportFile(
      JSON.stringify(data, null, 2),
      "blossom_respaldo.json",
      "application/json",
    );
    flash("Respaldo exportado. Guárdalo en un lugar seguro.");
  }
  async function importJson(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = parseBackup(await file.text());
      if (
        !confirm(
          `Importar ${data.recipes.length} recetas y ${data.sessions.length} sesiones? Esto reemplazará los registros personalizados actuales.`,
        )
      )
        return;
      customRecipes = data.recipes
        .filter(
          (x) =>
            x &&
            typeof x.name === "string" &&
            valid(Number(x.dose)) &&
            valid(Number(x.water)),
        )
        .slice(0, 200);
      sessions = data.sessions
        .filter(
          (x) => x && typeof x.coffee === "string" && valid(Number(x.dose)),
        )
        .slice(0, 2000);
      persist(STORAGE_R, customRecipes);
      persist(STORAGE_S, sessions);
      loadRecipe(defaults[0]);
      renderSessions();
      flash("Respaldo importado con éxito.");
    } catch (err) {
      flash("No se pudo importar: JSON incorrecto o incompatible.");
    } finally {
      e.target.value = "";
    }
  }
  function setTab(tab) {
    document
      .querySelectorAll(".tabs button")
      .forEach((el) => el.classList.toggle("active", el.dataset.tab === tab));
    document
      .querySelectorAll(".panel")
      .forEach((el) => el.classList.toggle("active", el.id === tab));
    if (tab === "extraction") calcEy();
  }
  function init() {
    const storedR = getStored(STORAGE_R),
      storedS = getStored(STORAGE_S);
    customRecipes = Array.isArray(storedR)
      ? storedR.filter((r) => r && typeof r.name === "string")
      : [];
    sessions = Array.isArray(storedS)
      ? storedS.filter((s) => s && typeof s.coffee === "string")
      : [];
    document
      .querySelectorAll(".tabs button")
      .forEach((el) =>
        el.addEventListener("click", () => setTab(el.dataset.tab)),
      );
    $("preset").addEventListener("change", () => {
      if (
        (recipeDirty || editor.isDirty) &&
        !confirm(
          "Tienes cambios sin guardar. ¿Quieres descartarlos y cambiar de receta?",
        )
      ) {
        $("preset").value = selected.id;
        return;
      }
      const r = recipeItems().find((r) => r.id === $("preset").value);
      if (r) loadRecipe(r);
    });
    for (const id of [
      "method",
      "grind",
      "grindSize",
      "grindMicrons",
      "otherGrinder",
      "dose",
      "water",
      "targetRatio",
      "temp",
      "temp2",
      "bloom",
      "pourCount",
      "time",
      "coffee",
    ])
      $(id).addEventListener("input", () => {
        markRecipeDirty();
        render();
      });
    $("grinder").addEventListener("change", () => {
      $("grind").value = "";
      updateGrindingFields();
      markRecipeDirty();
      render();
    });
    $("recipeName").addEventListener("input", markRecipeDirty);
    $("reviewPours")?.addEventListener("click", () => {
      if (!editor.isOpen) return;
      setTab("recipe");
      $("applyPours").focus();
      $("applyPours").scrollIntoView({ block: "center" });
    });
    $("editPours").addEventListener("click", () => {
      if (!valid(current().water)) {
        flash("Introduce un peso de agua válido antes de definir el plan.");
        return;
      }
      editor.open(currentPlan());
    });
    window.addEventListener("beforeunload", (event) => {
      if (recipeDirty || editor.isDirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    });
    $("matchRatio").addEventListener("click", () => {
      const r = current();
      if (!valid(r.dose) || !valid(r.ratio)) {
        flash("La dosis y el ratio deben ser positivos.");
        return;
      }
      $("water").value = Number(calculateWater(r.dose, r.ratio).toFixed(2));
      markRecipeDirty();
      render();
      flash("Agua recalculada al ratio objetivo.");
    });
    $("saveRecipe").addEventListener("click", saveNewRecipe);
    $("downloadPendingRecipe").addEventListener("click", () => {
      if (!pendingRecipeBackup) return;
      exportFile(
        JSON.stringify(pendingRecipeBackup, null, 2),
        "blossom_respaldo_pendiente.json",
        "application/json",
      );
    });
    $("updateRecipe").addEventListener("click", updateRecipe);
    $("deleteRecipe")?.addEventListener("click", requestRecipeDeletion);
    $("confirmDeleteRecipe")?.addEventListener("click", confirmRecipeDeletion);
    $("cancelDeleteRecipe")?.addEventListener("click", () =>
      clearDeleteConfirmation(true),
    );
    for (const id of ["eyDose", "cup", "tds"])
      $(id).addEventListener("input", calcEy);
    $("syncDose").addEventListener("click", () => {
      $("eyDose").value = $("dose").value;
      calcEy();
      flash("Dosis sincronizada. Completa los datos medidos.");
    });
    $("demoEy").addEventListener("click", () => {
      $("eyDose").value = 15;
      $("cup").value = 210;
      $("tds").value = 1.42;
      calcEy();
      flash(
        "Ejemplo ficticio: no corresponde a una extracción medida de Blossom.",
      );
    });
    for (const id of ["sweet", "acid", "body"])
      $(id).addEventListener(
        "input",
        () => ($(id + "V").textContent = $(id).value),
      );
    $("saveSession").addEventListener("click", saveSession);
    $("downloadCsv").addEventListener("click", downloadCsv);
    $("exportJson").addEventListener("click", exportJson);
    $("fileImport").addEventListener("change", importJson);
    $("clearSessions").addEventListener("click", () => {
      if (!sessions.length) return;
      if (
        confirm(
          "¿Quieres borrar todo el historial local? Exporta un respaldo antes de continuar.",
        )
      ) {
        sessions = [];
        persist(STORAGE_S, sessions);
        renderSessions();
        flash("Historial vaciado.");
      }
    });
    const lastRecipe = recipeItems().find(
      (recipe) => recipe.id === getStored(SELECTED_RECIPE_KEY),
    );
    loadRecipe(lastRecipe ?? defaults[0]);
    renderSessions();
  }
  init();
})();
