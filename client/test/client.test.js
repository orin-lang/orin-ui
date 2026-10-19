"use strict";
// Tests for client/orin-ui.js with a fake DOM. Run: node client/test/client.test.js [fixtures.jsonl]
// The fixtures come from tools/fixtures (Orin): server messages and the HTML expected after each of them.
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { FakeDocument, serializeChildren, normalizeHtml } = require("./fake-dom.js");
const OrinUI = require("../orin-ui.js");

let passed = 0;
let failed = 0;
const asyncTests = [];
function report(name, e) { failed++; console.error("FAIL " + name + "\n  " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join("\n  ") : e)); }
function test(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === "function") { asyncTests.push(r.then(() => { passed++; }, e => report(name, e))); } else { passed++; }
  } catch (e) { report(name, e); }
}

function newRoot() {
  const doc = new FakeDocument();
  return doc.createElement("div");
}

// ---------------------------------------------------------------- fixtures from the server

const fixtures = process.argv[2] || path.join(__dirname, "fixtures.jsonl");
if (fs.existsSync(fixtures)) {
  fs.readFileSync(fixtures, "utf8").split("\n").filter(Boolean).forEach(line => {
    const sc = JSON.parse(line);
    test("scenario " + sc.name, () => {
      const root = newRoot();
      sc.frames.forEach((f, i) => {
        OrinUI.applyMessage(root, f.msg);
        assert.strictEqual(serializeChildren(root), normalizeHtml(f.html), sc.name + " frame " + i);
      });
    });
  });
} else {
  console.error("no fixtures at " + fixtures + " (run tools/test-client.sh)");
  process.exit(1);
}

// ---------------------------------------------------------------- unit tests

test("unknown message types are ignored", () => {
  const root = newRoot();
  OrinUI.applyMessage(root, { t: "mount", dom: ["x"] });
  OrinUI.applyMessage(root, { t: "something-new", whatever: 1 });
  assert.strictEqual(serializeChildren(root), "x");
});

test("a patch with a bad path throws instead of corrupting", () => {
  const root = newRoot();
  OrinUI.applyMessage(root, { t: "mount", dom: ["x"] });
  assert.throws(() => OrinUI.applyMessage(root, { t: "patch", ops: [{ op: "remove", path: [5] }] }));
});

test("the client refuses event-handler attributes and unsafe URLs even if a server sends them", () => {
  const root = newRoot();
  OrinUI.applyMessage(root, { t: "mount", dom: [{ t: "a", a: [["onclick", "alert(1)"], ["href", "javascript:alert(1)"], ["srcdoc", "x"], ["id", "ok"]], c: [] }] });
  const a = root.childNodes[0];
  assert.strictEqual(a.getAttribute("onclick"), null);
  assert.strictEqual(a.getAttribute("srcdoc"), null);
  assert.strictEqual(a.getAttribute("href"), "about:invalid#orin-unsafe-url");
  assert.strictEqual(a.getAttribute("id"), "ok");
});

test("the client refuses script elements", () => {
  const root = newRoot();
  OrinUI.applyMessage(root, { t: "mount", dom: [{ t: "script", a: [], c: ["alert(1)"] }, { t: "p", a: [], c: [] }] });
  assert.strictEqual(root.childNodes.length, 2);
  assert.strictEqual(root.childNodes[0].nodeType, 8);
});

test("text is set as a text node value, never parsed as markup", () => {
  const root = newRoot();
  OrinUI.applyMessage(root, { t: "mount", dom: [{ t: "p", a: [], c: ["<img src=x onerror=alert(1)>"] }] });
  assert.strictEqual(root.childNodes[0].childNodes.length, 1);
  assert.strictEqual(root.childNodes[0].childNodes[0].nodeType, 3);
});

test("value and checked update the live properties", () => {
  const root = newRoot();
  OrinUI.applyMessage(root, { t: "mount", dom: [{ t: "input", a: [["value", "a"], ["checked", ""]], c: [] }] });
  const input = root.childNodes[0];
  assert.strictEqual(input.value, "a");
  assert.strictEqual(input.checked, true);
  OrinUI.applyMessage(root, { t: "patch", ops: [{ op: "attr", path: [0], name: "value", value: "b" }, { op: "unattr", path: [0], name: "checked" }] });
  assert.strictEqual(input.value, "b");
  assert.strictEqual(input.checked, false);
});

