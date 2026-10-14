# json2graph

View a JSON document as a graph, in the browser: <https://json2graph.gollahalli.com>. Built to stay responsive on files of 100 MB and more.

## Development

You need Node, pnpm and Rust (through rustup).

```sh
pnpm install
pnpm wasm   # build the WebAssembly packages; repeat after changing crates/
pnpm dev
pnpm test
```

## Release

Pushing a version tag runs the tests, deploys the site to Cloudflare Workers and creates a release on GitHub.

```sh
git tag 1.2.3
git push origin 1.2.3
```
