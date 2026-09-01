//+------------------------------------------------------------------+
//|                                                  NTS Super AI    |
//|                                                  NTSSuperAI.mq5  |
//+------------------------------------------------------------------+
//
// WHAT THIS IS
// ------------
// The same rules the app runs on its server, moved into an EA so
// they run on the chart it is attached to. Attach it, allow algo trading, and
// it trades the direction of the moving averages exactly as the app does.
//
// The maths is ported line for line from:
//   app/api/mt5/strategy/indicators.ts   ema(), atr(), decide()
//   app/api/mt5/strategy/risk.ts         stopPrice(), targetPrice(), trailTo()
//   app/api/mt5/strategy/engine.ts       the always-in / gated evaluation
//
// EMA and ATR are computed here rather than with iMA/iATR on purpose. The
// built-ins seed differently, and this file has to agree with the server's
// numbers, not merely be a reasonable moving average.
//
// TWO MODES, matching the server
// ------------------------------
// AlwaysIn = true  (the server's default)
//     Hold whichever way the EMAs point, at all times. No standing aside for
//     ranges, no entry gates. A genuine cross reverses the position. This is
//     what the app does out of the box.
//
// AlwaysIn = false
//     The strict gated rules: an entry needs EMA separation above AtrMult x
//     ATR, confirmation over ConfirmBars, and agreement from the higher
//     timeframe. Exits are deliberately looser than entries (ExitMult is half
//     of AtrMult) so a position near the boundary does not close and reopen on
//     noise. If the gates produce nothing for GraceWindowMinutes, it enters on
//     the bare EMA direction instead.
//
// SAFETY
// ------
// Decisions are taken on CLOSED bars only. Reversals always go through a flat
// account, verified, so long and short can never be open together. Every order
// carries a stop from the moment it is sent, never added afterwards.
//
#property copyright "NTS Super AI"
#property description "NTS Super AI"
#property description "Trades the direction of the moving averages."
#property version   "1.00"
#property strict

#resource "NTSSuperAI.bmp"

#include <Trade\Trade.mqh>
#include <Trade\PositionInfo.mqh>

//====================================================================
// INPUTS — defaults are the server's defaults
//====================================================================
input group           "=== Trading ==="
input bool            EnableTrading      = true;   // Trade when attached
input double          Lots               = 0.01;   // Volume per order
input int             OrdersPerEntry     = 1;      // count: orders opened per entry
input long            MagicNumber        = 20260830;
input int             SlippagePoints     = 20;

input group           "=== Direction ==="
input bool            AlwaysIn           = true;   // Hold the EMA direction at all times
input ENUM_TIMEFRAMES SignalTimeframe    = PERIOD_M15;
input ENUM_TIMEFRAMES HigherTimeframe    = PERIOD_H1;
input int             FastEma            = 21;
input int             SlowEma            = 55;
input int             HtfEma             = 200;    // higher-timeframe trend filter
input int             AtrPeriod          = 14;

input group           "=== Entry gates (ignored when AlwaysIn) ==="
input double          AtrMult            = 0.25;   // separation needed to ENTER, x ATR
input double          ExitMult           = 0.125;  // separation needed to STAY IN, x ATR
input int             ConfirmBars        = 1;      // bars the direction must persist
input int             GraceWindowMinutes = 10;     // 0 disables the fallback entry
input bool            FlatWhenNoSignal   = true;   // close when the position stops qualifying
input bool            ReenterEachBar     = false;  // diagnostic: re-enter every bar

input group           "=== Protection ==="
input double          SlAtrMult          = 1.5;    // stop distance, x ATR. 0 = no stop
input double          TpAtrMult          = 3.0;    // target distance, x ATR. 0 = none
input double          TrailStartAtr      = 1.0;    // profit before trailing starts, x ATR
input double          TrailAtr           = 1.0;    // trail distance, x ATR. 0 = no trailing

input group           "=== Breakers (0 disables) ==="
input double          MaxDailyLoss       = 0;      // account currency, positive number
input int             MaxConsecLosses    = 0;
input int             FridayFlatHourUtc  = 0;      // flatten from this hour on Friday

input group           "=== Advanced ==="
input int             HistoryBars        = 500;    // bars used to warm the EMAs
input bool            VerboseLog         = true;

//--------------------------------------------------------------------
// How the logo is fitted to the chart.
//   COVER   fills every pixel, cropping whatever overflows. Nothing is
//           letterboxed, which is what "fill the screen" usually means.
//   FIT     shows the whole logo, with empty margins on two sides.
//   STRETCH fills exactly, at the cost of distorting the artwork.
//--------------------------------------------------------------------
enum ENUM_LOGO_FILL
{
   LOGO_COVER   = 0,   // Cover: fill the chart, crop the overflow
   LOGO_FIT     = 1,   // Fit: whole logo, letterboxed
   LOGO_STRETCH = 2    // Stretch: fill exactly, distorts
};

