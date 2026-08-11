# Api2Trade MT5 Integration

How the apps use **Api2Trade** to connect MetaTrader 5 accounts, pull broker
symbols/quotes, and place/close trades — including the automated **batch loop**
and the **RSI auto-trader**.

> Api2Trade docs: https://docs.api2trade.com/docs · Dedicated server: `https://mt5.mt4api.dev`

**Shipped in 4 apps** (same integration, ported between them):
| App | Repo | Local port | Batch table |
|---|---|---|---|
| EA-APEX-APP | respondsetausi-del/EA-APEX-APP | :3000* | — (RSI RUN engine, no batch) |
| EMC-APP | nexoratengen-code/EMC-APP | :3001* | `emc_testflights` |
| ea-converter-app-public | respondsetausi-del/ea-converter-app-public | :3000 | `eac_mt5_batches` |
| tradeport-ea-app | respondsetausi-del/tradeport-ea-app | :3002 | `tp_mt5_batches` |

\* ports overlap because they aren't run simultaneously. Note :3001 on this machine is
often the **real Razor Markets MT5 terminal** (metatester64.exe), not a dev server.

> **Naming:** newer apps use **"batch"** everywhere (`app/api/mt5/batch/…`,
> `startBatch`). EMC still uses the older `testflight` naming internally. Do NOT
> introduce "test flight" wording in ea-converter / tradeport — the owner
> explicitly wants it kept out.

---

## 1. Architecture (3-tier)

```
┌─────────────────┐     HTTPS      ┌──────────────────────┐   Basic-auth HTTPS   ┌──────────────┐    ┌──────────────┐
│  Mobile app     │ ─────────────▶ │  Backend (Bun)       │ ───────────────────▶ │  Api2Trade   │ ─▶ │  MT5 broker  │
│ (Expo / RN/web) │  /api/mt5/*    │  (server.ts on Render)│   mt5.mt4api.dev     │  (mt5rest)   │    │ (RazorMarkets)│
└─────────────────┘  holds UUID    └──────────────────────┘   holds credentials  └──────────────┘    └──────────────┘
```

- **Client** never talks to Api2Trade directly and never holds Api2Trade credentials. It only holds a **session UUID** returned by our backend.
- **Backend** (`server.ts`) proxies every Api2Trade call, attaching the Basic-auth header server-side.
- **Api2Trade** holds the live MT5 connection (keyed by our UUID) and forwards orders to the broker.

**Key files**
| File | Role |
|---|---|
| `services/api2trade.ts` | Server-only Api2Trade REST wrapper (one function per endpoint) |
| `app/api/mt5/{connect,account,orders,trade,symbols}/route.ts` | Backend proxy routes |
| `app/api/mt5/batch/{engine,start,stop,status}` | Server-side batch loop (EMC: `…/testflight/…`) |
| `app/api/_db.ts` | MySQL pool (`getPool`) used for batch persistence |
| `server.ts` | Dispatches all `/api/mt5/*` routes (`handleApi`) + calls `resumeBatches()` on boot |
| `services/api.ts` | Client methods that call **our** backend (never Api2Trade) |
| `providers/app-provider.tsx` | MT5 session state (UUID) + trade orchestration (RSI RUN, news, indicators) |

---

## 2. Authentication & security

- Auth header is built **only** in `services/api2trade.ts` → `getAuthHeaders()`:
  `Authorization: Basic base64(API2TRADE_USERNAME:API2TRADE_PASSWORD)` (optional `x-api-key` fallback via `API2TRADE_API_KEY`).
- Credentials come from **environment variables**, never committed and never sent to the client.
- `services/api2trade.ts` is **server-only** — it must never be imported from client code.
- The client stores the **session UUID** on `MT5Account.uuid` (plus login/server for display).
- Sensitive endpoints (e.g. `AccountDetails`) are **not** proxied to the client.
- All Api2Trade requests are GET with a 30s `AbortController` timeout and `Accept: application/json`.

---

## 3. Api2Trade endpoints we use

Every call goes through `api2tradeGet(path, params)` in `services/api2trade.ts`.

