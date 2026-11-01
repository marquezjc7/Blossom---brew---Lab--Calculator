(function (root) {
  "use strict";

  const STATE_KEY = "blossom-brew-cloud-state-v1";
  const canonical = (value) => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, canonical(value[key])]),
      );
    }
    return value;
  };
  const keyOf = (kind, id) => JSON.stringify([kind, id]);

  async function fingerprint(payload) {
    const encoded = new TextEncoder().encode(
      JSON.stringify(canonical(payload)),
    );
    const digest = await root.crypto.subtle.digest("SHA-256", encoded);
    return [...new Uint8Array(digest)]
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("");
  }

  async function snapshot(data) {
    const entries = [];
    for (const [kind, collection] of [
      ["recipe", data.recipes],
      ["session", data.sessions],
    ]) {
      for (const payload of collection) {
        if (!payload || typeof payload.id !== "string" || !payload.id) {
          throw new Error(
            "Hay un registro sin identificador. Conserva un respaldo antes de sincronizarlo.",
          );
        }
        entries.push({
          kind,
          id: payload.id,
          payload,
          hash: await fingerprint(payload),
        });
      }
    }
    if (
      new Set(entries.map((entry) => keyOf(entry.kind, entry.id))).size !==
      entries.length
    ) {
      throw new Error(
        "Hay registros con identificadores repetidos. Conserva un respaldo antes de sincronizarlos.",
      );
    }
    return entries;
  }

  function makeBatch(
    entries,
    base = {},
    newId = () => root.crypto.randomUUID(),
  ) {
    const local = new Map(
      entries.map((entry) => [keyOf(entry.kind, entry.id), entry]),
    );
    const changes = [];
    for (const key of new Set([...Object.keys(base), ...local.keys()])) {
      const entry = local.get(key);
      const previous = base[key];
      if ((entry?.hash ?? null) === (previous?.hash ?? null)) continue;
      const [kind, id] = JSON.parse(key);
      changes.push({
        op_id: newId(),
        kind,
        record_id: id,
        base_version: previous?.version ?? 0,
        deleted: !entry,
        payload: entry?.payload ?? null,
      });
    }
    return {
      changes,
      sentHashes: Object.fromEntries(
        entries.map((entry) => [keyOf(entry.kind, entry.id), entry.hash]),
      ),
    };
  }

  async function reconcile(rows, sentHashes, current) {
    const base = {};
    const merged = new Map();
    for (const row of rows) {
      if (
        !row ||
        !["recipe", "session"].includes(row.kind) ||
        typeof row.record_id !== "string" ||
        !Number.isInteger(row.version) ||
        row.version < 1 ||
        typeof row.deleted !== "boolean"
      ) {
        throw new Error(
          "La nube devolvió un registro incompatible; tus datos locales se conservan.",
        );
      }
      const key = keyOf(row.kind, row.record_id);
      if (!row.deleted && (!row.payload || row.payload.id !== row.record_id)) {
        throw new Error(
          "La nube devolvió un registro incompatible; tus datos locales se conservan.",
        );
      }
      base[key] = {
        version: row.version,
        hash: row.deleted ? null : await fingerprint(row.payload),
      };
      if (!row.deleted) merged.set(key, row.payload);
    }
    const latest = new Map(
      current.map((entry) => [keyOf(entry.kind, entry.id), entry]),
    );
    // Changes made while a request was in flight belong to the next batch.
    for (const key of new Set([...Object.keys(sentHashes), ...latest.keys()])) {
      const entry = latest.get(key);
      if ((entry?.hash ?? null) === (sentHashes[key] ?? null)) continue;
      if (entry) merged.set(key, entry.payload);
      else merged.delete(key);
    }
    const data = { recipes: [], sessions: [] };
    for (const [key, payload] of merged) {
      data[JSON.parse(key)[0] === "recipe" ? "recipes" : "sessions"].push(
        payload,
      );
    }
    data.sessions.sort(
      (a, b) =>
        String(b.date ?? "").localeCompare(String(a.date ?? "")) ||
        a.id.localeCompare(b.id),
    );
    return { data, base };
  }

  function createSync({
    readData,
    writeData,
    readState,
    writeState,
    exchange,
    canApply = () => true,
    onStatus = () => {},
    onConflict = () => {},
  }) {
    let user = null,
      running = null,
      timer = null,
      generation = 0;
    let rerun = false;
    const status = (phase, message) => onStatus({ phase, message });

    function notify(delay = 700) {
      if (!user) return;
      status(
        "pending",
        "Cambios guardados en este dispositivo. Pendiente de sincronizar…",
      );
      if (running) rerun = true;
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        run();
      }, delay);
    }

    async function run() {
      if (!user) return;
      if (running) {
        rerun = true;
        return running;
      }
      if (!canApply()) {
        status(
          "waiting",
          "Guarda o cancela los cambios de la receta para recibir los de tus otros dispositivos.",
        );
        return;
      }
      const account = user;
      const started = generation;
      running = (async () => {
        try {
          let state = readState();
          if (state?.owner && state.owner !== account.id) {
            throw new Error(
              "Este navegador contiene datos de otra cuenta. Entra con la cuenta anterior para sincronizarlos.",
            );
          }
          if (!state?.owner)
            state = { owner: account.id, base: {}, batch: null };
          if (!state.batch) {
            state = {
              ...state,
              batch: makeBatch(await snapshot(readData()), state.base),
            };
            if (!writeState(state))
              throw new Error(
                "El navegador no permite guardar la sincronización. Tus recetas siguen en este dispositivo.",
              );
          }
          status("syncing", "Sincronizando tus recetas y bitácora…");
          const result = await exchange(state.batch.changes);
          if (started !== generation || !user) return;
          if (
            !Array.isArray(result?.records) ||
            !Array.isArray(result?.conflicts)
          ) {
            throw new Error(
              "No se pudo comprobar la sincronización. Tus datos locales se conservan.",
            );
          }
          if (!canApply()) {
            status(
              "waiting",
              "Hay cambios nuevos en la nube. Guarda o cancela la edición para recibirlos.",
            );
            return;
          }
          const next = await reconcile(
            result.records,
            state.batch.sentHashes,
            await snapshot(readData()),
          );
          if (started !== generation || !user || !canApply()) return;
          if (!writeData(next.data))
            throw new Error(
              "No se pudieron guardar los datos recibidos. La nube y tus cambios pendientes se conservan; volveremos a intentarlo.",
            );
          if (
            !writeState({ owner: account.id, base: next.base, batch: null })
          ) {
            throw new Error(
              "No se pudo confirmar la sincronización en este navegador. Se volverá a intentar sin borrar tus recetas.",
            );
          }
          if (result.conflicts.length) onConflict(result.conflicts);
          status("synced", "Tus recetas y bitácora están sincronizadas.");
          const pending = makeBatch(await snapshot(readData()), next.base);
          if (pending.changes.length) rerun = true;
        } catch (error) {
          if (started === generation && user)
            status(
              "error",
              error.message ||
                "Sin conexión con la nube. Tus cambios se conservan aquí y se enviarán cuando vuelva la conexión.",
            );
        }
      })();
      try {
        await running;
      } finally {
        running = null;
        if (rerun && user) {
          rerun = false;
          notify();
        }
      }
    }

    return {
      async connect(account) {
        generation++;
        user = account;
        await run();
      },
      disconnect() {
        generation++;
        user = null;
        rerun = false;
        clearTimeout(timer);
      },
      notify,
      run,
    };
  }

  const sync = Object.freeze({
    STATE_KEY,
    fingerprint,
    snapshot,
    makeBatch,
    reconcile,
    createSync,
  });
  if (typeof module !== "undefined" && module.exports) module.exports = sync;
  else (root.BlossomLab ??= {}).sync = sync;
})(globalThis);