input group           "=== Branding ==="
input bool            ShowLogo           = true;        // Fill the chart with the NTS logo
input ENUM_LOGO_FILL  LogoFill           = LOGO_COVER;  // How it fills the chart
input int             LogoOpacity        = 100;         // 0 invisible .. 100 solid

//====================================================================
// STATE
//====================================================================
CTrade         trade;
CPositionInfo  pos;

datetime g_lastBar      = 0;      // last CLOSED bar we acted on
datetime g_flatSince    = 0;      // when we last became flat (grace window)
bool     g_halted       = false;
string   g_haltReason   = "";
double   g_atrCache     = 0;      // ATR at the last evaluation, for trailing

//====================================================================
// INDICATOR MATHS — ported to agree with the server exactly
//====================================================================

// Exponential moving average, seeded with the SMA of the first `period`
// values then smoothed. NaN-equivalent (0 + false) before the seed.
bool EmaSeries(const double &values[], const int period, double &out[])
{
   int n = ArraySize(values);
   ArrayResize(out, n);
   ArrayInitialize(out, 0.0);
   if(period <= 0 || n < period) return false;

   double sum = 0.0;
   for(int i = 0; i < period; i++) sum += values[i];
   out[period - 1] = sum / period;

   double k = 2.0 / (period + 1.0);
   for(int i = period; i < n; i++)
      out[i] = values[i] * k + out[i - 1] * (1.0 - k);
   return true;
}

// Wilder's ATR over the same candles the EMAs used.
bool AtrSeries(const MqlRates &rates[], const int period, double &out[])
{
   int n = ArraySize(rates);
   ArrayResize(out, n);
   ArrayInitialize(out, 0.0);
   if(n < period + 1) return false;

   double tr[];
   ArrayResize(tr, n);
   ArrayInitialize(tr, 0.0);
   for(int i = 1; i < n; i++)
   {
      double prevClose = rates[i - 1].close;
      double a = rates[i].high - rates[i].low;
      double b = MathAbs(rates[i].high - prevClose);
      double c = MathAbs(rates[i].low  - prevClose);
      tr[i] = MathMax(a, MathMax(b, c));
   }

   double sum = 0.0;
   for(int i = 1; i <= period; i++) sum += tr[i];
   out[period] = sum / period;
   for(int i = period + 1; i < n; i++)
      out[i] = (out[i - 1] * (period - 1) + tr[i]) / period;
   return true;
}

//====================================================================
// DATA
//====================================================================

// Closed bars only, oldest first — the forming bar is excluded because its
// range is incomplete and would flicker the signal.
bool ClosedBars(const ENUM_TIMEFRAMES tf, const int count, MqlRates &rates[])
{
   ArraySetAsSeries(rates, false);
   int got = CopyRates(_Symbol, tf, 1, count, rates);   // start at shift 1
   return (got > 0 && ArraySize(rates) >= 2);
}

//====================================================================
// SIGNAL — a port of decide()
//====================================================================
struct Signal
{
   int      dir;        // +1 buy, -1 sell, 0 none
   int      raw;        // bare EMA lean, every veto ignored
   string   action;     // enter | hold | exit | reverse | none
   string   reason;
   double   fast, slow, atr, separation, required, exitLevel, htf, price;
   bool     ready;
};

// Forward declaration: Decide() calls this before it is defined.
Signal EntrySignal(const Signal &base, const bool haveHtf);

