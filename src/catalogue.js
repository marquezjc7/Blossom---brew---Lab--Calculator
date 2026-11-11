(function (root) {
  "use strict";
  const common = typeof module !== "undefined" && module.exports;
  const plans = common ? require("./plans.js") : root.BlossomLab.plans;
  const water = common ? require("./water.js") : root.BlossomLab.water;
  const api = common ? require("./cloud-api.js") : root.BlossomLab.cloudApi;
  const fields = [
    "name",
    "coffee",
    "method",
    "dose",
    "water",
    "ratio",
    "temp",
    "temp2",
    "bloom",
    "time",
    "grind",
    "grinder",
    "grindSize",
    "grindMicrons",
    "pours",
    "pourTimes",
    "pourSteps",
    "pourCount",
    "bloomWater",
  ];
  const MIGRATION = "supabase/migrations/202611110001_public_catalogue.sql";
  const MIGRATIONS = Object.freeze([
    MIGRATION,
    "supabase/migrations/202611110002_pour_steps.sql",
  ]);
  function publicRecipe(source) {
    if (!source || typeof source !== "object")
      throw new Error("Receta incompatible.");
    const recipe = Object.fromEntries(
      fields
        .filter((key) => source[key] !== undefined)
        .map((key) => [key, structuredClone(source[key])]),
    );
    for (const field of ["name", "coffee", "method"]) {
      if (
        typeof recipe[field] !== "string" ||
        !recipe[field].trim() ||
        recipe[field].length > (field === "coffee" ? 120 : 100)
      )
        throw new Error("La receta necesita nombre, café y método válidos.");
    }
    if (
      !Number.isFinite(recipe.dose) ||
      recipe.dose <= 0 ||
      recipe.dose > 1000 ||
      !Number.isFinite(recipe.water) ||
      recipe.water <= 0 ||
      recipe.water > 20000 ||
      !Number.isFinite(recipe.temp) ||
      recipe.temp < 0 ||
      recipe.temp > 100 ||
      (recipe.temp2 != null &&
        (!Number.isFinite(recipe.temp2) ||
          recipe.temp2 < 0 ||
          recipe.temp2 > 100))
    )
      throw new Error(
        "Revisa la dosis, el agua y las temperaturas antes de publicar.",
      );
    recipe.ratio ??= recipe.water / recipe.dose;
    recipe.temp2 ??= null;
    recipe.pours ??= null;
    recipe.time ??= "";
    if (
      !Number.isFinite(recipe.ratio) ||
      recipe.ratio < 1 ||
      recipe.ratio > 100 ||
      (recipe.bloom != null &&
        (!Number.isInteger(recipe.bloom) ||
          recipe.bloom < 0 ||
          recipe.bloom > 900)) ||
      (recipe.grindMicrons != null &&
        (!Number.isFinite(recipe.grindMicrons) || recipe.grindMicrons <= 0))
    )
      throw new Error(
        "Revisa el ratio, el bloom y la molienda antes de publicar.",
      );
    for (const field of ["grind", "grinder", "grindSize"])
      if (
        recipe[field] != null &&
        (typeof recipe[field] !== "string" || recipe[field].length > 100)
      )
        throw new Error("La referencia de molienda no es válida.");
    if (
      recipe.bloomWater != null &&
      (!Number.isFinite(recipe.bloomWater) ||
        recipe.bloomWater <= 0 ||
        recipe.bloomWater > recipe.water)
    )
      throw new Error("El bloom no puede superar el agua total.");
    const error =
      plans.validatePlan(
        recipe.pours,
        recipe.pourTimes,
        recipe.water,
        recipe.time,
      ) ||
      plans.validatePourCount(recipe) ||
      plans.validatePourSteps(recipe);
    if (error) throw new Error(error);
    if (recipe.pourSteps != null)
      recipe.pourSteps = recipe.pourSteps.map((_, index) =>
        plans.getPourStep(recipe, index),
      );
    if (source.waterProfile != null)
      recipe.waterProfile = water.makeProfile(source.waterProfile);
    return recipe;
  }
  function activationSql(sql, userId) {
    if (
      typeof sql !== "string" ||
      !sql.includes("create table if not exists public.blossom_publishers") ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
        userId,
      )
    )
      throw new Error("No se pudo preparar la configuración para esta cuenta.");
    return (
      sql +
      `\n-- Autorizar exclusivamente la cuenta verificada de este navegador.\n` +
      `insert into public.blossom_publishers(user_id) values ('${userId}'::uuid) on conflict do nothing;\n`
    );
  }
  function createReader({ config, fetch = root.fetch.bind(root) }) {
    const connection = api.validateConfig(config);
    if (!connection) return null;
    return {
      async list() {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        try {
          const response = await fetch(
            connection.url + "/rest/v1/rpc/blossom_public_catalogue",
            {
              method: "POST",
              signal: controller.signal,
              credentials: "omit",
              cache: "no-store",
              headers: {
                apikey: connection.publishableKey,
                "Content-Type": "application/json",
              },
              body: "{}",
            },
          );
          if (!response.ok) {
            const error = new Error(
              response.status === 404
                ? "El recetario se está preparando."
                : "No se pudo cargar el recetario. Vuelve a intentarlo.",
            );
            error.status = response.status;
            throw error;
          }
          const data = await response.json();
          if (!Array.isArray(data))
            throw new Error("No se pudo comprobar el recetario.");
          const seen = new Set();
          return data.map((value) => {
            if (
              typeof value.id !== "string" ||
              !/^[a-f0-9-]{36}$/i.test(value.id) ||
              seen.has(value.id)
            )
              throw new Error("No se pudo comprobar una receta publicada.");
            seen.add(value.id);
            return { ...publicRecipe(value), id: value.id };
          });
        } catch (error) {
          if (error.name === "AbortError" || error instanceof TypeError)
            throw new Error(
              "No se pudo conectar con el recetario. Comprueba la conexión y vuelve a intentarlo.",
            );
          throw error;
        } finally {
          clearTimeout(timer);
        }
      },
    };
  }
  const catalogue = Object.freeze({
    publicRecipe,
    createReader,
    activationSql,
    MIGRATION,
    MIGRATIONS,
  });
  if (common) module.exports = catalogue;
  else (root.BlossomLab ??= {}).catalogue = catalogue;
})(globalThis);
