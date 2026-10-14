#!/usr/bin/env bash
# The build command for Cloudflare's builds, whose image has no Rust:
#
#   bash scripts/cf.sh
#
# It installs rustup, which takes the version of Rust and the WebAssembly
# target from rust-toolchain.toml, and then builds the site.
set -euo pipefail

curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain none
. "${CARGO_HOME:-$HOME/.cargo}/env"

pnpm run build