| Api2Trade endpoint | Wrapper fn | Key params | Returns | Used for |
|---|---|---|---|---|
| `ConnectEx` | `connectEx` | `id, server, user, password` | session | **Connect** an MT5 account (creates the session under our UUID) |
| `Disconnect` | `disconnect` | `id` | message | **Disconnect** / tear down the session |
| `AccountSummary` | `getAccountSummary` | `id` | balance, equity, profit, margin, freeMargin, marginLevel, **leverage**, currency | **Validate connect** (leverage>0), live balance |
| `Account` | `getAccountInfo` | `id` | login, type, balance, leverage, email… | Account detail (`?detail=full`) |
| `SymbolList` | `getSymbolList` | `id` | `string[]` of broker symbols | **Broker symbol universe** (scanner picker, Quotes, quick-config) |
| `SymbolParams` | `getSymbolParams` | `id, symbol` | volumeMin/step/max, digits… | **Min/base lot** so orders aren't rejected `INVALID_VOLUME` |
| `PriceHistory` | `getPriceHistory` | `id, symbol, timeframe, from, to` | candles/closes | OHLC for RSI/indicator computation (client-side) |
| `GetQuote` | `getQuote` | `id, symbol` | bid/ask/last/volume | Single live quote |
| `GetQuoteMany` | `getQuoteMany` | `id, symbols[]` | `Quote[]` | Batch quotes (Quotes live prices) |
| `MarketWatchMany` | `getMarketWatch` | `id, symbols[]` | high/low/open/close/dailyChange/bid/ask/spread/volume | Market watch |
| `Search` | `searchBrokers` | `company=<query>` | broker/server list | **Broker search** (metatrader server picker) |
| `OpenedOrders` | `getOpenOrders` | `id` | `Order[]` (ticket, lots, orderType, symbol, comment…) | Open positions |
| `ClosedOrders` | `getClosedOrders` | `id` | `Order[]` | Trade history |
| `OrderSend` | `orderSend` | `id, symbol, operation, volume, comment?` | `Order` (with `ticket`) | **Open a trade** (manual, scanner, signal, batch) |
| `OrderClose` | `orderClose` | `id, ticket, lots?` | `Order` | **Close a trade** |
| `OrderModify` | `orderModify` | `id, ticket, stoploss, takeprofit, price?` | `Order` | Modify SL/TP |

**Defined but not used on the dedicated server:** `RegisterAccount` (dedicated server uses `ConnectEx`), `CheckConnect`, `OpenedOrder` (single by ticket), `AccountDetails` (server-only, never exposed). **No bulk-close endpoint exists** — CloseAll/OrderCloseAll all 404; close by looping tickets.

`operation` ∈ `Buy | Sell | BuyLimit | SellLimit | BuyStop | SellStop` (we use `Buy`/`Sell`).

---

## 4. Backend proxy routes (`/api/mt5/*`)

Each route attaches auth server-side and calls the wrapper. Dispatched from `server.ts` → `handleApi`.

| Route | Method | Query/Body | Api2Trade call(s) |
|---|---|---|---|
| `/api/mt5/connect` | `POST` `{server, login, password}` | generate UUID → `connectEx` → `getAccountSummary`; **reject (401) if leverage falsy** → `disconnect` | ConnectEx + AccountSummary |
| `/api/mt5/connect` | `DELETE` `?id=UUID` | `disconnect` | Disconnect |
| `/api/mt5/account` | `GET` `?id=UUID[&detail=full]` | `getAccountSummary` (+`getAccountInfo` when full) | AccountSummary / Account |
| `/api/mt5/orders` | `GET` `?id=UUID&type=open\|closed\|all` | `getOpenOrders` / `getClosedOrders` | OpenedOrders / ClosedOrders |
| `/api/mt5/trade` | `POST` `{id, action:open\|modify\|close, …}` | `orderSend` / `orderModify` / `orderClose` | OrderSend / Modify / Close |
| `/api/mt5/symbols` | `GET` `?id=UUID&action=list\|quote\|quotes\|watch\|params` | `getSymbolList` / `getQuote` / `getQuoteMany` / `getMarketWatch` / `getSymbolParams` | SymbolList / GetQuote(Many) / MarketWatch / SymbolParams |
| `/api/mt5/history` | `GET` `?id=&symbol=&timeframe=&…` | `getPriceHistory` | PriceHistory |
| `/api/mt5/brokers` | `GET` `?company=` | `searchBrokers` | Search |
| `/api/mt5/batch/start` | `POST` `{id, symbol, volume, count, intervalMinutes, comment}` | starts the server-side loop | OrderSend / OrderClose (looped) |
| `/api/mt5/batch/stop` | `POST` `{id}` | stops the loop, closes open legs | OrderClose |
| `/api/mt5/batch/status` | `GET` `?id=UUID` | current loop state | — |

*(EMC uses `/api/mt5/testflight/*` for the last three.)*

---

## 5. Client methods (`services/api.ts`)

These call **our backend** (`BASE_URL = EXPO_PUBLIC_API_BASE_URL || ''` → **empty = same-origin** on web, so `/api/mt5/*` hits the Bun server; set it for native builds):

