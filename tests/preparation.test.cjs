const { test } = require("node:test");
const assert = require("node:assert/strict");
const guide = require("../src/preparation.js");
const {
  createBackup,
  parseBackup,
  sessionsToCsv,
} = require("../src/transfers.js");
const recipe = {
  coffee: "Mi café",
  method: "Orea",
  dose: 15,
  water: 240,
  temp: 93,
  bloom: 45,
  time: "2:47",
  pours: [45, 145, 240],
  pourTimes: [0, 45, 90],
};
const ready = (r = recipe) => guide.createDraft(r, "Mi receta", "guided-1");
function completed() {
  let state = guide.start(ready(), 100000);
  state = guide.advance(state, 145000);
  state = guide.advance(state, 190000);
  return guide.finish(state, 267000);
}

test("una preparación conserva una copia del plan y no inventa la evaluación", () => {
  const source = structuredClone(recipe);
  const state = ready(source);
  source.pours[0] = 50;
  source.temp = 88;
  assert.deepEqual(state.recipe, recipe);
  assert.deepEqual(state.temperatures, [93, 93, 93]);
  assert.deepEqual(state.actualStarts, [null, null, null]);
  assert.equal(state.result.sweet, "");
  assert.equal(state.result.tds, "");
});

test("un plan incompleto o inválido debe definirse antes de usar la guía", () => {
  assert.throws(
    () => ready({ ...recipe, pours: null, bloomWater: 45 }),
    /plan completo/,
  );
  assert.throws(
    () => ready({ ...recipe, pours: [45, 145, 230] }),
    /último peso/,
  );
  assert.throws(() => ready({ ...recipe, pourTimes: [0, 90, 45] }), /aumentar/);
});

test("dos temperaturas requieren una asignación explícita antes de iniciar", () => {
  const state = ready({ ...recipe, temp2: 85 });
  assert.throws(() => guide.start(state), /temperatura de cada vertido/);
  state.temperatures = [93, 85, 85];
  const started = guide.start(state, 100000);
  assert.deepEqual(started.temperatures, [93, 85, 85]);
  assert.equal(state.phase, "ready");
});

test("el reloj recupera tiempo de fondo y excluye las pausas conservando milisegundos", () => {
  let state = guide.start(ready(), 100000);
  assert.equal(guide.elapsedSeconds(state, 145900), 45);
  state = guide.pause(state, 145900);
  assert.equal(guide.elapsedSeconds(state, 945900), 45);
  state = guide.resume(state, 1000000);
  assert.equal(guide.elapsedSeconds(state, 1000100), 46);
  assert.equal(guide.elapsedSeconds(state, 2000000), 1045);
});

test("el plan avanza solo al confirmar y conserva los inicios reales distintos al objetivo", () => {
  let state = guide.start(ready(), 100000);
  assert.equal(guide.elapsedSeconds(state, 250000), 150);
  assert.equal(state.index, 0);
  assert.throws(() => guide.finish(state, 250000), /confirma todos/);
  state = guide.advance(state, 151000);
  state = guide.advance(state, 201000);
  state = guide.finish(state, 280000);
  const record = guide.record(state);
  assert.deepEqual(record.actualStarts, [0, 51, 101]);
  assert.equal(record.durationSeconds, 180);
  assert.deepEqual(state.recipe.pourTimes, [0, 45, 90]);
  assert.equal(state.recipe.time, "2:47");
  assert.equal(guide.validateRecord(record, recipe), null);
});

test("una pausa impide avanzar o finalizar sin reanudar", () => {
  const state = guide.pause(guide.start(ready(), 100000), 120000);
  assert.throws(() => guide.advance(state, 130000));
  assert.throws(() => guide.finish(state, 130000));
  assert.throws(() => guide.record(state));
});

test("el progreso listo, activo, pausado y en evaluación se puede recuperar", () => {
  const initial = ready();
  const active = guide.advance(guide.start(initial, 100000), 145000);
  const paused = guide.pause(active, 155000);
  for (const state of [initial, active, paused, completed()]) {
    assert.deepEqual(
      guide.restoreDraft(JSON.parse(JSON.stringify(state))),
      state,
    );
  }
  assert.equal(guide.elapsedSeconds(guide.restoreDraft(active), 190000), 90);
  assert.equal(guide.restoreDraft({ ...active, runningSince: "ahora" }), null);
  assert.equal(
    guide.restoreDraft({ ...active, startedAt: { toString: null } }),
    null,
  );
  assert.equal(
    guide.restoreDraft({ ...initial, temperatures: [300, null, null] }),
    null,
  );
  assert.equal(guide.restoreDraft([]), null);
});

test("el resultado conserva tiempos reales y temperaturas en JSON y CSV sin alterar V1", () => {
  const session = { ...recipe, preparation: guide.record(completed()) };
  const backup = createBackup([], [session]);
  assert.deepEqual(parseBackup(JSON.stringify(backup)), backup);
  const csv = sessionsToCsv([session]).split("\r\n");
  assert.ok(
    csv[0].endsWith(
      '"tiempo_real_s","inicios_reales_s","temperaturas_vertidos_C"',
    ),
  );
  assert.ok(csv[1].endsWith('"167","0 / 45 / 90","93 / 93 / 93"'));
  assert.deepEqual(
    parseBackup(JSON.stringify(createBackup([], [recipe]))).sessions[0],
    recipe,
  );
});

test("rechaza registros guiados incompletos o contradictorios antes de importar", () => {
  const record = guide.record(completed());
  for (const invalid of [
    { ...record, durationSeconds: 0 },
    { ...record, actualStarts: [0, 90] },
    { ...record, actualStarts: [0, 90, 45] },
    { ...record, actualStarts: [0, 45, 200] },
    { ...record, actualStarts: [1, 45, 90] },
    { ...record, temperatures: [93, 85, 85] },
    { ...record, startedAt: "desconocido" },
    { ...record, temperatures: [null, 93, 93] },
  ]) {
    assert.throws(() =>
      parseBackup(
        JSON.stringify(createBackup([], [{ ...recipe, preparation: invalid }])),
      ),
    );
  }
});