test("svg elements get the svg namespace", () => {
  const root = newRoot();
  OrinUI.applyMessage(root, { t: "mount", dom: [{ t: "svg", a: [], c: [{ t: "circle", a: [], c: [] }] }] });
  assert.strictEqual(root.childNodes[0].namespaceURI, "http://www.w3.org/2000/svg");
  assert.strictEqual(root.childNodes[0].childNodes[0].namespaceURI, "http://www.w3.org/2000/svg");
});

// ---------------------------------------------------------------- events

function liveRoot(options) {
  const root = newRoot();
  const sent = [];
  const conn = OrinUI.connect(root, Object.assign({
    send: (text, deliver) => { sent.push(JSON.parse(text)); },
  }, options || {}));
  sent.length = 0; // the initial `join` of an empty root
  return { root, sent, conn };
}

test("a click is sent with the path of the element that handles it", () => {
  const { root, sent } = liveRoot();
  OrinUI.applyMessage(root, { t: "mount", dom: [{ t: "div", a: [], c: ["x", { t: "button", a: [["data-ou-on", "click"]], c: [{ t: "b", a: [], c: ["go"] }] }] }] });
  const inner = root.childNodes[0].childNodes[1].childNodes[0]; // <b> inside the button
  const ev = root.fire("click", inner);
  assert.deepStrictEqual(sent, [{ t: "event", path: [0, 1], event: "click", value: "" }]);
  assert.strictEqual(ev.defaultPrevented, true);
});

test("an element that does not handle the event sends nothing and keeps its default action", () => {
  const { root, sent } = liveRoot();
  OrinUI.applyMessage(root, { t: "mount", dom: [{ t: "a", a: [["href", "/x"], ["data-ou-on", "input"]], c: ["l"] }] });
  const ev = root.fire("click", root.childNodes[0]);
  assert.deepStrictEqual(sent, []);
  assert.strictEqual(ev.defaultPrevented, false);
});

test("input events carry the control's value, checkboxes carry true or false", () => {
  const { root, sent } = liveRoot();
  OrinUI.applyMessage(root, { t: "mount", dom: [
    { t: "input", a: [["data-ou-on", "input"]], c: [] },
    { t: "input", a: [["type", "checkbox"], ["data-ou-on", "change"]], c: [] },
  ] });
  const text = root.childNodes[0];
  text.value = "héllo";
  root.fire("input", text);
  const box = root.childNodes[1];
  box.type = "checkbox"; box.checked = true;
  root.fire("change", box);
  box.checked = false;
  root.fire("change", box);
  assert.deepStrictEqual(sent.map(s => [s.path, s.event, s.value]), [[[0], "input", "héllo"], [[1], "change", "true"], [[1], "change", "false"]]);
});

test("key events carry the key name", () => {
  const { root, sent } = liveRoot();
  OrinUI.applyMessage(root, { t: "mount", dom: [{ t: "input", a: [["data-ou-on", "keydown"]], c: [] }] });
  root.fire("keydown", root.childNodes[0], { key: "Enter" });
  assert.strictEqual(sent[0].value, "Enter");
});

test("a connection without server-rendered content asks for the UI", () => {
  const root = newRoot();
  const sent = [];
  OrinUI.connect(root, { send: (t) => sent.push(JSON.parse(t)) });
  assert.deepStrictEqual(sent, [{ t: "join" }]);
});

test("a connection with server-rendered content does not", () => {
  const root = newRoot();
  root.appendChild(root.ownerDocument.createTextNode("rendered"));
  const sent = [];
  OrinUI.connect(root, { send: (t) => sent.push(t) });
  assert.deepStrictEqual(sent, []);
});

