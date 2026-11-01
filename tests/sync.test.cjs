const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  snapshot,
  makeBatch,
  reconcile,
  createSync,
  fingerprint,
} = require("../src/sync.js");
const clone = (value) => structuredClone(value);
const recipe = (name = "Mi receta", id = "custom-1") => ({
  id,
  name,
  coffee: "Mi café",
  dose: 15,
  water: 240,
});
const row = (payload, version = 1, deleted = false) => ({
  kind: "recipe",
  record_id: payload.id,
  payload: deleted ? null : payload,
  version,
  deleted,
});

function harness(t, initial = { recipes: [], sessions: [] }) {
  const h = {
    data: clone(initial),
    state: null,
    statuses: [],
    calls: [],
    writable: true,
    ready: true,
    rows: [],
  };
  h.exchange = async (changes) => ({ records: h.rows, conflicts: [] });
  h.sync = createSync({
    readData: () => clone(h.data),
    writeData: (data) => {
      if (!h.writable) return false;
      h.data = clone(data);
      return true;
    },
    readState: () => clone(h.state),
    writeState: (state) => {
      h.state = clone(state);
      return true;
    },
    exchange: async (changes) => {
      h.calls.push(clone(changes));
      return h.exchange(changes);
    },
    canApply: () => h.ready,
    onStatus: (status) => h.statuses.push(status),
  });
  t.after(() => h.sync.disconnect());
  return h;
}

test("huellas estables preservan los campos y distinguen datos distintos", async () => {
  assert.equal(
    await fingerprint({ b: 2, a: 1 }),
    await fingerprint({ a: 1, b: 2 }),
  );
  assert.notEqual(
    await fingerprint(recipe()),
    await fingerprint(recipe("Editada")),
  );
  const data = { recipes: [recipe()], sessions: [] };
  await snapshot(data);
  assert.deepEqual(data, { recipes: [recipe()], sessions: [] });
});

test("el primer enlace sube las recetas locales y un teléfono vacío solo consulta", async () => {
  const entries = await snapshot({ recipes: [recipe()], sessions: [] });
  const batch = makeBatch(entries, {}, () => "operation-1");
  assert.equal(batch.changes[0].base_version, 0);
  assert.equal(batch.changes[0].payload.name, "Mi receta");
  assert.deepEqual(makeBatch([], {}).changes, []);
});

test("solo borra registros conocidos y no resucita un borrado ya recibido", async () => {
  const entries = await snapshot({ recipes: [recipe()], sessions: [] });
  const received = await reconcile(
    [row(recipe(), 2, true)],
    makeBatch(entries).sentHashes,
    entries,
  );
  assert.deepEqual(received.data.recipes, []);
  assert.deepEqual(makeBatch([], received.base).changes, []);
  const live = await reconcile([row(recipe())], {}, []);
  const deletion = makeBatch([], live.base).changes;
  assert.equal(deletion.length, 1);
  assert.equal(deletion[0].deleted, true);
  assert.equal(deletion[0].base_version, 1);
});

test("la respuesta de la nube no pisa cambios hechos durante la petición", async () => {
  const original = await snapshot({ recipes: [recipe()], sessions: [] });
  const sent = makeBatch(original).sentHashes;
  const latest = await snapshot({
    recipes: [recipe("Cambio nuevo"), recipe("Otra", "custom-2")],
    sessions: [],
  });
  const result = await reconcile(
    [row(recipe("Versión nube"), 2)],
    sent,
    latest,
  );
  assert.deepEqual(
    result.data.recipes.map((r) => r.name),
    ["Cambio nuevo", "Otra"],
  );
  const next = makeBatch(await snapshot(result.data), result.base);
  assert.equal(
    next.changes.find((change) => change.record_id === "custom-1").base_version,
    2,
  );
});

test("una pérdida de conexión conserva el lote y reutiliza sus identificadores", async (t) => {
  const h = harness(t, { recipes: [recipe()], sessions: [] });
  h.exchange = async () => {
    assert.ok(h.state.batch);
    throw new Error("Sin conexión");
  };
  await h.sync.connect({ id: "account-a" });
  const pending = clone(h.state.batch);
  h.data.recipes[0].name = "Editada sin conexión";
  h.exchange = async () => ({ records: [row(recipe())], conflicts: [] });
  await h.sync.run();
  assert.deepEqual(h.calls[0], h.calls[1]);
  assert.deepEqual(h.calls[0], pending.changes);
  assert.equal(h.data.recipes[0].name, "Editada sin conexión");
  assert.equal(h.state.base['["recipe","custom-1"]'].version, 1);
  assert.equal(
    makeBatch(await snapshot(h.data), h.state.base).changes[0].base_version,
    1,
  );
});

test("no aplica resultados mientras se edita y reintenta el mismo lote después", async (t) => {
  const h = harness(t, { recipes: [recipe()], sessions: [] });
  h.exchange = async () => {
    h.ready = false;
    return { records: [row(recipe())], conflicts: [] };
  };
  await h.sync.connect({ id: "account-a" });
  assert.ok(h.state.batch);
  assert.equal(h.statuses.at(-1).phase, "waiting");
  h.ready = true;
  h.exchange = async () => ({ records: [row(recipe())], conflicts: [] });
  await h.sync.run();
  assert.deepEqual(h.calls[0], h.calls[1]);
  assert.equal(h.state.batch, null);
});

test("no sube los datos locales a otra cuenta", async (t) => {
  const h = harness(t, { recipes: [recipe()], sessions: [] });
  h.state = { owner: "account-a", base: {}, batch: null };
  await h.sync.connect({ id: "account-b" });
  assert.equal(h.calls.length, 0);
  assert.equal(h.state.owner, "account-a");
  assert.equal(h.statuses.at(-1).phase, "error");
  assert.equal(h.data.recipes[0].name, "Mi receta");
});

test("un fallo de almacenamiento no confirma el lote recibido", async (t) => {
  const h = harness(t);
  h.rows = [row(recipe())];
  h.writable = false;
  await h.sync.connect({ id: "account-a" });
  assert.ok(h.state.batch);
  assert.deepEqual(h.data.recipes, []);
  h.writable = true;
  await h.sync.run();
  assert.equal(h.data.recipes[0].name, "Mi receta");
  assert.equal(h.state.batch, null);
});

test("cerrar sesión durante una petición impide aplicar su respuesta", async (t) => {
  const h = harness(t);
  let finish;
  h.exchange = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const connected = h.sync.connect({ id: "account-a" });
  while (!finish) await new Promise((resolve) => setImmediate(resolve));
  h.sync.disconnect();
  finish({ records: [row(recipe())], conflicts: [] });
  await connected;
  assert.deepEqual(h.data.recipes, []);
});
