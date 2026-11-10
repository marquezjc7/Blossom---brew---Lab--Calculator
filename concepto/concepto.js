(function () {
  "use strict";
  const { calculateRatio, calculateWater, scalePours } =
    BlossomLab.calculations;
  const baseline = BlossomLab.recipes[0];
  const $ = (id) => document.getElementById(id);
  const number = (value, digits = 1) =>
    value.toLocaleString("es-ES", { maximumFractionDigits: digits });
  const feedback = (message, error = false) => {
    $("feedback").hidden = !message;
    $("feedback").textContent = message;
    $("feedback").classList.toggle("error", error);
    $("feedback").setAttribute("role", error ? "alert" : "status");
  };
  function values() {
    const temp2 =
      $("temperature2").value === "" ? null : $("temperature2").valueAsNumber;
    return {
      dose: $("dose").valueAsNumber,
      water: $("water").valueAsNumber,
      ratio: $("ratio").valueAsNumber,
      temp: $("temperature").valueAsNumber,
      temp2,
      bloom: $("bloom").valueAsNumber,
    };
  }
  function errorFor(r) {
    if (!Number.isFinite(r.dose) || r.dose <= 0 || r.dose > 1000)
      return "Introduce una dosis de café entre 0 y 1000 g, mayor que cero.";
    if (!Number.isFinite(r.water) || r.water <= 0 || r.water > 20000)
      return "Introduce un peso de agua entre 0 y 20000 g, mayor que cero.";
    if (!Number.isFinite(r.ratio) || r.ratio < 1 || r.ratio > 100)
      return "El ratio debe estar entre 1 y 100.";
    if (
      !Number.isFinite(r.temp) ||
      r.temp < 0 ||
      r.temp > 100 ||
      (r.temp2 !== null &&
        (!Number.isFinite(r.temp2) || r.temp2 < 0 || r.temp2 > 100))
    )
      return "Las temperaturas deben estar entre 0 y 100 °C.";
    if (!Number.isInteger(r.bloom) || r.bloom < 0 || r.bloom > 900)
      return "El bloom debe ser un número entero entre 0 y 900 segundos.";
    if ($("endTime").value && !/^\d{1,3}:[0-5]\d$/.test($("endTime").value))
      return "El tiempo objetivo debe usar mm:ss o quedar vacío.";
    return null;
  }
  function render() {
    feedback("");
    $("copyFallback").hidden = true;
    const r = values();
    const error = errorFor(r);
    $("copyRecipe").disabled = !!error;
    $("secondTempResult").hidden = r.temp2 === null || !!error;
    if (error) {
      for (const id of [
        "ratioResult",
        "waterResult",
        "doseResult",
        "tempResult",
      ])
        $(id).textContent = "—";
      $("pourPlan").replaceChildren();
      feedback(error, true);
      return;
    }
    $("ratioResult").textContent =
      "1:" + number(calculateRatio(r.dose, r.water), 2);
    $("waterResult").textContent = number(r.water);
    $("doseResult").textContent = number(r.dose) + " g";
    $("tempResult").textContent = number(r.temp) + " °C";
    $("secondTempResult").textContent =
      "Temperatura 2 · " + number(r.temp2 ?? 0) + " °C";
    $("recipeSummary").textContent =
      $("method").value.toLocaleUpperCase("es-ES") +
      " · " +
      $("coffee").value.trim().toLocaleUpperCase("es-ES");
    $("pourPlan").innerHTML = scalePours(
      baseline.pours,
      baseline.water,
      r.water,
    )
      .map(
        (step, i) =>
          `<li><span class="pour-number">${String(i + 1).padStart(2, "0")}</span><span class="pour-label">${i === 0 ? "Bloom" : "Vertido " + i}<small>Añade ${number(step.incremental)} g${i === 0 ? " · " + r.bloom + " s" : ""}</small></span><strong class="pour-total">Hasta ${number(step.cumulative)} g</strong></li>`,
      )
      .join("");
  }
  function reset() {
    $("recipeForm").reset();
    render();
  }
  $("recipeForm").addEventListener("input", (event) => {
    const id = event.target.id;
    if (["dose", "ratio"].includes(id)) {
      const target = calculateWater(
        $("dose").valueAsNumber,
        $("ratio").valueAsNumber,
      );
      if (Number.isFinite(target)) $("water").value = Number(target.toFixed(2));
    } else if (id === "water") {
      const ratio = calculateRatio(
        $("dose").valueAsNumber,
        $("water").valueAsNumber,
      );
      if (Number.isFinite(ratio)) $("ratio").value = Number(ratio.toFixed(4));
    }
    if (id !== "reference") $("reference").value = "custom";
    render();
  });
  $("reference").addEventListener("change", () => {
    if ($("reference").value === "baseline") reset();
  });
  $("grinder").addEventListener("change", () => {
    $("grind").value = "";
    render();
  });
  $("resetRecipe").addEventListener("click", () => {
    reset();
    feedback("Referencia restablecida.");
  });
  $("recipeForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const r = values();
    const error = errorFor(r);
    if (error) return feedback(error, true);
    const pours = scalePours(baseline.pours, baseline.water, r.water);
    const text =
      `Blossom Brew Lab · Prueba de diseño\n${$("coffee").value.trim()} · ${$("method").value}\n` +
      `Café: ${number(r.dose)} g · Agua: ${number(r.water)} g · Ratio 1:${number(calculateRatio(r.dose, r.water), 2)}\n` +
      `Temperatura 1: ${number(r.temp)} °C${r.temp2 == null ? "" : " · Temperatura 2: " + number(r.temp2) + " °C"}\n` +
      `Molino: ${$("grinder").value || "sin especificar"} · Ajuste: ${$("grind").value || "sin especificar"}\n` +
      `Molienda: ${$("grindSize").value || "sin especificar"} · Bloom: ${r.bloom} s · Tiempo objetivo: ${$("endTime").value || "sin registrar"}\n` +
      pours
        .map(
          (step, i) =>
            `${i === 0 ? "Bloom" : "Vertido " + i}: añade ${number(step.incremental)} g, hasta ${number(step.cumulative)} g acumulados`,
        )
        .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      feedback(
        "Preparación copiada. Puedes conservar este texto mientras revisas la propuesta.",
      );
    } catch {
      $("copyFallback").value = text;
      $("copyFallback").hidden = false;
      $("copyFallback").focus();
      $("copyFallback").select();
      feedback(
        "Selecciona «Copiar» en este texto para conservar la preparación.",
      );
    }
  });
  render();
})();
