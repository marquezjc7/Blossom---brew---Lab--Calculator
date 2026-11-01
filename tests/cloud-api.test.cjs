const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  AUTH_KEY,
  validateConfig,
  createCloudApi,
} = require("../src/cloud-api.js");
const config = {
  url: "https://project.supabase.co",
  publishableKey: "sb_publishable_test",
};
const user = { id: "account-a", email: "julio@example.com" };
const token = (overrides = {}) => ({
  access_token: "test-access",
  refresh_token: "test-refresh",
  expires_at: 9999999999,
  user,
  ...overrides,
});

function harness() {
  const h = {
    saved: null,
    calls: [],
    reply: () => ({ status: 200, data: user }),
  };
  h.store = {
    read: () => structuredClone(h.saved),
    write: (_key, value) => {
      h.saved = structuredClone(value);
      return true;
    },
  };
  h.api = createCloudApi({
    config,
    store: h.store,
    fetch: async (url, options) => {
      h.calls.push({ url, ...options });
      const reply = h.reply(url, options);
      return {
        ok: reply.status >= 200 && reply.status < 300,
        status: reply.status,
        json: async () => reply.data,
      };
    },
  });
  return h;
}

test("la configuración rechaza claves de servidor y direcciones inseguras", () => {
  assert.equal(validateConfig({ url: "", publishableKey: "" }), null);
  assert.equal(validateConfig(config).url, config.url);
  const jwt = (role) =>
    "eyJhbGciOiJub25lIn0." +
    Buffer.from(JSON.stringify({ role })).toString("base64url") +
    ".test";
  assert.ok(validateConfig({ ...config, publishableKey: jwt("anon") }));
  for (const publishableKey of [
    "sb_secret_private",
    jwt("service_role"),
    "bad",
  ]) {
    assert.throws(() => validateConfig({ ...config, publishableKey }));
  }
  for (const url of [
    "http://project.supabase.co",
    "https://user:password@project.supabase.co",
    "https://project.supabase.co/path",
  ]) {
    assert.throws(() => validateConfig({ ...config, url }));
  }
});

test("el enlace se envía al correo y vuelve a la dirección pública de la aplicación", async () => {
  const h = harness();
  await h.api.sendLink(user.email, "https://example.com/app/");
  const sent = h.calls[0];
  assert.equal(
    new URL(sent.url).searchParams.get("redirect_to"),
    "https://example.com/app/",
  );
  assert.deepEqual(JSON.parse(sent.body), {
    email: user.email,
    create_user: true,
  });
  assert.equal(sent.headers.apikey, config.publishableKey);
});

test("la sesión del enlace solo se guarda tras verificar la identidad con el servidor", async () => {
  const h = harness();
  const returned = await h.api.restore(
    "https://example.com/#access_token=test-access&refresh_token=test-refresh&expires_in=3600",
  );
  assert.deepEqual(returned, user);
  assert.ok(h.calls[0].url.endsWith("/auth/v1/user"));
  assert.equal(h.saved.user.id, user.id);
  h.reply = () => ({ status: 401, data: {} });
  await assert.rejects(
    h.api.restore(
      "https://example.com/#access_token=invalid&refresh_token=invalid",
    ),
  );
  assert.equal(h.saved.access_token, "test-access");
});

test("no confunde el correo de la cuenta guardada con la identidad verificada", async () => {
  const h = harness();
  h.saved = token({ user: { id: "unverified", email: "other@example.com" } });
  assert.deepEqual(await h.api.restore("https://example.com/"), user);
  assert.equal(h.saved.user.id, user.id);
});

test("renueva una sesión caducada y no envía tokens dentro de los registros", async () => {
  const h = harness();
  h.saved = token({ expires_at: 1 });
  h.reply = (url) => ({
    status: 200,
    data: url.includes("/token?")
      ? token({ access_token: "renewed" })
      : url.includes("/user")
        ? user
        : { records: [], conflicts: [] },
  });
  await h.api.restore("https://example.com/");
  await h.api.exchange([]);
  const rpc = h.calls.at(-1);
  assert.equal(rpc.headers.Authorization, "Bearer renewed");
  assert.deepEqual(JSON.parse(rpc.body), { changes: [] });
});

test("un cambio de cuenta en otra pestaña detiene el envío de datos", async () => {
  const h = harness();
  h.saved = token();
  await h.api.restore("https://example.com/");
  h.saved = token({ user: { id: "account-b" } });
  const count = h.calls.length;
  await assert.rejects(h.api.exchange([]), /cuenta cambió/);
  assert.equal(h.calls.length, count);
});

test("cerrar sesión retira el token local incluso sin conexión", async () => {
  const h = harness();
  h.saved = token();
  await h.api.restore("https://example.com/");
  h.reply = () => {
    throw new Error("offline");
  };
  await h.api.signOut();
  assert.equal(h.saved, null);
  assert.ok(AUTH_KEY.endsWith("-v1"));
  await assert.rejects(h.api.exchange([]));
});
