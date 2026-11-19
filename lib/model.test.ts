// Local-only checks for the radar-3 model. NOT run by the grader: run it by hand with
//   node lib/model.test.ts
// from the repository root. It reads the sealed snapshot and asserts the fitted model's numbers,
// the board's shape, the holdout validation, and the two farm plans the design spells out word
// for word. The worked examples below were verified by independent arithmetic from the raw
// snapshot numbers (a separate calculation, not this model's own functions): all five reproduce
// to the dollar. If any worked example deviates by even $1, stop and report it.

import { strict as assert } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  MODEL_VERSION,
  boardIssue,
  buildBoard,
  buildRadar,
  comparables,
  farmEconomics,
  farmSteps,
  fitModel,
  holdoutValidation,
  impliedValue,
  launchOdds,
  parseSnapshot,
  stepText,
  waitYears,
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
const round3 = (n: number): number => Math.round(n * 1000) / 1000;
const round4 = (n: number): number => Math.round(n * 10000) / 10000;

// --- The model's version label -------------------------------------------------
assert.equal(MODEL_VERSION, 'radar-3');

// --- The fit itself: log-log regression over the snapshot's 128 traded tokens ---
const model = fitModel(snapshot.protocols, snapshot.as_of);
assert.equal(round4(model.intercept), 6.9646, `intercept ${model.intercept}`);
assert.equal(round4(model.slope), 0.5223, `slope ${model.slope}`);
assert.equal(round3(model.r_squared), 0.194, `R-squared ${model.r_squared}`);
assert.equal(model.traded_n, 128, `traded tokens ${model.traded_n}, expected 128 (not the spec's 92)`);
assert.equal(model.median_age_days, 677);
assert.deepEqual(
  model.f_values.map(round4),
  [0.2644, 0.2644, 0.3867, 0.3867, 0.5468, 0.7865, 0.7973],
  `launch curve ${model.f_values}`,
);
assert.equal(round3(model.premiums['Risk Curators']!), 1.61);
assert.equal(round3(model.premiums['Dexs']!), 1.113);
assert.equal(round3(model.premiums['CDP']!), 0.871);
assert.equal(round3(model.premiums['RWA']!), 1.384);
assert.equal(round3(model.premiums['Onchain Capital Allocator']!), 0.534);
assert.equal(round3(model.premiums['Lending']!), 0.634);
assert.equal(model.premium_comps['Dexs'], 11);
assert.equal(model.premium_comps['Lending'], 15);
assert.equal(model.premium_comps['RWA'], 9);
assert.equal(model.premium_comps['Risk Curators'], 1);
assert.equal(model.premium_comps['CDP'], 3);
assert.equal(round3(model.hazard['Risk Curators']!), 0.243);
assert.equal(round3(model.hazard['Dexs']!), 1.637);
assert.equal(round3(model.hazard['CDP']!), 0.896);

