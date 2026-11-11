const { before, beforeEach, after, test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { randomUUID } = require("node:crypto");
const { PGlite } = require("@electric-sql/pglite");
const alice = "11111111-1111-4111-8111-111111111111",
  bob = "22222222-2222-4222-8222-222222222222";
const migration = readFileSync(
  resolve(
    __dirname,
    "../supabase/migrations/202611110001_public_catalogue.sql",
  ),
  "utf8",
);
let db;
const recipe = () => ({
  id: "personal-1",
  name: "Mi receta",
  coffee: "Café",
  method: "V60",
  dose: 15,
  water: 240,
  ratio: 16,
  temp: 93,
  bloom: 40,
  time: "3:00",
  pours: [45, 145, 240],
  notes: "Notas personales que no deben publicarse",
  ownerEmail: "private@example.com",
  sessions: [{ notes: "Bitácora privada" }],
  waterProfile: {
    version: 1,
    system: "bh-1.68-2.45-v1",
    base: "distilled",
    name: "Mi agua",
    liters: 5,
    gh: 70,
    alkalinity: 40,
    privateToken: "never-public",
  },
});
before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key); insert into auth.users values ('${alice}'),('${bob}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;`);
  await db.exec(
    readFileSync(
      resolve(__dirname, "../supabase/migrations/202611010001_cloud_sync.sql"),
      "utf8",
    ),
  );
  await db.exec(migration);
});
beforeEach(async () => {
  await db.exec(
    "reset role; truncate public.blossom_publications, public.blossom_publishers, public.blossom_records;",
  );
  await db.query("insert into public.blossom_publishers values ($1)", [alice]);
});
after(async () => {
  if (db) await db.close();
});
async function account(id, role = "authenticated") {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    id ?? "",
  ]);
  await db.exec("set role " + role);
}
async function scalar(sql, args = []) {
  return (await db.query(sql, args)).rows[0].result;
}
async function save(
  body = recipe(),
  version = 0,
  kind = "recipe",
  deleted = false,
) {
  return scalar("select public.blossom_sync($1::jsonb) as result", [
    JSON.stringify([
      {
        op_id: randomUUID(),
        kind,
        record_id: body.id,
        payload: deleted ? null : body,
        deleted,
        base_version: version,
      },
    ]),
  ]);
}
async function publish(body = recipe(), revision = 0) {
  return scalar(
    "select public.blossom_publish_recipe($1,$2::jsonb,$3) as result",
    [body.id, JSON.stringify(body), revision],
  );
}
async function visible() {
  return scalar("select public.blossom_public_catalogue() as result");
}

test("los visitantes solo pueden leer proyecciones publicadas y no administran el recetario", async () => {
  await account(null, "anon");
  assert.deepEqual(await visible(), []);
  for (const sql of [
    "select * from public.blossom_records",
    "select * from public.blossom_publications",
    "select * from public.blossom_publishers",
    "select public.blossom_catalogue_status()",
    "select public.blossom_publish_recipe('x','{}',0)",
    "select public.blossom_withdraw_recipe('x',1)",
  ])
    await assert.rejects(db.query(sql), /permission denied/);
});
test("publicar exige autorización expresa y no puede obtenerse desde otra cuenta", async () => {
  await account(bob);
  const body = recipe();
  await save(body);
  assert.deepEqual(
    await scalar("select public.blossom_catalogue_status() as result"),
    { publisher: false, entries: [] },
  );
  await assert.rejects(publish(body), /Publisher access required/);
  await assert.rejects(
    db.query("insert into public.blossom_publishers values ($1)", [bob]),
    /permission denied/,
  );
  await assert.rejects(
    db.query(
      "insert into public.blossom_publications(owner_id,source_id) values ($1,'x')",
      [bob],
    ),
    /permission denied/,
  );
});
test("solo se publican parámetros permitidos, sin notas, sesiones ni identificadores de cuenta", async () => {
  await account(alice);
  const body = recipe();
  await save(body);
  const entry = await publish(body);
  assert.equal(entry.published, true);
  await account(null, "anon");
  const [copy] = await visible();
  assert.equal(copy.id, entry.public_id);
  assert.notEqual(copy.id, body.id);
  assert.equal(copy.waterProfile.gh, 70);
  assert.deepEqual(copy.pours, [45, 145, 240]);
  for (const key of [
    "notes",
    "ownerEmail",
    "sessions",
    "owner_id",
    "source_id",
  ])
    assert.equal(key in copy, false);
  assert.equal("privateToken" in copy.waterProfile, false);
  await account(alice);
  const mine = await scalar(
    "select public.blossom_catalogue_status() as result",
  );
  assert.equal(mine.publisher, true);
  assert.equal(mine.entries[0].source_id, body.id);
  const privateRecord = (
    await scalar("select public.blossom_sync('[]') as result")
  ).records[0].payload;
  assert.equal(privateRecord.notes, body.notes);
});
test("un editor autorizado no puede publicar la receta privada de otra cuenta", async () => {
  await account(alice);
  const body = recipe();
  await save(body);
  await db.exec("reset role");
  await db.query("insert into public.blossom_publishers values ($1)", [bob]);
  await account(bob);
  await assert.rejects(publish(body), /synchronize/);
  assert.deepEqual(await visible(), []);
});
test("la publicación es una copia explícita y rechaza versiones privadas o públicas antiguas", async () => {
  await account(alice);
  const body = recipe();
  await save(body);
  const first = await publish(body);
  const changed = { ...body, name: "Cambio privado" };
  await save(changed, 1);
  assert.equal((await visible())[0].name, body.name);
  await assert.rejects(publish(body, first.revision), /synchronization/);
  const second = await publish(changed, first.revision);
  assert.equal((await visible())[0].name, changed.name);
  await assert.rejects(publish(changed, first.revision), /Publication changed/);
  await assert.rejects(
    scalar("select public.blossom_withdraw_recipe($1,$2) as result", [
      body.id,
      first.revision,
    ]),
    /Publication changed/,
  );
  const retired = await scalar(
    "select public.blossom_withdraw_recipe($1,$2) as result",
    [body.id, second.revision],
  );
  assert.equal(retired.published, false);
  assert.deepEqual(await visible(), []);
  assert.equal(
    (await scalar("select public.blossom_sync('[]') as result")).records[0]
      .payload.name,
    changed.name,
  );
  await assert.rejects(
    publish(changed, second.revision),
    /Publication changed/,
  );
  assert.equal(
    (await publish(changed, retired.revision)).public_id,
    first.public_id,
  );
});
test("borrar y sincronizar una receta retira su publicación sin publicar la bitácora", async () => {
  await account(alice);
  const body = recipe();
  await save(body);
  await publish(body);
  await save(
    { id: "session-1", coffee: "Café", notes: "Mi evaluación" },
    0,
    "session",
  );
  await save(body, 1, "recipe", true);
  await account(null, "anon");
  assert.deepEqual(await visible(), []);
  await account(alice);
  const state = await scalar("select public.blossom_sync('[]') as result");
  assert.equal(
    state.records.find((r) => r.kind === "session").payload.notes,
    "Mi evaluación",
  );
});
test("revocar autorización retira visibilidad y repetir la migración conserva las publicaciones", async () => {
  await account(alice);
  await save();
  await publish();
  await db.exec("reset role");
  await db.exec(migration);
  await account(null, "anon");
  assert.equal((await visible()).length, 1);
  await db.exec("reset role");
  await db.query("delete from public.blossom_publishers where user_id=$1", [
    alice,
  ]);
  await account(null, "anon");
  assert.deepEqual(await visible(), []);
});
