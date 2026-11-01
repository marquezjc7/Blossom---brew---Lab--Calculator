const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  calculateRatio,
  calculateWater,
  calculateExtraction,
  scalePours,
} = require("../src/calculations.js");

test("18 g a ratio 1:16 requieren 288 g de agua", () => {
  assert.equal(calculateWater(18, 16), 288);
  assert.equal(calculateRatio(18, 288), 16);
});

test("el ratio real usa el agua añadida aunque difiera del objetivo", () => {
  assert.equal(calculateRatio(15, 255), 17);
  assert.equal(calculateWater(15, 16), 240);
});

test("las dosis y cantidades inválidas no producen resultados utilizables", () => {
  for (const value of [
    0,
    -1,
    NaN,
    Infinity,
    -Infinity,
    "15",
    null,
    undefined,
  ]) {
    assert.ok(Number.isNaN(calculateWater(value, 16)));
    assert.ok(Number.isNaN(calculateWater(15, value)));
    assert.ok(Number.isNaN(calculateRatio(value, 240)));
    assert.ok(Number.isNaN(calculateRatio(15, value)));
  }
});

test("el ejemplo didáctico produce EY 19.88% y 2.982 g de sólidos", () => {
  const result = calculateExtraction(15, 210, 1.42);
  assert.ok(Math.abs(result.yieldPercent - 19.88) < 1e-10);
  assert.ok(Math.abs(result.dissolvedSolids - 2.982) < 1e-10);
});

test("la extracción usa masa de bebida, no agua de preparación", () => {
  assert.equal(calculateExtraction(20, 300, 1.4).yieldPercent, 21);
});

test("la extracción permanece sin medir cuando faltan datos válidos", () => {
  for (const value of [0, -1, NaN, Infinity, "", null]) {
    assert.equal(calculateExtraction(value, 210, 1.42), null);
    assert.equal(calculateExtraction(15, value, 1.42), null);
    assert.equal(calculateExtraction(15, 210, value), null);
  }
  assert.equal(calculateExtraction(15, 210, 30.01), null);
  assert.notEqual(calculateExtraction(15, 210, 30), null);
});

test("escala vertidos acumulados e incrementales sin modificar la referencia", () => {
  const reference = Object.freeze([45, 145, 240]);
  assert.deepEqual(scalePours(reference, 240, 288), [
    { cumulative: 54, incremental: 54 },
    { cumulative: 174, incremental: 120 },
    { cumulative: 288, incremental: 114 },
  ]);
  assert.deepEqual(reference, [45, 145, 240]);
});

test("un plan desconocido o una masa inválida no inventan vertidos", () => {
  assert.equal(scalePours(null, 240, 288), null);
  assert.equal(scalePours([], 240, 288), null);
  assert.equal(scalePours([45, 145, 240], 0, 288), null);
  assert.equal(scalePours([45, 145, 240], 240, NaN), null);
});
