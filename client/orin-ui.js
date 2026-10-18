/*
 * orin-ui client: applies the patch stream of an orin-ui server to the browser DOM and sends events back.
 * No dependencies, no build step. Protocol: docs/design.md ("The patch protocol").
 *
 *   <div id="orin-ui" data-orin-ui="/ui/events"> ...server-rendered HTML... </div>
 *   <script src="/orin-ui.js"></script>
 *
 * The script boots every element that has a `data-orin-ui` attribute. The attribute is the endpoint: an http(s) path or URL
 * (events are POSTed, the response carries the patches) or a ws:/wss: URL (a WebSocket carries both directions).
 * Optional: `data-ou-session="<id>"` is sent as the `X-Orin-UI-Session` header (HTTP) or in the `s` field (WebSocket).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) { module.exports = api; }
  root.OrinUI = api;
  if (typeof document !== "undefined" && typeof window !== "undefined") {
    var boot = function () { api.bootAll(document); };
    if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", boot); } else { boot(); }
  }
})(typeof window !== "undefined" ? window : this, function () {
  "use strict";

  var EVENTS_ATTR = "data-ou-on";
  var SVG_NS = "http://www.w3.org/2000/svg";
  var MATH_NS = "http://www.w3.org/1998/Math/MathML";
  // Events the client listens for (capture phase on the mount element, so focus and blur work too).
  var LISTENED = ["click", "dblclick", "mousedown", "mouseup", "input", "change", "submit", "keydown", "keyup", "focus", "blur"];
  var URL_ATTRS = ["href", "src", "action", "formaction", "cite", "poster", "background", "manifest", "ping", "data", "longdesc", "xlink:href"];

  // ------------------------------------------------------------ safety (the server already guarantees these; defence in depth)

  function safeAttr(name, value) {
    var lower = String(name).toLowerCase();
    if (lower.indexOf("on") === 0 || lower === "srcdoc") { return null; }
    if (!/^[A-Za-z_:][A-Za-z0-9_:.\-]*$/.test(name)) { return null; }
    if (URL_ATTRS.indexOf(lower) >= 0) { return safeUrl(String(value)); }
    return String(value);
  }

  // Mirrors std:html's rule: relative URLs and the schemes http, https, mailto, tel.
  function safeUrl(u) {
    var m = /^([^:\/?#]*):/.exec(u);
    if (!m) { return u; }
    var scheme = m[1].toLowerCase();
    if (m[1] !== m[1].trim() || /[\u0000-\u001f]/.test(m[1])) { return "about:invalid#orin-unsafe-url"; }
    if (scheme === "http" || scheme === "https" || scheme === "mailto" || scheme === "tel") { return u; }
    return "about:invalid#orin-unsafe-url";
  }

  function safeTag(tag) {
    return /^[A-Za-z][A-Za-z0-9\-]*$/.test(tag) && ["script", "base", "meta", "object", "embed", "applet"].indexOf(tag.toLowerCase()) < 0;
  }

  // ------------------------------------------------------------ DOM construction and patching

  function namespaceFor(tag, parent) {
    if (tag === "svg") { return SVG_NS; }
    if (tag === "math") { return MATH_NS; }
    if (parent && parent.namespaceURI && parent.namespaceURI !== "http://www.w3.org/1999/xhtml" && parent.localName !== "foreignObject") {
      return parent.namespaceURI;
    }
    return null;
  }

  function setAttribute(el, name, value) {
    var v = safeAttr(name, value);
    if (v === null && name !== EVENTS_ATTR) { return; }
    if (name === EVENTS_ATTR) { v = String(value); }
    el.setAttribute(name, v);
    // Live properties that the attribute alone does not update after the user has interacted.
    var tag = el.localName || (el.tagName || "").toLowerCase();
    if (name === "value" && (tag === "input" || tag === "textarea" || tag === "select" || tag === "option")) {
      if (el.value !== v) { el.value = v; }
    } else if (name === "checked" && tag === "input") {
      el.checked = true;
    } else if (name === "selected" && tag === "option") {
      el.selected = true;
    }
  }

  function removeAttribute(el, name) {
    el.removeAttribute(name);
    var tag = el.localName || (el.tagName || "").toLowerCase();
    if (name === "value" && (tag === "input" || tag === "textarea")) { el.value = ""; }
    else if (name === "checked" && tag === "input") { el.checked = false; }
    else if (name === "selected" && tag === "option") { el.selected = false; }
  }

  // Build a DOM node from a protocol node: a JSON string is a text node, an object an element.
  function build(doc, node, parent) {
    if (typeof node === "string") { return doc.createTextNode(node); }
    if (!safeTag(node.t)) { return doc.createComment(""); }
    var ns = namespaceFor(node.t, parent);
    var el = ns ? doc.createElementNS(ns, node.t) : doc.createElement(node.t);
    var attrs = node.a || [];
    for (var i = 0; i < attrs.length; i++) { setAttribute(el, attrs[i][0], attrs[i][1]); }
    var kids = node.c || [];
    for (var j = 0; j < kids.length; j++) { el.appendChild(build(doc, kids[j], el)); }
    return el;
  }

  function nodeAt(rootEl, path) {
    var node = rootEl;
    for (var i = 0; i < path.length; i++) {
      node = node.childNodes[path[i]];
      if (!node) { throw new Error("orin-ui: no node at path [" + path.join(",") + "]"); }
    }
    return node;
  }

  function applyOp(rootEl, op) {
    var doc = rootEl.ownerDocument || document;
    var path = op.path;
    var parent, target, last;
    switch (op.op) {
      case "create":
        parent = nodeAt(rootEl, path.slice(0, -1));
        last = path[path.length - 1];
        parent.insertBefore(build(doc, op.node, parent), parent.childNodes[last] || null);
        break;
      case "remove":
        target = nodeAt(rootEl, path);
        target.parentNode.removeChild(target);
        break;
      case "replace":
        target = nodeAt(rootEl, path);
        target.parentNode.replaceChild(build(doc, op.node, target.parentNode), target);
        break;
      case "attr":
        setAttribute(nodeAt(rootEl, path), op.name, op.value);
        break;
      case "unattr":
        removeAttribute(nodeAt(rootEl, path), op.name);
        break;
      case "text":
        nodeAt(rootEl, path).nodeValue = op.text;
        break;
      case "move":
        parent = nodeAt(rootEl, path);
        target = parent.childNodes[op.from];
        if (!target) { throw new Error("orin-ui: no child " + op.from); }
        parent.removeChild(target);
        parent.insertBefore(target, parent.childNodes[op.to] || null);
        break;
      default:
        throw new Error("orin-ui: unknown operation " + op.op);
    }
  }

  // Apply one server message to the mount element. Unknown message types are ignored (forward compatibility).
  function applyMessage(rootEl, msg) {
    if (typeof msg === "string") { msg = JSON.parse(msg); }
    if (Array.isArray(msg)) { for (var k = 0; k < msg.length; k++) { applyMessage(rootEl, msg[k]); } return; }
    var doc = rootEl.ownerDocument || document;
    if (msg.t === "mount") {
      while (rootEl.firstChild) { rootEl.removeChild(rootEl.firstChild); }
      for (var i = 0; i < msg.dom.length; i++) { rootEl.appendChild(build(doc, msg.dom[i], rootEl)); }
    } else if (msg.t === "patch") {
      for (var j = 0; j < msg.ops.length; j++) { applyOp(rootEl, msg.ops[j]); }
    }
  }

  // ------------------------------------------------------------ events

  function pathOf(rootEl, node) {
    var path = [];
    while (node && node !== rootEl) {
      var parent = node.parentNode;
      if (!parent) { return null; }
      path.unshift(Array.prototype.indexOf.call(parent.childNodes, node));
      node = parent;
    }
    return node === rootEl ? path : null;
  }

  function handles(el, eventName) {
    if (!el || el.nodeType !== 1 || !el.getAttribute) { return false; }
    var list = el.getAttribute(EVENTS_ATTR);
    return !!list && (" " + list + " ").indexOf(" " + eventName + " ") >= 0;
  }

  function isControl(el) {
    var tag = el && el.localName;
    return tag === "input" || tag === "textarea" || tag === "select";
  }

  function payload(ev, handler) {
    var t = ev.target;
    var src = isControl(t) ? t : handler;
    switch (ev.type) {
      case "input":
      case "change":
        if (isControl(src)) {
          return (src.type === "checkbox" || src.type === "radio") ? (src.checked ? "true" : "false") : String(src.value);
        }
        return "";
      case "keydown":
      case "keyup":
        return String(ev.key === undefined ? "" : ev.key);
      case "submit":
        return formEncoded(handler);
      default:
        return "";
    }
  }

  function formEncoded(form) {
    var parts = [];
    var els = form.elements || [];
    for (var i = 0; i < els.length; i++) {
      var e = els[i];
      if (!e.name || e.disabled) { continue; }
      if ((e.type === "checkbox" || e.type === "radio") && !e.checked) { continue; }
      parts.push(encodeURIComponent(e.name) + "=" + encodeURIComponent(e.value));
    }
    return parts.join("&");
  }

  // ------------------------------------------------------------ a connection

  /*
   * connect(rootEl, options) -- run one live UI in `rootEl`.
   *   options.endpoint  http(s) URL for POSTed events, or ws:/wss: URL
   *   options.session   optional session id
   *   options.send      replaces the transport: function (text, deliver) -- `deliver(replyText)` for each server message
   *   options.onError   function (error)
   * Returns { send(eventObject), close(), root }.
   */
  function connect(rootEl, options) {
    options = options || {};
    var endpoint = options.endpoint || "";
    var onError = options.onError || function (e) { if (typeof console !== "undefined") { console.error(e); } };
    var inflight = 0;
    var queue = [];
    var busy = false;
    var socket = null;
    var closed = false;
    var retry = 0;

    function deliver(text) {
      try { applyMessage(rootEl, text); } catch (e) { onError(e); }
    }

    function postNext() {
      if (busy || queue.length === 0) { return; }
      busy = true;
      var body = queue.shift();
      var done = function () { busy = false; inflight--; postNext(); };
      if (options.send) {
        try { options.send(body, deliver); } catch (e) { onError(e); }
        done();
        return;
      }
      var headers = { "Content-Type": "application/json" };
      if (options.session) { headers["X-Orin-UI-Session"] = options.session; }
      fetch(endpoint, { method: "POST", headers: headers, body: body, credentials: "same-origin" })
        .then(function (r) { if (!r.ok) { throw new Error("orin-ui: HTTP " + r.status); } return r.text(); })
        .then(function (text) { if (text) { deliver(text); } done(); })
        .catch(function (e) { onError(e); done(); });
    }

    function sendObject(obj) {
      if (options.session && !socket) { /* the header carries it */ }
      var text = JSON.stringify(obj);
      if (socket) {
        if (options.session) { obj.s = options.session; text = JSON.stringify(obj); }
        if (socket.readyState === 1) { socket.send(text); } else { queue.push(text); }
        return;
      }
      inflight++;
      queue.push(text);
      postNext();
    }

    function openSocket() {
      socket = new WebSocket(endpoint);
      socket.onopen = function () {
        retry = 0;
        sendObject({ t: "join" });
        var pending = queue; queue = [];
        for (var i = 0; i < pending.length; i++) { socket.send(pending[i]); }
      };
      socket.onmessage = function (m) { deliver(m.data); };
      socket.onerror = function (e) { onError(e); };
      socket.onclose = function () {
        if (closed) { return; }
        var delay = Math.min(10000, 250 * Math.pow(2, retry++));
        setTimeout(openSocket, delay);
      };
    }

    function onDomEvent(ev) {
      var node = ev.target;
      while (node && node !== rootEl.parentNode) {
        if (handles(node, ev.type)) {
          var path = pathOf(rootEl, node);
          if (path === null) { return; }
          // The default action (following a link, submitting a form) is the program's decision now.
          if (ev.cancelable) { ev.preventDefault(); }
          sendObject({ t: "event", path: path, event: ev.type, value: payload(ev, node) });
          return;
        }
        if (node === rootEl) { break; }
        node = node.parentNode;
      }
    }

    var listeners = LISTENED.map(function (name) {
      rootEl.addEventListener(name, onDomEvent, true);
      return name;
    });

    var api = {
      root: rootEl,
      send: sendObject,
      close: function () {
        closed = true;
        listeners.forEach(function (name) { rootEl.removeEventListener(name, onDomEvent, true); });
        if (socket) { socket.close(); }
      },
      busy: function () { return inflight > 0; },
    };

    var isWs = /^wss?:/i.test(endpoint);
    if (isWs && !options.send) {
      openSocket();
    } else if (!rootEl.firstChild) {
      // No server-rendered content: ask for the whole UI.
      sendObject({ t: "join" });
    }
    return api;
  }

  function boot(rootEl) {
    var endpoint = rootEl.getAttribute("data-orin-ui");
    if (endpoint === null) { return null; }
    if (rootEl.__orinUi) { return rootEl.__orinUi; }
    var wsLike = /^\//.test(endpoint) && typeof location !== "undefined";
    var url = endpoint;
    // A path for a WebSocket is written ws:/path; resolve it against the page.
    if (/^wss?:\/(?!\/)/.test(endpoint) && typeof location !== "undefined") {
      url = (location.protocol === "https:" ? "wss://" : "ws://") + location.host + endpoint.replace(/^wss?:/, "");
    }
    void wsLike;
    rootEl.__orinUi = connect(rootEl, { endpoint: url, session: rootEl.getAttribute("data-ou-session") || undefined });
    return rootEl.__orinUi;
  }

  function bootAll(scope) {
    var nodes = scope.querySelectorAll("[data-orin-ui]");
    for (var i = 0; i < nodes.length; i++) { boot(nodes[i]); }
  }

  return { applyMessage: applyMessage, connect: connect, boot: boot, bootAll: bootAll, safeUrl: safeUrl, version: 1 };
});
