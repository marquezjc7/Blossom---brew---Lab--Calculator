const { test } = require("node:test");
const assert = require("node:assert/strict");
const { RECIPE_KEY, SESSION_KEY, createStore } = require("../src/storage.js");

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
  };
}

test("conserva las claves de recetas y sesiones de la V1", () => {
  assert.equal(RECIPE_KEY, "blossom-brew-recipes-v1");
  assert.equal(SESSION_KEY, "blossom-brew-sessions-v1");
});

test("recupera los datos anteriores sin modificar los valores almacenados", () => {
  const storage = memoryStorage();
  const recipes = [
    { id: "custom-anterior", coffee: "Mi café", dose: 18, water: 288 },
  ];
  storage.setItem(RECIPE_KEY, JSON.stringify(recipes));
  const store = createStore(() => storage);
  assert.deepEqual(store.read(RECIPE_KEY), recipes);
  assert.equal(storage.getItem(RECIPE_KEY), JSON.stringify(recipes));
});

test("guarda y recupera sesiones con notas y datos sin medir", () => {
  const storage = memoryStorage();
  const store = createStore(() => storage);
  const sessions = [
    { coffee: "Pacas", notes: "piña\nframbuesa", extraction: null },
  ];
  assert.equal(store.write(SESSION_KEY, sessions), true);
  assert.deepEqual(store.read(SESSION_KEY), sessions);
  assert.deepEqual(store.read(RECIPE_KEY), []);
});

test("un JSON dañado se ignora al leer y no se sobrescribe", () => {
  const storage = memoryStorage();
  storage.setItem(RECIPE_KEY, "{datos dañados");
  assert.deepEqual(createStore(() => storage).read(RECIPE_KEY), []);
  assert.equal(storage.getItem(RECIPE_KEY), "{datos dañados");
});

test("el navegador puede bloquear el acceso a localStorage sin detener la app", () => {
  const store = createStore(() => {
    throw new Error("SecurityError");
  });
  assert.deepEqual(store.read(RECIPE_KEY), []);
  assert.equal(store.write(SESSION_KEY, []), false);
});

test("una cuota agotada devuelve un fallo de escritura y conserva los datos", () => {
  const storage = memoryStorage();
  storage.setItem(SESSION_KEY, '[{"coffee":"anterior"}]');
  storage.setItem = () => {
    throw new Error("QuotaExceededError");
  };
  const store = createStore(() => storage);
  assert.equal(store.write(SESSION_KEY, [{ coffee: "nuevo" }]), false);
  assert.deepEqual(store.read(SESSION_KEY), [{ coffee: "anterior" }]);
});

test("no confirma el guardado si el navegador ignora la escritura sin lanzar un error", () => {
  const storage = memoryStorage();
  storage.setItem = () => {};
  const store = createStore(() => storage);
  assert.equal(store.write(RECIPE_KEY, [{ name: "Sin persistir" }]), false);
  assert.deepEqual(store.read(RECIPE_KEY), []);
});
