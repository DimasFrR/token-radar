# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/DimasFrR/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/DimasFrR/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar ranks 200 pre-token DeFi protocols by expected launch value — a size curve fitted by log-log regression on the snapshot's own traded tokens, × a category premium, × launch odds from protocol age and category — and validates the model out-of-sample on the snapshot's traded tokens (holdout miss ×2.27, P10–P90 range holds 90%, launch-odds hit 65%). Every row carries a FARM / MARGINAL / SKIP verdict with net $ after fees at a $1,000 plan size, and each protocol gets a concrete farm plan with costs and times plus a detail view (derivation ladder, nearest traded comparables, farm economics). The dashboard is a static page with a sortable board, a detail view for every protocol, and category/token-status filters.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=3sqn2d9b&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
