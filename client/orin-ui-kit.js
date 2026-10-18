/*
 * orin-ui kit behaviour: the theme toggle and the Escape key for dialogs. No dependencies. Load it in <head> (before the page is
 * painted) so that a saved theme is applied without a flash:
 *
 *   <script src="/orin-ui-kit.js"></script>
 *
 *   data-ou-theme-toggle      a button; each click cycles light -> dark -> system and remembers the choice (localStorage)
 *   data-ou-dismiss           the element Escape clicks to close a dialog (the dialog's backdrop button)
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) { module.exports = api; }
  root.OrinUIKit = api;
  if (typeof document !== "undefined") {
    api.applyStored(document.documentElement);
    document.addEventListener("click", function (e) { api.onClick(e, document); });
    document.addEventListener("keydown", function (e) { api.onKey(e, document); });
  }
})(typeof window !== "undefined" ? window : this, function () {
  "use strict";
  var KEY = "orin-ui-theme";
  var ORDER = ["light", "dark", "system"];

  function read() { try { return localStorage.getItem(KEY) || "system"; } catch (e) { return "system"; } }
  function write(v) { try { localStorage.setItem(KEY, v); } catch (e) { /* private mode: the choice lasts for the page only */ } }

  // theme is "light", "dark" or "system" (follow the operating system: no attribute).
  function apply(html, theme) {
    if (theme === "light" || theme === "dark") { html.setAttribute("data-theme", theme); } else { html.removeAttribute("data-theme"); }
  }

  function applyStored(html) { apply(html, read()); }

  function next(theme) { return ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length]; }

  function onClick(e, doc) {
    var t = e.target;
    while (t && t !== doc) {
      if (t.getAttribute && t.getAttribute("data-ou-theme-toggle") !== null) {
        var theme = next(read());
        write(theme);
        apply(doc.documentElement, theme);
        t.setAttribute("title", "Theme: " + theme);
        return theme;
      }
      t = t.parentNode;
    }
    return null;
  }

  function onKey(e, doc) {
    if (e.key !== "Escape") { return false; }
    var d = doc.querySelector("[data-ou-dismiss]");
    if (d && d.click) { d.click(); return true; }
    return false;
  }

  return { applyStored: applyStored, apply: apply, next: next, onClick: onClick, onKey: onKey, read: read };
});
