const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  createTracker,
  KEYS,
  channelFor,
  activationSql,
  instagramUrl,
} = require("../src/analytics.js");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const config = {
  url: "https://cloud.example.test",
  publishableKey: "sb_publishable_test",
};
const store = () => {
  const data = new Map();
  return {
    getItem: (key) => data.get(key) || null,
    setItem: (key, value) => data.set(key, value),
    data,
  };
};
function setup(overrides = {}) {
  const calls = [],
    local = store(),
    session = store();
  let index = 0;
  const options = {
    config,
    url: "https://blossom.test/recetario/?utm_source=instagram&secret=never-send",
    local,
    session,
    uuid: () => `00000000-0000-4000-8000-${String(++index).padStart(12, "0")}`,
    fetch: async (url, init) => {
      calls.push({ url, ...init, body: JSON.parse(init.body) });
      return { ok: true, status: 200, json: async () => ({ recorded: true }) };
    },
    ...overrides,
  };
  return { calls, options, local, session, tracker: createTracker(options) };
}
test("medición: cuenta una vez por visita y no envía sesión privada, URL completa ni credenciales", async () => {
  const { calls, tracker } = setup();
  await tracker.track("recipe", "reference-bourbon-lavado");
  await tracker.track("recipe", "reference-bourbon-lavado");
  await tracker.track("copy", "reference-bourbon-lavado");
  assert.deepEqual(
    calls.map((x) => x.body.event_kind),
    ["visit", "recipe", "copy"],
  );
  for (const call of calls) {
    assert.equal(call.credentials, "omit");
    assert.equal(call.referrerPolicy, "no-referrer");
    assert.equal("Authorization" in call.headers, false);
    assert.equal(JSON.stringify(call.body).includes("never-send"), false);
    assert.equal(call.body.channel, "instagram");
  }
});
test("medición: recargar mantiene la visita y vencer los 30 minutos inicia otra con el mismo visitante", async () => {
  let time = 100000000;
  const s = setup({ now: () => time });
  await s.tracker.track("recipe", "reference-bourbon-lavado");
  const first = s.calls[0].body;
  await createTracker(s.options).track("recipe", "reference-bourbon-lavado");
  assert.equal(s.calls.length, 2);
  time += 1800001;
  await createTracker(s.options).track("recipe", "reference-bourbon-lavado");
  assert.notEqual(s.calls[2].body.session_id, first.session_id);
  assert.equal(s.calls[2].body.visitor_id, first.visitor_id);
});
test("medición: exclusión de administración o privacidad no genera identificadores ni solicitudes", async () => {
  for (const disabled of [true, false]) {
    const s = setup({ disabled });
    if (!disabled) s.local.setItem(KEYS.excluded, "true");
    assert.equal(await s.tracker.track("visit"), false);
    assert.equal(s.calls.length, 0);
    assert.equal(s.local.getItem(KEYS.visitor), null);
  }
});
test("medición: fallos, configuración pendiente y almacenamiento bloqueado no impiden usar el recetario", async () => {
  let count = 0;
  const s = setup({
    fetch: async () => {
      count++;
      return { ok: false, status: 404 };
    },
  });
  await s.tracker.track("recipe", "reference-bourbon-lavado");
  await s.tracker.track("section", "water");
  assert.equal(count, 1);
  const broken = {
    getItem() {
      throw new Error();
    },
    setItem() {
      throw new Error();
    },
  };
  const fallback = setup({ local: broken, session: broken });
  await fallback.tracker.track("visit");
  await fallback.tracker.track("visit");
  assert.equal(fallback.calls.length, 1);
  fallback.tracker.setExcluded(true);
  await fallback.tracker.track("section", "water");
  assert.equal(fallback.calls.length, 1);
});
test("medición: un envío fallido se puede reintentar sin crear otra visita", async () => {
  const s = setup();
  let failed = true;
  const original = s.options.fetch;
  const tracker = createTracker({
    ...s.options,
    fetch: async (...args) => {
      if (failed) {
        failed = false;
        throw new Error("offline");
      }
      return original(...args);
    },
  });
  await tracker.track("visit");
  await tracker.track("visit");
  assert.equal(s.calls.length, 1);
});
test("origen y activación: enlace de Instagram etiquetado, fuentes limitadas y administrador verificado", () => {
  assert.equal(
    channelFor("https://blossom.test", "https://l.instagram.com/a"),
    "instagram",
  );
  assert.equal(
    channelFor("https://blossom.test", "https://evilinstagram.com/a"),
    "other",
  );
  assert.equal(
    channelFor("https://blossom.test", "https://blossom.test/owner"),
    "direct",
  );
  const link = new URL(
    instagramUrl("https://blossom.test/recetario/?receta=example"),
  );
  assert.equal(link.searchParams.get("receta"), "example");
  assert.equal(link.searchParams.get("utm_source"), "instagram");
  const sql = readFileSync(
    resolve(
      __dirname,
      "../supabase/migrations/202611110003_usage_statistics.sql",
    ),
    "utf8",
  );
  assert.match(
    activationSql(sql, "11111111-1111-4111-8111-111111111111"),
    /insert into public.blossom_analytics_admins/,
  );
  assert.throws(() => activationSql(sql, "x');drop table auth.users;--"));
});
