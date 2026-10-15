// Builds the game's own engine (engine/, Rust) to WebAssembly and generates its JS bindings into
// src/engine/wasm/ (gitignored). Runs before dev, build, test and typecheck. Needs the Rust toolchain
// pinned in engine/rust-toolchain.toml and a wasm-bindgen CLI matching the crate's version.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const engine = join(root, 'engine');
const out = join(root, 'src', 'engine', 'wasm');
// rustup's bin directory, in case this shell (or an editor started before Rust was installed) lacks it.
const cargoBin = join(process.env.CARGO_HOME ?? join(homedir(), '.cargo'), 'bin');
// Windows spells it "Path"; reuse whatever key the environment has.
const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
const env = { ...process.env, [pathKey]: `${process.env[pathKey] ?? ''}${delimiter}${cargoBin}` };

const run = (cmd, args, what) => {
  try {
    return execFileSync(cmd, args, { cwd: engine, env, stdio: ['ignore', 'pipe', 'inherit'] }).toString();
  } catch (e) {
    if (e.code === 'ENOENT') throw new Error(`${cmd} not found: ${what}`);
    throw e;
  }
};

// The CLI and the crate must agree exactly, or the generated bindings won't load.
const lock = readFileSync(join(engine, 'Cargo.lock'), 'utf8');
const crate = /name = "wasm-bindgen"\nversion = "([^"]+)"/.exec(lock)?.[1];
const cliVersion = run(
  'wasm-bindgen',
  ['--version'],
  `install it with: cargo install wasm-bindgen-cli --version ${crate}`,
)
  .trim()
  .split(' ')[1];
if (crate !== cliVersion) {
  throw new Error(
    `wasm-bindgen CLI is ${cliVersion} but the crate is ${crate}: cargo install wasm-bindgen-cli --version ${crate}`,
  );
}

run(
  'cargo',
  ['build', '--release', '--locked', '--target', 'wasm32-unknown-unknown', '-p', 'acc-wasm'],
  'install Rust from https://rustup.rs',
);
// --target web: an ES module whose init takes a URL (browser) or the bytes (Node: tests, simulator).
run(
  'wasm-bindgen',
  [
    '--target',
    'web',
    '--out-dir',
    out,
    '--out-name',
    'acc',
    join(engine, 'target', 'wasm32-unknown-unknown', 'release', 'acc_wasm.wasm'),
  ],
  '',
);
