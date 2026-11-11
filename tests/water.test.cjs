const { test } = require("node:test");
const assert = require("node:assert/strict");
const water = require("../src/water.js");
const {
  createBackup,
  parseBackup,
  sessionsToCsv,
} = require("../src/transfers.js");
const profile = (extra = {}) =>
  water.makeProfile({
    name: "Mi agua",
    liters: 1,
    gh: 70,
    alkalinity: 40,
    ...extra,
  });

test("reproduce el ejemplo WOC y conserva 4500 g después del redondeo", () => {
  const ref = water.references.find((r) => r.id === "woc-budapest");
  assert.deepEqual(water.calculate(profile({ ...ref, liters: 4.5 })), {
    buffer: 180.5,
    hardness: 230.4,
    distilled: 4089.1,
    total: 4500,
  });
});

test("las tres aguas del experimento mantienen GH 70 y varían solo la alcalinidad", () => {
  for (const [alkalinity, distilled] of [
    [20, 910],
    [40, 890],
    [60, 870],
  ]) {
    assert.deepEqual(water.calculate(profile({ alkalinity })), {
      buffer: alkalinity,
      hardness: 70,
      distilled,
      total: 1000,
    });
  }
});

test("ocho referencias y distintos volúmenes conservan la masa a 0.1 g", () => {
  assert.equal(water.references.length, 8);
  for (const reference of water.references) {
    for (const liters of [0.1, 0.5, 1, 1.25, 2, 4.5, 100]) {
      const result = water.calculate(profile({ ...reference, liters }));
      assert.ok(
        Math.abs(
          result.buffer + result.hardness + result.distilled - result.total,
        ) < 1e-8,
      );
      assert.ok(result.distilled >= 0);
      assert.equal(result.total, liters * 1000);
    }
  }
  assert.equal(
    water.calculate(profile({ gh: 333.5, alkalinity: 666.5, liters: 0.1 }))
      .distilled,
    0,
  );
});

test("rechaza objetivos imposibles y entradas vacías o no finitas sin mostrar masas negativas", () => {
  for (const extra of [
    { liters: 0 },
    { liters: 101 },
    { liters: NaN },
    { gh: -1 },
    { gh: Infinity },
    { alkalinity: -1 },
    { alkalinity: "40" },
    { gh: 800, alkalinity: 300 },
    { name: "" },
  ])
    assert.throws(() => profile(extra));
  assert.deepEqual(water.calculate(profile({ gh: 0, alkalinity: 0 })), {
    buffer: 0,
    hardness: 0,
    distilled: 1000,
    total: 1000,
  });
});

test("no interpreta otros concentrados ni agua mineralizada como el sistema BH declarado", () => {
  for (const invalid of [
    { ...profile(), system: "bh-1.68-2.55-v1" },
    { ...profile(), base: "reverse-osmosis" },
    { ...profile(), version: 2 },
  ]) {
    assert.ok(water.validateProfile(invalid));
    assert.throws(() => water.calculate(invalid));
    assert.throws(() =>
      parseBackup(
        JSON.stringify(createBackup([{ waterProfile: invalid }], [])),
      ),
    );
  }
});

test("el texto para pesar identifica soluciones, hidratación, unidades y volumen sin redondearlo a décimas", () => {
  const text = water.recipeText(profile({ liters: 1.25 }));
  assert.ok(text.includes("1,25 L"));
  assert.ok(text.includes("NaHCO₃ a 1.68 g/L"));
  assert.ok(text.includes("MgSO₄·7H₂O a 2.45 g/L"));
  assert.ok(text.includes("ppm como CaCO₃"));
  assert.ok(text.includes("Los objetivos no son mediciones"));
});

test("JSON conserva los perfiles de recetas y sesiones y no añade agua a los archivos V1", () => {
  const p = profile();
  const backup = createBackup(
    [{ name: "Mi café", waterProfile: p }],
    [{ coffee: "Mi café", waterProfile: p }],
  );
  assert.deepEqual(parseBackup(JSON.stringify(backup)), backup);
  assert.deepEqual(
    parseBackup(JSON.stringify(createBackup([{ name: "Anterior" }], [])))
      .recipes,
    [{ name: "Anterior" }],
  );
  assert.equal(water.profileKey(p), water.profileKey({ ...p }));
  assert.notEqual(
    water.profileKey(p),
    water.profileKey(profile({ alkalinity: 50 })),
  );
});

test("el CSV añade el perfil después de las 24 columnas existentes", () => {
  const rows = sessionsToCsv([{ waterProfile: profile() }, {}])
    .split("\r\n")
    .map((r) => r.split(","));
  assert.deepEqual(rows[0].slice(24, 29), [
    '"agua_perfil"',
    '"agua_GH_ppm_CaCO3"',
    '"agua_alcalinidad_ppm_CaCO3"',
    '"agua_lote_L"',
    '"agua_sistema"',
  ]);
  assert.deepEqual(rows[1].slice(24, 29), [
    '"Mi agua"',
    '"70"',
    '"40"',
    '"1"',
    '"bh-1.68-2.45-v1"',
  ]);
  assert.deepEqual(rows[2].slice(24, 29), Array(5).fill('""'));
});
