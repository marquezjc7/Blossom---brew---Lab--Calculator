(function (root) {
  "use strict";
  const AUTH_KEY = "blossom-brew-cloud-auth-v1";

  function validateConfig(config) {
    if (!config?.url && !config?.publishableKey) return null;
    const url = new URL(config.url);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      throw new Error(
        "La conexión de la nube debe utilizar una dirección HTTPS válida.",
      );
    }
    const key = config.publishableKey;
    let anonymous = false;
    if (typeof key === "string" && key.startsWith("eyJ")) {
      try {
        const part = key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
        anonymous = JSON.parse(root.atob(part)).role === "anon";
      } catch {
        /* Not a public anonymous key. */
      }
    }
    if (
      typeof key !== "string" ||
      (!key.startsWith("sb_publishable_") && !anonymous)
    ) {
      throw new Error(
        "La aplicación solo admite una clave pública de conexión.",
      );
    }
    return { url: url.origin, publishableKey: key };
  }

  function createCloudApi({
    config,
    store,
    fetch = root.fetch.bind(root),
    now = () => Date.now(),
  }) {
    const connection = validateConfig(config);
    if (!connection) return null;
    let session = null;
    let refreshing = null;
    let accountId = null;

    async function request(path, { token, body, method = "POST" } = {}) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch(connection.url + path, {
          method,
          signal: controller.signal,
          headers: {
            apikey: connection.publishableKey,
            "Content-Type": "application/json",
            ...(token ? { Authorization: "Bearer " + token } : {}),
          },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });
        let data;
        try {
          data = await response.json();
        } catch {
          data = null;
        }
        if (!response.ok) {
          const error = new Error(
            response.status === 429
              ? "Espera un momento antes de volver a enviar el enlace."
              : response.status === 401
                ? "Tu sesión necesita renovarse. Vuelve a entrar con tu correo."
                : "No se pudo conectar con la nube. Tus recetas se conservan en este navegador.",
          );
          error.status = response.status;
          throw error;
        }
        return data;
      } catch (error) {
        if (error.status) throw error;
        throw new Error(
          "Sin conexión con la nube. Tus recetas se conservan aquí; volveremos a intentarlo cuando haya conexión.",
        );
      } finally {
        clearTimeout(timeout);
      }
    }

    function remember(data, user) {
      if (!data?.access_token || !data?.refresh_token || !user?.id) {
        throw new Error(
          "No se pudo verificar la cuenta. Solicita otro enlace para entrar.",
        );
      }
      if (accountId && accountId !== user.id)
        throw new Error(
          "La cuenta cambió en otra pestaña. Recarga la aplicación antes de sincronizar.",
        );
      const candidate = {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at:
          Number(data.expires_at) ||
          Math.floor(now() / 1000) + (Number(data.expires_in) || 3600),
        user: { id: user.id, email: user.email ?? "" },
      };
      if (!store.write(AUTH_KEY, candidate))
        throw new Error(
          "El navegador no permite mantener la sesión. Revisa el almacenamiento e inténtalo otra vez.",
        );
      session = candidate;
      accountId = user.id;
      return candidate.user;
    }

    async function ensureSession(force = false) {
      // Another tab may already have renewed the refresh token.
      const saved = store.read(AUTH_KEY);
      if (!saved?.access_token || !saved?.refresh_token)
        throw new Error("Entra con tu correo para sincronizar tus recetas.");
      if (accountId && saved.user?.id !== accountId)
        throw new Error(
          "La cuenta cambió en otra pestaña. Recarga la aplicación antes de sincronizar.",
        );
      session = saved;
      if (!force && session.expires_at > now() / 1000 + 60) return session;
      if (!refreshing)
        refreshing = (async () => {
          const data = await request(
            "/auth/v1/token?grant_type=refresh_token",
            { body: { refresh_token: session.refresh_token } },
          );
          const user = await request("/auth/v1/user", {
            method: "GET",
            token: data.access_token,
          });
          remember(data, user);
          return session;
        })().finally(() => {
          refreshing = null;
        });
      return refreshing;
    }

    return {
      async restore(callbackUrl) {
        const parsed = new URL(callbackUrl);
        const fragment = new URLSearchParams(parsed.hash.slice(1));
        if (fragment.has("error"))
          throw new Error(
            "El enlace de acceso caducó o no es válido. Solicita otro desde esta página.",
          );
        if (fragment.get("access_token")) {
          const token = fragment.get("access_token");
          const user = await request("/auth/v1/user", { method: "GET", token });
          return remember(Object.fromEntries(fragment), user);
        }
        const saved = store.read(AUTH_KEY);
        if (!saved?.access_token || !saved?.refresh_token) return null;
        session = saved;
        const active = await ensureSession();
        const user = await request("/auth/v1/user", {
          method: "GET",
          token: active.access_token,
        });
        return remember(active, user);
      },
      async sendLink(email, redirectUrl) {
        await request(
          "/auth/v1/otp?redirect_to=" + encodeURIComponent(redirectUrl),
          { body: { email, create_user: true } },
        );
      },
      async exchange(changes) {
        const active = await ensureSession();
        try {
          return await request("/rest/v1/rpc/blossom_sync", {
            token: active.access_token,
            body: { changes },
          });
        } catch (error) {
          if (error.status !== 401) throw error;
          const renewed = await ensureSession(true);
          return request("/rest/v1/rpc/blossom_sync", {
            token: renewed.access_token,
            body: { changes },
          });
        }
      },
      async signOut() {
        const current = session;
        // Clearing the local token first prevents automatic reconnection on reload.
        if (!store.write(AUTH_KEY, null))
          throw new Error("No se pudo cerrar la sesión en este navegador.");
        session = null;
        accountId = null;
        if (current) {
          try {
            await request("/auth/v1/logout?scope=local", {
              token: current.access_token,
            });
          } catch {
            /* Already disconnected locally. */
          }
        }
      },
    };
  }

  const cloudApi = Object.freeze({ AUTH_KEY, validateConfig, createCloudApi });
  if (typeof module !== "undefined" && module.exports)
    module.exports = cloudApi;
  else (root.BlossomLab ??= {}).cloudApi = cloudApi;
})(globalThis);
