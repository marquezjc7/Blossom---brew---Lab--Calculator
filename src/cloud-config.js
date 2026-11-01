(function (root) {
  "use strict";
  // Only public connection values belong here. Server credentials never do.
  (root.BlossomLab ??= {}).cloudConfig = Object.freeze({
    url: "",
    publishableKey: "",
  });
})(globalThis);
