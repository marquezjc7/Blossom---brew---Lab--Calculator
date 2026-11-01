(function (root) {
  "use strict";
  const defaults = [
    {
      id: "bourbon-natural",
      name: "Bourbon Natural · V60 Neo",
      coffee: "Bourbon Natural",
      method: "V60 Neo",
      dose: 15,
      water: 240,
      ratio: 16,
      temp: 92,
      bloom: 45,
      time: "2:47",
      grind: "116",
      pours: [45, 145, 240],
      notes:
        "Perfil registrado: azúcar morena, naranja roja, cuerpo medio y posgusto largo. Versión preferida por mayor dulzura y complejidad.",
    },
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
    {
      id: "pacas-natural",
      name: "Pacas Natural · V60 Neo",
      coffee: "Pacas Natural",
      method: "V60 Neo",
      dose: 15,
      water: 240,
      ratio: 16,
      temp: 88,
      bloom: 45,
      time: "2:52",
      grind: "116",
      pours: null,
      bloomWater: 50,
      notes:
        "Prueba registrada: piña, frambuesa, naranja dulce, arándanos, avellana y toffee; final cremoso. El plan exacto de vertidos posteriores al bloom no está documentado.",
    },
  ];
  if (typeof module !== "undefined" && module.exports) {
    module.exports = defaults;
  } else {
    (root.BlossomLab ??= {}).recipes = defaults;
  }
})(globalThis);
