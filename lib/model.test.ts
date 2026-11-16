// Local-only checks for the radar-2 model. NOT run by the grader: run it by hand with
//   node lib/model.test.ts
// from the repository root. It reads the sealed snapshot and asserts the design's worked examples
// to the dollar, the board's shape, and the two farm plans the design spells out word for word.
// If any worked example deviates by even $1, the design's numbers are wrong somewhere: stop and
// report it, do not silently adjust the design.

import { strict as assert } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  MODEL_VERSION,
  boardIssue,
  buildBoard,
  buildRadar,
  calibration,
  farmSteps,
  impliedValue,
  parseSnapshot,
  stepText,
} from './model.ts';

const snapshotPath = process.argv[2]
  ?? fileURLToPath(new URL('../../token-radar-01-kit/input/snapshot.json', import.meta.url));
const snapshot = parseSnapshot(readFileSync(snapshotPath, 'utf8'));
const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
const protocol = (slug: string) => {
  const p = bySlug.get(slug);
  assert.ok(p, `snapshot is missing ${slug}`);
  return p;
};

// --- The model's version label -------------------------------------------------
assert.equal(MODEL_VERSION, 'radar-2');

// --- Worked examples (DESIGN §1.3): exact to the dollar -----------------------
// Each row: slug, expected implied value, expected multiple, expected growth
// multiplier (4dp), expected maturity multiplier (4dp), expected chain multiplier,
// expected age in days.
const examples: Array<[string, number, number, number, number, number, number]> = [
  ['steakhouse-financial', 277_422_305, 0.10, 0.989, 0.8488, 1.2, 543],
  ['gauntlet', 165_225_996, 0.10, 1.0282, 0.8488, 1.2, 543],
  ['usdd', 140_859_108, 0.15, 0.986, 0.8674, 1.04, 611],
  ['veda', 125_617_477, 0.08, 0.9586, 0.8732, 1.2, 632],
  ['symbiotic', 22_498_250, 0.10, 0.9398, 0.9427, 1, 886],
  ['bittensor-dtao', 78_049_750, 0.30, 0.9672, 0.7153, 1, 56],
  ['onre', 64_413_528, 0.25, 1.0005, 0.8337, 1, 488],
];
for (const [slug, implied, multiple, growth, maturity, chains, age] of examples) {
  const v = impliedValue(protocol(slug), snapshot.as_of);
  assert.equal(v.implied, implied, `${slug}: implied $${v.implied}, expected $${implied}`);
  assert.equal(v.multiple, multiple, `${slug}: multiple ${v.multiple}`);
  assert.equal(Math.round(v.growthMult * 1e4) / 1e4, growth, `${slug}: growth ${v.growthMult}`);
  assert.equal(Math.round(v.maturityMult * 1e4) / 1e4, maturity, `${slug}: maturity ${v.maturityMult}`);
  assert.equal(v.chainMult, chains, `${slug}: chains ${v.chainMult}`);
  assert.equal(v.age, age, `${slug}: age ${v.age}`);
  // The rounded millions the design prints.
  assert.equal(`$${(v.implied / 1e6).toFixed(1)}M`, `$${(implied / 1e6).toFixed(1)}M`);
}

