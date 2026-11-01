const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  parseTime,
  formatTime,
  validatePlan,
  snapshotPlan,
  getPourCount,
  validatePourCount,
} = require("../src/plans.js");

test("los tiempos opcionales distinguen cero, datos ausentes y formatos inválidos", () => {
  assert.equal(parseTime("0:00"), 0);
  assert.equal(parseTime("2:47"), 167);
  assert.equal(parseTime("999:59"), 59999);
  assert.equal(parseTime(""), null);
  assert.equal(parseTime(undefined), null);
  for (const value of ["0:60", "-1:00", "2:7", "90", "1:00:00", 90]) {
    assert.ok(Number.isNaN(parseTime(value)), String(value));
  }
});

test("presenta tiempos registrados sin convertir los desconocidos en cero", () => {
  assert.equal(formatTime(0), "0:00");
  assert.equal(formatTime(167), "2:47");
  assert.equal(formatTime(null), "");
  assert.equal(formatTime(undefined), "");
  assert.equal(formatTime(-1), "");
  assert.equal(formatTime(1.5), "");
});

test("un plan completo puede tener tiempos sin registrar o parcialmente conocidos", () => {
  assert.equal(validatePlan([45, 145, 240], undefined, 240, "2:47"), null);
  assert.equal(validatePlan([45, 145, 240], [0, null, 90], 240, "2:47"), null);
  assert.equal(validatePlan([45, 145, 240], [null, 45, 90], 240, ""), null);
});

test("rechaza pesos vacíos, negativos, repetidos, decrecientes y sobre el agua total", () => {
  for (const weights of [
    [],
    [0, 145, 240],
    [-1, 145, 240],
    [45, 45, 240],
    [145, 45, 240],
    [45, 145, 241],
    [45, NaN, 240],
  ]) {
    assert.equal(typeof validatePlan(weights, undefined, 240), "string");
  }
});

test("el plan completo debe terminar en el agua total con tolerancia solo para coma flotante", () => {
  assert.match(validatePlan([45, 145, 239], undefined, 240), /último/);
  assert.equal(validatePlan([45, 145, 240.00000001], undefined, 240), null);
  assert.match(validatePlan([45, 145, 240], undefined, 0), /agua válido/);
});

test("los tiempos conocidos deben aumentar incluso si hay campos intermedios desconocidos", () => {
  assert.match(validatePlan([45, 145, 240], [30, null, 20], 240), /aumentar/);
  assert.match(validatePlan([45, 145, 240], [0, 45, 45], 240), /aumentar/);
  assert.match(validatePlan([45, 145, 240], [0, -1, 90], 240), /mm:ss/);
  assert.match(validatePlan([45, 145, 240], [0, NaN, 90], 240), /mm:ss/);
});

test("ningún vertido puede comenzar al final o después de la preparación", () => {
  assert.match(
    validatePlan([45, 145, 240], [0, 45, 167], 240, "2:47"),
    /antes/,
  );
  assert.match(
    validatePlan([45, 145, 240], [0, 45, 180], 240, "2:47"),
    /antes/,
  );
  assert.match(validatePlan([45, 145, 240], null, 240, "0:00"), /tiempo final/);
  assert.match(validatePlan([45, 145, 240], null, 240, "2:99"), /tiempo final/);
});

test("los tiempos necesitan un plan y una entrada por vertido", () => {
  assert.equal(validatePlan(null, undefined, 240), null);
  assert.match(validatePlan(null, [0], 240), /completo/);
  assert.match(validatePlan([45, 145, 240], [0, 45], 240), /campo de tiempo/);
  assert.match(validatePlan([45, 145, 240], [0, "45", 90], 240), /mm:ss/);
});

test("escala cantidades sin cambiar tiempos ni modificar la receta original", () => {
  const reference = Object.freeze({
    water: 240,
    pours: Object.freeze([45, 145, 240]),
    pourTimes: Object.freeze([0, null, 90]),
  });
  const result = snapshotPlan(reference, 288);
  assert.deepEqual(result, { pours: [54, 174, 288], pourTimes: [0, null, 90] });
  assert.notEqual(result.pourTimes, reference.pourTimes);
  result.pours[0] = 99;
  result.pourTimes[0] = 10;
  assert.equal(reference.pours[0], 45);
  assert.equal(reference.pourTimes[0], 0);
});

test("una receta V1 y un bloom incompleto no reciben tiempos ni vertidos inventados", () => {
  assert.deepEqual(snapshotPlan({ water: 240, pours: [45, 145, 240] }, 288), {
    pours: [54, 174, 288],
  });
  assert.deepEqual(
    snapshotPlan({ water: 240, pours: null, bloomWater: 50 }, 288),
    { pours: null, bloomWater: 60 },
  );
  assert.deepEqual(snapshotPlan({ water: 240, pours: null }, 288), {
    pours: null,
  });
  assert.deepEqual(snapshotPlan({ water: 240, pours: [45, 145, 240] }, 0), {
    pours: null,
  });
});

test("el número de vertidos excluye el bloom y se deriva de los planes anteriores", () => {
  assert.equal(getPourCount({ pours: [45, 145, 240] }), 2);
  assert.equal(getPourCount({ pours: [240] }), 0);
  assert.equal(getPourCount({ pours: null, bloomWater: 50 }), null);
  assert.equal(getPourCount({}), null);
});

test("se puede registrar un número sin inventar los pesos de un plan incompleto", () => {
  const partial = { pours: null, bloomWater: 50, water: 240, pourCount: 3 };
  assert.equal(getPourCount(partial), 3);
  assert.equal(validatePourCount(partial), null);
  assert.equal(partial.pours, null);
  assert.equal(getPourCount({ pourCount: 0 }), 0);
  assert.equal(validatePourCount({ pourCount: null }), null);
});

test("rechaza números fraccionarios, negativos, fuera de rango o que contradigan el plan", () => {
  for (const count of [-1, 1.5, 50, NaN, Infinity, "3", ""]) {
    assert.equal(typeof validatePourCount({ pourCount: count }), "string");
  }
  assert.match(
    validatePourCount({ pourCount: 3, pours: [45, 145, 240] }),
    /no coincide/,
  );
  assert.equal(
    validatePourCount({ pourCount: 2, pours: [45, 145, 240] }),
    null,
  );
  assert.match(
    validatePourCount({ pourCount: 0, bloomWater: 50, water: 240 }),
    /agua restante/,
  );
  assert.equal(
    validatePourCount({ pourCount: 0, pours: [240], water: 240 }),
    null,
  );
});
