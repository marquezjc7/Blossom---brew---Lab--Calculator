const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  createBackup,
  parseBackup,
  sessionsToCsv,
} = require("../src/transfers.js");

test("los respaldos conservan el formato V1 y todos los datos", () => {
  const recipes = [{ name: "Mi café", dose: 18, water: 288 }];
  const sessions = [
    { coffee: "Mi café", notes: "Naranja, azúcar", extraction: null },
  ];
  const backup = createBackup(recipes, sessions, "2026-10-31T12:00:00.000Z");
  assert.deepEqual(parseBackup(JSON.stringify(backup)), {
    format: "blossom-brew-lab-v1",
    version: 1,
    exportedAt: "2026-10-31T12:00:00.000Z",
    recipes,
    sessions,
  });
});

test("un respaldo V1 anterior se puede importar sin migración", () => {
  const text =
    '{"format":"blossom-brew-lab-v1","version":1,"recipes":[],"sessions":[]}';
  assert.deepEqual(parseBackup(text).sessions, []);
});

test("rechaza JSON ilegible, formatos ajenos y colecciones ausentes", () => {
  for (const text of [
    "no es JSON",
    "null",
    "{}",
    '{"format":"otro","recipes":[],"sessions":[]}',
    '{"format":"blossom-brew-lab-v1","recipes":[],"sessions":{}}',
    '{"format":"blossom-brew-lab-v1","sessions":[]}',
  ]) {
    assert.throws(() => parseBackup(text));
  }
});

test("el CSV conserva las columnas anteriores y agrega el número de vertidos al final", () => {
  const csv = sessionsToCsv([]);
  assert.ok(csv.startsWith('\uFEFF"fecha","cafe"'));
  assert.equal(csv.slice(1).split(",").length, 19);
  assert.ok(
    csv.endsWith('"notas","molino","grosor_molienda","vertidos_despues_bloom"'),
  );
  const cells = sessionsToCsv([{ grind: "116" }])
    .split("\r\n")[1]
    .split(",");
  assert.equal(cells[7], '"116"');
  assert.deepEqual(cells.slice(16), ['""', '""', '""']);
});

test("JSON conserva molino, grosor y ajuste en recetas y sesiones", () => {
  const grinding = {
    grinder: "Mazzer Philos I200D",
    grindSize: "Media fina",
    grind: "116",
  };
  const backup = createBackup(
    [{ name: "Mi receta", ...grinding }],
    [{ coffee: "Mi café", ...grinding }],
  );
  assert.deepEqual(parseBackup(JSON.stringify(backup)), backup);
  assert.ok(
    sessionsToCsv([grinding]).endsWith(
      ',"Mazzer Philos I200D","Media fina",""',
    ),
  );
});

test("el CSV escapa comillas, comas y saltos de línea y conserva ceros", () => {
  const csv = sessionsToCsv([
    {
      coffee: 'Café "especial", natural',
      dose: 15,
      water: 240,
      extraction: null,
      score: { sweet: 0, acid: 6, body: 5 },
      notes: "Naranja\nChocolate",
    },
  ]);
  assert.ok(csv.includes('"Café ""especial"", natural"'));
  assert.ok(csv.includes('"Naranja\nChocolate"'));
  assert.ok(csv.includes('"0","6","5"'));
  assert.ok(csv.includes("\r\n"));
  assert.ok(!csv.includes("null"));
  assert.ok(!csv.includes("undefined"));
});

test("neutraliza fórmulas de texto en las celdas CSV", () => {
  for (const prefix of ["=", "+", "-", "@"]) {
    const csv = sessionsToCsv([
      { coffee: prefix + "SUM(A1)", notes: prefix + "riesgo" },
    ]);
    assert.ok(csv.includes("\"'" + prefix + 'SUM(A1)"'));
    assert.ok(csv.includes("\"'" + prefix + 'riesgo"'));
  }
});

test("JSON conserva los planes nuevos y los tiempos desconocidos de recetas y sesiones", () => {
  const plan = {
    water: 240,
    time: "2:47",
    pours: [45, 145, 240],
    pourTimes: [0, null, 90],
  };
  const backup = createBackup(
    [{ ...plan, name: "Mi receta" }],
    [{ ...plan, coffee: "Mi café" }],
  );
  const restored = parseBackup(JSON.stringify(backup));
  assert.deepEqual(restored.recipes, backup.recipes);
  assert.deepEqual(restored.sessions, backup.sessions);
});

test("rechaza tiempos nuevos incompatibles antes de reemplazar datos del navegador", () => {
  for (const item of [
    { water: 240, pours: [45, 145, 240], pourTimes: [0, 90, 45] },
    { water: 240, pours: null, pourTimes: [0] },
    { water: 240, pours: [45, 145, 200], pourTimes: [0, 45, 90] },
  ]) {
    assert.throws(() => parseBackup(JSON.stringify(createBackup([item], []))));
    assert.throws(() => parseBackup(JSON.stringify(createBackup([], [item]))));
  }
});

test("los respaldos conservan el número y rechazan contradicciones con un plan completo", () => {
  const recipe = { pours: null, bloomWater: 50, water: 240, pourCount: 3 };
  const backup = createBackup([recipe], [{ ...recipe, method: "Orea" }]);
  assert.deepEqual(parseBackup(JSON.stringify(backup)), backup);
  for (const invalid of [
    { pourCount: -1 },
    { pourCount: 1.5 },
    { pourCount: 3, pours: [45, 145, 240] },
  ]) {
    assert.throws(() =>
      parseBackup(JSON.stringify(createBackup([invalid], []))),
    );
    assert.throws(() =>
      parseBackup(JSON.stringify(createBackup([], [invalid]))),
    );
  }
});

test("CSV distingue un número desconocido, cero y un plan antiguo conocido", () => {
  const rows = sessionsToCsv([
    { pours: null },
    { pourCount: 0 },
    { pours: [45, 145, 240] },
  ])
    .split("\r\n")
    .slice(1);
  assert.ok(rows[0].endsWith(',""'));
  assert.ok(rows[1].endsWith(',"0"'));
  assert.ok(rows[2].endsWith(',"2"'));
});