Signal Decide(const int held)   // held: +1 / -1 / 0
{
   Signal s;
   s.dir = 0; s.raw = 0; s.action = "none"; s.reason = "";
   s.fast = 0; s.slow = 0; s.atr = 0; s.separation = 0;
   s.required = 0; s.exitLevel = 0; s.htf = 0; s.price = 0; s.ready = false;

   MqlRates bars[], htfBars[];
   int need = MathMax(SlowEma, AtrPeriod + 1) + ConfirmBars + 5;
   int want = (int)MathMax(need, HistoryBars);
   if(!ClosedBars(SignalTimeframe, want, bars))
   { s.reason = "no price history"; return s; }

   int n = ArraySize(bars);
   if(n < need) { s.reason = StringFormat("need %d closed bars, have %d", need, n); return s; }

   double closes[];
   ArrayResize(closes, n);
   for(int i = 0; i < n; i++) closes[i] = bars[i].close;

   double f[], sl[], a[];
   if(!EmaSeries(closes, FastEma, f) || !EmaSeries(closes, SlowEma, sl) || !AtrSeries(bars, AtrPeriod, a))
   { s.reason = "indicators not warmed up"; return s; }

   int i = n - 1;
   if(f[i] == 0.0 || sl[i] == 0.0 || a[i] <= 0.0)
   { s.reason = "indicators not warmed up"; return s; }

   s.fast       = f[i];
   s.slow       = sl[i];
   s.atr        = a[i];
   s.price      = closes[i];
   s.separation = MathAbs(f[i] - sl[i]);
   s.required   = AtrMult  * a[i];
   s.exitLevel  = ExitMult * a[i];
   s.raw        = (f[i] > sl[i]) ? 1 : -1;
   s.ready      = true;

   // Higher-timeframe trend filter.
   bool haveHtf = false;
   if(ClosedBars(HigherTimeframe, (int)MathMax(HtfEma + 5, HistoryBars), htfBars))
   {
      int hn = ArraySize(htfBars);
      if(hn >= HtfEma)
      {
         double hcloses[]; ArrayResize(hcloses, hn);
         for(int j = 0; j < hn; j++) hcloses[j] = htfBars[j].close;
         double h[];
         if(EmaSeries(hcloses, HtfEma, h) && h[hn - 1] != 0.0)
         { s.htf = h[hn - 1]; haveHtf = true; }
      }
   }

   // ── Holding something: the LOOSE exit tests ─────────────────────────
   if(held != 0)
   {
      if(s.raw != held)
      {
         Signal entry = EntrySignal(s, haveHtf);
         if(entry.dir != 0)
         {
            entry.action = "reverse";
            entry.reason = "reverse — EMAs crossed against the position. " + entry.reason;
            return entry;
         }
         s.dir = 0; s.action = "exit";
         s.reason = "exit — EMAs crossed against the position";
         return s;
      }
      if(s.separation < s.exitLevel)
      {
         s.dir = 0; s.action = "exit";
         s.reason = StringFormat("exit — separation collapsed (%.5f < %.5f)", s.separation, s.exitLevel);
         return s;
      }
      if(haveHtf && ((held == 1 && s.price < s.htf) || (held == -1 && s.price > s.htf)))
      {
         s.dir = 0; s.action = "exit";
         s.reason = "exit — higher timeframe turned against it";
         return s;
      }
      s.dir = held; s.action = "hold";
      s.reason = StringFormat("hold — separation %.5f still above exit floor %.5f", s.separation, s.exitLevel);
      return s;
   }

   // ── Flat: the STRICT entry tests ────────────────────────────────────
   Signal e = EntrySignal(s, haveHtf);
   if(e.dir != 0) e.action = "enter";
   return e;
}

// The three entry gates. Any one of them vetoes.
Signal EntrySignal(const Signal &base, const bool haveHtf)
{
   Signal s = base;
   s.dir = 0; s.action = "none";

   if(s.separation < s.required)
   {
      s.reason = StringFormat("EMAs too close (%.5f < %.5f) — ranging", s.separation, s.required);
      return s;
   }

   // The direction must have held for ConfirmBars closed bars.
   if(ConfirmBars > 0)
   {
      MqlRates bars[];
      int need = MathMax(SlowEma, AtrPeriod + 1) + ConfirmBars + 5;
      if(!ClosedBars(SignalTimeframe, (int)MathMax(need, HistoryBars), bars))
      { s.reason = "not enough history to confirm"; return s; }
      int n = ArraySize(bars);
      double closes[]; ArrayResize(closes, n);
      for(int i = 0; i < n; i++) closes[i] = bars[i].close;
      double f[], sl[];
      if(!EmaSeries(closes, FastEma, f) || !EmaSeries(closes, SlowEma, sl))
      { s.reason = "not enough history to confirm"; return s; }

      int last = n - 1;
      for(int b = 1; b <= ConfirmBars; b++)
      {
         int j = last - b;
         if(j < 0 || f[j] == 0.0 || sl[j] == 0.0)
         { s.reason = "not enough history to confirm"; return s; }
         int prior = (f[j] > sl[j]) ? 1 : -1;
         if(prior != s.raw)
         {
            s.reason = StringFormat("direction not confirmed — flipped %d bar(s) ago", b);
            return s;
         }
      }
   }

   if(!haveHtf) { s.reason = "higher-timeframe EMA not available"; return s; }
   if(s.raw == 1 && s.price < s.htf)
   { s.reason = StringFormat("Buy blocked — price %.5f below HTF EMA %.5f", s.price, s.htf); return s; }
   if(s.raw == -1 && s.price > s.htf)
   { s.reason = StringFormat("Sell blocked — price %.5f above HTF EMA %.5f", s.price, s.htf); return s; }

   s.dir = s.raw;
   s.action = "enter";
   s.reason = StringFormat("%s: separation %.5f (needed %.5f), with HTF trend",
                           s.raw == 1 ? "Buy" : "Sell", s.separation, s.required);
   return s;
}

