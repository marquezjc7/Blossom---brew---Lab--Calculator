const { before, beforeEach, after, test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { PGlite } = require("@electric-sql/pglite");
const alice = "11111111-1111-4111-8111-111111111111",
  bob = "22222222-2222-4222-8222-222222222222",
  published = "33333333-3333-4333-8333-333333333333",
  visit = "44444444-4444-4444-8444-444444444444",
  visitor = "55555555-5555-4555-8555-555555555555";
const migration = readFileSync(
  resolve(
    __dirname,
    "../supabase/migrations/202611110003_usage_statistics.sql",
  ),
  "utf8",
);
let db;
before(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);insert into auth.users values('${alice}'),('${bob}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`,
  );
  for (const name of [
    "202611010001_cloud_sync.sql",
    "202611110001_public_catalogue.sql",
  ])
    await db.exec(
      readFileSync(
        resolve(__dirname, "../supabase/migrations/" + name),
        "utf8",
      ),
    );
  await db.exec(migration);
});
beforeEach(async () => {
  await db.exec(
    "reset role;truncate public.blossom_usage_events,public.blossom_usage_visits,public.blossom_analytics_admins,public.blossom_publications,public.blossom_publishers;",
  );
  await db.query("insert into public.blossom_publishers values($1)", [alice]);
  await db.query("insert into public.blossom_analytics_admins values($1)", [
    alice,
  ]);
  await db.query(
    "insert into public.blossom_publications(owner_id,source_id,public_id,recipe,published) values($1,'private-recipe-id',$2,'{\"name\":\"Mi receta pública\"}',true)",
    [alice, published],
  );
});
after(async () => {
  if (db) await db.close();
});
async function account(id = null) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    id || "",
  ]);
  await db.exec("set role " + (id ? "authenticated" : "anon"));
}
async function track(
  kind = "visit",
  target = "",
  session = visit,
  person = visitor,
  channel = "direct",
) {
  return (
    await db.query(
      "select public.blossom_record_usage($1::uuid,$2::uuid,$3,$4,$5) as result",
      [session, person, kind, target, channel],
    )
  ).rows[0].result;
}
async function report(days = 7) {
  await account(alice);
  return (
    await db.query("select public.blossom_usage_summary($1) as result", [days])
  ).rows[0].result;
}
test("estadísticas: solo el administrador autorizado consulta agregados y nadie accede a tablas desde el cliente", async () => {
  for (const id of [null, bob]) {
    await account(id);
    for (const table of [
      "blossom_analytics_admins",
      "blossom_usage_visits",
      "blossom_usage_events",
    ]) {
      await assert.rejects(
        db.query("select * from public." + table),
        /permission denied/,
      );
      await assert.rejects(
        db.query("insert into public." + table + " default values"),
        /permission denied/,
      );
    }
    await assert.rejects(
      db.query("select public.blossom_usage_summary(7)"),
      /permission denied|access required/,
    );
  }
  await db.exec("reset role");
  await db.query("insert into public.blossom_publishers values($1)", [bob]);
  await account(bob);
  await assert.rejects(
    db.query("select public.blossom_usage_summary(7)"),
    /access required/,
  );
  assert.equal((await report()).visits, 0);
  await assert.rejects(
    db.query("select public.blossom_usage_summary(90)"),
    /7 or 30/,
  );
});
test("estadísticas: reintentos y clics repetidos cuentan una vez por visita, sin revelar identificadores", async () => {
  await account();
  for (let i = 0; i < 3; i++) {
    await track();
    await track("recipe", published);
    await track("prepare", published);
    await track("copy", published);
    await track("section", "recipes");
  }
  const data = await report();
  assert.equal(data.visits, 1);
  assert.equal(data.visitors, 1);
  assert.equal(data.preparations, 1);
  assert.equal(data.copies, 1);
  assert.deepEqual(data.recipes, [
    {
      id: published,
      name: "Mi receta pública",
      views: 1,
      preparations: 1,
      copies: 1,
    },
  ]);
  assert.deepEqual(data.sections, [{ name: "recipes", visits: 1 }]);
  assert.equal(data.daily.length, 7);
  const text = JSON.stringify(data);
  for (const privateValue of [visit, visitor, alice, "private-recipe-id"])
    assert.equal(text.includes(privateValue), false);
});
test("estadísticas: visitas, navegadores y origen se agregan por separado", async () => {
  await account();
  await track("visit", "", visit, visitor, "instagram");
  await track("visit", "", visit, visitor, "other");
  await track("recipe", "reference-bourbon-lavado");
  await track("visit", "", "66666666-6666-4666-8666-666666666666");
  await track(
    "visit",
    "",
    "77777777-7777-4777-8777-777777777777",
    bob,
    "other",
  );
  const data = await report(30);
  assert.equal(data.visits, 3);
  assert.equal(data.visitors, 2);
  assert.equal(data.daily.length, 30);
  assert.equal(data.channels.find((x) => x.name === "instagram").visits, 1);
  assert.match(data.recipes[0].name, /referencia/);
});
test("estadísticas: eventos inválidos y recetas privadas no crean visitas", async () => {
  await account();
  for (const [kind, target, channel] of [
    ["recipe", "private-recipe-id", "direct"],
    ["section", "journal", "direct"],
    ["visit", "a", "direct"],
    ["visit", "", "unknown"],
    ["secret", "anything", "direct"],
  ])
    await assert.rejects(
      track(kind, target, visit, visitor, channel),
      /Invalid usage|Only public/,
    );
  assert.equal((await report()).visits, 0);
});
test("estadísticas: una sesión no acepta otro visitante ni acciones fuera de sus 30 minutos", async () => {
  await account();
  await track();
  assert.equal((await track("recipe", published, visit, bob)).recorded, false);
  await db.exec("reset role");
  await db.exec(
    "update public.blossom_usage_visits set created_at=now()-interval '31 minutes'",
  );
  await account();
  assert.equal((await track("recipe", published)).recorded, false);
  assert.equal((await report()).recipes.length, 0);
});
test("estadísticas: períodos, retención y repetir la migración conservan datos vigentes", async () => {
  await account();
  await track("recipe", published);
  await db.exec("reset role");
  await db.exec(
    "update public.blossom_usage_visits set created_at=now()-interval '10 days';update public.blossom_usage_events set created_at=now()-interval '10 days';",
  );
  assert.equal((await report(7)).visits, 0);
  assert.equal((await report(30)).visits, 1);
  await db.exec("reset role");
  await db.exec(migration);
  assert.equal((await report(30)).recipes[0].views, 1);
  await db.exec("reset role");
  await db.exec(
    "update public.blossom_usage_visits set created_at=now()-interval '61 days'",
  );
  assert.equal((await report(30)).visits, 0);
  await db.exec("reset role");
  assert.equal(
    (await db.query("select count(*) n from public.blossom_usage_events"))
      .rows[0].n,
    0,
  );
});
test("estadísticas: retirar recetas impide nuevos eventos y mantiene la historia sin datos privados", async () => {
  await account();
  await track("recipe", published);
  await db.exec("reset role");
  await db.exec(
    "update public.blossom_publications set published=false,recipe=null",
  );
  await account();
  await assert.rejects(track("copy", published), /Only public/);
  assert.equal((await report()).recipes[0].name, "Receta retirada");
  await db.exec("reset role");
  await db.exec("delete from public.blossom_publishers");
  await account(alice);
  await assert.rejects(
    db.query("select public.blossom_usage_summary(7)"),
    /access required/,
  );
});