`connectMT5`, `disconnectMT5`, `getMT5AccountSummary`, `getMT5Orders`, `sendMT5Trade`,
`getMT5Symbols`, `getMT5Quote`, `getMT5Quotes`, `getMT5MarketWatch`, `getMT5SymbolParams`,
`getMT5History`, `searchBrokers`, `startBatch`, `stopBatch`, `getBatchStatus`.

---

## 6. Feature flows

### Connect an MT5 account (`app/(tabs)/metatrader.tsx`)
1. User enters login + password (server fixed to the single broker, `RazorMarkets-Live`, or picked via `searchBrokers`).
2. `apiService.connectMT5(server, login, password)` → `POST /api/mt5/connect`.
3. Backend: `uuid = crypto.randomUUID()` → `ConnectEx` → `AccountSummary`. **If `leverage` is falsy/0 → disconnect + 401** (ConnectEx returns success even on wrong credentials, so this is the real validation).
4. On success the client stores `{uuid, login, password, server, connected:true}`.
   - **Keep the password** in `MT5Account` so the field stays filled after connect (it was being dropped → field blanked).
   - **Lock** login/password while connected; **single button toggles** LINK ⇄ DISCONNECT; **disconnect keeps** login/password/server so you can reconnect without retyping. (tradeport MT4 still uses the legacy WebView terminal; MT5 uses Api2Trade.)

### Broker symbols pull (Quotes, scanner picker, quick-config)
- `getMT5Symbols(uuid)` → `SymbolList`. Populate searchable pickers so users select the broker's **exact** symbol (e.g. `XAUUSD.mic`, `.US30.mic`).
- Quotes shows a flat list; optionally live green/red prices via `getMT5Quotes` (batch, poll ~3s).

### Scanner auto-execute (`app/(tabs)/scanner.tsx` or `index.tsx`)
- After a scan resolves to BUY/SELL, fire `count` × `sendMT5Trade({action:'open', symbol, operation, volume, comment})` **concurrently** via Api2Trade — **silently** (no WebView, no "EXECUTING TRADE…" banner).
- **Exact casing** (no `.toUpperCase()`), comma-safe lot (`String(x).replace(',', '.')`).

### Quick-start → batch loop (`index.tsx`)
- Pressing **START** opens a quick-config popup **every time** (symbol from account + lot + trades) → CONFIRM replaces any prior symbol, executes instantly, and starts the batch loop (§7). STOP → `stopBatch` (close + halt).

