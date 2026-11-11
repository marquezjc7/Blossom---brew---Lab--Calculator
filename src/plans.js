(function (root) {
  "use strict";
  const valveLabels = Object.freeze({
    unknown: "Sin especificar",
    open: "Abierta",
    closed: "Cerrada",
    none: "No aplica",
  });
  const STEP_NOTE_LIMIT = 500;

  function getPourStep(recipe, index) {
    const step = recipe?.pourSteps?.[index];
    return {
      valve: Object.hasOwn(valveLabels, step?.valve) ? step.valve : "unknown",
      note: typeof step?.note === "string" ? step.note : "",
    };
  }
  function validatePourSteps(recipe) {
    if (recipe?.pourSteps == null) return null;
    if (
      !Array.isArray(recipe.pours) ||
      !recipe.pours.length ||
      !Array.isArray(recipe.pourSteps) ||
      recipe.pourSteps.length !== recipe.pours.length
    )
      return "Las indicaciones deben corresponder a cada paso de un plan completo de vertidos.";
    for (const step of recipe.pourSteps) {
      if (
        !step ||
        typeof step !== "object" ||
        Array.isArray(step) ||
        (step.valve != null && !Object.hasOwn(valveLabels, step.valve)) ||
        (step.note != null &&
          (typeof step.note !== "string" || step.note.length > STEP_NOTE_LIMIT))
      )
        return `Revisa la válvula de cada paso y utiliza indicaciones de hasta ${STEP_NOTE_LIMIT} caracteres.`;
    }
    return null;
  }
  function pourStepText(recipe, index) {
    const step = getPourStep(recipe, index);
    return (
      `Válvula al comenzar: ${valveLabels[step.valve]}` +
      (step.note ? `\n${step.note}` : "")
    );
  }

  function parseTime(value) {
    if (value == null || value === "") return null;
    if (typeof value !== "string" || !/^\d{1,3}:[0-5]\d$/.test(value))
      return NaN;
    const [minutes, seconds] = value.split(":").map(Number);
    return minutes * 60 + seconds;
  }

  function formatTime(seconds) {
    if (!Number.isInteger(seconds) || seconds < 0 || seconds > 59999) return "";
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }

  function validatePlan(pours, pourTimes, water, finalTime = "") {
    if (!Number.isFinite(water) || water <= 0)
      return "Introduce un peso de agua válido antes de definir el plan.";
    const end = parseTime(finalTime);
    if (Number.isNaN(end) || end === 0)
      return "El tiempo final debe usar mm:ss y ser mayor que 0:00, o quedar vacío si no lo conoces.";
    if (pours == null) {
      return pourTimes != null
        ? "Los tiempos necesitan un plan de vertidos completo."
        : null;
    }
    if (!Array.isArray(pours) || !pours.length || pours.length > 50)
      return "El plan debe tener entre 1 y 50 vertidos.";
    let previous = 0;
    for (const weight of pours) {
      if (
        !Number.isFinite(weight) ||
        weight <= previous ||
        weight > water + 1e-6
      ) {
        return "Los pesos acumulados deben ser positivos, aumentar en cada vertido y no superar el agua total.";
      }
      previous = weight;
    }
    if (Math.abs(previous - water) > 1e-6)
      return "El último peso acumulado debe coincidir con el agua total de la receta.";
    if (pourTimes == null) return null;
    if (!Array.isArray(pourTimes) || pourTimes.length !== pours.length)
      return "Cada vertido debe tener su campo de tiempo, aunque quede sin registrar.";
    let previousTime = -1;
    for (const seconds of pourTimes) {
      if (seconds === null) continue;
      if (!Number.isInteger(seconds) || seconds < 0 || seconds > 59999)
        return "Usa mm:ss en los tiempos de inicio, o deja el campo vacío si no lo conoces.";
      if (seconds <= previousTime)
        return "Los tiempos registrados deben aumentar según el orden de los vertidos.";
      if (end !== null && seconds >= end)
        return "Cada vertido debe comenzar antes del tiempo final de preparación.";
      previousTime = seconds;
    }
    return null;
  }

  // Quantities scale with water; recorded start times never scale automatically.
  function snapshotPlan(reference, water) {
    const withSteps = (result) => {
      if (reference.pourSteps != null)
        result.pourSteps = JSON.parse(JSON.stringify(reference.pourSteps));
      return result;
    };
    const factor = water / reference.water;
    if (!Number.isFinite(factor) || factor <= 0)
      return withSteps({ pours: null });
    if (Array.isArray(reference.pours) && reference.pours.length) {
      const result = {
        pours: reference.pours.map((weight) => weight * factor),
      };
      if (Array.isArray(reference.pourTimes))
        result.pourTimes = [...reference.pourTimes];
      return withSteps(result);
    }
    const result = { pours: null };
    if (Number.isFinite(reference.bloomWater) && reference.bloomWater > 0) {
      result.bloomWater = reference.bloomWater * factor;
    }
    return withSteps(result);
  }

  function getPourCount(recipe) {
    // The first entry is the bloom; the remaining entries are numbered pours.
    if (Array.isArray(recipe.pours) && recipe.pours.length)
      return recipe.pours.length - 1;
    return Number.isInteger(recipe.pourCount) &&
      recipe.pourCount >= 0 &&
      recipe.pourCount <= 49
      ? recipe.pourCount
      : null;
  }

  function validatePourCount(recipe) {
    const count = recipe.pourCount;
    if (count == null) return null;
    if (!Number.isInteger(count) || count < 0 || count > 49) {
      return "El número de vertidos debe ser un entero de 0 a 49, sin incluir el bloom, o quedar vacío si no lo conoces.";
    }
    if (
      Array.isArray(recipe.pours) &&
      recipe.pours.length &&
      count !== recipe.pours.length - 1
    ) {
      return "El número de vertidos no coincide con el plan. Ajusta el plan en «Editar vertidos»; el bloom se cuenta por separado.";
    }
    if (
      count === 0 &&
      Number.isFinite(recipe.bloomWater) &&
      recipe.bloomWater > 0 &&
      recipe.bloomWater < recipe.water
    ) {
      return "Hay agua restante después del bloom. Registra los vertidos posteriores o deja su número sin especificar.";
    }
    return null;
  }

  const plans = Object.freeze({
    valveLabels,
    STEP_NOTE_LIMIT,
    getPourStep,
    validatePourSteps,
    pourStepText,
    parseTime,
    formatTime,
    validatePlan,
    snapshotPlan,
    getPourCount,
    validatePourCount,
  });
  if (typeof module !== "undefined" && module.exports) {
    module.exports = plans;
  } else {
    (root.BlossomLab ??= {}).plans = plans;
  }
})(globalThis);