//====================================================================
// POSITIONS
//====================================================================
int HeldDirection()   // +1 / -1 / 0, and 0 if hedged (both sides open)
{
   bool hasBuy = false, hasSell = false;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      if(!pos.SelectByIndex(i)) continue;
      if(pos.Symbol() != _Symbol || pos.Magic() != MagicNumber) continue;
      if(pos.PositionType() == POSITION_TYPE_BUY) hasBuy = true; else hasSell = true;
   }
   if(hasBuy && hasSell) return 0;   // hedged — treated as "not what we want"
   if(hasBuy)  return 1;
   if(hasSell) return -1;
   return 0;
}

int OpenCount()
{
   int n = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      if(!pos.SelectByIndex(i)) continue;
      if(pos.Symbol() == _Symbol && pos.Magic() == MagicNumber) n++;
   }
   return n;
}

bool IsHedged()
{
   bool hasBuy = false, hasSell = false;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      if(!pos.SelectByIndex(i)) continue;
      if(pos.Symbol() != _Symbol || pos.Magic() != MagicNumber) continue;
      if(pos.PositionType() == POSITION_TYPE_BUY) hasBuy = true; else hasSell = true;
   }
   return (hasBuy && hasSell);
}

// Close everything on this symbol and PROVE it went flat. Mirrors the
// server's closeUntilFlat: never assumes, retries, reports failure.
bool CloseUntilFlat()
{
   for(int pass = 1; pass <= 4; pass++)
   {
      for(int i = PositionsTotal() - 1; i >= 0; i--)
      {
         if(!pos.SelectByIndex(i)) continue;
         if(pos.Symbol() != _Symbol || pos.Magic() != MagicNumber) continue;
         if(!trade.PositionClose(pos.Ticket(), SlippagePoints))
            PrintFormat("[NTS Super AI] close %I64u failed: %d %s",
                        pos.Ticket(), trade.ResultRetcode(), trade.ResultRetcodeDescription());
      }
      Sleep(300 * pass);
      if(OpenCount() == 0) return true;
      PrintFormat("[NTS Super AI] still %d open after pass %d — re-closing", OpenCount(), pass);
   }
   return (OpenCount() == 0);
}

//====================================================================
// PROTECTION
//====================================================================

// Broker minimum stop distance. A level inside it is rejected outright, so
// clamping here is the difference between a stop and no stop at all.
double MinStopDistance()
{
   long stopLevel = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL);
   double point   = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
   double spread  = (double)SymbolInfoInteger(_Symbol, SYMBOL_SPREAD) * point;
   return MathMax((double)stopLevel * point, spread) * 1.1;
}

void LevelsFor(const int dir, const double refPrice, const double atrValue,
               double &sl, double &tp)
{
   int digits = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
   sl = 0.0; tp = 0.0;
   if(atrValue <= 0.0) return;

   double minDist = MinStopDistance();

   if(SlAtrMult > 0.0)
   {
      double d = MathMax(atrValue * SlAtrMult, minDist);
      sl = NormalizeDouble(dir == 1 ? refPrice - d : refPrice + d, digits);
   }
   if(TpAtrMult > 0.0)
   {
      double d = MathMax(atrValue * TpAtrMult, minDist);
      tp = NormalizeDouble(dir == 1 ? refPrice + d : refPrice - d, digits);
   }
}

// Re-place the levels against the ACTUAL fill, the way the server refines
// after the send.
void RefineToFill(const double atrValue)
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      if(!pos.SelectByIndex(i)) continue;
      if(pos.Symbol() != _Symbol || pos.Magic() != MagicNumber) continue;

      int dir = (pos.PositionType() == POSITION_TYPE_BUY) ? 1 : -1;
      double sl, tp;
      LevelsFor(dir, pos.PriceOpen(), atrValue, sl, tp);
      if(sl == 0.0 && tp == 0.0) continue;
      if(MathAbs(pos.StopLoss() - sl) < _Point && MathAbs(pos.TakeProfit() - tp) < _Point) continue;

      if(!trade.PositionModify(pos.Ticket(), sl, tp))
         PrintFormat("[NTS Super AI] WARNING: could not set stop on %I64u: %d %s",
                     pos.Ticket(), trade.ResultRetcode(), trade.ResultRetcodeDescription());
   }
}

