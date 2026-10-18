# orin-ui design

orin-ui is a UI framework in the spirit of React: a program describes its screen as a tree, the framework works out what
changed and tells a *renderer* how to bring the real screen up to date. Like React, the core knows nothing about the
target. The backends in this repository write HTML, send a patch stream to a browser, or print text; others can be added
without touching the core.

Contents

1. [Architecture](#architecture)
2. [The tree: elements, text, fragments, components](#the-tree)
3. [State: the model/update/view architecture](#state)
4. [Reconciliation: diff and patches](#reconciliation)
5. [Events](#events)
6. [The patch protocol](#the-patch-protocol)
7. [Safety](#safety)
8. [Writing a backend](#writing-a-backend)
9. [Authoring: builder API and OX](#authoring)
10. [Running a live UI on a server](#running-a-live-ui-on-a-server)
11. [Limits and what is not here](#limits)

## Architecture

```
            model                                                    ┌──► HtmlRenderer      "<div>..</div>"
              │                                                      │
 message ──► update ──► model' ──► view ──► Node<Msg> ──┐            ├──► PatchStreamRenderer  {"t":"patch",..}  ──► client/orin-ui.js ──► browser DOM
 (typed)      ▲                                         │resolve     │
              │                                         ▼            ├──► TextRenderer      outline / op log
              │                                    VNode<Msg>        │
              │                                    │       │         └──► your backend
    handleEvent(path, event, value)          messageAt   toDom
              ▲                                    │       │
              └────────────────────────────────────┘       ▼
                                                          Dom ──► diff(old Dom, new Dom) ──► Patch[]
```

Three trees, each with one job:

| Type | Generic in `Msg` | Holds | Used by |
|---|---|---|---|
| `Node<Msg>` | yes | what the `view` writes: elements, text, fragments, component thunks, attributes with typed messages | authors |
| `VNode<Msg>` | yes | the normalised tree: no fragments or components, safe names, duplicates resolved, events as `Binding`s | the runtime, to route an event back to its message |
| `Dom` | no | the same tree with the messages erased: tag, key, attributes, children; text | the diff and **every backend** |

Erasing the messages is what makes backends simple. A backend never sees a closure or a program-specific type: it gets a
plain, comparable value (`Dom`) and a list of plain operations (`Patch`).

Modules (`src/`):

| File | Contents |
|---|---|
| `node.or` | `Node`, `Attr`, builder functions (`el`, `div`, `onClick`, ...), `mapMsg` |
| `vnode.or` | `resolve`, `toDom`, `messageAt`: from `Node` to `VNode` to `Dom`, and from a path back to a message |
| `dom.or` | `Dom`, `DomAttr`, helpers |
| `diff.or` | `Patch`, `diff` |
| `apply.or` | `apply`: the reference implementation of the patches on a `Dom` |
| `safe.or` | name validation and URL rules shared by lowering and rendering |
| `render_html.or` | backend 1: `renderHtml`, `renderPage` |
| `wire.or` | backend 2: JSON encoding of `Dom` and `Patch`, decoding of client messages |
| `render_text.or` | backend 3: `renderText`, `patchesText` |
| `renderer.or` | the `Renderer` interface and the three implementations |
| `runtime.or` | `Program`, `Session`, `start`, `send`, `handleEvent`, `respond` |
| `client/orin-ui.js` | the browser side of the patch protocol |

`src/module.or` is the public face; `import { ... } from "orin-ui"` sees only what it exports.

## The tree

```
type Node<M> =
  Element(tag, attrs, children)
  | Text(string)
  | Fragment(children)
  | Component(name, key, () => Node<M>)

type Attr<M> =
  Prop(name, value)         an HTML attribute; a boolean attribute has the value ""
  | Key(string)             identity among siblings for the diff, never rendered
  | On(event, msg)          on `event` the program receives `msg`
  | OnValue(event, f)       on `event` the program receives `f(payload)`
  | NoAttr                  nothing, so an attribute list can hold conditionals
```

* **Elements and text** are the leaves of what ends up on screen. Text is always text: every renderer escapes it, and the
  client sets it as a DOM text node, never as markup.
* **Fragments** group nodes without a wrapper element. They disappear when the tree is resolved.
* **Components** are functions. `function Item(t: Todo): Node<Msg>` is a component: props are its parameters (a record, or
  named parameters when written in OX), the result is a tree. Calling it is enough; nothing needs registering. The
  `Component` variant is for the case where a subtree should be *deferred* (built only when the tree is resolved) or given a
  key as a unit: `keyedComponent("Row", row.id, () => viewRow(row))`.
* **Keys** give a child an identity among its siblings, so that reordering a list moves nodes instead of rewriting them
  (see [Reconciliation](#reconciliation)). `key("42")` on an element; `keyedComponent` on a component (the key goes to the single
  element it renders).
* **Composition of messages.** A child written for its own message type is embedded with `mapMsg(child, f)`, which rewrites
  every message in the child's tree through `f` (Elm's `Html.map`).

A view is a pure function of the model. Resolving a tree (`resolve`) normalises it:

* components run and fragments are flattened;
* empty text is dropped and adjacent text is merged, so a tree and the browser's DOM have the same shape;
* elements with invalid or forbidden tags, and attributes with invalid or forbidden names, are dropped; URL attributes are
  sanitised ([Safety](#safety));
* a repeated attribute or event keeps its last value.

## State

**Decision: Elm architecture (model, typed messages, `update`, `view`), no hooks.**

```ts
type Program<Model, Msg> = {
  init: Model;
  update: (model: Model, msg: Msg) => Model;
  view: (model: Model) => Node<Msg>;
};
```

Why this and not hooks:

1. **Orin has no shared mutable state.** Every aggregate is a value (`const b = a` copies), closures capture a *snapshot*, a
   closure cannot assign to a captured variable (E0401) and cannot refer to itself. React's `useState` hands a component a
   setter that mutates a cell stored by the framework and captured by event-handler closures. Neither the cell nor such a
   setter can be expressed without language support; and hooks also rely on call order inside a function, a convention
   the compiler cannot check. A model that is passed in and a new model that is returned fit the language as it is.
2. **Event handlers are data.** `onClick(Increment)` stores a *message*, a value of a union type, in the tree. A closure
   `() => setCount(count + 1)` would capture the old `count` (a snapshot) and could not be compared, serialised or sent over
   a wire. Messages can be exhaustively matched in `update`; the compiler tells you when a case is missing.
3. **Sessions are values.** `Session<Model, Msg>` is a record of the model, the resolved tree and the `Dom` last shown.
   `send` and `handleEvent` return a *new* session with the patches. A server may keep sessions in a map, a database row
   or a cookie; there is nothing to lock, no hidden state to leak between requests, and rolling back is keeping the old
   value. Tests are `update(model, msg) == expected` and `diff` on two trees.
4. **Exhaustiveness and typing carry over to the UI.** A view that can produce `Remove(id)` is checked against the `Msg`
   union of the program.

What this costs, and how it is handled:

* **Component-local state** lives in the parent's model. A child component has its own `Model`, `Msg`, `update` and
  `view` (plain functions), and the parent stores the child model in its own model and routes messages with `mapMsg`
  (`tests/runtime_test.or`, "mapMsgEmbedsAChildComponent"). That is explicit but it keeps the whole state of the UI in one
  inspectable value.
* **Effects.** `update` is pure and returns only a model. Work that happens elsewhere (a timer, a database call, a message
  from another user) is done by the host, which turns its result into a `Msg` and calls `send(program, session, msg)`; the
  patches it gets back are pushed to the client. This keeps the core free of any I/O capability: orin-ui requires no grants.
  A `Cmd` type (update returning `(Model, Cmd<Msg>)`) can be added later without changing the tree or the backends.
* **Boilerplate.** `Msg` is a union and `update` a `match`. That is what the compiler needs to check them.

## Reconciliation

`diff(old: Dom[], next: Dom[]): Patch[]` compares two lists of root nodes.

### Patch operations

Paths are child indices from the root list: `[2, 0]` is the first child of the third root node.

| Operation | Meaning |
|---|---|
| `Create(path, node)` | insert `node` so that it has index `last(path)` among the children of `parent(path)` |
| `Remove(path)` | remove the node at `path` |
| `Replace(path, node)` | replace the node at `path` (different tag, or element and text) |
| `SetAttr(path, name, value)` | set an attribute (also used to add one) |
| `RemoveAttr(path, name)` | remove an attribute |
| `SetText(path, text)` | change the content of a text node |
| `Move(parent, from, to)` | take the child at index `from` out of the node at path `parent` (`[]` is the root list) and insert it so that it has index `to`, counted after taking it out |

**The patches are an ordered program.** Apply them one after the other, each to the result of the previous one; the final
tree equals `next`. `apply` (`src/apply.or`) is the reference implementation. A backend may apply them to a native widget
tree, a DOM or anything else with the same shape.

### Matching children

Within one list of siblings every child has an *effective key*: its explicit key if it has one, else its position
(`"i:" + index`). A repeated explicit key is made unique so only its first occurrence can match. An old and a new child
with the same effective key are *the same node*: it is kept and diffed (attributes, then children). Two nodes with equal
keys but different tags are the same slot with different content: `Replace`.

* **Unkeyed lists** match by position: the common case `[a, b, c] -> [a, b', c', d]` is two edits and a `Create`.
* **Keyed lists** match by key: inserting, deleting or moving an item does not rewrite its neighbours, and an item keeps its
  DOM node (so its focus, scroll position and typed text) when it moves.
* **Mixed lists** work: unkeyed children match by position, keyed ones by key.

### Algorithm

1. Compute effective keys; for each new child find the old child with the same key (`source[j]`, or -1).
2. Emit `Remove` for the unmatched old children, last first so that earlier indices stay valid.
3. Find the longest increasing run of `source` (patience sorting, O(n log n)). Children on that run stay where they are.
4. Walk the new children from last to first, keeping the current order in a small array. An unmatched new child becomes a
   `Create` immediately before its successor; a matched child that is not on the run becomes a `Move` to immediately before
   its successor (and no operation if it is already there). A single insertion, removal or move of any distance is one
   operation (`tests/diff_test.or`, "randomListsAreMinimalForSingleMoves": every one of the 56 single moves in a list of
   eight is one `Move`).
5. Now the children are in their final order, so recurse into each matched pair at its *final* index. Nested operations
   always use final positions of their ancestors; structural operations of a list come before the operations inside its
   children.

Attributes are compared by name; changed or new ones give `SetAttr`, missing ones `RemoveAttr`.

Cost: O(n) for the lowering and the comparison, plus O(n log n) for the longest run and O(n·m) for `m` moves (the array that
tracks the order is searched linearly). A view of 2000 keyed items in which two attributes change takes about 8 ms per
update in a debug build (`-O1`).

### Correctness

`tests/diff_test.or` checks `apply(old, diff(old, next)) == next` for hand-written cases and for 300 pseudo-random pairs of
keyed lists; `client/test/client.test.js` applies the JSON form of the same patches to a fake browser DOM for 31 scenarios,
among them 25 random ones, and compares the result with the HTML renderer's output for the target tree.

## Events

An event handler is a **typed message** in the tree: `onClick(Increment)`, `onSubmit(Add)`, or for events with a payload
`onInput((text) => Draft(text))` (a function from the text the client reports to a message; it must be pure).

Renderers do not encode the message. They mark the element:

```html
<button data-ou-on="click">+</button>
<input data-ou-on="input" value="">
```

`data-ou-on` lists the event names the element handles (sorted, space separated). When the user triggers one, the client
finds the nearest element, starting at the event target, that lists it, and reports **where** it is:

```json
{"t":"event","path":[0,2],"event":"click","value":""}
```

The server owns the session, whose `VNode` tree has the same shape as the browser's DOM, so `messageAt(tree, path, event,
payload)` finds the handler on the element at `path` and produces the message. `handleEvent` then runs `update` and returns the
patches.

Why paths and not the message itself in the attribute?

* A message may hold anything (records, lists); it would have to be serialised and parsed back, and a user could forge any
  message by editing the page. A path can only select a handler that exists in the tree the server rendered.
* It needs no codec: `Msg` stays an ordinary union.
* It is stateless-friendly too: a server that does not keep sessions can rebuild the tree from the model (`sessionOf`) and
  resolve the same path.

The payload `value` is a string: an input's value, `"true"`/`"false"` for a checkbox or radio button, the key name for key
events, the URL-encoded form fields for `submit`, `""` otherwise. A handler that does not exist (the UI changed while the
event was in flight) is ignored: `handled` is false and the session is unchanged.

Event names the client listens for: `click dblclick mousedown mouseup input change submit keydown keyup focus blur`.
Handling an event means the browser's default action is cancelled (a link is not followed, a form is not submitted); the
program decides what happens.

## The patch protocol

JSON messages, one per WebSocket text frame or HTTP body. Version 1.

### Server to client

```
{"t":"mount","dom":[N, ...]}      replace the contents of the mount element with these nodes
{"t":"patch","ops":[OP, ...]}     apply the operations in order
```

A node `N` is a JSON string (a text node) or `{"t":"div","a":[["class","x"],["id","y"]],"c":[N, ...]}`: tag, attributes as an
ordered list of name/value pairs, children. Keys are not sent.

An operation `OP`:

```
{"op":"create","path":[0,2],"node":N}
{"op":"remove","path":[0,2]}
{"op":"replace","path":[0,2],"node":N}
{"op":"attr","path":[0,2],"name":"class","value":"x"}
{"op":"unattr","path":[0,2],"name":"class"}
{"op":"text","path":[0,2,0],"text":"hello"}
{"op":"move","path":[0],"from":3,"to":0}
```

`path` is the child index path; for `move` it is the *parent's* path (`[]` is the mount element itself). The JSON is
escaped so that it is also safe inside a `<script>` element (`< > &` and U+2028/9 are written as `\u` escapes). A client
must ignore a message whose `t` it does not know.

### Client to server

```
{"t":"event","path":[0,2],"event":"click","value":""}
{"t":"join"}
```

`join` asks for the whole UI. A client sends it when the mount element has no server-rendered content, and a WebSocket client
sends it first thing after every (re)connection; the server answers with a `mount`. Extra fields (`"s"`, the session id, on a
WebSocket) are ignored by `parseClientMessage`.

### Transports

`client/orin-ui.js` boots every element with a `data-orin-ui` attribute. Its value is the endpoint:

* an `http:`/`https:` URL or a path: **HTTP**. Each event is a `POST` with a JSON body and `X-Orin-UI-Session` (from the
  `data-ou-session` attribute, if present); the response body carries the patch message. Events are sent one at a time, in
  order, so patches are applied in order. This is the HTMX-style transport: it needs nothing but a request handler.
* a `ws:`/`wss:` URL (or `ws:/path`, resolved against the page): **WebSocket**. Both directions use the socket, so the server
  can also push patches for things that happened elsewhere. The client reconnects with exponential backoff and sends `join`
  after each connection.

`OrinUI.connect(rootElement, { send })` replaces the transport with any function, which is how the client is tested.

### Push streams and ordered delivery

HTTP replies only carry the patches a client's own event caused. A server that also wants to push patches (a log that grows, a
status that changes) has two channels, and the browser may receive their messages in either order, while each patch is only
valid against the screen the previous one produced. Two optional additions solve that without WebSockets:

* **`data-ou-stream="/ui/stream"`** on the mount element makes the client open an `EventSource` on that URL (with `?s=<session>`
  appended when `data-ou-session` is set). The `data` of every event is one server message, applied like an HTTP reply.
  `EventSource` reconnects by itself, so a server may end the response after every batch and set the `retry:` field: a stream
  that is a poll the browser repeats needs no timer on the server.
* **Numbered messages.** A server message may carry an integer `"n"` (`mountMessageSeq`, `patchMessageSeq` write them). The
  server numbers the messages of a session in the order it computed them; the client (`data-ou-seq="N"` says which number it
  expects first, otherwise the first numbered message it sees) applies them in that order whichever channel delivers them: an
  early one waits, a repeated one is dropped, a `mount` resets the counter. If a gap lasts more than 2 s the client sends
  `join`, and the server's `mount` (numbered with the current count) puts it back in step. Messages without `n` are applied
  at once, as before.

### Server-side rendering and hydration

`renderPage(title, session.dom, "/orin-ui.js", "/ui/events")` produces a complete page: the markup of the current screen inside
`<div id="orin-ui" data-orin-ui="/ui/events">` and the script tag. The client finds the mount element non-empty, so it only
attaches its listeners (no `join`): the server-rendered DOM is the starting point, and the server's session, whose tree
produced that markup, sends patches relative to it. This works because the markup and the DOM have the same shape (see
"Resolving"): no empty or adjacent text nodes, no formatting whitespace.

Known mismatches between HTML text and a parsed DOM are limited to the HTML parser's own rules: elements that cannot nest
(`<p>` in `<p>`, `<div>` in `<p>`, a `<tr>` directly in a `<table>` gets a `<tbody>`) are fixed up by the browser and the paths
no longer agree. Write valid HTML structure. The renderer already compensates for the newline that `<pre>` and
`<textarea>` swallow.

### Live properties

An attribute patch also updates the matching DOM property for `value`, `checked` and `selected`, which stop following their
attribute once the user has interacted. A view that sets `value(model.text)` on an input therefore stays in step with the model.

## Safety

The framework assumes the *data* in a tree is hostile (user names, comments, query strings) and the *structure* is the
author's. It enforces this where the tree is built, in the renderer and again in the client:

| Threat | Rule |
|---|---|
| markup injection in text | every text is HTML-escaped (`& < > " '`) by the HTML renderer (`std:html`'s `escape`), and set as a text node by the client |
| attribute breakout | attribute values are escaped; names must match `[A-Za-z_:][A-Za-z0-9_:.-]*` (no space, quote, `=`, `>`) |
| script in attributes | attributes whose name starts with `on` (any case) are dropped; events are typed messages only. `srcdoc` is dropped |
| script URLs | `href src action formaction cite poster background manifest ping data longdesc xlink:href`: only relative URLs and the schemes `http https mailto tel` pass (`std:html`'s `safeUrl`); anything else (`javascript:`, `data:`, `vbscript:`, a scheme with a leading space or a tab) becomes `about:invalid#orin-unsafe-url` |
| script elements | `script`, `base`, `meta`, `object`, `embed`, `applet` are never rendered |
| invalid tags | tag names must match `[A-Za-z][A-Za-z0-9-]*` |
| `<style>` text | raw text; `<` is written as the CSS escape `\3c ` so a style cannot close its element |
| forged markers | a program cannot set `data-ou-on`; it is derived from the events |

The rules are applied twice, in `resolve` (so the `Dom`, the patches and the paths agree) and in the HTML renderer (so a `Dom`
built by hand cannot bypass them). The JavaScript client re-checks names, URLs and tags, so a hostile or buggy server cannot
make it execute code either. The test suites: `tests/html_test.or`, `client/test/client.test.js`.

There is no way to insert raw HTML. If a use case needs one, it will be an explicit `trustHtml`-style escape hatch that shows
up in review, as in `std:html`.

## Writing a backend

A backend turns a `Dom` into output, and keeps that output current from patches. The interface:

```ts
interface Renderer {
  name(): string;
  mount(roots: Dom[]): string;
  update(before: Dom[], after: Dom[], patches: Patch[]): string;
}
```

Backends are pure: they return what to write, the caller does the I/O. Interface methods cannot mutate their receiver, so a
backend that needs to remember a screen takes it from `before` (the previous `Dom`), or keeps it outside, in the loop that
calls it, using `apply(before, patches)` to advance a mirror.

You have these choices, from easiest to most efficient:

1. **Re-render.** Implement `mount` and make `update` render `after` again. This is what `HtmlRenderer` does, and it is
   correct for any target that can redraw cheaply (`examples/backend/src/markdown.or` renders Markdown this way).
2. **Serialise the patches.** `PatchStreamRenderer` writes `patches` as JSON and the receiving side applies them. Any
   language can implement the receiving side from the operation table above.
3. **Apply the patches to a native tree.** Keep a tree of your own widgets, addressed the same way (child indices),
   and implement the seven operations. The contract for each one is in [Patch operations](#patch-operations); the points that
   catch people out are:
   * paths are *child indices* and a `Create` index is the position **after** the insertion;
   * `Move` removes first, then inserts: `to` is an index in the list without the moved child;
   * operations are sequential: after a `Remove` the later indices have shifted, the diff has accounted for that;
   * a `Dom` never contains an empty text node or two adjacent text nodes; do not merge or split them;
   * the `data-ou-on` attribute is how an element declares events: a native backend should treat it as "this widget
     emits these events" and report them with the element's path.

To plug a backend into a program, call it from your driver:

```ts
const step = send(program, session, msg);
output(renderer.update(session.dom, step.session.dom, step.patches));
```

To write the event side, take the path of the element that emitted the event and call `handleEvent(program, session,
ClientEvent { path: p, event: "click", value: "" })`.

A test for a new backend should check, for pairs of trees, that mounting `a` and applying the patches from `a` to `b` shows the
same as mounting `b`; `tools/fixtures` and `client/test/client.test.js` do exactly this for the browser.

## Authoring

Two ways to write a view, producing the same `Node`.

**Builder functions** (always available, no setup):

```ts
div([cls("counter")], [
  button([onClick(Decrement)], [text("-")]),
  span([cls("value")], [text(m.count.toString())]),
  button([onClick(Increment)], [text("+")]),
])
```

Each element function takes the attribute list and the children; `el(tag, attrs, children)` builds any element.

**OX** (Orin's markup syntax, experimental). OX is checked by the compiler against a *provider* module that declares what the
elements are. orin-ui uses the `Components<R>` kind of provider, in which `<div>` calls the provider's function `div`. This
works with orin-ui's types, with these consequences, each of which is a compiler restriction recorded in
[compiler-issues.md](compiler-issues.md):

* A provider must be non-generic, and `Node<Msg>` is generic in the program's message type. So **each program carries a
  small provider module** (`examples/todo/src/ui.or`, 25 lines) that fixes `Msg` and lists the tags it uses, and each view
  file says `import ox from "./ui";`. The provider's functions are one-liners over `Element(...)`.
* Attributes of an OX element are parameters of the provider's function. A parameter that may be omitted must be an
  `Option`, and OX does not wrap a plain value in `Some`. orin-ui's element functions therefore take one optional list of
  attribute values: `<li attrs={Some([key("1"), cls("item")])}>`. `class`, `type` and `for` are keywords and cannot be
  parameter names, which is another reason to use `cls(...)`, `attr("type", ...)` and `htmlFor(...)`.
* Upper-case tags call functions in scope, with named parameters: `<FilterButton label="All" f={All} current={m.filter} />`
  is a component call, and the compiler checks the arguments.

Use OX for large static structure and components with several props; use the builders for dynamic code.

## Running a live UI on a server

With any HTTP library, a handler needs three things:

```ts
// GET /          the first page
const session = start(program);                      // or sessionOf(program, modelFromTheDatabase)
save(sessionId, session);
return html(renderPage("My app", session.dom, "/orin-ui.js", "/ui/events"));

// POST /ui/events          one event
const s = load(sessionId);                           // the cookie or X-Orin-UI-Session header says which
const reply = respond(program, s, request.body);     // decode, route, update, diff, encode
save(sessionId, reply.session);
return json(reply.body);                             // a {"t":"patch"} message; reply.error is set for a malformed request

// GET /orin-ui.js          client/orin-ui.js, as a static file
```

For a WebSocket, send `mountReply(session)` in answer to `join` and the result of `respond` for every other frame; to push a
change that did not come from the client, `send(program, session, msg)` and send `patchMessage(step.patches)`.

`examples/counter/src/main.or` runs this flow in-process.

## Limits

* No hooks, no context, no portals, no refs. Focus is preserved by not recreating nodes; the program cannot ask for focus.
* No `Cmd` or subscriptions in the core (see State). Async work is the host's job.
* No raw HTML. Event names are a fixed list in the client.
* The patch stream does not carry events with structured payloads: a payload is one string.
* Strings are bytes in Orin. The JSON for the browser must be UTF-8; a view containing invalid UTF-8 can make a WebSocket
  frame invalid. Validate input with `std:utf8` if it is not known to be text.
* `<textarea>` and `<input>` hold user text in properties; when the program sets `value` while the user is typing quickly over
  the HTTP transport, the last reply wins. Prefer `change` events for fields whose value the server rewrites.
* SVG and MathML elements are created in their namespace by the client; the HTML renderer writes them as plain markup, which
  the HTML parser puts in the right namespace.
