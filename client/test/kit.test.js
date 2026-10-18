"use strict";
// Tests for client/orin-ui-kit.js (theme toggle, Escape for dialogs). Run: node client/test/kit.test.js
const assert = require("assert");
let passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; } catch (e) { failed++; console.error("FAIL " + name + "\n  " + e.message); } }

function store() {
  const m = {};
  global.localStorage = { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); } };
  return m;
}
function html() {
  const attrs = {};
  return { attrs, setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute: k => { delete attrs[k]; } };
}
function toggle() { return { getAttribute: k => (k === "data-ou-theme-toggle" ? "1" : null), setAttribute() {}, parentNode: null }; }

const Kit = require("../orin-ui-kit.js");

test("the toggle cycles system, light, dark, system and remembers it", () => {
  const m = store();
  const doc = { documentElement: html() };
  const b = toggle();
  assert.strictEqual(Kit.onClick({ target: b }, doc), "light");
  assert.strictEqual(doc.documentElement.attrs["data-theme"], "light");
  assert.strictEqual(m["orin-ui-theme"], "light");
  assert.strictEqual(Kit.onClick({ target: b }, doc), "dark");
  assert.strictEqual(doc.documentElement.attrs["data-theme"], "dark");
  assert.strictEqual(Kit.onClick({ target: b }, doc), "system");
  assert.deepStrictEqual(doc.documentElement.attrs, {});
});

test("the default is the system theme and applying it removes the attribute", () => {
  store();
  const h = html();
  Kit.applyStored(h);
  assert.deepStrictEqual(h.attrs, {});
  Kit.apply(h, "dark");
  assert.strictEqual(h.attrs["data-theme"], "dark");
  Kit.apply(h, "system");
  assert.deepStrictEqual(h.attrs, {});
});

test("a stored theme is applied at start", () => {
  const m = store();
  m["orin-ui-theme"] = "light";
  const h = html();
  Kit.applyStored(h);
  assert.strictEqual(h.attrs["data-theme"], "light");
});

test("clicks elsewhere change nothing", () => {
  store();
  const doc = { documentElement: html() };
  assert.strictEqual(Kit.onClick({ target: { getAttribute: () => null, parentNode: null } }, doc), null);
});

test("Escape clicks the dismiss element of an open dialog", () => {
  let clicked = 0;
  const doc = { querySelector: s => (s === "[data-ou-dismiss]" ? { click: () => { clicked++; } } : null) };
  assert.strictEqual(Kit.onKey({ key: "Escape" }, doc), true);
  assert.strictEqual(clicked, 1);
  assert.strictEqual(Kit.onKey({ key: "a" }, doc), false);
  assert.strictEqual(Kit.onKey({ key: "Escape" }, { querySelector: () => null }), false);
});

test("a blocked localStorage does not break the toggle", () => {
  global.localStorage = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  const doc = { documentElement: html() };
  assert.doesNotThrow(() => Kit.onClick({ target: toggle() }, doc));
});

test("clicking elsewhere closes open menus but not the one clicked in", () => {
  const mk = (inside) => { const m = { attrs: { open: "" }, contains: n => n === inside, removeAttribute(k) { delete this.attrs[k]; } }; return m; };
  const target = {};
  const a = mk(target), b = mk({});
  const doc = { querySelectorAll: () => [a, b] };
  assert.strictEqual(Kit.closeMenus({ target }, doc), 1);
  assert.ok("open" in a.attrs && !("open" in b.attrs));
});

console.log(passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