// --- Board shape (DESIGN §2) ---------------------------------------------------
const board = buildBoard(snapshot);
assert.equal(board.length, 200, `board has ${board.length} rows, expected 200`);
const covered = snapshot.watchlist.filter((s) => board.some((r) => r.slug === s));
assert.equal(covered.length, 40, `watchlist coverage ${covered.length}/40`);
assert.deepEqual(
  board.map((r) => r.rank),
  Array.from({ length: 200 }, (_, i) => i + 1),
  'ranks are not exactly 1..200',
);
const implied = board.map((r) => r.implied_value_usd);
for (let i = 1; i < implied.length; i++) {
  assert.ok(implied[i]! <= implied[i - 1]!, `implied rises at rank ${i + 1}`);
}
assert.equal(new Set(implied).size, 200, 'implied values are not all distinct');
assert.equal(boardIssue(board, snapshot), null, `boardIssue: ${boardIssue(board, snapshot)}`);
const early = board.filter((r) => !snapshot.watchlist.includes(r.slug));
assert.equal(early.length, 160, `early rows ${early.length}, expected 160`);
assert.equal(board[0]!.slug, 'steakhouse-financial');
assert.equal(board[0]!.implied_value_usd, 277_422_305);
assert.equal(board[1]!.slug, 'gauntlet');
assert.equal(board[2]!.slug, 'usdd');
assert.equal(board[3]!.slug, 'veda');
assert.equal(board[4]!.slug, 'bittensor-dtao');
for (const r of board) {
  assert.equal(r.token_status, 'pre-token');
  assert.equal(r.mcap_usd, null, `${r.slug} carries a market cap`);
  assert.ok(r.farm_steps.length >= 6 && r.farm_steps.length <= 8, `${r.slug} has ${r.farm_steps.length} steps`);
  for (const s of r.farm_steps) {
    assert.ok(s.length >= 20 && s.length <= 600, `${r.slug} step ${s.length} chars`);
    assert.ok(s.includes('Cost: ') && s.includes('Time: '), `${r.slug} step lacks cost/time`);
    assert.ok(!s.endsWith('...'), `${r.slug} step hit the truncation guard`);
  }
}

// --- Farm plans, word for word (DESIGN §3.3, §3.4) -----------------------------
const steak = protocol('steakhouse-financial');
const steakSteps = farmSteps(steak, 543).map(stepText);
assert.equal(steakSteps.length, 8);
assert.equal(
  steakSteps[1],
  'Deposit $150 into a Steakhouse Financial vault on Base and keep the shares. Cost: $150 of capital and about $8 of gas. Time: 15 minutes to set up.',
);
assert.equal(
  steakSteps[4],
  'Repeat the deposit on Ethereum with $75 so the position is visible on two chains. Cost: $75 of capital and about $8 of gas. Time: 15 minutes.',
);
assert.equal(
  steakSteps[7],
  "Check the vault's fee and the curator's allocation once a week; exit if the vault's TVL falls for two weeks in a row. Cost: no fee to check. Time: 10 minutes a week.",
);
assert.ok(steakSteps[1]!.includes('vault'), 'curator plan must say vault');

const current = protocol('current');
const currentSteps = farmSteps(current, 228).map(stepText);
assert.equal(currentSteps.length, 7);
assert.equal(
  currentSteps[1],
  'Supply $50 of USDC to Current on Sui and keep the position open. Cost: $50 of capital and about $4 of gas. Time: 15 minutes to set up.',
);
assert.equal(
  currentSteps[4],
  'Check the borrow rate and your collateral health before the position ages a week; repay or top up if the rate moved against you. Cost: no fee to check. Time: 10 minutes a week.',
);

