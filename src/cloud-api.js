(function (root) {
  "use strict";
  const AUTH_KEY = "blossom-brew-cloud-auth-v1";
  const EMAIL_RETRY_KEY = "blossom-brew-email-retry-v1";

  function retryAfterSeconds(value, now = Date.now()) {
    if (!value) return null;
    const seconds = Number(value);
    if (Number.isFinite(seconds))
      return seconds > 0 ? Math.ceil(seconds) : null;
    const deadline = Date.parse(value);
    return Number.isFinite(deadline) && deadline > now
      ? Math.ceil((deadline - now) / 1000)
      : null;
  }

  function authMessage(status, code) {
    if (code === "over_email_send_rate_limit")
      return "El servicio alcanzó su límite horario de correos. No se ha enviado un enlace nuevo. Espera a que se renueve la cuota.";
    if (status === 429)
      return "El servicio está limitando las solicitudes de acceso. Espera antes de volver a intentarlo.";
    if (code === "invalid_credentials")
      return "El correo o la contraseña no coinciden. Comprueba los datos e inténtalo otra vez.";
    if (code === "weak_password")
      return "El servicio rechazó esa contraseña. Usa al menos 12 caracteres y combina letras, números y símbolos.";
    if (code === "same_password")
      return "Esa ya es tu contraseña actual; puedes usarla para entrar en el otro dispositivo.";
    if (
      code === "reauthentication_needed" ||
      code === "reauthentication_not_valid"
    )
      return "Supabase necesita un acceso reciente antes de cambiar la contraseña. Vuelve a entrar con un enlace nuevo.";
    if (code === "email_not_confirmed")
      return "Confirma primero tu correo desde el enlace que recibiste.";
    if (code === "email_address_not_authorized")
      return "El servicio de correo de prueba no permite enviar a esa dirección. Usa el correo del propietario del proyecto.";
    if (status === 401)
      return "Tu sesión necesita renovarse. Vuelve a entrar con tu correo.";
    return "No se pudo conectar con la nube. Tus recetas se conservan en este navegador.";
  }

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
    let emailRetry = null;

    function getEmailCooldown() {
      const saved = store.read(EMAIL_RETRY_KEY);
      const candidates = [saved, emailRetry].filter(
        (item) =>
          item?.url === connection.url &&
          Number.isFinite(item.until) &&
          item.until > now(),
      );
      const active = candidates.sort((a, b) => b.until - a.until)[0];
      return active
        ? {
            seconds: Math.ceil((active.until - now()) / 1000),
            reason: active.reason,
          }
        : null;
    }

    function pauseEmail(seconds, reason) {
      emailRetry = {
        url: connection.url,
        until: now() + seconds * 1000,
        reason,
      };
      store.write(EMAIL_RETRY_KEY, emailRetry);
    }

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
          let code =
            typeof data?.code === "string"
              ? data.code
              : typeof data?.error_code === "string"
                ? data.error_code
                : typeof data?.error === "string"
                  ? data.error
                  : "";
          if (code === "invalid_grant" && path.includes("grant_type=password"))
            code = "invalid_credentials";
          const error = new Error(authMessage(response.status, code));
          error.status = response.status;
          error.code = code;
          error.retryAfterSeconds = retryAfterSeconds(
            response.headers?.get("Retry-After"),
            now(),
          );
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
        const waiting = getEmailCooldown();
        if (waiting) {
          const error = new Error(
            waiting.reason === "over_email_send_rate_limit"
              ? authMessage(429, waiting.reason)
              : "Espera antes de solicitar otro enlace de acceso.",
          );
          error.status = 429;
          error.code = waiting.reason;
          error.retryAfterSeconds = waiting.seconds;
          throw error;
        }
        try {
          await request(
            "/auth/v1/otp?redirect_to=" + encodeURIComponent(redirectUrl),
            { body: { email, create_user: true } },
          );
          pauseEmail(60, "sent");
        } catch (error) {
          if (
            error.status === 429 ||
            error.code === "over_email_send_rate_limit" ||
            error.code === "over_request_rate_limit"
          ) {
            pauseEmail(
              error.retryAfterSeconds ??
                (error.code === "over_email_send_rate_limit" ? 3600 : 60),
              error.code || "rate_limited",
            );
          }
          throw error;
        }
      },
      getEmailCooldown,
      async signInWithPassword(email, password) {
        const data = await request("/auth/v1/token?grant_type=password", {
          body: { email, password },
        });
        const user = await request("/auth/v1/user", {
          method: "GET",
          token: data.access_token,
        });
        return remember(data, user);
      },
      async setPassword(password) {
        const active = await ensureSession();
        const result = await request("/auth/v1/user", {
          method: "PUT",
          token: active.access_token,
          body: { password },
        });
        const user = result?.user ?? result;
        if (user?.id !== active.user.id) {
          throw new Error(
            "No se pudo verificar el cambio de contraseña de tu cuenta.",
          );
        }
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

  const cloudApi = Object.freeze({
    AUTH_KEY,
    EMAIL_RETRY_KEY,
    retryAfterSeconds,
    validateConfig,
    createCloudApi,
  });
  if (typeof module !== "undefined" && module.exports)
    module.exports = cloudApi;
  else (root.BlossomLab ??= {}).cloudApi = cloudApi;
})(globalThis);
