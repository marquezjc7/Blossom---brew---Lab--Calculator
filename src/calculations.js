(function (root) {
  "use strict";

  function isPositive(value) {
    return Number.isFinite(value) && value > 0;
  }

  function calculateRatio(dose, water) {
    return isPositive(dose) && isPositive(water) ? water / dose : NaN;
  }

  function calculateWater(dose, ratio) {
    return isPositive(dose) && isPositive(ratio) ? dose * ratio : NaN;
  }

  function calculateExtraction(dose, beverage, tds) {
    if (
      !isPositive(dose) ||
      !isPositive(beverage) ||
      !isPositive(tds) ||
      tds > 30
    ) {
      return null;
    }
    return {
      yieldPercent: (tds * beverage) / dose,
      dissolvedSolids: (tds / 100) * beverage,
    };
  }

  function scalePours(pours, referenceWater, water) {
    if (
      !Array.isArray(pours) ||
      !pours.length ||
      !isPositive(referenceWater) ||
      !isPositive(water)
    ) {
      return null;
    }
    const scale = water / referenceWater;
    let previous = 0;
    return pours.map((pour) => {
      const result = {
        cumulative: pour * scale,
        incremental: (pour - previous) * scale,
      };
      previous = pour;
      return result;
    });
  }

  const calculations = Object.freeze({
    isPositive,
    calculateRatio,
    calculateWater,
    calculateExtraction,
    scalePours,
  });

  // Classic scripts keep index.html usable directly via file://, without a build.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = calculations;
  } else {
    (root.BlossomLab ??= {}).calculations = calculations;
  }
})(globalThis);
