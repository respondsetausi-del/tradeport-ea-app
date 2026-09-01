# NTS Super AI

`NTSSuperAI.mq5` runs the same rules as the TradePort app's server-side
strategy engine, on the chart you attach it to. Attach it, allow algo trading,
and it trades the direction of the moving averages exactly as the app does.

## Install

1. In MetaTrader 5: **File → Open Data Folder**
2. Copy `NTSSuperAI.mq5` into `MQL5/Experts/`
3. In MetaEditor press **F7**, or just copy the prebuilt `NTSSuperAI.ex5`
   into the same folder
4. Drag it onto a chart. Set the chart to the symbol you want traded
5. Tick **Allow Algo Trading**, both in the EA dialog and on the terminal toolbar

One chart per symbol. The EA only ever touches the symbol it is attached to and
only positions carrying its own magic number, so several charts can run side by
side without interfering.

## What it does

Defaults match the app exactly: EMA 21/55 on M15, a 200 EMA on H1 as the trend
filter, ATR 14, a stop at 1.5 × ATR and a target at 3 × ATR, trailing once the
trade is 1 × ATR in profit.

**AlwaysIn = true** (the default, and what the app ships with)
Hold whichever way the EMAs point, at all times. No standing aside for ranges,
no entry gates. A genuine cross closes the position and opens the other way.

**AlwaysIn = false**
The strict gated rules. An entry needs EMA separation above `AtrMult × ATR`,
the direction to have held for `ConfirmBars`, and agreement from the higher
timeframe. Exits use a looser threshold (`ExitMult`, half of `AtrMult`) on
purpose: with one threshold for both, a position sitting near the boundary
closes and reopens on ordinary noise and pays the spread twice for nothing.
If the gates produce nothing for `GraceWindowMinutes`, it enters on the bare
EMA direction instead.

## Why the maths is hand-rolled

EMA and ATR are computed in the file rather than with `iMA` and `iATR`. The
built-ins seed differently, and this EA has to agree with the server's numbers,
not merely be a reasonable moving average. `EmaSeries` seeds with the SMA of the
first `period` closes; `AtrSeries` is Wilder's, seeded the same way. Both are
line-for-line ports of `app/api/mt5/strategy/indicators.ts`.

Decisions are taken on **closed bars only**. The forming bar is excluded because
its range is incomplete and would flicker the signal.

## Safety behaviour

- **Reversals go through a verified flat account.** `CloseUntilFlat` closes,
  waits, re-reads and retries up to four times. If it cannot prove the symbol is
  empty it refuses to open, and says so in the log. Long and short cannot be
  open at once.
- **Every order carries its stop from the moment it is sent.** Levels are never
  added by a follow-up modify, which would leave a window where the position is
  live and naked. They are then refined to the actual fill price.
- **Stops are clamped to the broker's minimum distance.** A level inside
  `SYMBOL_TRADE_STOPS_LEVEL` is rejected outright, which would mean no stop at
  all rather than a tight one.
- **Trailing never moves backwards** and never crosses to the losing side of
  entry.
- **A hedge, if one ever appears, is cleared before anything else.**

## Differences from the server, and why

| | server | this EA |
|---|---|---|
| Evaluation | polls every 20s | every tick; decisions still gate on a new closed bar |
| Flat proof | re-reads the account over the API | reads the terminal directly, so it is immediate |
| Stop distance | as calculated | additionally clamped to the broker minimum |
| Loss breakers | account-wide across symbols | this EA's magic number on this symbol only |

That last row matters if you run several charts: each EA counts only its own
trades, so `MaxDailyLoss` is per chart rather than per account.

## Netting accounts

`OrdersPerEntry` opens that many orders per entry, matching the app's `count`.
On a **hedging** account you get that many positions. On a **netting** account
they merge into one larger position, so the setting just multiplies volume.
Nothing breaks either way, but be aware which you have.

## Before running it live

The stop and target logic has been verified against the app's own test suite
with a mocked broker, and this file compiles clean (0 errors, 0 warnings). It
has **not** been run against a live account.

Put it on a **demo account first** and confirm three things:

1. Orders arrive with a stop and a target already attached, not added a moment
   later
2. A reversal closes fully before the opposite side opens
3. The trailing stop moves in one direction only

The EA leaves open positions alone when you remove it from the chart. Close them
yourself if that is what you want.

## Branding

The chart is filled with the NTS logo. Three inputs control it:

| Input | Default | What it does |
|---|---|---|
| `ShowLogo` | `true` | Turns the backdrop on and off |
| `LogoFill` | `Cover` | `Cover` fills every pixel and crops the overflow. `Fit` shows the whole logo with margins on two sides. `Stretch` fills exactly, at the cost of distorting the artwork |
| `LogoOpacity` | `100` | `100` is solid. Lower it to turn the logo into a watermark |

The artwork is compiled into `NTSSuperAI.ex5`, so the prebuilt file carries its
own logo and needs nothing beside it. Only rebuilding from source needs
`NTSSuperAI.bmp` sitting next to the `.mq5`.

MetaTrader will not scale a bitmap object, so the image is resampled to the
exact size of the window and rebuilt whenever the window is resized. Price data
is moved to the chart foreground while the backdrop is up, so candles draw on
top of the logo and the chart stays readable.
