(function (root) {
  "use strict";
  const PREFIX = "blossom-public-usage-v1";
  const KEYS = Object.freeze({
    visitor: PREFIX + "-visitor",
    session: PREFIX + "-session",
    excluded: PREFIX + "-excluded",
  });
  const MIGRATION = "supabase/migrations/202611110003_usage_statistics.sql";
  const UUID =
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  const read = (store, key) => {
    try {
      return store?.getItem(key);
    } catch {
      return null;
    }
  };
  const write = (store, key, value) => {
    try {
      store?.setItem(key, value);
      return store?.getItem(key) === value;
    } catch {
      return false;
    }
  };
  function channelFor(url, referrer = "") {
    try {
      if (
        new URL(url).searchParams.get("utm_source")?.toLowerCase() ===
        "instagram"
      )
        return "instagram";
    } catch {}
    if (!referrer) return "direct";
    try {
      const from = new URL(referrer),
        here = new URL(url);
      if (
        from.hostname === "instagram.com" ||
        from.hostname.endsWith(".instagram.com")
      )
        return "instagram";
      if (from.origin === here.origin) return "direct";
    } catch {}
    return "other";
  }
  function activationSql(migration, userId) {
    if (
      !UUID.test(userId) ||
      !migration.includes(
        "create table if not exists public.blossom_analytics_admins",
      )
    )
      throw new Error("No se pudo verificar la configuración de estadísticas.");
    return (
      migration +
      `\n-- Authorize only the verified administrator.\ninsert into public.blossom_analytics_admins(user_id) values ('${userId}'::uuid) on conflict do nothing;\n`
    );
  }
  function instagramUrl(base) {
    const url = new URL(base);
    url.searchParams.set("utm_source", "instagram");
    url.searchParams.set("utm_medium", "bio");
    return url.href;
  }
  function createTracker({
    config,
    url,
    referrer = "",
    local,
    session,
    fetch = root.fetch?.bind(root),
    uuid = () => root.crypto.randomUUID(),
    now = () => Date.now(),
    disabled = false,
  }) {
    try {
      const api =
        typeof module !== "undefined" && module.exports
          ? require("./cloud-api.js")
          : root.BlossomLab.cloudApi;
      config = api.validateConfig(config);
    } catch {
      config = null;
    }
    if (!config || !fetch)
      return {
        track: () => Promise.resolve(false),
        setExcluded(value) {
          write(local, KEYS.excluded, String(!!value));
        },
      };
    let visit = null,
      visitor = null,
      chain = Promise.resolve(),
      halted = false;
    const excluded = () => disabled || read(local, KEYS.excluded) === "true";
    function identifiers() {
      if (!visitor) {
        const stored = read(local, KEYS.visitor);
        visitor = UUID.test(stored || "") ? stored : uuid();
        write(local, KEYS.visitor, visitor);
      }
      if (!visit) {
        try {
          visit = JSON.parse(read(session, KEYS.session));
        } catch {}
      }
      if (
        !visit ||
        !UUID.test(visit.id || "") ||
        !Number.isFinite(visit.until) ||
        visit.until <= now() ||
        visit.until > now() + 1800000
      ) {
        visit = {
          id: uuid(),
          until: now() + 1800000,
          channel: channelFor(url, referrer),
          sent: [],
        };
      }
      if (!Array.isArray(visit.sent)) visit.sent = [];
      write(session, KEYS.session, JSON.stringify(visit));
    }
    async function send(kind, target = "") {
      if (halted || excluded()) return false;
      identifiers();
      const key = kind + ":" + target;
      if (visit.sent.includes(key)) return true;
      const controller = new AbortController(),
        timer = setTimeout(() => controller.abort(), 5000);
      try {
        const response = await fetch(
          config.url.replace(/\/$/, "") + "/rest/v1/rpc/blossom_record_usage",
          {
            method: "POST",
            credentials: "omit",
            referrerPolicy: "no-referrer",
            keepalive: true,
            signal: controller.signal,
            headers: {
              apikey: config.publishableKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              session_id: visit.id,
              visitor_id: visitor,
              event_kind: kind,
              target,
              channel: visit.channel,
            }),
          },
        );
        if (response.status === 404) {
          halted = true;
          return false;
        }
        if (!response.ok) return false;
        const result = await response.json();
        if (result?.recorded !== true) return false;
        visit.sent.push(key);
        write(session, KEYS.session, JSON.stringify(visit));
        return true;
      } catch {
        return false;
      } finally {
        clearTimeout(timer);
      }
    }
    function track(kind, target = "") {
      if (
        !["visit", "section", "recipe", "prepare", "copy"].includes(kind) ||
        typeof target !== "string" ||
        target.length > 64
      )
        return Promise.resolve(false);
      chain = chain
        .then(async () => {
          if (kind !== "visit") await send("visit");
          return send(kind, target);
        })
        .catch(() => false);
      return chain;
    }
    return {
      track,
      setExcluded(value) {
        disabled = !!value;
        write(local, KEYS.excluded, String(disabled));
      },
    };
  }
  const analytics = Object.freeze({
    KEYS,
    MIGRATION,
    read,
    write,
    activationSql,
    instagramUrl,
    channelFor,
    createTracker,
  });
  if (typeof module !== "undefined" && module.exports)
    module.exports = analytics;
  else (root.BlossomLab ??= {}).analytics = analytics;
})(globalThis);
