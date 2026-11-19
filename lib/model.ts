// Token Radar, model "radar-3": one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds the
// pre-token protocols below the watchlist floor with the most TVL: the early rows the radar exists to
// find. A protocol is pre-token when its record carries no token (no market cap, no CoinGecko id, no
// symbol); the snapshot's live-token protocols are kept apart and shown as the market's own values,
// never mixed into the ranked board.
//
// Implied value is an EXPECTED value: what a launch would be worth IF it launches, times the chance
// it launches in the next two years. Both halves are fitted from the snapshot's own figures, never
// from a name:
//
//   forward TVL  = tvl_usd x (1 + clamp(change_7d, -30, +30) / 100); null change counts as 0
//   size curve   = exp(a) x forwardTVL^b, where log mcap ~ a + b log TVL is an OLS log-log
//                  regression over the snapshot's own traded tokens (mcap > 0)
//   premium      = exp(shrink x median log residual) per category, shrink = n / (n + 3),
//                  clamped to [0.30, 2.00]; a category with no traded comps takes 1
//   value-if-launches = sizeCurve(forward TVL) x premium
//   launch odds  = (F_cat(age + 2y) - F_cat(age)) / (1 - F_cat(age)), where F is the cohort's
//                  launched-by-age curve (binned current-status fractions, made monotone by
//                  pool-adjacent-violators) and F_cat(a) = 1 - (1 - F(a))^k scales it by the
//                  category's hazard ratio k
//   expected     = round(value-if-launches x odds), clamped to [1, 1e14]
//
// P10-P90 ranges come from the premium-adjusted log residuals of the size-curve fit: the board's
// range is expected x exp(q10) to expected x exp(q90). The ranges are wide because the fit is
// loose (R-squared near 0.2: traded tokens scatter an order of magnitude around the curve), and
// the board says so instead of hiding it.
//
// Validation is held out, not asserted: every 4th protocol by slug (25%) is set aside, the whole
// model is fitted on the other 75%, and the board prints the holdout numbers (median fold miss on
// traded tokens, share of holdout caps inside their P10-P90 range, share of held-out protocols
// whose launched/not-launched status the odds model calls right). The final board refits on all
// 758 protocols; the holdout numbers describe the procedure, not the final fit.
//
// Farm economics are priced at a $1,000 plan: the model's drop is 7% of the expected value split
// pro-rata across TVL (a $1,000 deposit is 1000 / TVL of the pool), fees are the farm plan's own
// gas (first transaction, setup, weekly actions, second chain where the plan repeats), and
// net = drop - fees. Verdict: FARM when net >= $10, MARGINAL when net >= $0, SKIP below that.
// Farming a $2.7B curator with $1,000 is a bad trade under this maths, and the board shows it.
//
// No protocol name is ever special-cased: the same functions score every row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The fitted model: every number the dashboard needs to recompute a row, fitted at build time. */
export interface FittedModel {
  intercept: number;
  slope: number;
  r_squared: number;
  traded_n: number;
  premiums: Record<string, number>;
  premium_comps: Record<string, number>;
  median_ratios: Record<string, number | null>;
  f_centers: number[];
  f_values: number[];
  hazard: Record<string, number>;
  median_age_days: number;
  base_rate: number;
  resid_q10: number;
  resid_q90: number;
  growth_floor: number;
  growth_cap: number;
  plan_size_usd: number;
  drop_share: number;
  odds_horizon_days: number;
  farm_threshold_usd: number;
  unknown_age_days: number;
}

/** What the holdout check measured, so the board can print it instead of asserting it. */
export interface Holdout {
  size_n: number;
  size_miss: number;
  size_holds: number;
  size_hold_n: number;
  odds_hits: number;
  odds_n: number;
}

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-3';

/** The largest implied value the model will state: the gate's own cap. */
export const IMPLIED_CAP = 100_000_000_000_000;

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** The farm plan's size in dollars: every verdict and net figure is priced at this deposit. */
export const PLAN_SIZE_USD = 1000;

