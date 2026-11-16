// Token Radar dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, a filterable table, a per-protocol detail view with the model's own
// inputs and the protocol's farm plan, and the live-token comparison tab. No network: every
// byte it shows is in data.js. Every number on the page is recomputed in the browser from the
// same data the program wrote: impliedOf below is the model's formula, and farmSteps below is
// the plan generator main.ts runs, kept textually close to lib/model.ts on purpose.
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
  function fmtAsOf(iso) { return fmtDate(iso); }

  // The model, mirrored from lib/model.ts: same constants, same arithmetic.
  function multipleOf(category) {
    if (category === null || category === undefined) return MODEL.default_multiple;
    var m = MODEL.multiples[category];
    return m === undefined ? MODEL.default_multiple : m;
  }
  function impliedOf(row) {
    var growth = Math.min(MODEL.growth_cap, Math.max(MODEL.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * MODEL.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? MODEL.unknown_age_days : row.age_days;
    var maturity = MODEL.maturity_floor + (Math.min(Math.max(age, 0), MODEL.maturity_days) / MODEL.maturity_days) * MODEL.maturity_range;
    var chains = 1 + MODEL.chain_step * Math.min(Math.max(row.chains.length - 1, 0), MODEL.chain_cap);
    return Math.min(100000000000000, Math.max(1, Math.round(row.tvl_usd * multipleOf(row.category) * growthMult * maturity * chains)));
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
    multiple: function (a, b) { return a.base_multiple - b.base_multiple; }
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
      '<p class="rank1"><span class="tag">#1</span> <b>' + esc(top.name) + ' — ' + fmtUsd(top.implied_value_usd) + ' implied</b></p>' +
      '<p class="sub">' + DATA.board_size + ' ranked · ' + DATA.live_size + ' live for comparison · model ' + esc(DATA.model_version) + '</p></header>';
  }
  function judgeHtml() {
    return '<section class="panel judge" aria-label="How this radar works"><h2>How this radar works — read this first</h2>' +
      '<p>The board ranks 200 protocols that record no token, by what a launch would be worth if their record stayed as it is. ' +
      'Implied value = TVL × a category multiple × growth × maturity × chains. The multiples come from this snapshot\u2019s own 158 tokenized protocols ' +
      '(median market-cap/TVL per category, capped at 0.40 — see the table below), not from a list of names: the same formula scores every row, ' +
      'and the detail view shows every factor for every protocol. The 40 watchlist protocols are all here, plus 160 below the $50M floor by TVL. ' +
      'Protocols whose token already trades are on the Live tab, with their market value — never mixed into the ranking. Each protocol\u2019s farm plan ' +
      'names its cost and time per step. This radar does not predict whether or when any token is issued, and it promises no airdrop.</p>' +
      '<p class="note">Multiples are medians, not means: one 400× outlier must not set a whole category. A category with fewer than three live comps takes a sibling\u2019s shape, never one comp\u2019s ratio. ' +
      'Below the floor, wrapped/staked products cannot be separated from the snapshot alone — the watchlist\u2019s own rule needs a field this file does not carry.</p></section>';
  }
  function calibrationHtml() {
    var rows = DATA.calibration.map(function (c) {
      return '<tr><td>' + esc(c.category) + '</td><td class="num">' + c.multiple.toFixed(2) + '</td><td class="num">' + c.comps + '</td><td class="num">' + (c.median === null ? '—' : c.median.toFixed(3)) + '</td></tr>';
    }).join('');
    return '<section class="panel calibration" aria-label="How the multiples were set"><h2>How the multiples were set — calibration table</h2>' +
      '<p>Each category\u2019s multiple is the median market-cap/TVL of this snapshot\u2019s tokenized protocols in that category, capped at 0.40.</p>' +
      '<table class="mult"><thead><tr><th>Category</th><th>Multiple</th><th>Tokenized comps</th><th>Median mcap/TVL</th></tr></thead><tbody>' + rows + '</tbody></table></section>';
  }
  function controlsHtml(s) {
    var cats = [];
    ROWS.forEach(function (r) { if (r.category && cats.indexOf(r.category) === -1) cats.push(r.category); });
    cats.sort();
    var opts = '<option value="all">All categories</option>' + cats.map(function (c) {
      return '<option value="' + esc(c) + '"' + (s.cat === c ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');
    var sortOpts = [['rank', 'Rank'], ['name', 'Protocol A–Z'], ['tvl', 'TVL'], ['change', '7d change'], ['age', 'Age'], ['implied', 'Implied value'], ['multiple', 'Multiple']].map(function (o) {
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
      var chains = esc(r.chains[0] || '') + (r.chains.length > 1 ? ' +' + (r.chains.length - 1) : '');
      var badge = isWatchlist(r) ? '<span class="badge wl">Watchlist</span>' : '<span class="badge early">Early</span>';
      var chg = r.change_7d === null ? '<span class="num">n/a</span>' : '<span class="num ' + (r.change_7d >= 0 ? 'up' : 'down') + '">' + fmtPct(r.change_7d) + '</span>';
      return '<tr' + (r.rank === 1 ? ' class="top1"' : '') + '><td class="rank num">' + r.rank + '</td>' +
        '<td class="name"><b>' + esc(r.name) + '</b><span class="slug">' + esc(r.slug) + '</span>' + badge + '</td>' +
        '<td>' + esc(r.category === null ? '—' : r.category) + '</td><td>' + chains + '</td>' +
        '<td class="tvl num">' + fmtUsd(r.tvl_usd) + '</td><td>' + chg + '</td>' +
        '<td class="num">' + fmtAge(r.age_days) + '</td><td class="num">' + r.base_multiple.toFixed(2) + '</td>' +
        '<td class="impl num">' + fmtUsd(r.implied_value_usd) + '<span class="bar"><i style="width:' + w + '%"></i></span></td>' +
        '<td><button type="button" class="farm" data-farm="' + esc(r.slug) + '">Farm plan</button></td></tr>';
    }).join('');
    if (!body) body = '<tr><td colspan="10" class="note">No protocols match this filter.</td></tr>';
    return '<div class="table-wrap"><table class="board"><thead><tr>' + th('rank', 'Rank') + th('name', 'Protocol') + '<th>Category</th><th>Chains</th>' +
      th('tvl', 'TVL') + th('change', '7d') + th('age', 'Age') + th('multiple', 'Multiple') + th('implied', 'Implied value') + '<th>Farm</th></tr></thead>' +
      '<tbody>' + body + '</tbody></table></div>' +
      '<div class="pager"><button type="button" data-page="prev"' + (page <= 1 ? ' disabled' : '') + '>← Prev</button>' +
      '<span class="pages">Page ' + page + ' of ' + pages + ' · ' + total + ' protocols</span>' +
      '<button type="button" data-page="next"' + (page >= pages ? ' disabled' : '') + '>Next →</button></div>' +
      '<p class="note">Every number on this page is recomputed in the browser from the same data the program wrote — open any protocol to see its factors.</p>';
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
        ' TVL — about a ' + ratio + '× ratio. That one row is exactly why this radar uses medians and caps, not raw comps.</p>' : '') +
      '<div class="table-wrap"><table class="board"><thead><tr><th>Rank</th><th>Protocol</th><th>Category</th><th>TVL</th><th>Market cap</th><th>7d</th></tr></thead><tbody>' + body + '</tbody></table></div></section>';
  }
  function detailHtml(slug) {
    var row = BY_SLUG[slug] || null;
    if (!row) return '<section class="panel"><p>Unknown protocol: ' + esc(slug) + '.</p></section>';
    var steps = farmSteps(row, row.age_days);
    var items = steps.map(function (st) { return '<li>' + esc(st) + '</li>'; }).join('');
    var badge = isWatchlist(row) ? '<span class="badge wl">Watchlist</span>' : '<span class="badge early">Early — below the $50M floor</span>';
    return '<section class="panel detail" aria-label="Protocol detail"><button type="button" class="close" data-close="1">Close ×</button>' +
      '<h2>' + esc(row.name) + ' ' + badge + '</h2>' +
      '<p class="meta"><b>' + esc(row.category === null ? 'No category recorded' : row.category) + '</b> · ' +
      esc(row.chains.join(', ') || 'no chains recorded') + ' · TVL <b>' + fmtUsd(row.tvl_usd) + '</b> · 7d <b>' + fmtPct(row.change_7d) + '</b> · age <b>' + fmtAge(row.age_days) + '</b> · listed <b>' + fmtDate(row.listed_at) + '</b> · rank <b>#' + row.rank + '</b></p>' +
      '<div class="equation">' + fmtM(row.tvl_usd) + ' TVL × ' + row.base_multiple.toFixed(2) + ' (' + esc(row.category || 'default') + ') × ' +
      row.growth_multiplier.toFixed(3) + ' growth × ' + row.maturity_multiplier.toFixed(3) + ' maturity × ' +
      row.chain_multiplier.toFixed(2) + ' chains = <b>' + fmtUsd(row.implied_value_usd) + '</b><br>' +
      '<span class="lbl">TVL from the snapshot · multiple from the calibration table · 7d change · days listed · chain count</span></div>' +
      '<p class="note">Recomputed here in the browser: ' + fmtUsd(impliedOf(row)) + '. It matches the board, or the page is wrong.</p>' +
      '<h2>Farm plan</h2><ol>' + items + '</ol>' +
      '<p class="honest">Records no token. No airdrop is promised or implied. Implied value is this entry\u2019s own claim, not a prediction of whether or when a token is issued.</p></section>';
  }
  function footerHtml() {
    return '<footer><p>Method: implied value = TVL × a category multiple × growth × maturity × chains, from the snapshot\u2019s own figures. ' +
      'The multiples are the median market-cap/TVL of this snapshot\u2019s tokenized protocols per category, capped at 0.40. Model ' + esc(DATA.model_version) + '.</p>' +
      '<p>Data: ' + esc(DATA.source_label) + '. Implied values are this entry\u2019s own claim. This radar does not predict whether or when a token is issued, and it promises no airdrop.</p></footer>';
  }

  function render() {
    var s = readState();
    var html = headerHtml() + judgeHtml() + controlsHtml(s);
    if (s.selected) html += detailHtml(s.selected);
    html += s.tab === 'live' ? liveHtml() : boardHtml(s, filteredRows(s));
    html += calibrationHtml();
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
  window.__radarTest = { impliedOf: impliedOf, farmSteps: farmSteps, stepText: stepText, multipleOf: multipleOf };
  render();
})();
