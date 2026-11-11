const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const {
  publicRecipe,
  createReader,
  activationSql,
} = require("../src/catalogue.js");
const source = {
  ...require("../src/recipes.js")[0],
  notes: "private",
  email: "private@example.com",
  secret: "never-public",
  waterProfile: {
    version: 1,
    system: "bh-1.68-2.45-v1",
    base: "distilled",
    name: "Agua",
    liters: 5,
    gh: 70,
    alkalinity: 40,
    secret: "never-public",
  },
};
const id = "11111111-1111-4111-8111-111111111111";
test("la proyección de receta omite datos privados y conserva parámetros, tiempos y agua", () => {
  const before = structuredClone(source),
    projected = publicRecipe(source);
  assert.equal(projected.waterProfile.gh, 70);
  assert.deepEqual(projected.pours, [45, 145, 240]);
  for (const key of ["notes", "email", "secret", "id"])
    assert.equal(key in projected, false);
  assert.equal("secret" in projected.waterProfile, false);
  assert.deepEqual(source, before);
  for (const invalid of [
    { dose: 0 },
    { pours: [45, 44, 240] },
    { temp2: 101 },
    { bloomWater: 300 },
    { waterProfile: {} },
  ])
    assert.throws(() => publicRecipe({ ...source, ...invalid }));
});
test("las indicaciones públicas conservan solo válvula y texto de cada paso", () => {
  const recipe = {
    ...source,
    pourSteps: [
      { valve: "closed", note: "Abrir a los 0:45", private: "no compartir" },
      { note: "Verter en círculos" },
      { valve: "none" },
    ],
  };
  const before = structuredClone(recipe);
  assert.deepEqual(publicRecipe(recipe).pourSteps, [
    { valve: "closed", note: "Abrir a los 0:45" },
    { valve: "unknown", note: "Verter en círculos" },
    { valve: "none", note: "" },
  ]);
  assert.deepEqual(recipe, before);
  assert.equal(Object.hasOwn(publicRecipe(source), "pourSteps"), false);
  for (const pourSteps of [
    [],
    [{ valve: "closed" }],
    [{}, {}, { note: "x".repeat(501) }],
  ])
    assert.throws(() => publicRecipe({ ...source, pourSteps }));
});
test("el lector público no envía sesión, cookies ni parámetros de escritura", async () => {
  let sent;
  const reader = createReader({
    config: {
      url: "https://cloud.example.test",
      publishableKey: "sb_publishable_test",
    },
    fetch: async (...args) => {
      sent = args;
      return { ok: true, json: async () => [{ ...source, id }] };
    },
  });
  const recipes = await reader.list();
  assert.equal(recipes[0].id, id);
  assert.equal("secret" in recipes[0], false);
  assert.ok(sent[0].endsWith("/blossom_public_catalogue"));
  assert.equal(sent[1].credentials, "omit");
  assert.equal(sent[1].body, "{}");
  assert.equal("Authorization" in sent[1].headers, false);
});
test("el lector distingue activación pendiente y rechaza listas o recetas incompatibles", async () => {
  const config = {
    url: "https://cloud.example.test",
    publishableKey: "sb_publishable_test",
  };
  assert.equal(createReader({ config: { url: "", publishableKey: "" } }), null);
  await assert.rejects(
    createReader({
      config,
      fetch: async () => ({ ok: false, status: 404 }),
    }).list(),
    (error) => error.status === 404,
  );
  for (const data of [
    {},
    [{ ...source, id: "bad" }],
    [
      { ...source, id },
      { ...source, id },
    ],
    [{ ...source, id, dose: 0 }],
  ])
    await assert.rejects(
      createReader({
        config,
        fetch: async () => ({ ok: true, json: async () => data }),
      }).list(),
    );
});
test("la activación SQL asigna únicamente un UUID válido sin incluir correos ni credenciales", () => {
  const migration = readFileSync(
    require("node:path").join(
      __dirname,
      "../supabase/migrations/202611110001_public_catalogue.sql",
    ),
    "utf8",
  );
  const sql = activationSql(migration, id);
  assert.ok(sql.includes(`values ('${id}'::uuid)`));
  assert.throws(() =>
    activationSql(migration, "bad'); drop table auth.users;--"),
  );
  assert.throws(() => activationSql("select 1", id));
});
