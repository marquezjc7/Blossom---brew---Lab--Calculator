(function (root) {
  "use strict";
  // Practical BH approximation: 1 g of either stock per 1 kg final water ≈ 1 ppm as CaCO3.
  // These are not ion concentrations, measured TDS or a full SCA water specification.
  const SYSTEM = "bh-1.68-2.45-v1";
  const DRAFT_KEY = "blossom-brew-water-draft-v1";
  const references = Object.freeze(
    [
      { id: "melbourne", name: "Melbourne", gh: 24, alkalinity: 12 },
      { id: "woc-budapest", name: "WOC Budapest", gh: 51.2, alkalinity: 40.1 },
      { id: "sca-bh-2019", name: "SCA (BH 2019)", gh: 69, alkalinity: 40 },
      { id: "barista-hustle", name: "Barista Hustle", gh: 81, alkalinity: 40 },
      { id: "rao-water", name: "Rao Water", gh: 76, alkalinity: 50 },
      { id: "hendon-water", name: "Hendon Water", gh: 100, alkalinity: 31 },
      { id: "pretty-hard", name: "Pretty Hard", gh: 126, alkalinity: 35 },
      { id: "hard-dot-af", name: "Hard dot AF", gh: 177, alkalinity: 45 },
    ].map(Object.freeze),
  );

  function validateProfile(profile) {
    if (
      !profile ||
      profile.version !== 1 ||
      profile.system !== SYSTEM ||
      profile.base !== "distilled"
    )
      return "El perfil de agua debe usar el sistema de dos concentrados de 1.68 y 2.45 g/L con agua destilada.";
    if (
      typeof profile.name !== "string" ||
      !profile.name.trim() ||
      profile.name.length > 100
    )
      return "Escribe un nombre para el perfil de agua de hasta 100 caracteres.";
    if (
      !Number.isFinite(profile.liters) ||
      profile.liters < 0.1 ||
      profile.liters > 100
    )
      return "El volumen final debe estar entre 0.1 y 100 litros.";
    if (
      !Number.isFinite(profile.gh) ||
      !Number.isFinite(profile.alkalinity) ||
      profile.gh < 0 ||
      profile.alkalinity < 0 ||
      profile.gh > 1000 ||
      profile.alkalinity > 1000
    )
      return "GH y alcalinidad deben ser números entre 0 y 1000 ppm como CaCO₃.";
    if (profile.gh + profile.alkalinity > 1000)
      return "Estos objetivos requieren más concentrados que la cantidad total de agua. Reduce GH o alcalinidad.";
    return null;
  }

  function makeProfile(values) {
    const profile = {
      version: 1,
      system: SYSTEM,
      base: "distilled",
      name: values.name,
      liters: values.liters,
      gh: values.gh,
      alkalinity: values.alkalinity,
    };
    const error = validateProfile(profile);
    if (error) throw new Error(error);
    return profile;
  }

  function calculate(profile) {
    const error = validateProfile(profile);
    if (error) throw new Error(error);
    // Work in 0.1 g ticks. Deduct the rounded stocks so displayed amounts sum to the total.
    const ticks = (n) =>
      Math.round((n + Number.EPSILON * Math.max(1, n) * 4) * 10);
    const total = ticks(profile.liters * 1000);
    const buffer = ticks(profile.alkalinity * profile.liters);
    const hardness = Math.min(
      ticks(profile.gh * profile.liters),
      total - buffer,
    );
    return {
      buffer: buffer / 10,
      hardness: hardness / 10,
      distilled: (total - buffer - hardness) / 10,
      total: total / 10,
    };
  }

  function profileKey(profile) {
    return JSON.stringify([
      profile.system,
      profile.name,
      profile.gh,
      profile.alkalinity,
      profile.liters,
    ]);
  }

  function recipeText(profile) {
    const amounts = calculate(profile);
    const f = (n) => n.toLocaleString("es-ES", { maximumFractionDigits: 1 });
    const volume = profile.liters.toLocaleString("es-ES", {
      maximumFractionDigits: 3,
    });
    return (
      `Blossom · ${profile.name}\n` +
      `Agua final aproximada: ${volume} L (${f(amounts.total)} g)\n` +
      `GH objetivo ≈ ${f(profile.gh)} ppm como CaCO₃\n` +
      `Alcalinidad objetivo (KH) ≈ ${f(profile.alkalinity)} ppm como CaCO₃\n\n` +
      `Buffer: ${f(amounts.buffer)} g de concentrado de NaHCO₃ a 1.68 g/L\n` +
      `Dureza: ${f(amounts.hardness)} g de concentrado de MgSO₄·7H₂O a 2.45 g/L\n` +
      `Agua destilada: ${f(amounts.distilled)} g\n\n` +
      "Pesa por separado las soluciones ya preparadas y el agua destilada; después mezcla.\n" +
      "Aproximación BH: 1 g de solución ≈ 1 mL; agua base con GH y alcalinidad prácticamente cero.\n" +
      "Los objetivos no son mediciones. Comprueba el agua final con un kit adecuado.\n" +
      "No evalúa todos los parámetros de una norma SCA ni la compatibilidad con una máquina de espresso."
    );
  }

  const water = Object.freeze({
    SYSTEM,
    DRAFT_KEY,
    references,
    validateProfile,
    makeProfile,
    calculate,
    profileKey,
    recipeText,
  });
  if (typeof module !== "undefined" && module.exports) module.exports = water;
  else (root.BlossomLab ??= {}).water = water;
})(globalThis);
