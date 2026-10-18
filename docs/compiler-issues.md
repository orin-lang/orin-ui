# Compiler and toolchain notes

Things met while building orin-ui against the toolchain of 2026-10-18 (`orin-lang/orin-lang` main). None blocked the work;
each has a workaround that is in the code. They are listed so that they can be fixed or documented upstream. The orin-lang
checkout was not modified.

## OX

1. **A `Components<R>` provider cannot be generic.** `ox()` must name non-generic functions (`E0490: a function (the name of a
   non-generic function) must be written as a literal here`), and an intrinsic tag is looked up among exported *non-generic*
   functions (`E0491: the OX provider has no element 'div' (no exported, non-generic function of that name)`); a re-export of a
   generic function does not count. orin-ui's `Node<Msg>` is generic in the program's message type, so a single provider
   `import ox from "orin-ui"` is impossible. Workaround: each program has a small provider module that fixes `Msg`
   (`examples/todo/src/ui.or`). A provider that is itself generic over `R`'s parameters, or one that is a module-level
   function generic in `M` with inference from the expected type, would remove the boilerplate.
2. **An `Option<T>` parameter cannot be given a bare `T`.** `<div cls="a">` against `cls: Option<string>` is `E0400: expected
   Option<string>, found string`; one must write `cls={Some("a")}`. Since the only way to make an OX attribute optional is
   `Option` (there are no default parameter values), every optional attribute costs a `Some(...)`. Workaround: the provider's
   elements take one `attrs: Option<Attr<Msg>[]>` (`attrs={Some([cls("a"), onClick(Inc)])}`). Wrapping a value of type `T` into
   `Some` when `Option<T>` is expected (for OX attributes only, say) would make OX much closer to JSX.
3. **Keywords cannot be attribute names of a `Components` provider**, because attributes are parameters: `class`, `type` and
   `for` give `E0200: expected identifier, found 'class'`. Workaround: `cls(...)`, `attr("type", ...)`, `htmlFor(...)` helpers.

## Language and syntax

4. **`export * from "./x"` is not supported** (`E0200: expected declaration, found '*'`); a package's `module.or` has to list
   every name. `src/module.or` is 11 long lines.
5. **A union variant constructor is not a function value.** `const f = Set;` where `Set(string)` is a variant is `E0404: variant
   'Set' expects 1 argument(s)`. Handlers that map a payload to a message are written `(v) => Set(v)`.
6. **An explicit type argument on a nullary generic variant does not parse.** `return NoAttr<M>;` is `E0200: expected expression,
   found ';'` (it is read as a comparison); the documented way, `const none: Attr<M> = NoAttr; return none;`, works.
7. **`from` is a reserved word** and so cannot be a variable or parameter name (`E0200: expected identifier, found 'from'`),
   which is surprising in a language where it is only meaningful in `import`. The message does not say "reserved".
8. **`type X = Bump;` declares an alias, not a one-variant union.** The error is `E0300: unknown type 'Bump'`, which is correct
   but easy to misread; a one-variant union needs a leading `|` or a second variant.
9. **Strings have no `\u` escapes** (`E0100: unknown escape sequence`) and no `toLowerCase`. orin-ui uses
   `String.fromCharCode` and its own `asciiLower`.

## Tooling

10. **`orin test` has no `--target` option**, so the unit tests cannot be run as WebAssembly (`error: Unknown test option:
    --target=wasm32-orbit`). `tools/test-wasm.sh` builds three programs that exercise the whole library and compares native
    and wasm32-orbit output instead.
11. **`orin build` on a library package fails** with `E0412: entry file must define 'function main(): void'`, and `orin api`
    does the same, so the library itself cannot be built or checked for a target; `orin check` and `orin test` work. The wasm
    status therefore comes from the example programs, which pull in every module.
12. **Tests can only import what a package's `module.or` exports** (`E0302: cannot import private file`), also from the
    package's own `tests/`. That is the documented module rule; it means internals are tested through the public API.
13. **First run of `tools/orin` in a fresh worktree** failed once with `cc1: fatal error: build/dev/orin.data.c: No such file or
    directory` while building the development compiler; the second run succeeded.
14. **`tools/wasm_run.mjs` says it needs Node >= 24**, but a `wasm32-orbit` module ran correctly under Node 22.22 (only
    `wasm64-orbit` needs memory64).

## wasm32-orbit

`orin build --target=wasm32-orbit` succeeds for `examples/counter`, `examples/todo` and `tools/fixtures` (which together reach
every module, including `std:json` and `std:html`), and the three modules print byte-for-byte what the native builds print.
The manifest needs only `log/v1`.

## Found while building the component kit

15. **`type X = Variant;` declares an alias** (see item 8); a program whose message type has no real messages (the kit gallery) needs a
    second dummy variant: `type Msg = Noop | Spare;`.
16. **`usize` and `int` never mix**, so every `array.length` in arithmetic with an `int` needs `.toInt()` and every `int` index
    `.toUsize()`. The chart code is full of them. A literal-typed or inferred index would remove most of the noise.
17. **No bitwise operators and no shifts** (also in `std`): colour mixing and hashing are written with `/` and `%`.
18. **No float formatting** in `std` (`toFixed`), so chart geometry is done on integers in tenths of a unit and written by a helper.
19. **A union variant with a payload cannot be compared with `==`** inside tests without `match`, which makes message assertions
    verbose (`match (m) { Go => true, _ => false }`).