test("replies are applied in order through the transport", () => {
  const root = newRoot();
  root.appendChild(root.ownerDocument.createTextNode("0"));
  const conn = OrinUI.connect(root, {
    send: (text, deliver) => { deliver(JSON.stringify({ t: "patch", ops: [{ op: "text", path: [0], text: String(Number(root.childNodes[0].nodeValue) + 1) }] })); },
  });
  conn.send({ t: "event", path: [0], event: "click", value: "" });
  conn.send({ t: "event", path: [0], event: "click", value: "" });
  assert.strictEqual(root.childNodes[0].nodeValue, "2");
});

test("close removes the listeners", () => {
  const { root, sent, conn } = liveRoot();
  OrinUI.applyMessage(root, { t: "mount", dom: [{ t: "button", a: [["data-ou-on", "click"]], c: [] }] });
  conn.close();
  root.fire("click", root.childNodes[0]);
  assert.deepStrictEqual(sent, []);
});

// ---------------------------------------------------------------- numbered messages and the stream

function textPatch(n, text) { return { t: "patch", n: n, ops: [{ op: "text", path: [0], text: text }] }; }

function numberedRoot(options) {
  const root = newRoot();
  root.appendChild(root.ownerDocument.createTextNode("start"));
  let deliverFn = null;
  const sent = [];
  const conn = OrinUI.connect(root, Object.assign({ send: (t, d) => { sent.push(JSON.parse(t)); deliverFn = d; } }, options || {}));
  // reach `deliver` through a round trip of the fake transport
  conn.send({ t: "event", path: [], event: "click", value: "" });
  sent.length = 0;
  return { root, sent, conn, deliver: deliverFn };
}

test("numbered messages are applied in order even when they arrive out of order", () => {
  const { root, deliver } = numberedRoot({ seq: 0 });
  deliver(JSON.stringify(textPatch(1, "second")));
  assert.strictEqual(root.childNodes[0].nodeValue, "start");
  deliver(JSON.stringify(textPatch(0, "first")));
  assert.strictEqual(root.childNodes[0].nodeValue, "second");
});

test("a numbered message that was already applied is dropped", () => {
  const { root, deliver } = numberedRoot({ seq: 0 });
  deliver(JSON.stringify(textPatch(0, "a")));
  deliver(JSON.stringify(textPatch(0, "b")));
  assert.strictEqual(root.childNodes[0].nodeValue, "a");
});

test("unnumbered messages are applied at once", () => {
  const { root, deliver } = numberedRoot({ seq: 5 });
  deliver(JSON.stringify({ t: "patch", ops: [{ op: "text", path: [0], text: "now" }] }));
  assert.strictEqual(root.childNodes[0].nodeValue, "now");
});

test("an empty message is a heartbeat and is ignored", () => {
  const { root, deliver } = numberedRoot({ seq: 0 });
  deliver("");
  assert.strictEqual(root.childNodes[0].nodeValue, "start");
});

test("a mount message resets the sequence and discards what it overtook", () => {
  const { root, deliver } = numberedRoot({ seq: 0 });
  deliver(JSON.stringify(textPatch(3, "late")));
  deliver(JSON.stringify({ t: "mount", n: 9, dom: ["whole"] }));
  assert.strictEqual(root.childNodes[0].nodeValue, "whole");
  deliver(JSON.stringify(textPatch(10, "next")));
  assert.strictEqual(root.childNodes[0].nodeValue, "next");
});

test("the first numbered message is accepted when no start number is known", () => {
  const { root, deliver } = numberedRoot();
  deliver(JSON.stringify(textPatch(7, "seven")));
  deliver(JSON.stringify(textPatch(8, "eight")));
  assert.strictEqual(root.childNodes[0].nodeValue, "eight");
});

test("a gap that lasts asks for the whole UI", () => {
  const { sent, deliver, conn } = numberedRoot({ seq: 0, stallMs: 10 });
  deliver(JSON.stringify(textPatch(2, "x")));
  return new Promise(resolve => setTimeout(resolve, 60)).then(() => {
    assert.ok(sent.some(m => m.t === "join"), "join sent");
    conn.close();
  });
});

class FakeEventSource {
  constructor(url) { this.url = url; this.closed = false; FakeEventSource.last = this; }
  close() { this.closed = true; }
}

