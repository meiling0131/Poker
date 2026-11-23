#!/bin/sh
# Rebuild turing's files in js/turing/: the WebAssembly engine, and from a folder of bp*.bin the blueprints.
#   tools/turing/build.sh [blueprint folder]
# Needs Rust with the wasm32-unknown-unknown target (rustup target add wasm32-unknown-unknown) and python3.
# Then bump VER in js/turing.js so browsers fetch the new files.
set -e
cd "$(dirname "$0")"
cargo build --release -p turing-web --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/turing_web.wasm ../../js/turing/turing.wasm
if [ -n "${1:-}" ]; then python3 pack.py "$1" ../../js/turing/blueprints.bin; fi
ls -l ../../js/turing