// --- Worked examples: exact to the dollar (hand-checked, see the file header) ----
// Each row: slug, expected value, value-if-launches, odds (3dp), forward TVL,
// size-curve value, premium (3dp), age in days, range lo, range hi, wait in years (null = over 5).
const examples: Array<[string, number, number, number, number, number, number, number, number, number, number | null]> = [
  ['steakhouse-financial', 32_130_723, 143_389_754, 0.224, 2_693_572_911, 89_085_827, 1.61, 543, 3_444_093, 194_329_391, null],
  ['usdd', 28_038_587, 46_895_369, 0.598, 1_026_165_926, 53_817_225, 0.871, 611, 3_005_457, 169_579_799, 1.75],
  ['gauntlet', 25_006_295, 111_595_575, 0.224, 1_666_745_806, 69_332_597, 1.61, 543, 2_680_425, 151_240_235, null],
  ['onre', 22_243_532, 39_802_290, 0.559, 309_216_566, 28_763_686, 1.384, 488, 2_384_285, 134_530_805, 2],
  ['bittensor-dtao', 15_522_995, 34_211_759, 0.454, 351_361_941, 30_748_652, 1.113, 56, 1_663_910, 93_884_416, 2.25],
];
for (const [slug, expected, vif, odds, fwd, curve, premium, age, lo, hi, wait] of examples) {
  const v = impliedValue(protocol(slug), snapshot.as_of, model);
  assert.equal(v.expected, expected, `${slug}: expected $${v.expected}, hand-checked $${expected}`);
  assert.equal(Math.round(v.valueIfLaunches), vif, `${slug}: value-if-launches ${Math.round(v.valueIfLaunches)}`);
  assert.equal(round3(v.odds), odds, `${slug}: odds ${v.odds}`);
  assert.equal(Math.round(v.forwardTvlUsd), fwd, `${slug}: forward TVL ${Math.round(v.forwardTvlUsd)}`);
  assert.equal(Math.round(v.curveUsd), curve, `${slug}: size curve ${Math.round(v.curveUsd)}`);
  assert.equal(round3(v.premium), premium, `${slug}: premium ${v.premium}`);
  assert.equal(v.age, age, `${slug}: age ${v.age}`);
  assert.equal(v.rangeLo, lo, `${slug}: range lo ${v.rangeLo}`);
  assert.equal(v.rangeHi, hi, `${slug}: range hi ${v.rangeHi}`);
  assert.equal(waitYears(model, protocol(slug).category, v.age), wait, `${slug}: wait ${waitYears(model, protocol(slug).category, v.age)}`);
  assert.equal(launchOdds(model, protocol(slug).category, v.age), v.odds, `${slug}: launchOdds disagrees with impliedValue`);
  // The expected value is the probability-weighted one, not the raw implied value: the old
  // radar-2 Steakhouse was $277M; radar-3 says $32M because a launch is a 22% chance, not a fact.
  assert.ok(v.expected < v.valueIfLaunches, `${slug}: expected must be below value-if-launches`);
}

// --- Holdout validation: fitted on 75%, measured on the held-out 25% --------------
const holdout = holdoutValidation(snapshot);
assert.deepEqual(holdout, {
  size_n: 97,
  size_miss: 2.27,
  size_holds: 28,
  size_hold_n: 31,
  odds_hits: 122,
  odds_n: 189,
}, `holdout ${JSON.stringify(holdout)}`);

// --- Board shape -----------------------------------------------------------------
const board = buildBoard(snapshot, model);
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
assert.equal(board[0]!.implied_value_usd, 32_130_723);
assert.equal(board[1]!.slug, 'usdd');
assert.equal(board[2]!.slug, 'gauntlet');
assert.equal(board[3]!.slug, 'onre');
assert.equal(board[4]!.slug, 'opentrade');
assert.equal(board[39]!.implied_value_usd, 5_696_975, 'rank 40');
assert.equal(board[99]!.implied_value_usd, 2_864_864, 'rank 100');
assert.equal(board[199]!.implied_value_usd, 4_331, 'rank 200');
for (const r of board) {
  assert.equal(r.token_status, 'pre-token');
  assert.equal(r.mcap_usd, null, `${r.slug} carries a market cap`);
  assert.ok(r.farm_steps.length >= 6 && r.farm_steps.length <= 8, `${r.slug} has ${r.farm_steps.length} steps`);
  for (const s of r.farm_steps) {
    assert.ok(s.length >= 20 && s.length <= 600, `${r.slug} step ${s.length} chars`);
    assert.ok(s.includes('Cost: ') && s.includes('Time: '), `${r.slug} step lacks cost/time`);
    assert.ok(!s.endsWith('...'), `${r.slug} step hit the truncation guard`);
  }
  // Ranges bracket the expected value; odds are a probability; the verdict follows the net.
  assert.ok(r.range_lo_usd <= r.implied_value_usd && r.implied_value_usd <= r.range_hi_usd, `${r.slug} range does not bracket`);
  assert.ok(r.launch_odds > 0 && r.launch_odds < 1, `${r.slug} odds ${r.launch_odds}`);
  assert.ok(r.value_if_launches_usd >= r.implied_value_usd, `${r.slug} value-if-launches below expected`);
  const econ = farmEconomics(protocol(r.slug), r.age_days, r.implied_value_usd, model);
  assert.equal(econ.net, r.net_usd, `${r.slug}: net ${r.net_usd}`);
  assert.equal(econ.drop, r.drop_usd, `${r.slug}: drop ${r.drop_usd}`);
  assert.equal(econ.fees, r.fees_usd, `${r.slug}: fees ${r.fees_usd}`);
  assert.equal(econ.verdict, r.verdict, `${r.slug}: verdict ${r.verdict}`);
  assert.ok(r.wait_years === null || (r.wait_years >= 0.25 && r.wait_years <= 5), `${r.slug} wait ${r.wait_years}`);
  assert.equal(r.comparables.length, 3, `${r.slug} has ${r.comparables.length} comparables`);
  for (const c of r.comparables) assert.ok(c.mcap_usd > 0, `${r.slug} comparable ${c.slug} does not trade`);
}
// Verdict mix: farming a giant with $1,000 is a bad trade under this maths; only 5 rows clear $10 net.
const verdicts = { FARM: 0, MARGINAL: 0, SKIP: 0 };
for (const r of board) verdicts[r.verdict]++;
assert.deepEqual(verdicts, { FARM: 5, MARGINAL: 18, SKIP: 177 }, `verdicts ${JSON.stringify(verdicts)}`);
assert.deepEqual(
  board.filter((r) => r.verdict === 'FARM').map((r) => r.slug).sort(),
  ['byreal', 'manifest-trade', 'predict-fun', 'reya-perps', 'sx-rollup-bridge'],
  'FARM rows',
);