test("a stream delivers its events as server messages and closes with the connection", () => {
  const root = newRoot();
  root.appendChild(root.ownerDocument.createTextNode("start"));
  const conn = OrinUI.connect(root, { endpoint: "/ui/events", session: "s 1", stream: "/ui/stream", seq: 0, EventSource: FakeEventSource });
  const es = FakeEventSource.last;
  assert.strictEqual(es.url, "/ui/stream?s=s%201");
  es.onmessage({ data: JSON.stringify(textPatch(0, "pushed")) });
  assert.strictEqual(root.childNodes[0].nodeValue, "pushed");
  conn.close();
  assert.strictEqual(es.closed, true);
});

test("boot reads the stream, the session and the sequence from the mount element", () => {
  const root = newRoot();
  root.appendChild(root.ownerDocument.createTextNode("start"));
  root.setAttribute("data-orin-ui", "/ui/events");
  root.setAttribute("data-ou-session", "abc");
  root.setAttribute("data-ou-stream", "/ui/stream?x=1");
  root.setAttribute("data-ou-seq", "4");
  global.EventSource = FakeEventSource;
  try {
    const conn = OrinUI.boot(root);
    assert.strictEqual(FakeEventSource.last.url, "/ui/stream?x=1&s=abc");
    FakeEventSource.last.onmessage({ data: JSON.stringify(textPatch(3, "old")) });   // before the start number: dropped
    FakeEventSource.last.onmessage({ data: JSON.stringify(textPatch(4, "new")) });
    assert.strictEqual(root.childNodes[0].nodeValue, "new");
    conn.close();
  } finally { delete global.EventSource; }
});

test("safeUrl", () => {
  assert.strictEqual(OrinUI.safeUrl("/a?b=c:d"), "/a?b=c:d");
  assert.strictEqual(OrinUI.safeUrl("HTTPS://x"), "HTTPS://x");
  assert.strictEqual(OrinUI.safeUrl("javascript:1"), "about:invalid#orin-unsafe-url");
  assert.strictEqual(OrinUI.safeUrl(" javascript:1"), "about:invalid#orin-unsafe-url");
  assert.strictEqual(OrinUI.safeUrl("data:text/html,x"), "about:invalid#orin-unsafe-url");
  assert.strictEqual(OrinUI.safeUrl("mailto:a@b.c"), "mailto:a@b.c");
});


test("explicit element event values survive nested SVG targets", () => {
  const { root, sent } = liveRoot();
  OrinUI.applyMessage(root, { t:"mount", dom:[{t:"svg",a:[],c:[{t:"circle",a:[["data-ou-on","click"],["data-ou-value","1792404000000"]],c:[]}]}] });
  root.fire("click", root.childNodes[0].childNodes[0]);
  assert.strictEqual(sent[0].value, "1792404000000");
});
test("HTTP queued requests use the state from the preceding applied reply", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = (url, init) => new Promise(resolve => calls.push({body:JSON.parse(init.body),resolve}));
  const root = newRoot(); root.appendChild(root.ownerDocument.createTextNode("ready"));
  const conn = OrinUI.connect(root, {endpoint:"/ui",state:{count:0}});
  try {
    conn.send({t:"event",path:[0],event:"click",value:""});
    conn.send({t:"event",path:[0],event:"click",value:""});
    assert.strictEqual(calls.length,1); assert.strictEqual(calls[0].body.state.count,0);
    calls[0].resolve({ok:true,text:async()=>JSON.stringify({t:"patch",ops:[],state:{count:1}})});
    await new Promise(resolve=>setImmediate(resolve));
    assert.strictEqual(calls.length,2); assert.strictEqual(calls[1].body.state.count,1);
    calls[1].resolve({ok:true,text:async()=>JSON.stringify({t:"patch",ops:[],state:{count:2}})});
    await new Promise(resolve=>setImmediate(resolve));
    assert.strictEqual(conn.busy(),false);
  } finally { conn.close(); global.fetch=originalFetch; }
});

Promise.all(asyncTests).then(() => {
  console.log(passed + " passed, " + failed + " failed");
  process.exit(failed ? 1 : 0);
});
