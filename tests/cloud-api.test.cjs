const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  AUTH_KEY,
  EMAIL_RETRY_KEY,
  retryAfterSeconds,
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
    cooldown: null,
    now: Date.now(),
    calls: [],
    reply: () => ({ status: 200, data: user }),
  };
  h.store = {
    read: (key) => structuredClone(key === AUTH_KEY ? h.saved : h.cooldown),
    write: (key, value) => {
      if (key === AUTH_KEY) h.saved = structuredClone(value);
      else h.cooldown = structuredClone(value);
      return true;
    },
  };
  h.api = createCloudApi({
    config,
    store: h.store,
    now: () => h.now,
    fetch: async (url, options) => {
      h.calls.push({ url, ...options });
      const reply = h.reply(url, options);
      return {
        ok: reply.status >= 200 && reply.status < 300,
        status: reply.status,
        headers: new Headers(reply.headers ?? {}),
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

test("interpreta Retry-After sin confundir números inválidos con fechas", () => {
  const now = Date.parse("2026-11-09T00:00:00Z");
  assert.equal(retryAfterSeconds("120", now), 120);
  assert.equal(retryAfterSeconds("Mon, 09 Nov 2026 00:02:00 GMT", now), 120);
  for (const value of [null, "", "0", "-1", "no es una fecha"])
    assert.equal(retryAfterSeconds(value, now), null);
});

test("distingue el límite de correos y conserva la espera al restaurar la aplicación", async () => {
  const h = harness();
  h.reply = () => ({
    status: 429,
    data: { code: "over_email_send_rate_limit" },
    headers: { "Retry-After": "600" },
  });
  await assert.rejects(
    h.api.sendLink(user.email, "https://example.com/"),
    (error) => {
      assert.equal(error.code, "over_email_send_rate_limit");
      assert.equal(error.retryAfterSeconds, 600);
      assert.match(error.message, /límite horario/);
      return true;
    },
  );
  assert.equal(h.api.getEmailCooldown().seconds, 600);
  assert.equal(h.saved, null);
  const restored = createCloudApi({
    config,
    store: h.store,
    now: () => h.now,
    fetch: async () => {
      throw new Error("No debe reenviar");
    },
  });
  await assert.rejects(
    restored.sendLink(user.email, "https://example.com/"),
    /límite horario/,
  );
  assert.equal(h.calls.length, 1);
  assert.equal(restored.getEmailCooldown().seconds, 600);
});

test("las esperas sin cabecera diferencian cuota de correo y solicitudes frecuentes", async () => {
  for (const [code, expected] of [
    ["over_email_send_rate_limit", 3600],
    ["over_request_rate_limit", 60],
  ]) {
    const h = harness();
    h.reply = () => ({ status: 429, data: { code } });
    await assert.rejects(h.api.sendLink(user.email, "https://example.com/"));
    assert.equal(h.api.getEmailCooldown().seconds, expected);
  }
  const legacy = harness();
  legacy.reply = () => ({
    status: 400,
    data: { code: "over_email_send_rate_limit" },
  });
  await assert.rejects(legacy.api.sendLink(user.email, "https://example.com/"));
  assert.equal(legacy.api.getEmailCooldown().seconds, 3600);
});

test("un envío correcto se pausa sin alterar la sesión y permite reenviar tras la espera", async () => {
  const h = harness();
  h.saved = token();
  const session = structuredClone(h.saved);
  await h.api.sendLink(user.email, "https://example.com/");
  assert.equal(h.api.getEmailCooldown().seconds, 60);
  await assert.rejects(h.api.sendLink(user.email, "https://example.com/"));
  assert.equal(h.calls.length, 1);
  h.now += 61000;
  assert.equal(h.api.getEmailCooldown(), null);
  await h.api.sendLink(user.email, "https://example.com/");
  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.saved, session);
  assert.equal(EMAIL_RETRY_KEY, "blossom-brew-email-retry-v1");
});

test("entrar con contraseña funciona aunque los correos estén limitados y no guarda la contraseña", async () => {
  const h = harness();
  const password = "contraseña-de-prueba-123";
  h.cooldown = {
    url: config.url,
    until: h.now + 3600000,
    reason: "over_email_send_rate_limit",
  };
  h.reply = (url) => ({
    status: 200,
    data: url.includes("grant_type=password") ? token() : user,
  });
  assert.deepEqual(await h.api.signInWithPassword(user.email, password), user);
  assert.equal(h.calls.length, 2);
  assert.deepEqual(JSON.parse(h.calls[0].body), {
    email: user.email,
    password,
  });
  assert.ok(!h.calls.some((call) => call.url.includes("/otp")));
  assert.ok(!JSON.stringify([h.saved, h.cooldown]).includes(password));
});

test("la contraseña se configura con la sesión actual y no modifica los datos guardados", async () => {
  const h = harness();
  const password = "contraseña-de-prueba-123";
  h.saved = token();
  await h.api.restore("https://example.com/");
  const session = structuredClone(h.saved);
  await h.api.setPassword(password);
  const call = h.calls.at(-1);
  assert.equal(call.method, "PUT");
  assert.ok(call.url.endsWith("/auth/v1/user"));
  assert.equal(call.headers.Authorization, "Bearer test-access");
  assert.deepEqual(JSON.parse(call.body), { password });
  assert.deepEqual(h.saved, session);
  assert.ok(!JSON.stringify(h.saved).includes(password));
  h.reply = () => ({ status: 200, data: { user } });
  await h.api.setPassword(password);
  assert.deepEqual(h.saved, session);
});

test("no configura contraseñas sin una sesión y explica credenciales inválidas", async () => {
  const h = harness();
  await assert.rejects(
    h.api.setPassword("contraseña-de-prueba-123"),
    /Entra con tu correo/,
  );
  assert.equal(h.calls.length, 0);
  h.reply = () => ({ status: 400, data: { error: "invalid_grant" } });
  await assert.rejects(
    h.api.signInWithPassword(user.email, "incorrecta"),
    /correo o la contraseña/,
  );
  assert.equal(h.saved, null);
});