// Move the stop up behind a winner. Never backwards, never past entry.
void UpdateTrailing(const double atrValue)
{
   if(TrailAtr <= 0.0 || atrValue <= 0.0) return;
   int digits = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
   double minDist = MinStopDistance();

   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      if(!pos.SelectByIndex(i)) continue;
      if(pos.Symbol() != _Symbol || pos.Magic() != MagicNumber) continue;

      int    dir     = (pos.PositionType() == POSITION_TYPE_BUY) ? 1 : -1;
      double entry   = pos.PriceOpen();
      double current = (dir == 1) ? SymbolInfoDouble(_Symbol, SYMBOL_BID)
                                  : SymbolInfoDouble(_Symbol, SYMBOL_ASK);

      double profit = (dir == 1) ? current - entry : entry - current;
      if(profit < atrValue * TrailStartAtr) continue;

      double candidate = NormalizeDouble(dir == 1 ? current - atrValue * TrailAtr
                                                  : current + atrValue * TrailAtr, digits);

      // Respect the broker's minimum distance from the market.
      if(dir == 1  && current - candidate < minDist) candidate = NormalizeDouble(current - minDist, digits);
      if(dir == -1 && candidate - current < minDist) candidate = NormalizeDouble(current + minDist, digits);

      double existing = pos.StopLoss();
      if(existing > 0.0)
      {
         bool better = (dir == 1) ? candidate > existing : candidate < existing;
         if(!better) continue;
      }
      // Never trail to the losing side of entry.
      bool beyondEntry = (dir == 1) ? candidate < entry : candidate > entry;
      if(beyondEntry) continue;

      if(!trade.PositionModify(pos.Ticket(), candidate, pos.TakeProfit()))
         PrintFormat("[NTS Super AI] trail on %I64u failed: %d", pos.Ticket(), trade.ResultRetcode());
      else if(VerboseLog)
         PrintFormat("[NTS Super AI] trailing stop -> %s", DoubleToString(candidate, digits));
   }
}

//====================================================================
// ENTRY
//====================================================================
double NormalizedLots()
{
   double minLot  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double maxLot  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   double stepLot = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   double v = Lots;
   if(stepLot > 0) v = MathRound(v / stepLot) * stepLot;
   v = MathMax(minLot, MathMin(maxLot, v));
   return NormalizeDouble(v, 2);
}

// Open `OrdersPerEntry` orders, each carrying its stop from the moment it is
// sent. The server does the same: a stop added afterwards leaves a window
// where the position is live and naked.
void OpenDirection(const int dir, const double atrValue)
{
   double volume = NormalizedLots();
   double ref    = (dir == 1) ? SymbolInfoDouble(_Symbol, SYMBOL_ASK)
                              : SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double sl, tp;
   LevelsFor(dir, ref, atrValue, sl, tp);

   if(sl == 0.0 && SlAtrMult > 0.0)
      Print("[NTS Super AI] WARNING: opening with no stop — no ATR to size one from");

   int opened = 0;
   int orders = (int)MathMax(1, OrdersPerEntry);
   for(int k = 0; k < orders; k++)
   {
      bool ok = (dir == 1)
         ? trade.Buy(volume, _Symbol, 0.0, sl, tp, "NTS Super AI")
         : trade.Sell(volume, _Symbol, 0.0, sl, tp, "NTS Super AI");
      if(ok) opened++;
      else PrintFormat("[NTS Super AI] order %d/%d rejected: %d %s",
                       k + 1, orders, trade.ResultRetcode(), trade.ResultRetcodeDescription());
   }

   PrintFormat("[NTS Super AI] opened %d/%d %s %s @ stop %s target %s",
               opened, orders, dir == 1 ? "Buy" : "Sell", _Symbol,
               DoubleToString(sl, _Digits), DoubleToString(tp, _Digits));

   // Now that the fills are known, put the levels exactly where they belong.
   if(opened > 0) RefineToFill(atrValue);
}

//====================================================================
// BREAKERS
//====================================================================
double RealisedToday()
{
   datetime dayStart = (datetime)(TimeCurrent() - (TimeCurrent() % 86400));
   if(!HistorySelect(dayStart, TimeCurrent())) return 0.0;
   double total = 0.0;
   for(int i = HistoryDealsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = HistoryDealGetTicket(i);
      if(ticket == 0) continue;
      if(HistoryDealGetInteger(ticket, DEAL_ENTRY) != DEAL_ENTRY_OUT) continue;
      if(HistoryDealGetInteger(ticket, DEAL_MAGIC) != MagicNumber) continue;
      total += HistoryDealGetDouble(ticket, DEAL_PROFIT)
             + HistoryDealGetDouble(ticket, DEAL_SWAP)
             + HistoryDealGetDouble(ticket, DEAL_COMMISSION);
   }
   return total;
}

int ConsecutiveLosses()
{
   if(!HistorySelect(TimeCurrent() - 30 * 86400, TimeCurrent())) return 0;
   int streak = 0;
   for(int i = HistoryDealsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = HistoryDealGetTicket(i);
      if(ticket == 0) continue;
      if(HistoryDealGetInteger(ticket, DEAL_ENTRY) != DEAL_ENTRY_OUT) continue;
      if(HistoryDealGetInteger(ticket, DEAL_MAGIC) != MagicNumber) continue;
      double net = HistoryDealGetDouble(ticket, DEAL_PROFIT)
                 + HistoryDealGetDouble(ticket, DEAL_SWAP)
                 + HistoryDealGetDouble(ticket, DEAL_COMMISSION);
      if(net < 0) streak++; else break;
   }
   return streak;
}

