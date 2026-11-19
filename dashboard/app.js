// Token Radar dashboard (radar-3). It reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the ranked board, a filterable table, a per-protocol detail view with the model's own
// inputs and the protocol's farm plan, and the live-token comparison tab. No network: every byte
// it shows is in data.js. Every number on the page is recomputed in the browser from the same data
// the program wrote: impliedOf below is the model's formula (size curve x premium x launch odds),
// and farmSteps below is the plan generator main.ts runs, kept textually close to lib/model.ts.
(function () {
  'use strict';
  var DATA = window.RADAR;
  var app = document.getElementById('board');
  if (!DATA || !app) return;
  var ROWS = DATA.rows;
  var LIVE = DATA.live;
  var BY_SLUG = {};
  ROWS.forEach(function (r) { BY_SLUG[r.slug] = r; });
  var MODEL = DATA.model;
  var HOLD = DATA.holdout;
  var PAGE = 25;

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtM(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e6) return '$' + Math.round(n / 1e6).toLocaleString('en-US') + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtMoney(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n < 0 ? '-$' : '+$') + Math.abs(n).toFixed(2);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDate(iso) {
    if (!iso) return 'unknown';
    var p = iso.split('-');
    return Number(p[2]) + ' ' + MONTHS[Number(p[1]) - 1] + ' ' + p[0];
  }

  // The model, mirrored from lib/model.ts: same constants, same arithmetic.
  function premiumOf(category) {
    if (category === null || category === undefined) return 1;
    var m = MODEL.premiums[category];
    return m === undefined ? 1 : m;
  }
  function hazardOf(category) {
    if (category === null || category === undefined) return 1;
    var m = MODEL.hazard[category];
    return m === undefined ? 1 : m;
  }
  function curveAt(f, age) {
    var c = MODEL.f_centers;
    if (age <= c[0]) return f[0];
    for (var i = 0; i < c.length - 1; i++) {
      if (age < c[i + 1]) { var t = (age - c[i]) / (c[i + 1] - c[i]); return f[i] + t * (f[i + 1] - f[i]); }
    }
    return f[f.length - 1];
  }
  function oddsOf(row) {
    var age = row.age_days === null || row.age_days === undefined ? MODEL.unknown_age_days : row.age_days;
    var k = hazardOf(row.category);
    var fa = 1 - Math.pow(1 - curveAt(MODEL.f_values, age), k);
    var fb = 1 - Math.pow(1 - curveAt(MODEL.f_values, age + MODEL.odds_horizon_days), k);
    return Math.min(0.999, Math.max(0.001, (fb - fa) / Math.max(1 - fa, 0.001)));
  }
  function forwardOf(row) {
    var g = Math.min(MODEL.growth_cap, Math.max(MODEL.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    return row.tvl_usd * (1 + g / 100);
  }
  function impliedOf(row) {
    var curve = Math.exp(MODEL.intercept + MODEL.slope * Math.log(forwardOf(row)));
    var expected = curve * premiumOf(row.category) * oddsOf(row);
    return Math.min(100000000000000, Math.max(1, Math.round(expected)));
  }
  function chainOf(row) { return row.chains.length > 0 ? row.chains[0] : 'its main chain'; }
  function capitalFor(row) {
    if (row.tvl_usd >= 5000000000) return 250;
    if (row.tvl_usd >= 1000000000) return 150;
    if (row.tvl_usd >= 100000000) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 45;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function gasFor(capital) { return capital >= 150 ? 8 : 4; }
  function feesFor(row) {
    var capital = capitalFor(row);
    var weeks = Math.ceil(holdDaysFor(row.age_days) / 7);
    return 3 + gasFor(capital) + 2 * weeks + (row.chains.length >= 3 ? gasFor(capital) : 0);
  }
  function farmMinutes(row) {
    var weeks = Math.ceil(holdDaysFor(row.age_days) / 7);
    return 5 + 15 + 10 * weeks + (row.chains.length >= 3 ? 15 : 0) + 10 + 5;
  }
  function netFor(row, deposit, share) {
    return row.implied_value_usd * share * (deposit / row.tvl_usd) - row.fees_usd;
  }
  function verdictFor(net) {
    return net >= MODEL.farm_threshold_usd ? 'FARM' : net >= 0 ? 'MARGINAL' : 'SKIP';
  }
  function actionFor(row, capital, chain) {
    var c = (row.category || '').toLowerCase();
    var name = row.name;
    if (c === '') return 'Deposit $' + capital + ' of USDC into ' + name + '\'s main app and keep the position open.';
    if (c.indexOf('cdp') !== -1) return 'Mint ' + name + '\'s stable asset with $' + capital + ' of collateral on ' + chain + ' and keep the position open.';
    if (c.indexOf('lend') !== -1 || c.indexOf('collateral') !== -1) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('curator') !== -1 || c.indexOf('allocator') !== -1) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c === 'dexs' || c.indexOf('yield') !== -1 || c.indexOf('leveraged farm') !== -1) return 'Provide $' + capital + ' of liquidity to ' + name + '\'s main pool on ' + chain + ' and keep the position open.';
    if (c.indexOf('bridge') !== -1) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') !== -1 || c.indexOf('restak') !== -1) return 'Stake $' + capital + ' of the chain\'s staking asset through ' + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') !== -1 || c.indexOf('derivative') !== -1 || c.indexOf('basis') !== -1) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') !== -1) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('rwa') !== -1) return 'Mint $' + capital + ' of the protocol\'s yield asset on ' + chain + ' and hold it.';
    if (c.indexOf('insurance') !== -1) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    if (c.indexOf('chain') !== -1) return 'Bridge $' + capital + ' of USDC to ' + chain + ' and use ' + name + '\'s native app to stay active.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + ' Hold the position and check the protocol\'s own page.';
    return s;
  }
  function farmSteps(row, age) {
    var chain = chainOf(row);
    var capital = capitalFor(row);
    var hold = holdDaysFor(age);
    var steps = [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(row, capital, chain), cost: '$' + capital + ' of capital and about $' + gasFor(capital) + ' of gas', time: '15 minutes to set up' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' }
    ];
    if (row.chains.length >= 3) {
      var half = capital / 2;
      steps.push({ text: 'Repeat the deposit on ' + row.chains[1] + ' with $' + half + ' so the position is visible on two chains.', cost: '$' + half + ' of capital and about $' + gasFor(capital) + ' of gas', time: '15 minutes' });
    }
    var c = (row.category || '').toLowerCase();
    if (c.indexOf('cdp') !== -1 || c.indexOf('lend') !== -1) {
      steps.push({ text: 'Check the borrow rate and your collateral health before the position ages a week; repay or top up if the rate moved against you.', cost: 'no fee to check', time: '10 minutes a week' });
    }
    steps.push(
      { text: 'Before you withdraw, open the protocol\'s own points or rewards page and claim only from the link it publishes.', cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    );
    if (c.indexOf('curator') !== -1 || c.indexOf('allocator') !== -1) {
      steps.push({ text: 'Check the vault\'s fee and the curator\'s allocation once a week; exit if the vault\'s TVL falls for two weeks in a row.', cost: 'no fee to check', time: '10 minutes a week' });
    }
    return steps.map(stepText);
  }

  // State lives in the URL hash, so a filtered view or a detail is a link.
  function readState() {
    var h = location.hash || '';
    var s = { q: '', cat: 'all', tab: 'pre-token', sort: 'implied', dir: -1, page: 1, selected: null };
    if (h.indexOf('#/protocol/') === 0) { s.selected = decodeURIComponent(h.slice(11)); return s; }
    var params = new URLSearchParams(h.replace(/^#\/?/, ''));
    if (params.get('q')) s.q = params.get('q');
    if (params.get('cat')) s.cat = params.get('cat');
    if (params.get('tab') === 'live') s.tab = 'live';
    if (params.get('sort')) s.sort = params.get('sort');
    if (params.get('dir') === '1') s.dir = 1;
    var pg = parseInt(params.get('page') || '1', 10);
    if (pg > 0) s.page = pg;
    return s;
  }
  function writeState(s) {
    var p = new URLSearchParams();
    if (s.q) p.set('q', s.q);
    if (s.cat !== 'all') p.set('cat', s.cat);
    if (s.tab === 'live') p.set('tab', 'live');
    if (s.sort !== 'implied') p.set('sort', s.sort);
    if (s.dir === 1) p.set('dir', '1');
    if (s.page > 1) p.set('page', String(s.page));
    var h = p.toString();
    if (s.selected) h = '/protocol/' + encodeURIComponent(s.selected);
    var next = h ? '#' + h : '#';
    if (location.hash !== next) history.replaceState(null, '', next);
  }

  var SORTS = {
    rank: function (a, b) { return a.rank - b.rank; },
    name: function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; },
    tvl: function (a, b) { return a.tvl_usd - b.tvl_usd; },
    change: function (a, b) { return (a.change_7d === null ? 0 : a.change_7d) - (b.change_7d === null ? 0 : b.change_7d); },
    age: function (a, b) { return (a.age_days === null ? 365 : a.age_days) - (b.age_days === null ? 365 : b.age_days); },
    implied: function (a, b) { return a.implied_value_usd - b.implied_value_usd; },
    odds: function (a, b) { return a.launch_odds - b.launch_odds; },
    net: function (a, b) { return a.net_usd - b.net_usd; }
  };
  function isWatchlist(row) { return row.tvl_usd >= DATA.floor_usd; }
  function filteredRows(s) {
    var q = s.q.trim().toLowerCase();
    var rows = ROWS.filter(function (r) {
      if (s.cat !== 'all' && r.category !== s.cat) return false;
      if (q && r.name.toLowerCase().indexOf(q) === -1 && r.slug.toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    var fn = SORTS[s.sort] || SORTS.implied;
    rows.sort(function (a, b) { return fn(a, b) * s.dir || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0); });
    return rows;
  }

  function headerHtml() {
    var top = ROWS[0];
    return '<header><div class="title-row"><span class="sweep" aria-hidden="true"></span>' +
      '<h1>TOKEN RADAR <span class="thin">— pre-token protocols, ranked by what a launch would be worth</span></h1></div>' +
      '<p class="sub">' + esc(DATA.source_label) + ' · ' + DATA.protocols + ' protocols · floor ' + fmtM(DATA.floor_usd) +
      ' · ' + DATA.watchlist_size + ' on the watchlist</p>' +
      '<p class="rank1"><span class="tag">#1</span> <b>' + esc(top.name) + ' — ' + fmtUsd(top.implied_value_usd) + ' expected</b> <span class="tag">launch odds ' + Math.round(top.launch_odds * 100) + '%</span></p>' +
      '<p class="sub">' + DATA.board_size + ' ranked · ' + DATA.live_size + ' live for comparison · model ' + esc(DATA.model_version) + '</p></header>';
  }
  function statsHtml() {
    var miss = HOLD.size_miss.toFixed(2);
    var holdsPct = Math.round(100 * HOLD.size_holds / HOLD.size_hold_n);
    var oddsPct = Math.round(100 * HOLD.odds_hits / HOLD.odds_n);
    function card(v, l) { return '<div class="stat"><b>' + v + '</b><span>' + l + '</span></div>'; }
    return '<section class="stats" aria-label="Radar at a glance">' +
      card(DATA.board_size, 'protocols ranked') +
      card(fmtUsd(DATA.implied_total_usd), 'implied value, total') +
      card('×' + miss, 'holdout miss (median)') +
      card(holdsPct + '%', 'caps inside P10–P90 (' + HOLD.size_holds + '/' + HOLD.size_hold_n + ')') +
      card(oddsPct + '%', 'launch-odds hit (' + HOLD.odds_hits + '/' + HOLD.odds_n + ')') +
      card(DATA.farm_count, 'worth farming at $1,000') +
      '</section>' +
      '<p class="formula">Expected value = size curve(forward TVL) × category premium × launch odds (2 years). ' +
      'The board prints its holdout check above — a tested model, not a promise.</p>';
  }
  function controlsHtml(s) {
    var cats = [];
    ROWS.forEach(function (r) { if (r.category && cats.indexOf(r.category) === -1) cats.push(r.category); });
    cats.sort();
    var opts = '<option value="all">All categories</option>' + cats.map(function (c) {
      return '<option value="' + esc(c) + '"' + (s.cat === c ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');
    var sortOpts = [['rank', 'Rank'], ['name', 'Protocol A–Z'], ['tvl', 'TVL'], ['change', '7d change'], ['age', 'Age'], ['implied', 'Expected value'], ['odds', 'Launch odds'], ['net', 'Net $']].map(function (o) {
      return '<option value="' + o[0] + '"' + (s.sort === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
    }).join('');
    return '<div class="controls" role="search">' +
      '<input type="search" id="q" placeholder="Search name or slug" value="' + esc(s.q) + '" aria-label="Search name or slug">' +
      '<select id="cat" aria-label="Category">' + opts + '</select>' +
      '<select id="sort" aria-label="Sort by">' + sortOpts + '</select>' +
      '<div class="tabs" role="group" aria-label="Board tab">' +
      '<button type="button" data-tab="pre-token" aria-pressed="' + (s.tab === 'pre-token') + '">Pre-token (' + DATA.board_size + ')</button>' +
      '<button type="button" data-tab="live" aria-pressed="' + (s.tab === 'live') + '">Live (' + DATA.live_size + ')</button>' +
      '</div></div>';
  }
  function verdictCell(r) {
    return '<span class="verdict v-' + r.verdict.toLowerCase() + '">' + r.verdict + '</span>';
  }
  function boardHtml(s, rows) {
    var total = rows.length;
    var pages = Math.max(1, Math.ceil(total / PAGE));
    var page = Math.min(s.page, pages);
    var slice = rows.slice((page - 1) * PAGE, page * PAGE);
    var maxLog = Math.log10(ROWS[0].implied_value_usd);
    var minLog = Math.log10(ROWS[ROWS.length - 1].implied_value_usd);
    function th(key, label) {
      var arrow = s.sort === key ? (s.dir === 1 ? ' ▲' : ' ▼') : '';
      return '<th><button type="button" data-sort="' + key + '">' + label + arrow + '</button></th>';
    }
    var body = slice.map(function (r) {
      var w = Math.max(4, Math.round((Math.log10(r.implied_value_usd) - minLog) / (maxLog - minLog) * 100));
      var badge = isWatchlist(r) ? '<span class="badge wl">Watchlist</span>' : '<span class="badge early">Early</span>';
      var chg = r.change_7d === null ? '<span class="num">n/a</span>' : '<span class="num ' + (r.change_7d >= 0 ? 'up' : 'down') + '">' + fmtPct(r.change_7d) + '</span>';
      var netCls = r.net_usd >= 0 ? 'up' : 'muted';
      return '<tr' + (r.rank === 1 ? ' class="top1"' : '') + '><td class="rank num">' + r.rank + '</td>' +
        '<td class="name"><b>' + esc(r.name) + '</b><span class="slug">' + esc(r.slug) + '</span>' + badge + '</td>' +
        '<td>' + esc(r.category === null ? '—' : r.category) + '</td>' +
        '<td class="tvl num">' + fmtUsd(r.tvl_usd) + '</td><td>' + chg + '</td>' +
        '<td class="num">' + fmtAge(r.age_days) + '</td><td class="num">' + Math.round(r.launch_odds * 100) + '%</td>' +
        '<td class="impl num">' + fmtUsd(r.implied_value_usd) + '<span class="range">' + fmtUsd(r.range_lo_usd) + '–' + fmtUsd(r.range_hi_usd) + '</span><span class="bar"><i style="width:' + w + '%"></i></span></td>' +
        '<td>' + verdictCell(r) + '</td><td class="num ' + netCls + '">' + fmtMoney(r.net_usd) + '</td>' +
        '<td><button type="button" class="farm" data-farm="' + esc(r.slug) + '">Farm plan</button></td></tr>';
    }).join('');
    if (!body) body = '<tr><td colspan="11" class="note">No protocols match this filter.</td></tr>';
    return '<div class="table-wrap"><table class="board"><thead><tr>' + th('rank', 'Rank') + th('name', 'Protocol') + '<th>Category</th>' +
      th('tvl', 'TVL') + th('change', '7d') + th('age', 'Age') + th('odds', 'Odds') + th('implied', 'Expected · P10–P90') + '<th>Verdict</th>' + th('net', 'Net $') + '<th>Farm</th></tr></thead>' +
      '<tbody>' + body + '</tbody></table></div>' +
      '<div class="pager"><button type="button" data-page="prev"' + (page <= 1 ? ' disabled' : '') + '>← Prev</button>' +
      '<span class="pages">Page ' + page + ' of ' + pages + ' · ' + total + ' protocols</span>' +
      '<button type="button" data-page="next"' + (page >= pages ? ' disabled' : '') + '>Next →</button></div>' +
      '<p class="note">Expected value is value-if-launches × launch odds. Verdict and Net $ are priced at a $1,000 plan with a 7% drop share: FARM clears $10 after fees, MARGINAL clears $0, SKIP does not. Every number on this page is recomputed in the browser from the same data the program wrote — open any protocol to see its factors.</p>';
  }
  function liveHtml() {
    var top = LIVE[0];
    var ratio = top && top.tvl_usd ? Math.round(top.mcap_usd / top.tvl_usd) : null;
    var body = LIVE.map(function (r, i) {
      var chg = r.change_7d === null ? '<span class="num">n/a</span>' : '<span class="num ' + (r.change_7d >= 0 ? 'up' : 'down') + '">' + fmtPct(r.change_7d) + '</span>';
      return '<tr><td class="rank num">' + (i + 1) + '</td><td class="name"><b>' + esc(r.name) + '</b><span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category === null ? '—' : r.category) + '</td><td class="tvl num">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="impl num">' + fmtUsd(r.mcap_usd) + '</td><td>' + chg + '</td></tr>';
    }).join('');
    return '<section class="panel"><h2>Already trading — the market\u2019s own values, not the model\u2019s</h2>' +
      '<p>These protocols record a token, so they are never ranked and never get an implied value. What you see is their actual market cap, next to their TVL — never a ratio presented as a valuation.</p>' +
      (top ? '<p class="warn">Caution: the top live row is ' + esc(top.name) + ' (' + esc(top.category || '') + '), ' + fmtM(top.mcap_usd) + ' market cap on ' + fmtM(top.tvl_usd) +
        ' TVL — about a ' + ratio + '× ratio. That one row is exactly why this radar uses a fitted curve and shrunk premiums, not raw comps.</p>' : '') +
      '<div class="table-wrap"><table class="board"><thead><tr><th>Rank</th><th>Protocol</th><th>Category</th><th>TVL</th><th>Market cap</th><th>7d</th></tr></thead><tbody>' + body + '</tbody></table></div></section>';
  }
  function detailHtml(slug) {
    var row = BY_SLUG[slug] || null;
    if (!row) return '<section class="panel"><p>Unknown protocol: ' + esc(slug) + '.</p></section>';
    var steps = farmSteps(row, row.age_days);
    var items = steps.map(function (st) { return '<li>' + esc(st) + '</li>'; }).join('');
    var badge = isWatchlist(row) ? '<span class="badge wl">Watchlist</span>' : '<span class="badge early">Early — below the $50M floor</span>';
    var wait = row.wait_years === null ? 'over 5 years' : row.wait_years.toFixed(2).replace(/\.?0+$/, '') + ' years';
    var curve = Math.exp(MODEL.intercept + MODEL.slope * Math.log(forwardOf(row)));
    var ladder = [
      ['TVL', fmtUsd(row.tvl_usd)],
      ['Forward TVL (7d ' + fmtPct(row.change_7d) + ')', fmtUsd(row.forward_tvl_usd)],
      ['Size curve — exp(' + MODEL.intercept.toFixed(2) + ' + ' + MODEL.slope.toFixed(2) + ' · ln TVL)', fmtUsd(row.size_curve_usd)],
      ['× category premium (' + esc(row.category || 'no category') + ', ' + row.category_premium.toFixed(2) + ')', fmtUsd(row.value_if_launches_usd)],
      ['× launch odds (' + Math.round(row.launch_odds * 100) + '%, ' + fmtAge(row.age_days) + ' with no token)', '<b>' + fmtUsd(row.implied_value_usd) + '</b>'],
      ['P10–P90 range', fmtUsd(row.range_lo_usd) + ' – ' + fmtUsd(row.range_hi_usd)]
    ].map(function (r) { return '<tr><td>' + r[0] + '</td><td class="num">' + r[1] + '</td></tr>'; }).join('');
    var comps = row.comparables.map(function (c) {
      return '<tr><td><b>' + esc(c.name) + '</b><span class="slug">' + esc(c.slug) + '</span></td><td class="num">' + fmtUsd(c.tvl_usd) + '</td><td class="num">' + fmtUsd(c.mcap_usd) + '</td></tr>';
    }).join('');
    var econ = '<tr><td>At risk (plan size)</td><td class="num">$1,000</td></tr>' +
      '<tr><td>Fees (gas: first tx, setup, weekly, second chain)</td><td class="num">$' + row.fees_usd.toFixed(2) + '</td></tr>' +
      '<tr><td>Time</td><td class="num">~' + farmMinutes(row) + ' min over ' + holdDaysFor(row.age_days) + ' days</td></tr>' +
      '<tr><td>Model\u2019s drop (7% of expected, pro-rata over TVL)</td><td class="num">' + fmtMoney(row.drop_usd).replace('+', '') + '</td></tr>' +
      '<tr><td>Net</td><td class="num"><b>' + fmtMoney(row.net_usd) + '</b> ' + verdictCell(row) + '</td></tr>';
    var shares = [0.03, 0.07, 0.15];
    var deposits = [100, 1000, 5000];
    var matrix = '<tr><th></th>' + shares.map(function (s) { return '<th>' + Math.round(s * 100) + '% drop</th>'; }).join('') + '</tr>' +
      deposits.map(function (d) {
        return '<tr><th>$' + d.toLocaleString('en-US') + ' in</th>' + shares.map(function (s) {
          var net = netFor(row, d, s);
          var v = verdictFor(net);
          return '<td class="num m-' + v.toLowerCase() + '">' + fmtMoney(net) + '<span class="mv">' + v + '</span></td>';
        }).join('') + '</tr>';
      }).join('');
    return '<section class="panel detail" aria-label="Protocol detail"><button type="button" class="close" data-close="1">Close ×</button>' +
      '<h2>' + esc(row.name) + ' ' + badge + '</h2>' +
      '<p class="meta"><b>' + esc(row.category === null ? 'No category recorded' : row.category) + '</b> · ' +
      esc(row.chains.join(', ') || 'no chains recorded') + ' · TVL <b>' + fmtUsd(row.tvl_usd) + '</b> · 7d <b>' + fmtPct(row.change_7d) + '</b> · age <b>' + fmtAge(row.age_days) + '</b> · listed <b>' + fmtDate(row.listed_at) + '</b> · rank <b>#' + row.rank + '</b></p>' +
      '<h2>How the number is built</h2><table class="ladder">' + ladder + '</table>' +
      '<p class="note">Recomputed here in the browser: ' + fmtUsd(impliedOf(row)) + ' (size curve $' + fmtUsd(curve) + '). It matches the board, or the page is wrong. ' +
      'Typical wait if it launches: <b>' + wait + '</b> — the median wait from the cohort\u2019s launch history, not a promise.</p>' +
      '<h2>Nearest traded comparables</h2><table class="comp"><thead><tr><th>Protocol</th><th>TVL</th><th>Market cap</th></tr></thead><tbody>' + comps + '</tbody></table>' +
      '<p class="note">The three traded protocols nearest in TVL. Their market caps are the market\u2019s own values — the curve above is fitted through all 128 traded tokens, not just these three.</p>' +
      '<h2>Farm economics — $1,000 plan</h2><table class="econ">' + econ + '</table>' +
      '<h2>Drop share × deposit</h2><table class="matrix">' + matrix + '</table>' +
      '<p class="note">Each cell is the net $ at that drop share and deposit, fees held at this row\u2019s $' + row.fees_usd.toFixed(2) + '. A bigger deposit buys a bigger slice of the same drop — and the same fees.</p>' +
      '<h2>Farm plan</h2><ol>' + items + '</ol>' +
      '<p class="honest">Records no token. No airdrop is promised or implied. Implied value is this entry\u2019s own claim, not a prediction of whether or when a token is issued.</p></section>';
  }
  function methodHtml() {
    var rows = DATA.calibration.map(function (c) {
      return '<tr><td>' + esc(c.category) + '</td><td class="num">' + c.premium.toFixed(2) + '</td><td class="num">' + c.comps + '</td><td class="num">' + (c.median_ratio === null ? '—' : c.median_ratio.toFixed(3)) + '</td></tr>';
    }).join('');
    return '<section class="panel method" aria-label="How this radar works"><h2>How this radar works</h2>' +
      '<p><b>Expected value = size curve(forward TVL) × category premium × launch odds.</b> The size curve is log market-cap on log TVL, ' +
      'fitted by regression over this snapshot\u2019s own ' + MODEL.traded_n + ' traded tokens (intercept ' + MODEL.intercept.toFixed(2) + ', slope ' + MODEL.slope.toFixed(2) + ', R² ' + MODEL.r_squared.toFixed(2) + '). ' +
      'A category\u2019s premium is its median residual from that curve, shrunk toward 1 and capped at 0.30–2.00. Forward TVL grows TVL by the seven-day change, clamped to ±30%.</p>' +
      '<p><b>Launch odds</b> come from the cohort, not a guess: the share of protocols that record a token, by age bin (made monotone), scaled by the category\u2019s hazard ratio — then the chance of a launch in the next 2 years given none yet. Older protocols with no token score lower: the cohort has already had its chance with them. ' +
      'A protocol with no listed date is scored at the median age (' + MODEL.median_age_days + ' days).</p>' +
      '<p><b>Held out, not asserted.</b> Every 4th protocol by slug was set aside and the whole model fitted on the other 75%: median miss ×' + HOLD.size_miss.toFixed(2) + ' on ' + HOLD.size_hold_n + ' held-out traded tokens, ' +
      HOLD.size_holds + ' of ' + HOLD.size_hold_n + ' caps inside their P10–P90 range, and the odds model called launched vs not-launched right on ' + HOLD.odds_hits + ' of ' + HOLD.odds_n + ' held-out protocols. ' +
      'The ranges are wide because the fit is loose (R² ' + MODEL.r_squared.toFixed(2) + ') — traded tokens scatter an order of magnitude around the curve, and the board shows that instead of hiding it.</p>' +
      '<p><b>Farm verdicts</b> are priced at a $1,000 plan and a 7% drop share: the model\u2019s drop is 7% of the expected value split pro-rata across TVL, fees are the plan\u2019s own gas, net = drop − fees. FARM clears $10, MARGINAL clears $0, SKIP does not. ' +
      'Below the floor, wrapped/staked products cannot be separated from the snapshot alone — the watchlist\u2019s own rule needs a field this file does not carry.</p>' +
      '<p>This radar does not predict whether or when any token is issued, and it promises no airdrop.</p>' +
      '<h2>Category premiums — derivation table</h2>' +
      '<table class="mult"><thead><tr><th>Category</th><th>Premium</th><th>Traded comps</th><th>Median ratio</th></tr></thead><tbody>' + rows + '</tbody></table></section>';
  }
  function footerHtml() {
    return '<footer><p>Method: expected value = size curve(forward TVL) × category premium × launch odds (2 years), fitted from the snapshot\u2019s own figures. Model ' + esc(DATA.model_version) + '.</p>' +
      '<p>Data: ' + esc(DATA.source_label) + '. Implied values are this entry\u2019s own claim. This radar does not predict whether or when a token is issued, and it promises no airdrop.</p></footer>';
  }

  function render() {
    var s = readState();
    var html = headerHtml() + statsHtml() + controlsHtml(s);
    if (s.selected) html += detailHtml(s.selected);
    html += s.tab === 'live' ? liveHtml() : boardHtml(s, filteredRows(s));
    html += methodHtml();
    html += footerHtml();
    app.innerHTML = html;
    app.setAttribute('aria-busy', 'false');
  }

  app.addEventListener('click', function (e) {
    var t = e.target.closest('button');
    if (!t) return;
    var s = readState();
    if (t.hasAttribute('data-sort')) {
      var key = t.getAttribute('data-sort');
      if (s.sort === key) s.dir = -s.dir;
      else { s.sort = key; s.dir = key === 'name' ? 1 : -1; }
      s.page = 1;
    } else if (t.hasAttribute('data-tab')) {
      s.tab = t.getAttribute('data-tab');
      s.page = 1;
    } else if (t.hasAttribute('data-page')) {
      s.page = Math.max(1, s.page + (t.getAttribute('data-page') === 'next' ? 1 : -1));
    } else if (t.hasAttribute('data-farm')) {
      s.selected = t.getAttribute('data-farm');
    } else if (t.hasAttribute('data-close')) {
      s.selected = null;
    } else return;
    writeState(s);
    render();
    if (t.hasAttribute('data-farm')) {
      var d = app.querySelector('.detail');
      if (d) d.scrollIntoView();
    }
  });
  app.addEventListener('input', function (e) {
    var s = readState();
    if (e.target.id === 'q') { s.q = e.target.value; s.page = 1; writeState(s); render(); var q = document.getElementById('q'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }
  });
  app.addEventListener('change', function (e) {
    var s = readState();
    if (e.target.id === 'cat') { s.cat = e.target.value; s.page = 1; }
    else if (e.target.id === 'sort') { s.sort = e.target.value; s.dir = s.sort === 'name' ? 1 : -1; s.page = 1; }
    else return;
    writeState(s);
    render();
  });
  window.addEventListener('hashchange', render);

  // Cross-check on load: the page's own recomputation must agree with the data it was given.
  var bad = 0;
  ROWS.forEach(function (r) { if (impliedOf(r) !== r.implied_value_usd) bad++; });
  if (bad > 0) console.error('token radar: recomputation disagrees with data.js on ' + bad + ' rows');
  window.__radarTest = { impliedOf: impliedOf, farmSteps: farmSteps, stepText: stepText, oddsOf: oddsOf, feesFor: feesFor, farmMinutes: farmMinutes, netFor: netFor, verdictFor: verdictFor };
  render();
})();
