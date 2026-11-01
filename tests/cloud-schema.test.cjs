const { before, beforeEach, after, test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { randomUUID } = require("node:crypto");
const { PGlite } = require("@electric-sql/pglite");
let db;
const alice = "11111111-1111-4111-8111-111111111111";
const bob = "22222222-2222-4222-8222-222222222222";
const payload = (name = "Mi receta") => ({
  id: "custom-1",
  name,
  coffee: "Café",
  dose: 15,
  water: 240,
});
const change = (body = payload(), version = 0, extra = {}) => ({
  op_id: randomUUID(),
  kind: "recipe",
  record_id: body.id,
  payload: body,
  deleted: false,
  base_version: version,
  ...extra,
});

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users (id uuid primary key);
    insert into auth.users values ('${alice}'), ('${bob}');
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
  `);
  await db.exec(
    readFileSync(
      resolve(__dirname, "../supabase/migrations/202611010001_cloud_sync.sql"),
      "utf8",
    ),
  );
});
beforeEach(async () => {
  await db.exec("reset role; truncate public.blossom_records;");
});
after(async () => {
  if (db) await db.close();
});

async function account(id, role = "authenticated") {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [
    id ?? "",
  ]);
  await db.exec("set role " + role);
}
async function exchange(changes = []) {
  const result = await db.query(
    "select public.blossom_sync($1::jsonb) as result",
    [JSON.stringify(changes)],
  );
  return result.rows[0].result;
}

test("las cuentas solo consultan sus registros y no pueden escribir fuera del RPC", async () => {
  await account(alice);
  assert.equal((await exchange([change()])).records.length, 1);
  await account(bob);
  assert.deepEqual((await exchange()).records, []);
  assert.equal(
    (await db.query("select * from public.blossom_records")).rows.length,
    0,
  );
  await assert.rejects(
    db.query(
      "insert into public.blossom_records(user_id,kind,record_id,payload) values ($1,'recipe','x','{}')",
      [bob],
    ),
    /permission denied/,
  );
  const mine = await exchange([
    change(payload("Receta de Bob"), 0, { user_id: alice }),
  ]);
  assert.equal(mine.records[0].payload.name, "Receta de Bob");
  await account(alice);
  assert.equal((await exchange()).records[0].payload.name, "Mi receta");
});

test("el acceso anónimo no puede leer recetas ni ejecutar la sincronización", async () => {
  await account(null, "anon");
  await assert.rejects(exchange(), /permission denied/);
  await assert.rejects(
    db.query("select * from public.blossom_records"),
    /permission denied/,
  );
});

test("dos ediciones simultáneas se conservan y un reintento no duplica la copia", async () => {
  await account(alice);
  await exchange([change()]);
  await exchange([change(payload("Cambio desde computadora"), 1)]);
  const phone = change(payload("Cambio desde teléfono"), 1);
  const result = await exchange([phone]);
  assert.equal(result.conflicts[0].action, "copied");
  assert.equal(result.records.length, 2);
  assert.deepEqual(
    new Set(result.records.map((r) => r.payload.name)),
    new Set([
      "Cambio desde computadora",
      "Cambio desde teléfono · copia conservada",
    ]),
  );
  assert.equal((await exchange([phone])).records.length, 2);
});

test("el borrado deja una marca que se propaga y una edición antigua se conserva como copia", async () => {
  await account(alice);
  await exchange([change()]);
  const deleted = await exchange([
    change(payload(), 1, { deleted: true, payload: null }),
  ]);
  assert.equal(deleted.records[0].deleted, true);
  assert.equal(deleted.records[0].payload, null);
  assert.equal(deleted.records[0].version, 2);
  const late = await exchange([change(payload("Edición sin conexión"), 1)]);
  assert.equal(
    late.records.find((r) => r.record_id === "custom-1").deleted,
    true,
  );
  assert.equal(late.records.filter((r) => !r.deleted).length, 1);
});

test("un borrado antiguo no elimina una edición nueva y repetir un guardado es idempotente", async () => {
  await account(alice);
  const original = change();
  await exchange([original]);
  assert.equal((await exchange([original])).records.length, 1);
  const newer = payload("Edición nueva");
  await exchange([change(newer, 1)]);
  const result = await exchange([
    change(payload(), 1, { deleted: true, payload: null }),
  ]);
  assert.equal(result.conflicts[0].action, "remote_kept");
  assert.equal(result.records[0].payload.name, "Edición nueva");
  assert.equal(result.records[0].version, 2);
});

test("un lote inválido se rechaza completo y no modifica los registros existentes", async () => {
  await account(alice);
  await exchange([change()]);
  await assert.rejects(
    exchange([
      change(payload("Cambio que debe deshacerse"), 1),
      change({ id: "otro", name: "Dato incompatible" }, 0, {
        record_id: "different",
      }),
    ]),
    /Invalid record/,
  );
  assert.equal((await exchange()).records[0].payload.name, "Mi receta");
});
