# json2graph

View a JSON document as a graph. Every non-empty object and array is a box, its
rows are its values, and an arrow leads from a row to the box of the object or
array it holds. Built to stay responsive on files of 100 MB and more.

## Running it

You need Node, pnpm, a Rust toolchain with the `wasm32-unknown-unknown` target,
and [`wasm-pack`](https://rustwasm.github.io/wasm-pack/).

```sh
pnpm install
pnpm wasm   # build the engine into engine/pkg; repeat after changing engine/
pnpm dev
```

`pnpm build` builds the engine and then a static site in `build/`.

## Using it

- Edit the JSON on the left: the graph follows once the text is valid again.
- Open a file with the button, or drop one anywhere on the page. Files over
  5 MB are shown as a graph only. Example loads the sample document again, and
  Clear empties the editor and the graph.
- Drag to pan, scroll to zoom, or use the buttons over the graph.
- Click a value that ends in `…` to expand it onto wrapped lines; click again to
  collapse it.
- Export saves a PNG of the whole graph, or of the part on screen when the whole
  graph would not be readable in one image. Its menu chooses the background
  (the current one, transparent, or a colour) and whether the grid is kept.
- The sun/moon button switches between light and dark mode.

## How it works

```
page (Svelte)                        worker                       engine (Rust, WebAssembly)
editor, toolbar, pan/zoom  ──────▶   draws on an OffscreenCanvas  ◀──▶  index, layout, viewport query
```

- **`engine/`** indexes the document in one pass without copying it: each value
  is 16 bytes that point back into the source bytes. It lays the boxes out left
  to right, and for each frame returns only what the viewport shows, so the cost
  of a frame depends on the screen, not on the size of the document.
- **`src/lib/graph/worker.ts`** streams the file into the engine's memory, so
  the document never becomes JavaScript objects, and draws each frame from the
  engine's buffers.
- **`src/lib/graph/controller.ts`** runs on the page: it hands the canvas to the
  worker and forwards the canvas size, theme, pointer and the d3-zoom transform.
- **`src/lib/editor/json-editor.ts`** is the CodeMirror editor.

## Tests

```sh
pnpm test:engine   # Rust tests, in engine/tests/
pnpm test:e2e      # Playwright, against a production build
```

`scripts/generate-json.mjs <megabytes> <file>` writes a large test document.