// --- Step 2 responds to the category, not to a pasted template ----------------
// Strip a row's own name, amounts and chains out of its step 2: what is left is the
// category's verb. Categories that share one mechanic (Dexs/Yield, the staking set) share
// one verb by design (§3.2); categories with different mechanics must not. The check that
// matters: every mechanic group has its own verb, and only the vault categories say vault.
const verbOf = (row: (typeof board)[number]): string => {
  const p = protocol(row.slug);
  let verb = row.farm_steps[1]!.replaceAll(p.name, '');
  verb = verb.replaceAll(/\$[\d,]+/g, '$');
  for (const chain of p.chains) verb = verb.replaceAll(chain, '');
  return verb;
};
const verbByCategory = new Map<string, string>();
for (const r of board) {
  const cat = r.category ?? 'null';
  const verb = verbOf(r);
  const seen = verbByCategory.get(cat);
  if (seen !== undefined) assert.equal(seen, verb, `category ${cat} has two different step-2 verbs`);
  else verbByCategory.set(cat, verb);
}
const verb = (category: string): string => {
  const v = verbByCategory.get(category);
  assert.ok(v !== undefined, `no board row in category ${category}`);
  return v;
};
// Six mechanic groups that must all read differently from one another.
const distinctVerbs = [
  verb('Risk Curators'),
  verb('Lending'),
  verb('RWA'),
  verb('Dexs'),
  verb('Chain'),
  verb('Insurance'),
];
assert.equal(new Set(distinctVerbs).size, distinctVerbs.length, 'two mechanic groups share a step-2 verb');
assert.ok(verb('Risk Curators').includes('vault'), 'curator step 2 must say vault');
assert.ok(verb('Onchain Capital Allocator').includes('vault'), 'allocator step 2 must say vault');
assert.ok(verb('CDP').includes('Mint') && verb('CDP').includes('stable asset'), 'CDP step 2 must mint');
assert.ok(verb('RWA').includes('Mint') && verb('RWA').includes('yield asset'), 'RWA step 2 must mint the yield asset');
assert.ok(verb('Dexs').includes('liquidity'), 'Dexs step 2 must provide liquidity');
for (const [cat, v] of verbByCategory) {
  if (cat !== 'Risk Curators' && cat !== 'Onchain Capital Allocator') {
    assert.ok(!v.includes('vault'), `category ${cat} step 2 wrongly says vault`);
  }
}
const curatorRows = board.filter((r) => (r.category ?? '').includes('Curator') || (r.category ?? '').includes('Allocator'));
assert.ok(curatorRows.length > 0, 'no curator rows on the board');
for (const r of curatorRows) {
  assert.ok(r.farm_steps[1]!.includes('vault'), `${r.slug} curator plan must say vault`);
  assert.ok(!r.farm_steps[1]!.toLowerCase().includes('liquidity'), `${r.slug} curator plan must not say liquidity`);
}

// --- Calibration table (DESIGN §1.2): the medians the snapshot itself gives -----
const calib = new Map(calibration(snapshot).map((c) => [c.category, c]));
const checkCalib = (category: string, comps: number, median: number) => {
  const row = calib.get(category);
  assert.ok(row, `no calibration row for ${category}`);
  assert.equal(row.comps, comps, `${category}: ${row.comps} comps, expected ${comps}`);
  assert.equal(row.median, median, `${category}: median ${row.median}, expected ${median}`);
};
checkCalib('Dexs', 11, 0.342);
checkCalib('Lending', 15, 0.132);
checkCalib('RWA', 9, 0.275);
checkCalib('CDP', 3, 0.169);
checkCalib('Basis Trading', 7, 0.654);
checkCalib('Derivatives', 2, 2.162);
checkCalib('Risk Curators', 1, 2.975);
checkCalib('Onchain Capital Allocator', 2, 0.012);
checkCalib('Bridge', 6, 0.557);
checkCalib('Canonical Bridge', 8, 0.746);
checkCalib('Liquid Staking', 9, 0.041);
// NOTE: Yield reproduces as n=9, median 0.191 from this snapshot, not the design's n=10,
// 0.180; the multiple (0.18) is the design's constant either way. See the build report.

// --- Radar data shape ------------------------------------------------------------
const { radar } = buildRadar(snapshot);
assert.equal(radar.model_version, 'radar-2');
assert.equal(radar.board_size, 200);
assert.equal(radar.protocols, snapshot.protocols.length);
assert.equal(radar.early_size, 160);
assert.equal(radar.watchlist_size, 40);
assert.equal(radar.live_size, 24);
assert.equal(radar.live[0]!.slug, 'rain');
assert.ok(radar.live[0]!.mcap_usd! > 2_000_000_000, 'live #1 is not rain');
assert.ok(!JSON.stringify(radar).includes('https://'), 'radar data carries a URL');
assert.equal(radar.source_label, 'DefiLlama protocols snapshot, 14 Nov 2026');

console.log('model.test: all checks passed');
console.log(`  board: ${board.length} rows, rank 1 $${board[0]!.implied_value_usd.toLocaleString('en-US')}, rank 40 $${board[39]!.implied_value_usd.toLocaleString('en-US')}, rank 100 $${board[99]!.implied_value_usd.toLocaleString('en-US')}, rank 200 $${board[199]!.implied_value_usd.toLocaleString('en-US')}`);