### RSI RUN auto-trader (EA-APEX, `providers/app-provider.tsx`)
- While the bot is active: every configured symbol traded by **RSI(14) on M1** — first pass immediate, then every 5 min. Silent.
- **Strict no-hedge:** each cycle fetches open positions, then **closes every position on the symbol whose direction ≠ the new RSI target** (opposite *or* a direction it can't read) **before** opening. Skips opening if already holding the target direction. Buy and Sell never run on the same symbol at once.

### Trade comment = the active robot name
- All executions (scanner, batch, RSI, news, indicators) stamp `eas[0]?.name` (the primary connected EA) as the MT5 order `comment`, **not** a platform label. Fallback `'Robot'`. Truncated to 31 chars.

---

## 7. Batch loop (`app/api/mt5/batch/engine.ts`)

A self-contained automated cycle that **runs on the backend**, so it keeps trading even when the app is **backgrounded or fully closed**.

**Behavior**
- Start → clean the symbol flat (`getOpenOrders` → close leftovers), pick a **random** first direction.
- Open the configured **number of trades** all in that direction (concurrent `orderSend`).
- Hold the **interval** (default **10 minutes**), then **close all → FLIP direction → reopen** the batch in the opposite direction. Loop indefinitely. (Whole batch is one direction per cycle; it flips each cycle. No hedge, never same side twice in a row.)
- Each order's `comment` = the robot/EA name (≤31 chars).
- **Stop** halts the loop and closes any open positions.

**Why server-side:** iOS suspends app JS ~30s after backgrounding and runs nothing when force-quit. The loop lives in `server.ts` keyed by the UUID; the app only calls start/stop and polls `status`.

**Reboot-safe (persistence + resume):**
- Each state change is saved to MySQL (table per app — see the top table). On boot, `resumeBatches()` (called from `server.ts` after `Bun.serve`) reloads active flights and continues them — catching up **one** flip if it was down past the interval, then normal cadence.
- **Keep-alive:** while a flight is active the engine self-pings `RENDER_EXTERNAL_URL/health` every ~4 min (external uptime pinger is the dependable anti-sleep on free tier).
- **PRODUCTION-GATED:** persistence + resume only run when `RENDER === 'true'` (or `BATCH_PERSIST=1` / EMC `TESTFLIGHT_PERSIST=1`). **This is critical** — local and prod share the same MySQL, so a local dev server would otherwise reload and **trade live production flights** (this actually happened once with EMC — a local boot closed/reopened 20 real `.US30.mic` orders). Locally the loop runs in-memory only.

**Endpoints:** `POST /api/mt5/batch/start|stop`, `GET /api/mt5/batch/status`.

---

## 8. Environment variables

Set on the server only (never `EXPO_PUBLIC_*`, which would bake them into the client bundle):

| Var | Required | Purpose |
|---|---|---|
| `API2TRADE_USERNAME` | **yes** (secret, no fallback) | Basic-auth username — every order fails without it |
| `API2TRADE_PASSWORD` | **yes** (secret, no fallback) | Basic-auth password |
| `API2TRADE_BASE_URL` | no (default `https://mt5.mt4api.dev`) | Api2Trade server |
| `API2TRADE_API_KEY` | no | `x-api-key` fallback if user/pass absent |
| `DB_HOST/USER/PASSWORD/NAME/PORT` | for batch persistence | MySQL (has a hardcoded fallback in `_db.ts`, but set them explicitly) |
| `EXPO_PUBLIC_API_BASE_URL` | native builds | URL of the Bun server the client calls for `/api/mt5/*` (empty on web = same-origin) |
| `RENDER`, `RENDER_EXTERNAL_URL` | auto-set by Render | enable the batch persistence gate + keep-alive self-ping automatically |

On Render: set the `API2TRADE_*` (and `DB_*`) as `sync:false` secrets in the dashboard. Without the `API2TRADE_*` pair the server throws *"Api2Trade credentials not configured"* and every order fails. Add an **external uptime pinger** to `<app>.onrender.com/health` (~5 min) for true 24/7.

> **Credentials are NOT recorded here.** Take every value from the Render
> dashboard (Environment). This file previously listed them inline; the
> Api2Trade password was rotated and the stale copy cost an hour of debugging a
> `403` that looked like an IP block. They also remain in this repo's git
> history, so the pairs that were published there should be treated as
> compromised and rotated.

---

## 9. Gotchas / lessons learned

- **Symbol casing is exact.** Broker symbols are case-sensitive with suffixes (`XAUUSD.mic`, `.US30.mic`). Do **not** uppercase before `OrderSend` — `XAUUSD.MIC` is rejected. This was a real scanner bug (`tradeSymbol.trim().toUpperCase()`).
- **Lot comma.** Locale keyboards enter `0,10`; `parseFloat("0,10") === 0` → fell back to `0.01` → below broker min → silent reject → "no trade". Always `String(x).replace(',', '.')` before `parseFloat`. Also floor volume to the broker min via `getSymbolParams` (min field varies: `volumeMin`/`minVolume`/`lotMin`/`minLot`/`tradeVolumeMin`).
- **Validate fills by ticket.** `OrderSend` returns HTTP 200 even on a broker rejection (e.g. `INVALID_VOLUME` for an index at 0.01). Treat as placed only if `Order.ticket > 0`.
- **Close needs the volume.** `OrderClose` must include `lots`, or the position doesn't close and opposites pile up. There's no bulk-close — loop tickets.
- **ConnectEx leverage trap.** ConnectEx returns success on wrong credentials but with `leverage = 0`; validate via `AccountSummary.leverage > 0`.
- **No-hedge = close-before-open.** Don't just *skip* opening the opposite; **close** every non-matching position on the symbol first (including ones whose direction you can't read), then open. Skipping left the old side open and could still hedge when direction detection failed.
- **Shared dev/prod DB.** Local and Render use the same MySQL. Gate batch persistence + resume to production (`RENDER`) or a local server will reload & TRADE live loops. Use a **distinct table name per app** (`eac_…`/`tp_…`/`emc_…`).
- **Missing-import crashes.** An icon/var referenced but not imported (`RefreshCw`, `activeTab`) only crashes on the render path that uses it → blank "Something went wrong". Run `bunx tsc --noEmit | grep "Cannot find name"` to catch them all at once (Metro doesn't typecheck, so the build won't flag them).
- **iOS input zoom / PWA.** Focus on a <16px field auto-zooms and a home-screen PWA won't zoom back → collapse to one `maximum-scale=1` viewport in `post-build.js`.
- **Deploy = env vars.** "Broker search fails / nothing trades" on the live app is almost always the `API2TRADE_*` (or `DB_*`) env vars not set in the Render dashboard.
