# orin-ui

A React-like, renderer-agnostic UI framework for the [Orin](https://github.com/orin-lang/orin-lang) programming language.

You describe a screen as a tree of typed values. orin-ui works out what changed between two screens and expresses it as a list
of patch operations. A *backend* turns that into something real: an HTML string for server-side rendering, a JSON patch stream
for a browser, text for a terminal, or your own target. The core knows nothing about any of them.

```ts
import { Node, Program, div, button, span, text, cls, onClick, start, send, renderHtml, patchesText } from "orin-ui";

type Model = { count: int; };
type Msg = Increment | Decrement;

function update(m: Model, msg: Msg): Model {
  return match (msg) {
    Increment => Model { count: m.count + 1 },
    Decrement => Model { count: m.count - 1 },
  };
}

function view(m: Model): Node<Msg> {
  return div([cls("counter")], [
    button([onClick(Decrement)], [text("-")]),
    span([], [text(m.count.toString())]),
    button([onClick(Increment)], [text("+")]),
  ]);
}

function main(): void {
  const program = Program<Model, Msg> { init: Model { count: 0 }, update: update, view: view };
  const s0 = start(program);
  console.log(renderHtml(s0.dom));
  // <div class="counter"><button data-ou-on="click">-</button><span>0</span><button data-ou-on="click">+</button></div>
  console.log(patchesText(send(program, s0, Increment).patches));
  // text /0/1/0 "1"
}
```

Status: first version, experimental like the Orin features it uses (OX).

## Ideas

* **Elm architecture.** A program is a model, typed messages, `update(model, msg)` and `view(model)`. State is a value, the
  runtime has no hidden mutable state, a session can be stored anywhere. Why not hooks: [docs/design.md](docs/design.md#state).
* **Events are messages, not closures.** `onClick(Increment)` puts a value of your `Msg` type in the tree. Renderers mark the
  element (`data-ou-on="click"`); the client reports the path of the element; the server finds the message.
* **A small, checked reconciler.** Keyed and unkeyed children, one `Move` per moved item, tested with `apply(old, diff(old, new)) ==
  new` on generated trees.
* **Safe by construction.** Text and attributes are escaped, `on*` attributes and `script` elements are never written, URL
  attributes are sanitised, and the JavaScript client enforces the same rules again.
* **Backends behind one interface.** HTML string, patch stream with a dependency-free JavaScript client, text; writing another is a few
  dozen lines (`examples/backend`).

## Use

`orin.toml` of your package:

```toml
[dependencies]
orin-ui = { path = "../orin-ui" }   # or { git = "https://github.com/orin-lang/orin-ui", tag = "v0.1.0" }
```

```ts
import { Node, Program, el, div, text, onClick, start, send, handleEvent, respond, renderHtml, renderPage } from "orin-ui";
```

| Area | API |
|---|---|
| Tree | `Node<M>`: `Element`, `Text`, `Fragment`, `Component`; `el`, `text`, `fragment`, `nothing`, `when`, `component`, `keyedComponent`, `mapMsg` |
| Elements | `div span p h1 h2 h3 a button input textarea select option label form ul ol li table thead tbody tr th td section header footer nav pre code strong em img br hr` (`(attrs, children)`) |
| Attributes | `Attr<M>`: `attr`, `key`, `cls`, `classes`, `classIf`, `id`, `href`, `src`, `style`, `title`, `name`, `value`, `placeholder`, `inputType`, `htmlFor`, `flag`, `disabled`, `checked`, `selected`, `readonly`, `autofocus` |
| Events | `on`, `onValue`, `onClick`, `onDoubleClick`, `onSubmit`, `onFocus`, `onBlur`, `onInput`, `onChange`, `onKeyDown`, `onKeyUp` |
| Program | `Program<Model, Msg> { init, update, view }`, `Session`, `start`, `sessionOf`, `send`, `sendAll`, `handleEvent`, `respond`, `mountReply` |
| Reconciliation | `diff(old, next): Patch[]` with `Create Remove Replace SetAttr RemoveAttr SetText Move`; `apply(dom, patches)` |
| Lowering | `resolve`, `toDom`, `Dom` (`DElement`, `DText`), `messageAt` |
| Backends | `Renderer` interface; `renderHtml`, `renderPage`; `mountMessage`, `patchMessage`, `parseClientMessage`; `renderText`, `patchesText`; `HtmlRenderer`, `PatchStreamRenderer`, `TextRenderer` |

## Component kit

`orin-ui` also ships a renderer-agnostic component kit (`src/kit/`, exported from the package): the pieces of a dashboard, as plain
functions that return `Node<Msg>`. Styles are in [`client/orin-ui-kit.css`](client/orin-ui-kit.css) (light and dark, one accent colour,
an 8px grid, tabular numerals, thin borders) and the small theme-toggle script in [`client/orin-ui-kit.js`](client/orin-ui-kit.js).

| Area | Components |
|---|---|
| Layout | `AppShell`, `Sidebar` (sections, active item), `TopBar`, `PageHeader` (breadcrumbs, actions), `Card`, `FlushCard`, `Grid`, `Stack`, `Inline`, `EmptyState`, `Loading` |
| Data | `Table` (sortable header, empty state), `Tabs`, `Badge`, `StatusPill`, `KeyValue`, `KeyValueGroup`, `CodeBlock`, `JsonBlock`, `Banner`, `Toast` |
| Inputs | `Button` (primary, secondary, danger, ghost; small, icon), `Form`, `TextField`, `TextArea`, `SelectField`, `Toggle`, `Dialog`, `ConfirmDialog`, `ThemeToggle` |
| Charts (SVG) | `StatCard`, `Sparkline`, `LineChart`, `AreaChart`, `BarChart` (stacked), `LatencyBar`, `Legend` |

Charts are generated in Orin: integer geometry (tenths of a unit, no float formatting), "nice" axis ticks, gridlines, a `<title>`
tooltip per point, an accessible name and description, and the colour-blind-safe Okabe-Ito palette (`ou-fill-N`). Axis labels are HTML
positioned in percent over a stretched SVG, so text keeps its size at any width. `tools/gallery.sh` renders
[`examples/kit-gallery`](examples/kit-gallery), every component on one page; see [docs/design.md](docs/design.md#component-kit).

## Examples

| | |
|---|---|
| [`examples/counter`](examples/counter) | the smallest program, with the server flow: first page, message, patches, event reply |
| [`examples/todo`](examples/todo) | a todo list in OX with keyed lists, forms, inputs and filters, and its tests |
| [`examples/backend`](examples/backend) | one program shown through every backend, including a new Markdown backend |

```sh
cd examples/counter && orin run
cd examples/todo && orin run && orin test
```

## The browser client

[`client/orin-ui.js`](client/orin-ui.js) has no dependencies. Serve it and put the page together with `renderPage`, or write

```html
<div id="orin-ui" data-orin-ui="/ui/events"><!-- server-rendered markup --></div>
<script src="/orin-ui.js"></script>
```

`data-orin-ui` is the endpoint: an HTTP path (events are POSTed, the reply is a patch message) or a `ws://` / `wss://` URL. Without
WebSockets a server can still push: `data-ou-stream` names a server-sent events stream, and numbered messages (`patchMessageSeq`)
keep the two channels in order ([docs/design.md](docs/design.md#push-streams-and-ordered-delivery)). For stateless HTTP islands and opt-in SSR navigation see [the adapter contract](docs/design.md#stateless-http-islands-and-progressive-ssr-navigation). The
protocol is in [docs/design.md](docs/design.md#the-patch-protocol).

## Tests

```sh
orin test                      # unit tests: diff, escaping, wire format, runtime, backends
tools/test-all.sh              # everything: unit, examples, JavaScript client, native vs wasm32-orbit
```

`ORIN=/path/to/orin ORIN_TOOLCHAIN=/path/to/orin-lang tools/test-all.sh` if `orin` is not on `PATH` (the toolchain checkout provides
the WebAssembly test host).

## Documents

* [docs/design.md](docs/design.md): architecture, state model, reconciliation, events, the patch protocol, safety, writing a backend
* [docs/compiler-issues.md](docs/compiler-issues.md): compiler and toolchain limits met while building this, and the wasm32-orbit status

## License

MIT. Copyright (c) 2026 Henry Schwerdtner and the Orin contributors.

## Module architecture

Implementation is organized into directory modules with explicit `module.or` interfaces and compiler-enforced dependency policies. See [the module map](docs/architecture.md) and run `ORIN=/path/to/orin tools/check_modules.sh` to verify the boundaries. The package-level imports remain compatible.