string BreachedLimits()
{
   if(MaxDailyLoss <= 0 && MaxConsecLosses <= 0) return "";
   if(MaxDailyLoss > 0)
   {
      double realised = RealisedToday();
      if(realised <= -MathAbs(MaxDailyLoss))
         return StringFormat("daily loss cap hit (%.2f today, limit %.2f)", realised, MaxDailyLoss);
   }
   if(MaxConsecLosses > 0)
   {
      int streak = ConsecutiveLosses();
      if(streak >= MaxConsecLosses)
         return StringFormat("%d losing trades in a row (limit %d)", streak, MaxConsecLosses);
   }
   return "";
}

// Friday flatten, judged in UTC like the server.
bool IsWeekendFlat()
{
   if(FridayFlatHourUtc <= 0) return false;
   MqlDateTime t;
   TimeGMT(t);
   if(t.day_of_week == 6 || t.day_of_week == 0) return true;
   return (t.day_of_week == 5 && t.hour >= FridayFlatHourUtc);
}

//====================================================================
// LIFECYCLE
//====================================================================
//====================================================================
// BRANDING - the full-chart backdrop
//====================================================================
//
// MetaTrader will not scale a bitmap object for us: OBJ_BITMAP_LABEL draws an
// image at its own pixel size and crops the rest. So the artwork is resampled
// here into a resource built to the exact size of the window, and rebuilt
// whenever that window changes size.
//
// Price data is moved to the chart FOREGROUND while the backdrop is up, so the
// candles draw on top of the logo. The chart stays readable over the branding
// instead of being hidden behind it.

#define LOGO_OBJ "NTS_SuperAI_Backdrop"
#define LOGO_RES "::NTSLogoScaled"

bool g_logoUp   = false;
bool g_fgSaved  = false;
long g_fgWas    = 0;
int  g_logoW    = 0;
int  g_logoH    = 0;

// Bilinear sample, so scaling the artwork up stays smooth rather than going
// blocky the way nearest-neighbour would.
uint LogoSample(const uint &src[], const int sw, const int sh,
                const double fx, const double fy)
{
   int x0 = (int)MathFloor(fx);
   int y0 = (int)MathFloor(fy);
   double tx = fx - x0;
   double ty = fy - y0;
   int x1 = x0 + 1;
   int y1 = y0 + 1;

   if(x0 < 0) x0 = 0;
   if(y0 < 0) y0 = 0;
   if(x1 < 0) x1 = 0;
   if(y1 < 0) y1 = 0;
   if(x0 > sw - 1) x0 = sw - 1;
   if(y0 > sh - 1) y0 = sh - 1;
   if(x1 > sw - 1) x1 = sw - 1;
   if(y1 > sh - 1) y1 = sh - 1;

   uint p00 = src[y0 * sw + x0];
   uint p10 = src[y0 * sw + x1];
   uint p01 = src[y1 * sw + x0];
   uint p11 = src[y1 * sw + x1];

   uint outPix = 0;
   for(int c = 0; c < 4; c++)
   {
      int sft = c * 8;
      double top = ((p00 >> sft) & 0xFF) * (1.0 - tx) + ((p10 >> sft) & 0xFF) * tx;
      double bot = ((p01 >> sft) & 0xFF) * (1.0 - tx) + ((p11 >> sft) & 0xFF) * tx;
      double v   = top * (1.0 - ty) + bot * ty;
      int    iv  = (int)MathRound(v);
      if(iv < 0)   iv = 0;
      if(iv > 255) iv = 255;
      outPix |= (((uint)iv) << sft);
   }
   return outPix;
}

