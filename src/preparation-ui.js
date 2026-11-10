(function (root) {
  "use strict";
  root.BlossomLab.createPreparationGuide = function ({
    store,
    ownerId,
    onLoad,
    onSave,
    onBackup,
    onChange,
  }) {
    const core = root.BlossomLab.preparation;
    const { formatTime } = root.BlossomLab.plans;
    const $ = (id) => document.getElementById(id);
    const number = (n) =>
      n.toLocaleString("es-ES", { maximumFractionDigits: 2 });
    const label = (i) => (i === 0 ? "Bloom" : `Vertido ${i}`);
    let draft = core.restoreDraft(store.read(core.DRAFT_KEY));
    let timer = null;
    let preserved = true;

    function message(text, error = false) {
      $("brewFeedback").textContent = text;
      $("brewFeedback").hidden = !text;
      $("brewFeedback").classList.toggle("error", error);
      $("brewFeedback").setAttribute("role", error ? "alert" : "status");
      if (error) {
        $("brewFeedback").focus();
        $("brewFeedback").scrollIntoView({ block: "center" });
      }
    }
    function persist() {
      preserved = store.write(core.DRAFT_KEY, draft);
      if (!preserved) {
        message(
          "No se pudo conservar el progreso en este navegador. Mantén abierta la página; al terminar podrás descargar un respaldo si el guardado falla.",
          true,
        );
        return false;
      }
      return true;
    }
    function changed() {
      persist();
      render();
      onChange?.();
    }
    function action(transform) {
      try {
        draft = transform(draft);
        message("");
        changed();
      } catch (error) {
        message(error.message, true);
      }
    }
    function refreshClock() {
      if (!draft) return;
      const elapsed = core.elapsedSeconds(draft);
      $("brewClock").textContent =
        formatTime(elapsed) || "Tiempo fuera de rango";
      $("brewClockState").textContent =
        draft.phase === "paused"
          ? "Cronómetro pausado"
          : draft.phase === "review"
            ? "Tiempo real · pausas excluidas"
            : "Tiempo transcurrido · pausas excluidas";
      const next = draft.recipe.pourTimes?.[draft.index + 1];
      const hasNext = draft.index < draft.recipe.pours.length - 1;
      let cue,
        countdown = "";
      if (draft.phase === "review")
        cue = "Preparación finalizada. Registra cómo quedó tu taza.";
      else if (draft.phase === "paused")
        cue = "Reanuda el cronómetro para continuar con los vertidos.";
      else if (!hasNext)
        cue = "Cuando termine de drenar, pulsa «Finalizar preparación».";
      else if (next == null)
        cue =
          "El siguiente vertido no tiene hora de inicio registrada. Tú decides cuándo comenzarlo.";
      else {
        cue =
          elapsed >= next
            ? `Ya llegó el inicio previsto de ${label(draft.index + 1).toLowerCase()}. Avanza cuando lo comiences.`
            : `Siguiente: ${label(draft.index + 1)} a ${formatTime(next)}.`;
        countdown =
          elapsed >= next
            ? `Inicio previsto superado por ${formatTime(elapsed - next) || "—"}`
            : `Faltan ${formatTime(next - elapsed)}`;
      }
      if ($("brewCue").textContent !== cue) $("brewCue").textContent = cue;
      $("brewCountdown").textContent = countdown;
    }
    function render() {
      clearInterval(timer);
      timer = null;
      $("brewEmpty").hidden = !!draft;
      $("brewContent").hidden = !draft;
      $("brewLoad").disabled = !!draft;
      $("brewDiscardPanel").hidden = true;
      $("brewPendingBackup").hidden = true;
      if (!draft) return;
      const recipe = draft.recipe;
      const ready = draft.phase === "ready";
      const review = draft.phase === "review";
      $("brewName").textContent = draft.name;
      $("brewRecipeSummary").textContent =
        `${recipe.coffee} · ${recipe.method} · ${number(recipe.dose)} g de café · ${number(recipe.water)} g de agua`;
      $("brewWaterProfile").hidden = !recipe.waterProfile;
      $("brewWaterProfile").textContent = recipe.waterProfile
        ? `Agua: ${recipe.waterProfile.name} · GH ≈ ${number(recipe.waterProfile.gh)} · Alcalinidad ≈ ${number(recipe.waterProfile.alkalinity)} ppm como CaCO₃`
        : "";
      $("brewTarget").textContent = recipe.time
        ? `Tiempo objetivo: ${recipe.time}`
        : "Tiempo objetivo sin registrar";
      $("brewTemperaturesNote").textContent =
        recipe.temp2 == null
          ? `Temperatura de la receta: ${number(recipe.temp)} °C.`
          : `T1: ${number(recipe.temp)} °C · T2: ${number(recipe.temp2)} °C. Selecciona una temperatura por vertido; se conservará con esta sesión.`;
      $("brewStart").hidden = !ready;
      $("brewLive").hidden = ready;
      $("brewResult").hidden = !review;
      $("brewPause").hidden = ready || review;
      $("brewPause").textContent =
        draft.phase === "paused" ? "Reanudar" : "Pausar";
      $("brewNext").hidden =
        ready || review || draft.index >= recipe.pours.length - 1;
      $("brewNext").disabled = draft.phase !== "running";
      $("brewNext").textContent = `Comenzar vertido ${draft.index + 1}`;
      $("brewFinish").hidden =
        ready || review || draft.index !== recipe.pours.length - 1;
      $("brewFinish").disabled = draft.phase !== "running";
      $("brewCurrent").hidden = ready || review;
      $("brewCurrentLabel").textContent = label(draft.index);
      $("brewBloom").hidden =
        draft.index !== 0 || !Number.isFinite(recipe.bloom);
      $("brewBloom").textContent = `Bloom de referencia: ${recipe.bloom} s.`;
      const cumulative = recipe.pours[draft.index];
      const incremental = cumulative - (recipe.pours[draft.index - 1] ?? 0);
      $("brewAmount").textContent = `Añade ${number(incremental)} g`;
      $("brewCumulative").textContent =
        `Hasta ${number(cumulative)} g acumulados en la balanza`;
      $("brewTemperature").textContent =
        draft.temperatures[draft.index] == null
          ? "Temperatura sin asignar"
          : `Usa agua a ${number(draft.temperatures[draft.index])} °C`;
      $("brewPlan").innerHTML = recipe.pours
        .map((weight, i) => {
          const amount = weight - (recipe.pours[i - 1] ?? 0);
          const planned = recipe.pourTimes?.[i];
          const actual = draft.actualStarts[i];
          const temperatures =
            recipe.temp2 == null
              ? `<span>${number(recipe.temp)} °C</span>`
              : `<label for="brewTemp${i}">Temperatura de ${label(i).toLowerCase()}</label><select id="brewTemp${i}" data-brew-temperature="${i}" ${ready ? "" : "disabled"}><option value="">Seleccionar</option><option value="1" ${draft.temperatures[i] === recipe.temp ? "selected" : ""}>T1 · ${number(recipe.temp)} °C</option><option value="2" ${draft.temperatures[i] !== recipe.temp && draft.temperatures[i] === recipe.temp2 ? "selected" : ""}>T2 · ${number(recipe.temp2)} °C</option></select>`;
          return `<li class="brew-plan-step ${!ready && i === draft.index ? "current" : ""}" ${!ready && i === draft.index ? 'aria-current="step"' : ""}><div><strong>${label(i)} · +${number(amount)} g</strong><span>Hasta ${number(weight)} g acumulados</span><span>Inicio previsto: ${planned == null ? "sin registrar" : formatTime(planned)}</span>${actual == null ? "" : `<span>Inicio real: ${formatTime(actual)}</span>`}</div><div class="brew-step-temperature">${temperatures}</div></li>`;
        })
        .join("");
      for (const key of Object.keys(draft.result))
        $("brewResult_" + key).value = draft.result[key];
      $("brewResultSummary").textContent =
        `Tiempo real: ${formatTime(core.elapsedSeconds(draft)) || "—"}. El tiempo objetivo de la receta se conserva por separado.`;
      refreshClock();
      if (draft.phase === "running") timer = setInterval(refreshClock, 250);
    }
    $("brewLoad").addEventListener("click", onLoad);
    $("brewStart").addEventListener("click", () =>
      action((s) => core.start(s)),
    );
    $("brewPause").addEventListener("click", () =>
      action((s) => (s.phase === "paused" ? core.resume(s) : core.pause(s))),
    );
    $("brewNext").addEventListener("click", () =>
      action((s) => core.advance(s)),
    );
    $("brewFinish").addEventListener("click", () => {
      action((s) => core.finish(s));
      if (draft?.phase === "review") $("brewResultTitle").focus();
    });
    $("brewPlan").addEventListener("change", (event) => {
      const index = event.target.dataset.brewTemperature;
      if (index == null || draft?.phase !== "ready") return;
      draft.temperatures[Number(index)] =
        event.target.value === ""
          ? null
          : event.target.value === "1"
            ? draft.recipe.temp
            : draft.recipe.temp2;
      persist();
    });
    $("brewDiscard").addEventListener("click", () => {
      $("brewDiscardPanel").hidden = false;
      $("brewKeep").focus();
    });
    $("brewKeep").addEventListener("click", () => {
      $("brewDiscardPanel").hidden = true;
    });
    $("brewConfirmDiscard").addEventListener("click", () => {
      if (!store.write(core.DRAFT_KEY, null))
        return message(
          "No se pudo descartar el progreso guardado. Inténtalo otra vez.",
          true,
        );
      draft = null;
      render();
      message(
        "Preparación descartada. Tus recetas y la bitácora se conservan.",
      );
      onChange?.();
    });
    $("brewResult").addEventListener("input", (event) => {
      const key = event.target.dataset.brewResult;
      if (!key || draft?.phase !== "review") return;
      draft.result[key] = event.target.value;
      persist();
    });
    $("brewResult").addEventListener("submit", (event) => {
      event.preventDefault();
      if (draft?.phase !== "review") return;
      if (draft.ownerId && draft.ownerId !== ownerId())
        return message(
          "Vuelve a entrar con la cuenta que inició esta preparación antes de guardarla.",
          true,
        );
      try {
        onSave(draft);
        draft = null;
        // A stable session id also prevents duplication if clearing this draft fails.
        const cleared = store.write(core.DRAFT_KEY, null);
        render();
        message(
          cleared
            ? "Sesión guardada en la bitácora. Ya puedes preparar otra receta."
            : "Sesión guardada en la bitácora. No se pudo limpiar el progreso anterior; volver a guardarlo no creará un duplicado.",
        );
        $("brewFeedback").focus();
        onChange?.();
      } catch (error) {
        message(error.message, true);
        $("brewPendingBackup").hidden = false;
      }
    });
    $("brewPendingBackup").addEventListener("click", () => {
      try {
        onBackup(draft);
      } catch (error) {
        message(error.message, true);
      }
    });
    window.addEventListener("storage", (event) => {
      if (event.key !== core.DRAFT_KEY) return;
      draft = core.restoreDraft(store.read(core.DRAFT_KEY));
      render();
      message(
        draft
          ? "Progreso actualizado desde otra pestaña de este navegador."
          : "La preparación se cerró desde otra pestaña.",
      );
      onChange?.();
    });
    document.addEventListener("visibilitychange", refreshClock);
    render();
    if (draft)
      message(
        draft.phase === "running"
          ? "Recuperamos tu preparación en este navegador. El cronómetro conserva el tiempo transcurrido mientras la página estuvo cerrada."
          : "Recuperamos tu preparación y los datos pendientes en este navegador.",
      );
    return {
      get hasDraft() {
        return !!draft;
      },
      get needsUnloadWarning() {
        return !!draft && !preserved;
      },
      prepare(recipe, name) {
        if (draft)
          return message(
            "Ya tienes una preparación pendiente. Continúa con ella o descártala antes de cargar otra.",
            true,
          );
        try {
          draft = core.createDraft(
            recipe,
            name,
            "guided-" + (root.crypto?.randomUUID?.() ?? Date.now()),
            ownerId(),
          );
          message("");
          changed();
        } catch (error) {
          message(error.message, true);
        }
      },
    };
  };
})(globalThis);
