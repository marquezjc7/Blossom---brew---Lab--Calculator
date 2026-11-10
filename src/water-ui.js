(function (root) {
  "use strict";
  root.BlossomLab.createWaterLab = function ({
    store,
    getProfiles,
    onApply,
    onDownload,
  }) {
    const core = root.BlossomLab.water;
    const $ = (id) => document.getElementById(id);
    const f = (n) =>
      n.toLocaleString("es-ES", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      });
    let savedProfiles = new Map();
    function status(text, error = false) {
      $("waterFeedback").hidden = !text;
      $("waterFeedback").textContent = text;
      $("waterFeedback").classList.toggle("error", error);
      $("waterFeedback").setAttribute("role", error ? "alert" : "status");
    }
    function read() {
      return core.makeProfile({
        name: $("waterName").value.trim() || "Agua personalizada",
        gh: $("waterGH").valueAsNumber,
        alkalinity: $("waterAlkalinity").valueAsNumber,
        liters: $("waterLiters").valueAsNumber,
      });
    }
    function render(persist = true) {
      status("");
      $("waterCopyText").hidden = true;
      try {
        const profile = read();
        const amounts = core.calculate(profile);
        for (const [key, value] of Object.entries(amounts))
          $("waterAmount_" + key).textContent = f(value) + " g";
        for (const [field, range, minimumMax] of [
          ["waterGH", "waterGHRange", 250],
          ["waterAlkalinity", "waterAlkalinityRange", 150],
        ]) {
          $(range).max = Math.max(minimumMax, $(field).valueAsNumber);
          $(range).value = $(field).value;
        }
        for (const id of ["waterCopy", "waterDownload", "waterApply"])
          $(id).disabled = false;
        if (persist && !store.write(core.DRAFT_KEY, profile))
          status(
            "El cálculo está listo, pero este navegador no pudo conservarlo al recargar. Puedes copiarlo o descargarlo.",
            true,
          );
      } catch (error) {
        for (const key of ["buffer", "hardness", "distilled", "total"])
          $("waterAmount_" + key).textContent = "—";
        for (const id of ["waterCopy", "waterDownload", "waterApply"])
          $(id).disabled = true;
        status(error.message, true);
      }
    }
    function load(profile, selected = "custom") {
      if (core.validateProfile(profile))
        return status("No se pudo abrir ese perfil de agua.", true);
      $("waterName").value = profile.name;
      $("waterGH").value = profile.gh;
      $("waterAlkalinity").value = profile.alkalinity;
      $("waterLiters").value = profile.liters;
      $("waterPreset").value = selected;
      render();
    }
    function refreshProfiles() {
      const keep = $("waterPreset").value;
      const selector = $("waterPreset");
      selector.replaceChildren();
      const add = (parent, value, label) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        parent.append(option);
      };
      const refs = document.createElement("optgroup");
      refs.label = "Referencias compartidas · aproximadas";
      for (const r of core.references) add(refs, r.id, r.name);
      selector.append(refs);
      add(selector, "custom", "Personalizada");
      savedProfiles = new Map();
      for (const p of getProfiles())
        if (!core.validateProfile(p))
          savedProfiles.set("saved:" + core.profileKey(p), p);
      if (savedProfiles.size) {
        const group = document.createElement("optgroup");
        group.label = "Perfiles guardados en tus recetas y bitácora";
        for (const [id, p] of savedProfiles)
          add(group, id, `${p.name} · GH ${f(p.gh)} / KH ${f(p.alkalinity)}`);
        selector.append(group);
      }
      selector.value = [...selector.options].some(
        (option) => option.value === keep,
      )
        ? keep
        : "custom";
    }
    $("waterPreset").addEventListener("change", () => {
      const id = $("waterPreset").value;
      const reference = core.references.find((r) => r.id === id);
      if (reference)
        load(
          core.makeProfile({
            ...reference,
            liters: $("waterLiters").valueAsNumber || 1,
          }),
          id,
        );
      else if (savedProfiles.has(id)) load(savedProfiles.get(id), id);
      else {
        $("waterName").value = "Agua personalizada";
        render();
      }
    });
    function customize() {
      if (core.references.some((r) => r.id === $("waterPreset").value))
        $("waterName").value = "Agua personalizada";
      $("waterPreset").value = "custom";
    }
    for (const [input, range] of [
      ["waterGH", "waterGHRange"],
      ["waterAlkalinity", "waterAlkalinityRange"],
    ]) {
      $(range).addEventListener("input", () => {
        $(input).value = $(range).value;
        customize();
        render();
      });
      $(input).addEventListener("input", () => {
        customize();
        render();
      });
    }
    $("waterName").addEventListener("input", () => {
      $("waterPreset").value = "custom";
      render();
    });
    $("waterLiters").addEventListener("input", () => render());
    $("waterVolumes").addEventListener("click", (event) => {
      const volume = event.target.dataset.waterVolume;
      if (volume) {
        $("waterLiters").value = volume;
        render();
      }
    });
    $("waterApply").addEventListener("click", () => {
      try {
        onApply(read());
      } catch (error) {
        status(error.message, true);
      }
    });
    $("waterDownload").addEventListener("click", () => {
      try {
        onDownload(core.recipeText(read()));
      } catch (error) {
        status(error.message, true);
      }
    });
    $("waterCopy").addEventListener("click", async () => {
      let text;
      try {
        text = core.recipeText(read());
      } catch (error) {
        return status(error.message, true);
      }
      try {
        if (!navigator.clipboard?.writeText)
          throw new Error("Clipboard unavailable");
        await navigator.clipboard.writeText(text);
        status(
          "Receta de agua copiada, con las concentraciones y las unidades.",
        );
      } catch {
        $("waterCopyText").value = text;
        $("waterCopyText").hidden = false;
        $("waterCopyText").focus();
        $("waterCopyText").select();
        status(
          "Selecciona «Copiar» en el texto, o pulsa «Descargar receta TXT» para conservarlo.",
        );
      }
    });
    refreshProfiles();
    const draft = store.read(core.DRAFT_KEY);
    const defaultRef = core.references.find((r) => r.id === "woc-budapest");
    if (!core.validateProfile(draft)) {
      const ref = core.references.find(
        (r) =>
          r.name === draft.name &&
          r.gh === draft.gh &&
          r.alkalinity === draft.alkalinity,
      );
      load(draft, ref?.id ?? "custom");
    } else load(core.makeProfile({ ...defaultRef, liters: 1 }), defaultRef.id);
    return { load, refreshProfiles };
  };
})(globalThis);