bool LogoDraw()
{
   if(!ShowLogo) return false;

   uint src[];
   uint sw = 0, sh = 0;
   if(!ResourceReadImage("::NTSSuperAI.bmp", src, sw, sh))
   {
      Print("[NTS Super AI] logo artwork could not be read");
      return false;
   }

   int cw = (int)ChartGetInteger(0, CHART_WIDTH_IN_PIXELS);
   int ch = (int)ChartGetInteger(0, CHART_HEIGHT_IN_PIXELS);
   if(cw < 8 || ch < 8) return false;

   // Cover takes the LARGER ratio so no gap is left anywhere; fit takes the
   // smaller so nothing is cut off; stretch scales each axis on its own.
   double sxs, sys;
   if(LogoFill == LOGO_STRETCH)
   {
      sxs = (double)cw / (double)sw;
      sys = (double)ch / (double)sh;
   }
   else
   {
      double rx = (double)cw / (double)sw;
      double ry = (double)ch / (double)sh;
      double k  = (LogoFill == LOGO_COVER) ? MathMax(rx, ry) : MathMin(rx, ry);
      sxs = k;
      sys = k;
   }

   double drawW = sw * sxs;
   double drawH = sh * sys;
   double offX  = (cw - drawW) / 2.0;   // centred, so a cover crop takes
   double offY  = (ch - drawH) / 2.0;   // evenly from both sides

   int op = LogoOpacity;
   if(op < 0)   op = 0;
   if(op > 100) op = 100;

   uint dst[];
   if(ArrayResize(dst, cw * ch) != cw * ch) return false;

   for(int y = 0; y < ch; y++)
   {
      for(int x = 0; x < cw; x++)
      {
         double fx = (x - offX) / sxs;
         double fy = (y - offY) / sys;

         // The artwork is flattened to full opacity when it is built, so the
         // alpha channel here carries nothing but the user opacity, and zero
         // outside the image. The source alpha is deliberately NOT sampled:
         // reading it back and letting the terminal divide colour by it is
         // what banded the gradient.
         bool inside = (fx >= 0.0 && fy >= 0.0 && fx <= sw - 1 && fy <= sh - 1);
         uint px = inside ? LogoSample(src, (int)sw, (int)sh, fx, fy) : 0;
         uint a  = inside ? (uint)((255 * op) / 100) : 0;
         dst[y * cw + x] = (px & 0x00FFFFFF) | (a << 24);
      }
   }

   // Release the previous bitmap before building the next one. Creating
   // over a live resource of the same name is what let each redraw stack
   // on the last one, so the picture degraded the longer it ran.
   ResourceFree(LOGO_RES);
   if(!ResourceCreate(LOGO_RES, dst, cw, ch, 0, 0, cw, COLOR_FORMAT_ARGB_RAW))
   {
      Print("[NTS Super AI] could not build the scaled backdrop");
      return false;
   }

   if(ObjectFind(0, LOGO_OBJ) < 0)
   {
      ObjectCreate(0, LOGO_OBJ, OBJ_BITMAP_LABEL, 0, 0, 0);
      ObjectSetInteger(0, LOGO_OBJ, OBJPROP_CORNER,     CORNER_LEFT_UPPER);
      ObjectSetInteger(0, LOGO_OBJ, OBJPROP_XDISTANCE,  0);
      ObjectSetInteger(0, LOGO_OBJ, OBJPROP_YDISTANCE,  0);
      ObjectSetInteger(0, LOGO_OBJ, OBJPROP_BACK,       true);
      ObjectSetInteger(0, LOGO_OBJ, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, LOGO_OBJ, OBJPROP_SELECTED,   false);
      ObjectSetInteger(0, LOGO_OBJ, OBJPROP_HIDDEN,     true);
      ObjectSetInteger(0, LOGO_OBJ, OBJPROP_ZORDER,     0);
   }
   ObjectSetString (0, LOGO_OBJ, OBJPROP_BMPFILE, LOGO_RES);
   ObjectSetInteger(0, LOGO_OBJ, OBJPROP_XSIZE,   cw);
   ObjectSetInteger(0, LOGO_OBJ, OBJPROP_YSIZE,   ch);

   g_logoW  = cw;
   g_logoH  = ch;
   g_logoUp = true;
   return true;
}

void LogoAttach()
{
   if(!ShowLogo) return;
   if(!g_fgSaved)
   {
      g_fgWas   = ChartGetInteger(0, CHART_FOREGROUND);
      g_fgSaved = true;
   }
   ChartSetInteger(0, CHART_FOREGROUND, true);   // candles over the logo
   LogoDraw();
   ChartRedraw();
}

void LogoDetach()
{
   ObjectDelete(0, LOGO_OBJ);
   ResourceFree(LOGO_RES);
   if(g_fgSaved)
   {
      ChartSetInteger(0, CHART_FOREGROUND, g_fgWas);
      g_fgSaved = false;
   }
   g_logoUp = false;
   ChartRedraw();
}

// The chart-change event also fires on every scroll and zoom, so the backdrop
// is only rebuilt when the window has actually changed SIZE.
void OnChartEvent(const int id, const long &lparam, const double &dparam, const string &sparam)
{
   if(id != CHARTEVENT_CHART_CHANGE || !ShowLogo) return;
   int cw = (int)ChartGetInteger(0, CHART_WIDTH_IN_PIXELS);
   int ch = (int)ChartGetInteger(0, CHART_HEIGHT_IN_PIXELS);
   if(cw != g_logoW || ch != g_logoH)
   {
      LogoDraw();
      ChartRedraw();
   }
}

