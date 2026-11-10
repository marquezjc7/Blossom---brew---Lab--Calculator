(function (root) {
  "use strict";

  const BACKUP_FORMAT = "blossom-brew-lab-v1";
  const { validatePlan, getPourCount, validatePourCount } =
    typeof module !== "undefined" && module.exports
      ? require("./plans.js")
      : root.BlossomLab.plans;
  const { validateRecord } =
    typeof module !== "undefined" && module.exports
      ? require("./preparation.js")
      : root.BlossomLab.preparation;

  function createBackup(
    recipes,
    sessions,
    exportedAt = new Date().toISOString(),
  ) {
    return { format: BACKUP_FORMAT, version: 1, exportedAt, recipes, sessions };
  }

  function parseBackup(text) {
    const data = JSON.parse(text);
    if (
      !data ||
      data.format !== BACKUP_FORMAT ||
      !Array.isArray(data.recipes) ||
      !Array.isArray(data.sessions)
    ) {
      throw new Error("Archivo no compatible");
    }
    // V1 files without optional timing fields remain valid and unchanged.
    for (const item of [...data.recipes, ...data.sessions]) {
      if (item?.preparation != null) {
        const error = validateRecord(item.preparation, item);
        if (error) throw new Error(error);
      }
      if (
        item &&
        item.grindMicrons != null &&
        (!Number.isFinite(item.grindMicrons) || item.grindMicrons <= 0)
      ) {
        throw new Error(
          "El grosor en µm debe ser un número mayor que 0, o quedar sin especificar.",
        );
      }
      if (
        item &&
        item.temp2 != null &&
        (!Number.isFinite(item.temp2) || item.temp2 < 0 || item.temp2 > 100)
      ) {
        throw new Error(
          "La temperatura 2 debe estar entre 0 y 100 °C o quedar sin especificar.",
        );
      }
      if (item && Object.hasOwn(item, "pourCount")) {
        const error = validatePourCount(item);
        if (error) throw new Error(error);
      }
      if (item && Object.hasOwn(item, "pourTimes")) {
        const error = validatePlan(
          item.pours,
          item.pourTimes,
          Number(item.water),
          item.time ?? "",
        );
        if (error) throw new Error(error);
      }
    }
    return data;
  }

  function csvCell(value) {
    let text = String(value ?? "");
    if (/^[=+@\-]/.test(text) && isNaN(Number(text))) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }

  function sessionsToCsv(sessions) {
    const headers = [
      "fecha",
      "cafe",
      "metodo",
      "dosis_g",
      "agua_g",
      "ratio",
      "temperatura_C",
      "molienda",
      "tiempo",
      "TDS_bebida_pct",
      "bebida_g",
      "EY_pct",
      "dulzura_0_10",
      "acidez_0_10",
      "cuerpo_0_10",
      "notas",
      "molino",
      "grosor_molienda",
      "vertidos_despues_bloom",
      "temperatura_2_C",
      "grosor_molienda_um",
      "tiempo_real_s",
      "inicios_reales_s",
      "temperaturas_vertidos_C",
    ];
    const rows = sessions.map((session) => [
      session.date,
      session.coffee,
      session.method,
      session.dose,
      session.water,
      session.realRatio,
      session.temp,
      session.grind,
      session.time,
      session.tds ?? "",
      session.cup ?? "",
      session.extraction ?? "",
      session.score?.sweet ?? "",
      session.score?.acid ?? "",
      session.score?.body ?? "",
      session.notes || "",
      session.grinder ?? "",
      session.grindSize ?? "",
      getPourCount(session) ?? "",
      session.temp2 ?? "",
      session.grindMicrons ?? "",
      session.preparation?.durationSeconds ?? "",
      session.preparation?.actualStarts?.join(" / ") ?? "",
      session.preparation?.temperatures?.join(" / ") ?? "",
    ]);
    return (
      "\uFEFF" +
      [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")
    );
  }

  const transfers = Object.freeze({
    BACKUP_FORMAT,
    createBackup,
    parseBackup,
    sessionsToCsv,
  });
  if (typeof module !== "undefined" && module.exports) {
    module.exports = transfers;
  } else {
    (root.BlossomLab ??= {}).transfers = transfers;
  }
})(globalThis);