/** The share of the expected value the model assumes is dropped to farmers. */
export const DROP_SHARE = 0.07;

/** Launch odds count a launch inside this many days, given no launch yet. */
export const ODDS_HORIZON_DAYS = 730;

/** Net dollars at or above this verdict is FARM; at or above zero is MARGINAL; below is SKIP. */
export const FARM_THRESHOLD_USD = 10;

/** Age bins for the launched-by-age curve, in days; the last bin runs open-ended. */
export const AGE_EDGES = [0, 90, 180, 365, 730, 1095, 1460, Number.POSITIVE_INFINITY];

/** Bin centres for interpolation between the launched-by-age bins, in days. */
export const AGE_CENTERS = [45, 135, 272, 547, 912, 1277, 1650];

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One traded protocol the detail view names as a comparable: name, TVL, market cap. */
export interface Comparable {
  slug: string;
  name: string;
  tvl_usd: number;
  mcap_usd: number;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  value_if_launches_usd: number;
  launch_odds: number;
  range_lo_usd: number;
  range_hi_usd: number;
  verdict: 'FARM' | 'MARGINAL' | 'SKIP';
  net_usd: number;
  drop_usd: number;
  fees_usd: number;
  wait_years: number | null;
  comparables: Comparable[];
  model: {
    forward_tvl_usd: number;
    size_curve_usd: number;
    category_premium: number;
    growth_pct: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  value_if_launches_usd: number;
  launch_odds: number;
  range_lo_usd: number;
  range_hi_usd: number;
  verdict: 'FARM' | 'MARGINAL' | 'SKIP';
  net_usd: number;
  drop_usd: number;
  fees_usd: number;
  wait_years: number | null;
  comparables: Comparable[];
  forward_tvl_usd: number;
  size_curve_usd: number;
  category_premium: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** One row of the premium derivation table: the tokenized comps behind a premium. */
export interface CalibrationRow {
  category: string;
  comps: number;
  median_ratio: number | null;
  premium: number;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source_label: string;
  floor_usd: number;
  protocols: number;
  model: FittedModel;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  implied_total_usd: number;
  farm_count: number;
  holdout: Holdout;
  calibration: CalibrationRow[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a list, or null when it holds nothing. */
function medianOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n % 2 === 1) return sorted[(n - 1) / 2]!;
  return (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2;
}

/** The q-th quantile by the floor rule: sorted[floor(q * n)], clamped to the last element. */
function quantileOf(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol's token trades with a measurable market cap: the size curve's training set. */
export function isTraded(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The OLS log-log fit of market cap on TVL over a protocol list's traded rows. */
export function fitSizeCurve(protos: SnapshotProtocol[]): { intercept: number; slope: number; rSquared: number; n: number } {
  const pts = protos.filter(isTraded).map((p) => ({ x: Math.log(p.tvl_usd), y: Math.log(p.mcap_usd!) }));
  const n = pts.length;
  if (n < 2) return { intercept: 0, slope: 0, rSquared: 0, n };
  const mx = pts.reduce((s, q) => s + q.x, 0) / n;
  const my = pts.reduce((s, q) => s + q.y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const q of pts) {
    sxy += (q.x - mx) * (q.y - my);
    sxx += (q.x - mx) * (q.x - mx);
    syy += (q.y - my) * (q.y - my);
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = my - slope * mx;
  const rSquared = sxx === 0 || syy === 0 ? 0 : (sxy * sxy) / (sxx * syy);
  return { intercept, slope, rSquared, n };
}

/** The category premium from a fit's residuals: median log residual, shrunk toward 1, capped. */
export function fitPremiums(
  protos: SnapshotProtocol[],
  fit: { intercept: number; slope: number },
): { premiums: Record<string, number>; comps: Record<string, number>; medianRatios: Record<string, number | null> } {
  const byCat = new Map<string, number[]>();
  for (const p of protos) {
    if (!isTraded(p)) continue;
    const r = Math.log(p.mcap_usd!) - (fit.intercept + fit.slope * Math.log(p.tvl_usd));
    const c = p.category ?? 'null';
    if (!byCat.has(c)) byCat.set(c, []);
    byCat.get(c)!.push(r);
  }
  const premiums: Record<string, number> = {};
  const comps: Record<string, number> = {};
  const medianRatios: Record<string, number | null> = {};
  for (const [c, rs] of [...byCat.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const med = medianOf(rs) ?? 0;
    const shrink = rs.length / (rs.length + 3);
    premiums[c] = Math.min(2.0, Math.max(0.3, Math.exp(shrink * med)));
    comps[c] = rs.length;
    medianRatios[c] = Math.round(Math.exp(med) * 1000) / 1000;
  }
  return { premiums, comps, medianRatios };
}

/** Premium-adjusted log residuals under a fit: what the P10-P90 ranges are built from. */
export function fitResiduals(
  protos: SnapshotProtocol[],
  fit: { intercept: number; slope: number },
  premiums: Record<string, number>,
): number[] {
  const out: number[] = [];
  for (const p of protos) {
    if (!isTraded(p)) continue;
    const premium = premiums[p.category ?? 'null'] ?? 1;
    out.push(Math.log(p.mcap_usd!) - (fit.intercept + fit.slope * Math.log(p.tvl_usd) + Math.log(premium)));
  }
  return out;
}

/**
 * The cohort's launched-by-age curve: for each age bin, the fraction of protocols in it that
 * record a token (current-status data: each protocol is seen once, at its current age). Raw bin
 * fractions are made monotone non-decreasing by pool-adjacent-violators, because a launch
 * fraction cannot fall as a cohort ages. An empty bin carries the previous bin's fraction.
 */
export function fitLaunchCurve(protos: SnapshotProtocol[], asOf: string): number[] {
  const bins = AGE_EDGES.slice(0, -1).map((lo, i) => {
    const hi = AGE_EDGES[i + 1]!;
    let n = 0;
    let l = 0;
    for (const p of protos) {
      const a = ageDays(asOf, p.listed_at);
      if (a === null || a < lo || a >= hi) continue;
      n++;
      if (!isPreToken(p)) l++;
    }
    return { n, l };
  });
  let carry = 0;
  const raw = bins.map((b) => {
    if (b.n === 0) return carry;
    carry = b.l / b.n;
    return carry;
  });
  const blocks: { idx: number[]; n: number; l: number }[] = [];
  for (let i = 0; i < bins.length; i++) {
    blocks.push({ idx: [i], n: bins[i]!.n, l: bins[i]!.l });
    while (blocks.length >= 2) {
      const b2 = blocks[blocks.length - 1]!;
      const b1 = blocks[blocks.length - 2]!;
      const f1 = b1.n ? b1.l / b1.n : raw[b1.idx[0]!]!;
      const f2 = b2.n ? b2.l / b2.n : raw[b2.idx[0]!]!;
      if (f1 <= f2) break;
      blocks.pop();
      blocks.pop();
      blocks.push({ idx: [...b1.idx, ...b2.idx], n: b1.n + b2.n, l: b1.l + b2.l });
    }
  }
  const out = new Array<number>(bins.length).fill(0);
  for (const b of blocks) {
    const f = b.n ? b.l / b.n : raw[b.idx[0]!]!;
    for (const i of b.idx) out[i] = f;
  }
  return out;
}

/** The launched-by-age curve at one age, linearly interpolated between bin centres, flat outside. */
export function launchCurveAt(fValues: number[], age: number): number {
  const centers = AGE_CENTERS;
  if (age <= centers[0]!) return fValues[0]!;
  for (let i = 0; i < centers.length - 1; i++) {
    if (age < centers[i + 1]!) {
      const t = (age - centers[i]!) / (centers[i + 1]! - centers[i]!);
      return fValues[i]! + t * (fValues[i + 1]! - fValues[i]!);
    }
  }
  return fValues[fValues.length - 1]!;
}

/** The share of a protocol list that records a token. */
function launchRate(protos: SnapshotProtocol[]): number {
  if (protos.length === 0) return 0;
  return protos.filter((p) => !isPreToken(p)).length / protos.length;
}

/**
 * A category's hazard ratio: how much faster its protocols launch than the whole cohort, from its
 * launched share shrunk toward the global rate with five pseudo-protocols. Proportional hazards:
 * F_cat(a) = 1 - (1 - F(a))^k. A category nobody has seen launches from still gets a small ratio,
 * never zero; a category that always launches is capped.
 */
export function fitHazard(protos: SnapshotProtocol[]): Record<string, number> {
  const base = launchRate(protos);
  const out: Record<string, number> = {};
  if (base <= 0 || base >= 1) return out;
  const cats = [...new Set(protos.map((p) => p.category ?? 'null'))].sort();
  for (const c of cats) {
    const inCat = protos.filter((p) => (p.category ?? 'null') === c);
    const f = (inCat.filter((p) => !isPreToken(p)).length + 5 * base) / (inCat.length + 5);
    const k = Math.log(1 - f) / Math.log(1 - base);
    out[c] = Math.min(3, Math.max(0.05, k));
  }
  return out;
}

/** Fit the whole model from one protocol list: size curve, premiums, launch curve, hazards. */
export function fitModel(protos: SnapshotProtocol[], asOf: string): FittedModel {
  const fit = fitSizeCurve(protos);
  const prem = fitPremiums(protos, fit);
  const resid = fitResiduals(protos, fit, prem.premiums);
  const knownAges = protos.map((p) => ageDays(asOf, p.listed_at)).filter((a): a is number => a !== null);
  const medianAge = medianOf(knownAges) ?? 365;
  return {
    intercept: fit.intercept,
    slope: fit.slope,
    r_squared: fit.rSquared,
    traded_n: fit.n,
    premiums: prem.premiums,
    premium_comps: prem.comps,
    median_ratios: prem.medianRatios,
    f_centers: [...AGE_CENTERS],
    f_values: fitLaunchCurve(protos, asOf),
    hazard: fitHazard(protos),
    median_age_days: medianAge,
    base_rate: launchRate(protos),
    resid_q10: quantileOf(resid, 0.1),
    resid_q90: quantileOf(resid, 0.9),
    growth_floor: -30,
    growth_cap: 30,
    plan_size_usd: PLAN_SIZE_USD,
    drop_share: DROP_SHARE,
    odds_horizon_days: ODDS_HORIZON_DAYS,
    farm_threshold_usd: FARM_THRESHOLD_USD,
    unknown_age_days: medianAge,
  };
}

/** The premium for a category: the fitted value, or 1 for a category with no traded comps. */
export function premiumFor(model: FittedModel, category: string | null): number {
  if (category === null) return 1;
  return model.premiums[category] ?? 1;
}

/** The hazard ratio for a category: the fitted value, or 1 for an unseen category. */
export function hazardFor(model: FittedModel, category: string | null): number {
  if (category === null) return 1;
  return model.hazard[category] ?? 1;
}

/** The chance a protocol aged `age` days launches within the horizon, given it has not yet. */
export function launchOdds(model: FittedModel, category: string | null, age: number | null): number {
  const a = age ?? model.unknown_age_days;
  const k = hazardFor(model, category);
  const fa = 1 - Math.pow(1 - launchCurveAt(model.f_values, a), k);
  const fb = 1 - Math.pow(1 - launchCurveAt(model.f_values, a + model.odds_horizon_days), k);
  const denom = Math.max(1 - fa, 0.001);
  return Math.min(0.999, Math.max(0.001, (fb - fa) / denom));
}

/** The median wait, in years, until launch given no launch yet; null when it never reaches 50%. */
export function waitYears(model: FittedModel, category: string | null, age: number | null): number | null {
  const a = age ?? model.unknown_age_days;
  const k = hazardFor(model, category);
  const fa = 1 - Math.pow(1 - launchCurveAt(model.f_values, a), k);
  for (let t = 0.25; t <= 5.001; t += 0.25) {
    const ft = 1 - Math.pow(1 - launchCurveAt(model.f_values, a + t * 365), k);
    if ((ft - fa) / Math.max(1 - fa, 0.001) >= 0.5) return Math.round(t * 100) / 100;
  }
  return null;
}

/** The TVL the size curve scores: this week's TVL, grown by the (clamped) seven-day change. */
export function forwardTvl(p: SnapshotProtocol, model: FittedModel): number {
  const growth = Math.min(model.growth_cap, Math.max(model.growth_floor, finite(p.change_7d, 0)));
  return p.tvl_usd * (1 + growth / 100);
}

/** The multipliers and the expected value one protocol gets under the fitted model. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: FittedModel,
): {
  expected: number;
  valueIfLaunches: number;
  odds: number;
  forwardTvlUsd: number;
  curveUsd: number;
  premium: number;
  growthPct: number;
  age: number | null;
  rangeLo: number;
  rangeHi: number;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, finite(protocol.change_7d, 0)));
  const forward = forwardTvl(protocol, model);
  const curve = Math.exp(model.intercept + model.slope * Math.log(forward));
  const premium = premiumFor(model, protocol.category);
  const valueIfLaunches = curve * premium;
  const odds = launchOdds(model, protocol.category, age);
  const expected = Math.min(IMPLIED_CAP, Math.max(1, Math.round(valueIfLaunches * odds)));
  const rangeLo = Math.min(IMPLIED_CAP, Math.max(1, Math.round(expected * Math.exp(model.resid_q10))));
  const rangeHi = Math.min(IMPLIED_CAP, Math.max(1, Math.round(expected * Math.exp(model.resid_q90))));
  return { expected, valueIfLaunches, odds, forwardTvlUsd: forward, curveUsd: curve, premium, growthPct, age, rangeLo, rangeHi };
}

/** The holdout check: fit on 75%, measure on the held-out 25% (every 4th protocol by slug). */
export function holdoutValidation(snapshot: Snapshot): Holdout {
  const sorted = [...snapshot.protocols].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const train = sorted.filter((_, i) => i % 4 !== 3);
  const held = sorted.filter((_, i) => i % 4 === 3);
  const model = fitModel(train, snapshot.as_of);
  const folds: number[] = [];
  let holds = 0;
  let holdN = 0;
  for (const p of held) {
    if (!isTraded(p)) continue;
    holdN++;
    const v = impliedValue(p, snapshot.as_of, model);
    const pred = v.valueIfLaunches;
    folds.push(Math.max(pred / p.mcap_usd!, p.mcap_usd! / pred));
    if (p.mcap_usd! >= pred * Math.exp(model.resid_q10) && p.mcap_usd! <= pred * Math.exp(model.resid_q90)) holds++;
  }
  const miss = medianOf(folds) ?? 0;
  let hits = 0;
  for (const p of held) {
    const a = ageDays(snapshot.as_of, p.listed_at) ?? model.unknown_age_days;
    const k = hazardFor(model, p.category);
    const fcat = 1 - Math.pow(1 - launchCurveAt(model.f_values, a), k);
    if ((fcat >= model.base_rate) === !isPreToken(p)) hits++;
  }
  return {
    size_n: model.traded_n,
    size_miss: Math.round(miss * 100) / 100,
    size_holds: holds,
    size_hold_n: holdN,
    odds_hits: hits,
    odds_n: held.length,
  };
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The gas one farm transaction costs, from the capital tier: bigger positions pay more gas. */
function gasFor(capital: number): number {
  return capital >= 150 ? 8 : 4;
}

/** The fees one farm plan costs at the $1,000 plan size: first tx, setup, weekly actions, second chain. */
export function feesFor(p: SnapshotProtocol, age: number | null): number {
  const capital = capitalFor(p);
  const weeks = Math.ceil(holdDaysFor(age) / 7);
  return 3 + gasFor(capital) + 2 * weeks + (p.chains.length >= 3 ? gasFor(capital) : 0);
}

/** The clicking time one farm plan takes, in minutes: setup, weekly actions, second chain, claim, log. */
export function farmMinutes(p: SnapshotProtocol, age: number | null): number {
  const weeks = Math.ceil(holdDaysFor(age) / 7);
  return 5 + 15 + 10 * weeks + (p.chains.length >= 3 ? 15 : 0) + 10 + 5;
}

/** The farm economics at the $1,000 plan size: the model's drop, the plan's fees, the net, the verdict. */
export function farmEconomics(
  p: SnapshotProtocol,
  age: number | null,
  expected: number,
  model: FittedModel,
): { drop: number; fees: number; net: number; verdict: 'FARM' | 'MARGINAL' | 'SKIP' } {
  const drop = Math.round(expected * model.drop_share * (model.plan_size_usd / p.tvl_usd) * 100) / 100;
  const fees = feesFor(p, age);
  const net = Math.round((drop - fees) * 100) / 100;
  const verdict = net >= model.farm_threshold_usd ? 'FARM' : net >= 0 ? 'MARGINAL' : 'SKIP';
  return { drop, fees, net, verdict };
}

/** The category's one action, in the words a farmer can follow. Curators are vaults: a farmer
 *  deposits into a vault a curator manages, and never "supplies liquidity" to one. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c === '') return `Deposit $${capital} of USDC into ${name}'s main app and keep the position open.`;
  if (c.includes('cdp')) return `Mint ${name}'s stable asset with $${capital} of collateral on ${chain} and keep the position open.`;
  if (c.includes('lend') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c === 'dexs' || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('chain')) return `Bridge $${capital} of USDC to ${chain} and use ${name}'s native app to stay active.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: six to eight steps, each an action with a cost and a time. The plan is
 * derived from the protocol's own record (category, chains, TVL, age), never from a hand-written
 * list of names. Multi-chain protocols repeat the deposit on a second chain; CDP and Lending
 * protocols get a risk check; vault protocols get a weekly vault watch.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const steps: FarmStep[] = [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${gasFor(capital)} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
  ];
  if (p.chains.length >= 3) {
    const half = capital / 2;
    steps.push({
      text: `Repeat the deposit on ${p.chains[1]} with $${half} so the position is visible on two chains.`,
      cost: `$${half} of capital and about $${gasFor(capital)} of gas`,
      time: '15 minutes',
    });
  }
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('cdp') || c.includes('lend')) {
    steps.push({
      text: `Check the borrow rate and your collateral health before the position ages a week; repay or top up if the rate moved against you.`,
      cost: 'no fee to check',
      time: '10 minutes a week',
    });
  }
  steps.push(
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  );
  if (c.includes('curator') || c.includes('allocator')) {
    steps.push({
      text: `Check the vault's fee and the curator's allocation once a week; exit if the vault's TVL falls for two weeks in a row.`,
      cost: 'no fee to check',
      time: '10 minutes a week',
    });
  }
  return steps;
}

/** The three traded protocols nearest in TVL (log distance), for the detail view's comparables. */
export function comparables(p: SnapshotProtocol, snapshot: Snapshot): Comparable[] {
  return snapshot.protocols
    .filter((q) => isTraded(q) && q.slug !== p.slug)
    .map((q) => ({ q, d: Math.abs(Math.log(q.tvl_usd) - Math.log(p.tvl_usd)) }))
    .sort((a, b) => a.d - b.d || (a.q.slug < b.q.slug ? -1 : a.q.slug > b.q.slug ? 1 : 0))
    .slice(0, 3)
    .map(({ q }) => ({ slug: q.slug, name: q.name, tvl_usd: q.tvl_usd, mcap_usd: q.mcap_usd! }));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: FittedModel): BoardRow[] {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but the
  // board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL, capped. Never a replacement
  // for a watchlist row: a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model);
    const econ = farmEconomics(p, v.age, v.expected, model);
    return { p, v, econ, wait: waitYears(model, p.category, v.age), comps: comparables(p, snapshot) };
  });
  scored.sort((a, b) => b.v.expected - a.v.expected || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.v.age,
    implied_value_usd: s.v.expected,
    value_if_launches_usd: Math.min(IMPLIED_CAP, Math.max(1, Math.round(s.v.valueIfLaunches))),
    launch_odds: Math.round(s.v.odds * 1000) / 1000,
    range_lo_usd: s.v.rangeLo,
    range_hi_usd: s.v.rangeHi,
    verdict: s.econ.verdict,
    net_usd: s.econ.net,
    drop_usd: s.econ.drop,
    fees_usd: s.econ.fees,
    wait_years: s.wait,
    comparables: s.comps,
    model: {
      forward_tvl_usd: Math.round(s.v.forwardTvlUsd),
      size_curve_usd: Math.min(IMPLIED_CAP, Math.max(1, Math.round(s.v.curveUsd))),
      category_premium: Math.round(s.v.premium * 1000) / 1000,
      growth_pct: s.v.growthPct,
      age_days: s.v.age,
    },
    farm_steps: farmSteps(s.p, s.v.age).map(stepText),
  }));
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    value_if_launches_usd: row.value_if_launches_usd,
    launch_odds: row.launch_odds,
    range_lo_usd: row.range_lo_usd,
    range_hi_usd: row.range_hi_usd,
    verdict: row.verdict,
    net_usd: row.net_usd,
    drop_usd: row.drop_usd,
    fees_usd: row.fees_usd,
    wait_years: row.wait_years,
    comparables: row.comparables,
    forward_tvl_usd: row.model.forward_tvl_usd,
    size_curve_usd: row.model.size_curve_usd,
    category_premium: row.model.category_premium,
  };
}

/** The snapshot's date as a readable label: "14 Nov 2026" from "2026-11-14". No URL is ever stored. */
function dateLabel(asOf: string): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const parts = asOf.split('-');
  const month = months[Number(parts[1]) - 1] ?? '';
  return `${Number(parts[2])} ${month} ${parts[0]}`;
}

/** The premium derivation table, from the fitted model: comps, median ratio, premium per category. */
export function calibration(model: FittedModel, medianRatios: Record<string, number | null>): CalibrationRow[] {
  return Object.keys(model.premiums)
    .sort()
    .map((category) => ({
      category,
      comps: model.premium_comps[category] ?? 0,
      median_ratio: medianRatios[category] ?? null,
      premium: Math.round(model.premiums[category]! * 1000) / 1000,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData; model: FittedModel; holdout: Holdout } {
  const model = fitModel(snapshot.protocols, snapshot.as_of);
  const holdout = holdoutValidation(snapshot);
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source_label: `DefiLlama protocols snapshot, ${dateLabel(snapshot.as_of)}`,
    floor_usd: snapshot.floor_usd,
    protocols: snapshot.protocols.length,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    implied_total_usd: board.reduce((s, r) => s + r.implied_value_usd, 0),
    farm_count: board.filter((r) => r.verdict === 'FARM').length,
    holdout,
    calibration: calibration(model, model.median_ratios),
    rows: board.map(radarRow),
    live,
  };
  return { board, radar, model, holdout };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
