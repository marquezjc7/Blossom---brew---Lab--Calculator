(function (root) {
  "use strict";
  const { parseTime, formatTime, validatePlan } = root.BlossomLab.plans;

  function createPourEditor({ getRecipe, onApply, onDraftChange }) {
    const form = document.getElementById("pourEditor");
    const container = document.getElementById("pourRows");
    const openButton = document.getElementById("editPours");
    const addButton = document.getElementById("addPour");
    const error = document.getElementById("pourError");
    let changed = false;

    function values() {
      return [...container.querySelectorAll(".pour-row")].map((row) => ({
        weight: row.querySelector(".pour-weight").value,
        time: row.querySelector(".pour-start").value,
      }));
    }

    function draw(rows) {
      container.replaceChildren();
      rows.forEach((row, index) => {
        const fieldset = document.createElement("fieldset");
        fieldset.className = "pour-row";
        fieldset.innerHTML = `
          <legend>${index === 0 ? "Bloom" : `Vertido ${index}`}</legend>
          <div class="fields">
            <div class="field">
              <label for="pourWeight${index}">Peso acumulado (g)</label>
              <input id="pourWeight${index}" class="pour-weight" type="number" min="0.01" max="20000" step="0.01" inputmode="decimal" aria-describedby="pourEditorHelp" />
            </div>
            <div class="field">
              <label for="pourStart${index}">Inicio (mm:ss, opcional)</label>
              <input id="pourStart${index}" class="pour-start" type="text" placeholder="Sin registrar" maxlength="6" aria-describedby="pourEditorHelp" />
            </div>
          </div>
          <button type="button" class="btn remove-pour" aria-label="Eliminar ${index === 0 ? "bloom" : `vertido ${index}`}">Eliminar</button>`;
        fieldset.querySelector(".pour-weight").value = row.weight;
        fieldset.querySelector(".pour-start").value = row.time;
        fieldset.querySelector(".remove-pour").addEventListener("click", () => {
          const remaining = values();
          remaining.splice(index, 1);
          draw(remaining);
          markChanged();
          (container.querySelector("input") ?? addButton).focus();
        });
        container.append(fieldset);
      });
      if (!rows.length) {
        const empty = document.createElement("p");
        empty.className = "note";
        empty.textContent =
          "Sin plan documentado. Agrega solo los vertidos que conozcas; para aplicar un plan completo debes registrar toda el agua.";
        container.append(empty);
      }
      addButton.disabled = rows.length >= 50;
    }

    function markChanged() {
      changed = true;
      error.hidden = true;
      onDraftChange();
    }

    function close(focus = true) {
      form.hidden = true;
      openButton.disabled = false;
      openButton.setAttribute("aria-expanded", "false");
      changed = false;
      error.hidden = true;
      onDraftChange();
      if (focus) openButton.focus();
    }

    function open(plan) {
      const weights = plan.pours ?? (plan.bloomWater ? [plan.bloomWater] : []);
      draw(
        weights.map((weight, index) => ({
          weight: Number(weight.toFixed(2)),
          time: formatTime(plan.pourTimes?.[index]),
        })),
      );
      form.hidden = false;
      error.hidden = true;
      openButton.disabled = true;
      openButton.setAttribute("aria-expanded", "true");
      changed = false;
      onDraftChange();
      (container.querySelector("input") ?? addButton).focus();
    }

    addButton.addEventListener("click", () => {
      const rows = values();
      if (rows.length >= 50) return;
      rows.push({ weight: "", time: "" });
      draw(rows);
      markChanged();
      container.querySelector(".pour-row:last-child .pour-weight").focus();
    });
    form.addEventListener("input", markChanged);
    document
      .getElementById("cancelPours")
      .addEventListener("click", () => close());
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const rows = values();
      const plan = {
        pours: rows.length ? rows.map((row) => Number(row.weight)) : null,
      };
      const times = rows.map((row) => parseTime(row.time.trim()));
      if (times.some((time) => time !== null)) plan.pourTimes = times;
      const recipe = getRecipe();
      const message = validatePlan(
        plan.pours,
        plan.pourTimes,
        recipe.water,
        recipe.time,
      );
      if (message) {
        error.textContent = message;
        error.hidden = false;
        error.tabIndex = -1;
        error.focus();
        return;
      }
      close(false);
      onApply(plan);
      openButton.focus();
    });

    return {
      open,
      close,
      get isOpen() {
        return !form.hidden;
      },
      get isDirty() {
        return changed;
      },
    };
  }

  root.BlossomLab.createPourEditor = createPourEditor;
})(globalThis);
