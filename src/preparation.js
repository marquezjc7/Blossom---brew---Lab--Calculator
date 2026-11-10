(function (root) {
  "use strict";
  const { validatePlan } =
    typeof module !== "undefined" && module.exports
      ? require("./plans.js")
      : root.BlossomLab.plans;
  const DRAFT_KEY = "blossom-brew-preparation-v1";
  const temperature = (n) => Number.isFinite(n) && n >= 0 && n <= 100;
  const seconds = (n) => Number.isInteger(n) && n >= 0 && n <= 59999;

  function validateRecipe(recipe) {
    if (
      !recipe ||
      !Number.isFinite(recipe.dose) ||
      recipe.dose <= 0 ||
      typeof recipe.coffee !== "string" ||
      !recipe.coffee.trim() ||
      !temperature(recipe.temp) ||
      (recipe.temp2 != null && !temperature(recipe.temp2))
    )
      return "Revisa el café, la dosis y las temperaturas de la receta.";
    if (!Array.isArray(recipe.pours) || !recipe.pours.length)
      return "Esta receta necesita un plan completo. Define los pesos en «Editar vertidos» antes de iniciar la guía.";
    return validatePlan(
      recipe.pours,
      recipe.pourTimes,
      recipe.water,
      recipe.time,
    );
  }

  function createDraft(recipe, name, id, ownerId = null) {
    const error = validateRecipe(recipe);
    if (error) throw new Error(error);
    return {
      version: 1,
      id,
      ownerId,
      name,
      recipe: JSON.parse(JSON.stringify(recipe)),
      phase: "ready",
      elapsedMs: 0,
      runningSince: null,
      startedAt: null,
      index: 0,
      actualStarts: recipe.pours.map(() => null),
      temperatures: recipe.pours.map(() =>
        recipe.temp2 == null ? recipe.temp : null,
      ),
      result: { sweet: "", acid: "", body: "", cup: "", tds: "", notes: "" },
    };
  }

  // Derive the clock from timestamps; suspended/background tabs do not lose ticks.
  function elapsedSeconds(draft, now = Date.now()) {
    return Math.floor(
      (draft.elapsedMs +
        (draft.runningSince === null
          ? 0
          : Math.max(0, now - draft.runningSince))) /
        1000,
    );
  }

  function start(draft, now = Date.now()) {
    if (draft.phase !== "ready")
      throw new Error("La preparación ya está iniciada.");
    if (
      draft.temperatures.some(
        (t) =>
          !temperature(t) ||
          (t !== draft.recipe.temp && t !== draft.recipe.temp2),
      )
    )
      throw new Error(
        "Selecciona la temperatura de cada vertido antes de empezar.",
      );
    return {
      ...draft,
      phase: "running",
      startedAt: new Date(now).toISOString(),
      runningSince: now,
      actualStarts: draft.actualStarts.map((_, i) => (i === 0 ? 0 : null)),
    };
  }

  function pause(draft, now = Date.now()) {
    if (draft.phase !== "running")
      throw new Error("El cronómetro no está en marcha.");
    return {
      ...draft,
      phase: "paused",
      runningSince: null,
      elapsedMs: draft.elapsedMs + Math.max(0, now - draft.runningSince),
    };
  }

  function resume(draft, now = Date.now()) {
    if (draft.phase !== "paused")
      throw new Error("El cronómetro no está pausado.");
    return { ...draft, phase: "running", runningSince: now };
  }

  function advance(draft, now = Date.now()) {
    if (
      draft.phase !== "running" ||
      draft.index >= draft.recipe.pours.length - 1
    )
      throw new Error(
        "No hay otro vertido disponible mientras el cronómetro está pausado o el plan ha terminado.",
      );
    const index = draft.index + 1;
    const actualStarts = [...draft.actualStarts];
    actualStarts[index] = elapsedSeconds(draft, now);
    return { ...draft, index, actualStarts };
  }

  function finish(draft, now = Date.now()) {
    if (draft.phase !== "running" || draft.actualStarts.some((t) => t === null))
      throw new Error(
        "Reanuda el cronómetro y confirma todos los vertidos antes de finalizar.",
      );
    const duration = elapsedSeconds(draft, now);
    if (!seconds(duration) || duration === 0)
      throw new Error(
        "El tiempo real debe ser mayor que 0:00 y menor que 1000 minutos.",
      );
    return {
      ...draft,
      phase: "review",
      runningSince: null,
      elapsedMs: duration * 1000,
    };
  }

  function record(draft) {
    if (draft.phase !== "review")
      throw new Error("Finaliza la preparación antes de guardarla.");
    return {
      version: 1,
      startedAt: draft.startedAt,
      durationSeconds: elapsedSeconds(draft),
      actualStarts: [...draft.actualStarts],
      temperatures: [...draft.temperatures],
    };
  }

  function validateRecord(preparation, recipe) {
    if (preparation == null) return null;
    const error = "El registro de preparación guiada es incorrecto.";
    if (
      preparation.version !== 1 ||
      validateRecipe(recipe) ||
      typeof preparation.startedAt !== "string" ||
      !Number.isFinite(Date.parse(preparation.startedAt)) ||
      !seconds(preparation.durationSeconds) ||
      preparation.durationSeconds === 0 ||
      !Array.isArray(preparation.actualStarts) ||
      !Array.isArray(preparation.temperatures) ||
      preparation.actualStarts.length !== recipe.pours.length ||
      preparation.temperatures.length !== recipe.pours.length ||
      preparation.actualStarts[0] !== 0
    )
      return error;
    let previous = 0;
    for (let i = 0; i < recipe.pours.length; i++) {
      const t = preparation.actualStarts[i];
      const temp = preparation.temperatures[i];
      if (
        !seconds(t) ||
        t < previous ||
        t > preparation.durationSeconds ||
        !temperature(temp) ||
        (temp !== recipe.temp && temp !== recipe.temp2)
      )
        return error;
      previous = t;
    }
    return null;
  }

  function restoreDraft(value) {
    if (
      !value ||
      value.version !== 1 ||
      typeof value.id !== "string" ||
      !value.id ||
      typeof value.name !== "string" ||
      (value.ownerId !== null && typeof value.ownerId !== "string") ||
      validateRecipe(value.recipe) ||
      !["ready", "running", "paused", "review"].includes(value.phase) ||
      !Number.isFinite(value.elapsedMs) ||
      value.elapsedMs < 0 ||
      !Number.isInteger(value.index) ||
      value.index < 0 ||
      value.index >= value.recipe.pours.length ||
      !Array.isArray(value.actualStarts) ||
      !Array.isArray(value.temperatures) ||
      value.actualStarts.length !== value.recipe.pours.length ||
      value.temperatures.length !== value.recipe.pours.length ||
      value.temperatures.some(
        (t) =>
          t !== null &&
          (!temperature(t) ||
            (t !== value.recipe.temp && t !== value.recipe.temp2)),
      ) ||
      !value.result ||
      ["sweet", "acid", "body", "cup", "tds", "notes"].some(
        (k) => typeof value.result[k] !== "string",
      )
    )
      return null;
    if (value.phase === "ready") {
      if (
        value.startedAt !== null ||
        value.runningSince !== null ||
        value.elapsedMs !== 0 ||
        value.index !== 0 ||
        value.actualStarts.some((t) => t !== null)
      )
        return null;
    } else {
      if (
        typeof value.startedAt !== "string" ||
        !Number.isFinite(Date.parse(value.startedAt)) ||
        (value.phase === "running"
          ? !Number.isFinite(value.runningSince)
          : value.runningSince !== null) ||
        value.temperatures.some((t) => t === null) ||
        value.actualStarts[0] !== 0
      )
        return null;
      let previous = 0;
      for (let i = 0; i < value.actualStarts.length; i++) {
        const t = value.actualStarts[i];
        if (i <= value.index) {
          if (!seconds(t) || t < previous) return null;
          previous = t;
        } else if (t !== null) return null;
      }
      if (
        value.phase === "review" &&
        (value.index !== value.recipe.pours.length - 1 ||
          validateRecord(record(value), value.recipe))
      )
        return null;
    }
    return JSON.parse(JSON.stringify(value));
  }

  const preparation = Object.freeze({
    DRAFT_KEY,
    createDraft,
    elapsedSeconds,
    start,
    pause,
    resume,
    advance,
    finish,
    record,
    validateRecord,
    restoreDraft,
  });
  if (typeof module !== "undefined" && module.exports)
    module.exports = preparation;
  else (root.BlossomLab ??= {}).preparation = preparation;
})(globalThis);
