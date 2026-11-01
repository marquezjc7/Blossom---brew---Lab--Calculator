(function (root) {
  "use strict";

  // Preserve the V1 keys so existing recipes and sessions remain available.
  const RECIPE_KEY = "blossom-brew-recipes-v1";
  const SESSION_KEY = "blossom-brew-sessions-v1";

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
          getStorage().setItem(key, JSON.stringify(value));
          return true;
        } catch {
          return false;
        }
      },
    };
  }

  const storage = Object.freeze({ RECIPE_KEY, SESSION_KEY, createStore });
  if (typeof module !== "undefined" && module.exports) {
    module.exports = storage;
  } else {
    (root.BlossomLab ??= {}).storage = storage;
  }
})(globalThis);
