"use strict";
// A very small DOM, enough for client/orin-ui.js: nodes, attributes, child lists, events with a capture phase on one node.
// Not a general DOM. It exists so the client can be tested with plain `node`, without a browser or npm packages.

class FakeNode {
  constructor(doc, nodeType) {
    this.ownerDocument = doc;
    this.nodeType = nodeType;
    this.parentNode = null;
    this.childNodes = [];
  }
  get firstChild() { return this.childNodes[0] || null; }
  appendChild(n) { return this.insertBefore(n, null); }
  insertBefore(n, ref) {
    if (n.parentNode) { n.parentNode.removeChild(n); }
    const i = ref ? this.childNodes.indexOf(ref) : this.childNodes.length;
    if (i < 0) { throw new Error("insertBefore: reference is not a child"); }
    this.childNodes.splice(i, 0, n);
    n.parentNode = this;
    return n;
  }
  removeChild(n) {
    const i = this.childNodes.indexOf(n);
    if (i < 0) { throw new Error("removeChild: not a child"); }
    this.childNodes.splice(i, 1);
    n.parentNode = null;
    return n;
  }
  replaceChild(n, old) {
    this.insertBefore(n, old);
    this.removeChild(old);
    return old;
  }
}

class FakeText extends FakeNode {
  constructor(doc, text) { super(doc, 3); this.nodeValue = text; }
}

class FakeComment extends FakeNode {
  constructor(doc, text) { super(doc, 8); this.nodeValue = text; }
}

class FakeElement extends FakeNode {
  constructor(doc, tag, ns) {
    super(doc, 1);
    this.localName = tag;
    this.tagName = tag.toUpperCase();
    this.namespaceURI = ns || "http://www.w3.org/1999/xhtml";
    this.attrs = [];
    this.listeners = {};
  }
  setAttribute(name, value) {
    const a = this.attrs.find(x => x.name === name);
    if (a) { a.value = String(value); } else { this.attrs.push({ name, value: String(value) }); }
  }
  getAttribute(name) {
    const a = this.attrs.find(x => x.name === name);
    return a ? a.value : null;
  }
  removeAttribute(name) { this.attrs = this.attrs.filter(x => x.name !== name); }
  addEventListener(type, fn, capture) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter(f => f !== fn); }
  // Run the listeners of `this` for an event aimed at `target` (a descendant): what a capture listener on the root sees.
  fire(type, target, extra) {
    const ev = Object.assign({ type, target, cancelable: true, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } }, extra || {});
    (this.listeners[type] || []).forEach(fn => fn(ev));
    return ev;
  }
}

class FakeDocument {
  createElement(tag) { return new FakeElement(this, tag); }
  createElementNS(ns, tag) { return new FakeElement(this, tag, ns); }
  createTextNode(text) { return new FakeText(this, text); }
  createComment(text) { return new FakeComment(this, text); }
}

function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const VOID = ["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"];

// Serialise like the server's HTML renderer, with attributes sorted by name so that attribute order does not matter.
function serialize(node) {
  if (node.nodeType === 3) { return esc(node.nodeValue); }
  if (node.nodeType === 8) { return ""; }
  const attrs = node.attrs.slice().sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map(a => " " + a.name + "=\"" + esc(a.value) + "\"").join("");
  if (VOID.indexOf(node.localName) >= 0) { return "<" + node.localName + attrs + ">"; }
  return "<" + node.localName + attrs + ">" + node.childNodes.map(serialize).join("") + "</" + node.localName + ">";
}

function serializeChildren(root) { return root.childNodes.map(serialize).join(""); }

// Sort the attributes of an HTML string produced by the server so it compares with `serialize` (test helper: parses the
// small, regular subset the server writes).
function normalizeHtml(html) {
  const doc = new FakeDocument();
  const root = doc.createElement("root");
  const stack = [root];
  const re = /<\/([A-Za-z0-9\-]+)>|<([A-Za-z][A-Za-z0-9\-]*)((?:\s+[^\s=>]+="[^"]*")*)>|([^<]+)/g;
  let m;
  const unesc = s => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&amp;/g, "&");
  while ((m = re.exec(html)) !== null) {
    const top = stack[stack.length - 1];
    if (m[1]) { stack.pop(); }
    else if (m[2]) {
      const el = doc.createElement(m[2]);
      const are = /\s+([^\s=>]+)="([^"]*)"/g;
      let a;
      while ((a = are.exec(m[3] || "")) !== null) { el.setAttribute(a[1], unesc(a[2])); }
      top.appendChild(el);
      if (VOID.indexOf(m[2]) < 0) { stack.push(el); }
    } else {
      top.appendChild(doc.createTextNode(unesc(m[4])));
    }
  }
  return serializeChildren(root);
}

module.exports = { FakeDocument, FakeElement, FakeText, serialize, serializeChildren, normalizeHtml };