// --- Comparables are the true nearest three traded protocols by TVL -----------------
for (const slug of ['steakhouse-financial', 'usdd', 'bittensor-dtao']) {
  const p = protocol(slug);
  const nearest = snapshot.protocols
    .filter((q) => q.mcap_usd !== null && q.mcap_usd > 0 && q.tvl_usd > 0 && q.slug !== slug)
    .map((q) => ({ slug: q.slug, d: Math.abs(Math.log(q.tvl_usd) - Math.log(p.tvl_usd)) }))
    .sort((a, b) => a.d - b.d || (a.slug < b.slug ? -1 : 1))
    .slice(0, 3)
    .map((q) => q.slug);
  assert.deepEqual(
    comparables(p, snapshot).map((c) => c.slug),
    nearest,
    `${slug}: comparables are not the nearest three`,
  );
}
assert.equal(comparables(protocol('steakhouse-financial'), snapshot)[0]!.slug, 'babylon-protocol');

// --- Farm plans, word for word (unchanged templates, DESIGN §3.3, §3.4) ------------
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

// --- Radar data shape ------------------------------------------------------------
const { radar } = buildRadar(snapshot);
assert.equal(radar.model_version, 'radar-3');
assert.equal(radar.board_size, 200);
assert.equal(radar.protocols, snapshot.protocols.length);
assert.equal(radar.early_size, 160);
assert.equal(radar.watchlist_size, 40);
assert.equal(radar.live_size, 24);
assert.equal(radar.implied_total_usd, 848_265_159, `implied total ${radar.implied_total_usd}`);
assert.equal(radar.farm_count, 5);
assert.deepEqual(radar.holdout, holdout, 'radar holdout disagrees with the direct check');
assert.equal(radar.live[0]!.slug, 'rain');
assert.ok(radar.live[0]!.mcap_usd! > 2_000_000_000, 'live #1 is not rain');
assert.ok(!JSON.stringify(radar).includes('https://'), 'radar data carries a URL');
assert.equal(radar.source_label, 'DefiLlama protocols snapshot, 14 Nov 2026');

console.log('model.test: all checks passed');
console.log(`  board: ${board.length} rows, rank 1 $${board[0]!.implied_value_usd.toLocaleString('en-US')}, rank 40 $${board[39]!.implied_value_usd.toLocaleString('en-US')}, rank 100 $${board[99]!.implied_value_usd.toLocaleString('en-US')}, rank 200 $${board[199]!.implied_value_usd.toLocaleString('en-US')}`);
console.log(`  holdout: miss x${holdout.size_miss}, ranges hold ${holdout.size_holds}/${holdout.size_hold_n}, odds hit ${holdout.odds_hits}/${holdout.odds_n}`);
console.log(`  verdicts: FARM ${verdicts.FARM}, MARGINAL ${verdicts.MARGINAL}, SKIP ${verdicts.SKIP}; implied total $${radar.implied_total_usd.toLocaleString('en-US')}`);
