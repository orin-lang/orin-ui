/* Progressive navigation for SSR documents. Mark the replaceable region with
 * data-orin-navigation, links with data-ou-navigate and GET forms with data-ou-form.
 * This adapter transports documents only; application state and rendering stay in Orin. */
(function () {
  "use strict";
  if (typeof document === "undefined") return;
  var controller = null, revision = 0, timers = new WeakMap();
  function root() { return document.querySelector("[data-orin-navigation]"); }
  function report(region, message) {
    var status = region.querySelector("[data-ou-navigation-status]");
    if (status) status.textContent = message;
  }
  async function visit(url, push, input) {
    var region = root();
    if (!region || url.origin !== location.origin) { location.assign(url.href); return; }
    if (controller) controller.abort();
    controller = new AbortController();
    var current = ++revision;
    region.setAttribute("aria-busy", "true");
    report(region, region.getAttribute("data-ou-busy-label") || "Loading…");
    try {
      var response = await fetch(url.href, { credentials: "same-origin", cache: "no-store", headers: { "X-Orin-Navigation": "1" }, signal: controller.signal });
      var html = await response.text();
      if (current !== revision) return;
      var page = new DOMParser().parseFromString(html, "text/html");
      var next = page.querySelector("[data-orin-navigation]");
      if (!next) { location.assign(response.url || url.href); return; }
      if (!response.ok) throw new Error("HTTP " + response.status);
      region.querySelectorAll("[data-orin-ui]").forEach(function (island) { if (island.__orinUi) island.__orinUi.close(); });
      region.replaceWith(next);
      document.title = page.title;
      if (push && url.href !== location.href) history.pushState(null, "", url.href);
      if (window.OrinUI) window.OrinUI.bootAll(document);
      next.setAttribute("aria-busy", "false");
      report(next, "");
      if (input && input.name) {
        var field = Array.from(next.querySelectorAll("input,select")).find(function (el) { return el.name === input.name; });
        if (field) { field.focus({ preventScroll: true }); if (typeof field.setSelectionRange === "function" && input.start !== null) field.setSelectionRange(input.start, input.end); }
      } else {
        var heading = next.querySelector("h1");
        if (heading) { heading.setAttribute("tabindex", "-1"); heading.focus({ preventScroll: true }); }
        window.scrollTo({ top: 0, behavior: "instant" });
      }
    } catch (error) {
      if (current !== revision || error.name === "AbortError") return;
      region.setAttribute("aria-busy", "false");
      report(region, region.getAttribute("data-ou-error-label") || "The page could not be updated. Please try again.");
    }
  }
  function submit(form, input) {
    if (form.method.toLowerCase() !== "get") return;
    var url = new URL(form.getAttribute("action") || location.href, location.href);
    url.search = new URLSearchParams(new FormData(form)).toString();
    visit(url, true, input);
  }
  document.addEventListener("click", function (event) {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    var link = event.target.closest("a[data-ou-navigate]");
    if (!link || !link.closest("[data-orin-navigation]") || link.hasAttribute("download") || link.target) return;
    var url = new URL(link.href, location.href);
    if (url.origin !== location.origin || url.hash) return;
    event.preventDefault(); visit(url, true);
  });
  document.addEventListener("submit", function (event) {
    var form = event.target;
    if (!form.matches("form[data-ou-form]") || form.method.toLowerCase() !== "get") return;
    event.preventDefault(); submit(form);
  });
  document.addEventListener("change", function (event) {
    var field = event.target;
    if (field.matches("[data-ou-auto-submit]") && field.form && field.form.matches("[data-ou-form]")) submit(field.form);
  });
  document.addEventListener("input", function (event) {
    var field = event.target, form = field.form;
    if (!field.matches("[data-ou-live]") || !form || !form.matches("[data-ou-form]")) return;
    if (controller) { controller.abort(); controller = null; revision++; var region = root(); if (region) { region.setAttribute("aria-busy", "false"); report(region, ""); } }
    clearTimeout(timers.get(form));
    timers.set(form, setTimeout(function () { submit(form, { name: field.name, start: field.selectionStart, end: field.selectionEnd }); }, 300));
  });
  window.addEventListener("popstate", function () { visit(new URL(location.href), false); });
})();
