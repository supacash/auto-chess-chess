// Runs Fairy-Stockfish (WASM) as a UCI process over stdin/stdout for the simulator.
// Usage: node fairyProcess.cjs <variants.ini path>. The variants file is loaded into the engine's
// virtual filesystem as /variants.ini before any command, so `setoption name VariantPath value /variants.ini` works.
const fs = require('node:fs');
const readline = require('node:readline');

// The engine's old Emscripten loader tries fetch() on file paths under newer Node; force the fs path.
delete globalThis.fetch;
const Stockfish = require('fairy-stockfish-nnue.wasm/stockfish.js');

(async () => {
  const engine = await Stockfish();
  engine.addMessageListener((line) => process.stdout.write(`${line}\n`));
  if (process.argv[2]) engine.FS.writeFile('/variants.ini', fs.readFileSync(process.argv[2], 'utf8'));
  for await (const line of readline.createInterface({ input: process.stdin })) {
    if (line === 'quit') break;
    engine.postMessage(line);
  }
  process.exit(0);
})();
