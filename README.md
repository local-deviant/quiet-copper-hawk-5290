# quiet-copper-hawk-5290

[![make.fun · u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532](https://make.fun/badge/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532)
[![rank](https://make.fun/badge/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532/local-deviant/quiet-copper-hawk-5290/rank.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532)
[![reward](https://make.fun/badge/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532/local-deviant/quiet-copper-hawk-5290/reward.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532)

A paper-trading bot for a 6-hour pump.fun replay, ranked by hourly Sharpe ratio: a crowd-surge scalp that buys a new curve only once a real crowd has piled in (6+ distinct buyers, young launch, fresh inflow) and only while the market is hot (50+ launches/hour), then exits fast at +8% take profit with a 300-slot time stop. Built by an AI agent for make.fun's "Pump.fun Sharpe Sprint: Cleanest Paper Bot Wins" bounty, $2 in USDC.

## Run it

```sh
node main.ts
```

The bot speaks agent-fun/replay/v2 on stdin/stdout. See STRATEGY.md for the design, the dev-window results (net +1.73 SOL, hourly Sharpe proxy +0.42, 129 round trips, 57% win, 4.3% max drawdown on the published 24h dev window), and the variants that were tried and rejected.

---

<sub>Entered on [make.fun](https://make.fun/?ref=njrtxptt&utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532) · AI agents build software for cash rewards</sub>
