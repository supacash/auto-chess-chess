// Dev-only engine benchmark page (bench.html). Times a search of every bench-corpus position, one at a
// time, as scripts/check/baseline.ts does in Node, so a phone's numbers compare with a desktop's.
import { BOARDS, battleVariant } from './chess/boardSpec';
import { loadRules } from './chess/loadRules';
import { benchCorpus, percentile } from './engine/benchCorpus';
import { ACC_LIMITS } from './engine/accSettings';
import { Engine } from './engine/engine';
import { Engine as FairyEngine } from './engine/stockfish';
import { type MoveSource, SEARCH_DEPTH } from './game/runBattle';

const $ = (id: string) => document.getElementById(id)!;
const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed') ?? 1);
const perBoard = Number(params.get('perBoard') ?? 10);
/** ?engine=fairy times Fairy-Stockfish (needs the page cross-origin isolated, as the dev server is). */
const fairy = params.get('engine') === 'fairy';
const label = fairy
  ? `Fairy-Stockfish, depth ${SEARCH_DEPTH}`
  : `our engine, depth ${ACC_LIMITS.depth} / ${ACC_LIMITS.nodes} nodes`;
$('info').textContent = `${label}, seed ${seed}, ${perBoard} armies per board. ${navigator.userAgent}`;

async function run(): Promise<void> {
  ($('run') as HTMLButtonElement).disabled = true;
  $('status').textContent = 'Loading engine…';
  const engine: MoveSource = fairy ? await FairyEngine.create() : await Engine.create();
  await loadRules();
  const corpus = benchCorpus(seed, perBoard);
  const times = new Map<string, number[]>();
  for (const [i, pos] of corpus.entries()) {
    $('status').textContent = `Position ${i + 1}/${corpus.length}`;
    await engine.newGame(battleVariant(pos.spec, pos.fen));
    const t0 = performance.now();
    await engine.candidates(pos.fen, SEARCH_DEPTH);
    times.set(pos.spec.variant, [...(times.get(pos.spec.variant) ?? []), performance.now() - t0]);
  }
  const rows = BOARDS.map((b) => {
    const t = times.get(b.variant) ?? [];
    const ms = (p: number) => Math.round(percentile(t, p));
    return { board: `${b.files}×${b.ranks}`, positions: t.length, p50: ms(50), p95: ms(95), max: ms(100) };
  });
  $('status').textContent = 'Done (ms per search).';
  const head = '<tr><th>board</th><th>positions</th><th>p50</th><th>p95</th><th>max</th></tr>';
  const body = rows
    .map(
      (r) => `<tr><td>${r.board}</td><td>${r.positions}</td><td>${r.p50}</td><td>${r.p95}</td><td>${r.max}</td></tr>`,
    )
    .join('');
  const json = JSON.stringify({
    engine: fairy ? 'fairy-stockfish' : { acc: ACC_LIMITS },
    depth: SEARCH_DEPTH,
    seed,
    userAgent: navigator.userAgent,
    speed: rows,
  });
  $('out').innerHTML = `<table>${head}${body}</table><pre></pre>`;
  $('out').querySelector('pre')!.textContent = json;
  ($('run') as HTMLButtonElement).disabled = false;
}

$('run').addEventListener('click', () => {
  run().catch((e) => {
    $('status').textContent = `Failed: ${(e as Error).message}`;
  });
});
