(function (root) {
  "use strict";
  const defaults = [
    {
      id: "bourbon-lavado",
      name: "Bourbon Lavado · Baseline",
      coffee: "Bourbon Lavado",
      method: "V60 Neo",
      dose: 15,
      water: 240,
      ratio: 16,
      temp: 93,
      bloom: 45,
      time: "2:47",
      grind: "116",
      pours: [45, 145, 240],
      notes:
        "Receta base de comparación. Los valores sensoriales deben registrarse después de cada sesión.",
    },
  ];
  if (typeof module !== "undefined" && module.exports) {
    module.exports = defaults;
  } else {
    (root.BlossomLab ??= {}).recipes = defaults;
  }
})(globalThis);