int OnInit()
{
   trade.SetExpertMagicNumber(MagicNumber);
   trade.SetDeviationInPoints(SlippagePoints);
   trade.SetTypeFillingBySymbol(_Symbol);
   g_flatSince = TimeCurrent();

   LogoAttach();

   if(ExitMult >= AtrMult && !AlwaysIn)
      Print("[NTS Super AI] WARNING: ExitMult should be below AtrMult, or positions will "
            "flicker at the boundary. The server defaults to half.");

   PrintFormat("[NTS Super AI] attached to %s. Mode: %s. EMA%d/%d on %s, HTF EMA%d on %s. "
               "%d order(s) @ %.2f, stop %.2fxATR, target %.2fxATR",
               _Symbol, AlwaysIn ? "always-in" : "gated",
               FastEma, SlowEma, EnumToString(SignalTimeframe),
               HtfEma, EnumToString(HigherTimeframe),
               OrdersPerEntry, Lots, SlAtrMult, TpAtrMult);
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   LogoDetach();
   PrintFormat("[NTS Super AI] detached from %s (reason %d). Open positions are LEFT AS THEY ARE.",
               _Symbol, reason);
}

void OnTick()
{
   if(!EnableTrading) return;
   if(g_halted) return;
   if(!MQLInfoInteger(MQL_TRADE_ALLOWED) || !TerminalInfoInteger(TERMINAL_TRADE_ALLOWED)) return;

   Signal sig = Decide(HeldDirection());
   if(sig.atr > 0) g_atrCache = sig.atr;

   // Breakers first, so a breached cap can't be followed by one more trade.
   string breach = BreachedLimits();
   if(breach != "")
   {
      g_halted = true; g_haltReason = breach;
      CloseUntilFlat();
      PrintFormat("[NTS Super AI] HALTED — %s", breach);
      return;
   }

   // Weekend: be flat, stay flat.
   if(IsWeekendFlat())
   {
      if(OpenCount() > 0) { CloseUntilFlat(); Print("[NTS Super AI] flat for the weekend"); }
      return;
   }

   // A hedge should be impossible, but if one appears, clear it before anything else.
   if(IsHedged())
   {
      Print("[NTS Super AI] HEDGE DETECTED — clearing before trading");
      CloseUntilFlat();
      return;
   }

   // Trail on every tick: the stop should follow price, and price moves
   // between bars.
   if(OpenCount() > 0) UpdateTrailing(g_atrCache);

   if(!sig.ready) return;

   // Act only on a newly closed bar. Between bars nothing can have changed.
   datetime barTime = iTime(_Symbol, SignalTimeframe, 1);
   if(barTime == g_lastBar) return;
   g_lastBar = barTime;

   int held = HeldDirection();

   //── ALWAYS-IN ────────────────────────────────────────────────────────
   if(AlwaysIn)
   {
      int target = sig.raw;
      if(target == 0) return;

      if(held == target && OpenCount() > 0 && !ReenterEachBar)
         return;                                  // already holding it

      if(OpenCount() > 0 && !CloseUntilFlat())
      {
         Print("[NTS Super AI] could not prove flat — NOT opening");
         return;
      }
      OpenDirection(target, sig.atr);
      g_flatSince = TimeCurrent();
      return;
   }

   //── GATED ────────────────────────────────────────────────────────────
   if(sig.action == "exit")
   {
      if(!FlatWhenNoSignal) return;
      CloseUntilFlat();
      g_flatSince = TimeCurrent();
      PrintFormat("[NTS Super AI] EXIT — %s", sig.reason);
      return;
   }

   if(sig.action == "reverse")
   {
      if(!CloseUntilFlat()) { Print("[NTS Super AI] reverse withheld — not flat"); return; }
      OpenDirection(sig.dir, sig.atr);
      g_flatSince = TimeCurrent();
      return;
   }

   if(sig.action == "enter")
   {
      if(OpenCount() > 0 && !CloseUntilFlat()) return;
      OpenDirection(sig.dir, sig.atr);
      g_flatSince = TimeCurrent();
      return;
   }

   if(sig.action == "hold") return;

   // Flat and nothing qualifies. Grace window: after GraceWindowMinutes the
   // bare EMA direction is taken instead. Deliberately looser than the gates,
   // and still the market's direction rather than a coin flip.
   if(GraceWindowMinutes > 0 && sig.raw != 0 && held == 0)
   {
      int waitedMin = (int)((TimeCurrent() - g_flatSince) / 60);
      if(waitedMin >= GraceWindowMinutes)
      {
         if(OpenCount() > 0 && !CloseUntilFlat()) return;
         OpenDirection(sig.raw, sig.atr);
         g_flatSince = TimeCurrent();
         PrintFormat("[NTS Super AI] grace-window entry after %dm (gates not met: %s)",
                     waitedMin, sig.reason);
      }
   }
}
//+------------------------------------------------------------------+
