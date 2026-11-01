(function (root) {
  "use strict";

  // Preserve the V1 keys so existing recipes and sessions remain available.
  const RECIPE_KEY = "blossom-brew-recipes-v1";
  const SESSION_KEY = "blossom-brew-sessions-v1";
  const SELECTED_RECIPE_KEY = "blossom-brew-selected-recipe-v1";

  function createStore(getStorage = () => root.localStorage) {
    return {
      read(key) {
        try {
          const value = getStorage().getItem(key);
          return value ? JSON.parse(value) : [];
        } catch {
          return [];
        }
      },
      write(key, value) {
        try {
          const storage = getStorage();
          const serialized = JSON.stringify(value);
          storage.setItem(key, serialized);
          return storage.getItem(key) === serialized;
        } catch {
          return false;
        }
      },
    };
  }

  const storage = Object.freeze({
    RECIPE_KEY,
    SESSION_KEY,
    SELECTED_RECIPE_KEY,
    createStore,
  });
  if (typeof module !== "undefined" && module.exports) {
    module.exports = storage;
  } else {
    (root.BlossomLab ??= {}).storage = storage;
  }
})(globalThis);
