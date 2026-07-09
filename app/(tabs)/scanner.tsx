import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  Platform,
  ScrollView,
  Image,
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { TextInput } from 'react-native';
import {
  ArrowLeft,
  Upload,
  Scan,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Minus,
  Clock,
  History,
  Trash2,
  ChevronDown,
  Shield,
} from 'lucide-react-native';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  analyzeOnWeb,
  buildInsights,
  buildAnalyzerHtml,
  type ChartInsights,
} from '@/utils/chart-heuristics';
import { ScanPhases } from '@/components/scan-phases';
import { ConfidenceGauge } from '@/components/confidence-gauge';
import { Typewriter } from '@/components/typewriter';
import { ParticleBurst } from '@/components/particle-burst';
import { useTheme } from '@/providers/theme-provider';
import { useApp } from '@/providers/app-provider';
import { apiService } from '@/services/api';
import { BROKER_SYMBOLS } from '@/constants/broker-symbols';

type ScanHistoryEntry = {
  id: string;
  at: number;
  action: ChartInsights['signal']['action'];
  strength: ChartInsights['signal']['strength'];
  headline: string;
  confidence: number;
  bullishPercent: number;
  bearishPercent: number;
  trend: ChartInsights['trend'];
};

const SCAN_HISTORY_KEY = 'scanHistory.v1';
const SCAN_SYMBOL_KEY = 'scanSymbol.v1';
const SIGNAL_TTL_MS = 15 * 60 * 1000;

export default function ScannerScreen() {
  const { mt4Symbols, mt5Symbols, placeManualTrade, mt5Account, eas, ensureMT5Connected } = useApp();
  const { theme } = useTheme();
  const accent = theme.accent;

  // Chart Scanner state
  const [pickedImage, setPickedImage] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [scanLoading, setScanLoading] = useState<boolean>(false);
  const [insights, setInsights] = useState<ChartInsights | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  // When set on native, a hidden WebView mounts and runs the analyzer on the data URI
  const [analyzerDataUri, setAnalyzerDataUri] = useState<string | null>(null);
  // Multi-phase scan state (-1 = idle, 0..3 active phase, 4 = done)
  const [scanPhase, setScanPhase] = useState<number>(-1);
  // Increments each time a signal reveals — drives the particle burst.
  const [revealCount, setRevealCount] = useState<number>(0);
  // When the currently displayed signal was produced (for the 15-min countdown).
  const [signalAt, setSignalAt] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  // Scan history (last 10 signals, persisted in AsyncStorage).
  const [scanHistory, setScanHistory] = useState<ScanHistoryEntry[]>([]);
  const [historyOpen, setHistoryOpen] = useState<boolean>(false);

  // ── Symbol picker / trade config (mirrors ea-converter scanner) ──
  const [tradeSymbol, setTradeSymbol] = useState<string>('');
  const [tradeLot, setTradeLot] = useState<string>('0.01');
  const [tradeCount, setTradeCount] = useState<string>('1');
  const [symbolDropdownOpen, setSymbolDropdownOpen] = useState<boolean>(false);

  // Look up a symbol's saved lot / count from MT4/MT5 config (if any).
  const lookupSymbolConfig = useCallback((sym: string) => {
    if (!sym) return undefined;
    const m5 = (mt5Symbols || []).find(s => s.symbol === sym);
    if (m5) return { lot: m5.lotSize, count: m5.numberOfTrades, platform: 'MT5' as const };
    const m4 = (mt4Symbols || []).find(s => s.symbol === sym);
    if (m4) return { lot: m4.lotSize, count: m4.numberOfTrades, platform: 'MT4' as const };
    return undefined;
  }, [mt4Symbols, mt5Symbols]);

  // Hydrate last-picked scan symbol on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const sym = await AsyncStorage.getItem(SCAN_SYMBOL_KEY);
        if (cancelled || !sym) return;
        setTradeSymbol(sym);
        const cfg = lookupSymbolConfig(sym);
        if (cfg) {
          setTradeLot(cfg.lot);
          setTradeCount(cfg.count);
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);

  // Each scan holds the revealed result for a random 10–20s so the phase
  // progression has room to play out and the experience feels like genuine
  // analysis. These refs track the target + elapsed so we can cancel cleanly.
  const scanTargetMsRef = useRef<number>(0);
  const scanStartedAtRef = useRef<number>(0);
  const scanRevealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hydrate history once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(SCAN_HISTORY_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (!cancelled && Array.isArray(parsed)) {
          setScanHistory(parsed.slice(0, 10));
        }
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const resetScanner = useCallback(() => {
    // Cancel any in-flight reveal so leaving the screen mid-scan doesn't
    // pop the result in later.
    if (scanRevealTimerRef.current) {
      clearTimeout(scanRevealTimerRef.current);
      scanRevealTimerRef.current = null;
    }
    setPickedImage(null);
    setInsights(null);
    setScanError(null);
    setScanLoading(false);
    setAnalyzerDataUri(null);
    setScanPhase(-1);
    setSignalAt(null);
  }, []);

  const handlePickChartImage = useCallback(async () => {
    try {
      setScanError(null);
      setInsights(null);
      if (Platform.OS !== 'web') {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permission needed', 'Please allow access to your media library to upload a chart.');
          return;
        }
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 0.9,
        // Native analyzer needs raw bytes to build a data URI for the hidden WebView
        base64: Platform.OS !== 'web',
      });
      if (!result.canceled && result.assets && result.assets[0]) {
        setPickedImage(result.assets[0]);
      }
    } catch (e) {
      console.error('Pick chart image error:', e);
      setScanError('Could not pick image. Please try again.');
    }
  }, []);

  // Pushes a freshly computed insight into state + history, fires reveal effects.
  const commitInsights = useCallback(async (result: ChartInsights) => {
    setInsights(result);
    setScanError(null);
    setSignalAt(Date.now());
    setRevealCount(c => c + 1);
    const entry: ScanHistoryEntry = {
      id: `${Date.now()}`,
      at: Date.now(),
      action: result.signal.action,
      strength: result.signal.strength,
      headline: result.signal.headline,
      confidence: result.confidence,
      bullishPercent: result.bullishPercent,
      bearishPercent: result.bearishPercent,
      trend: result.trend,
    };
    setScanHistory(prev => {
      const next = [entry, ...prev].slice(0, 10);
      AsyncStorage.setItem(SCAN_HISTORY_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });

    // ── AUTO-EXECUTE: fire trade immediately after scan, silently via Api2Trade ──
    const action = result.signal.action;
    if (action === 'BUY' || action === 'SELL') {
      const sym = (tradeSymbol || '').trim(); // exact broker casing — no uppercasing
      let uuid = mt5Account?.uuid;
      const cfg = lookupSymbolConfig(sym);
      const lot = parseFloat(String(tradeLot.trim() || cfg?.lot || '0.01').replace(',', '.'));
      const count = Math.max(1, Math.min(100, parseInt(tradeCount.trim() || cfg?.count || '1', 10) || 1));
      if (sym && uuid && isFinite(lot) && lot > 0) {
        // Probe/reconnect once so a silently-expired session doesn't drop trades.
        const fresh = await ensureMT5Connected();
        if (fresh) uuid = fresh;
        const operation = action === 'BUY' ? 'Buy' : 'Sell';
        Promise.all(Array.from({ length: count }, () =>
          apiService.sendMT5Trade({ id: uuid, action: 'open', symbol: sym, operation, volume: lot, comment: (eas?.[0]?.name || 'Robot') })
            .catch((e: any) => console.error('[scanner] auto-exec error:', e?.message || e)),
        )).catch(() => {});
      } else if (!sym) {
        console.warn('[scanner] auto-exec skipped: no symbol selected');
      }
    }
  }, [tradeSymbol, tradeLot, tradeCount, lookupSymbolConfig, mt5Account?.uuid, eas, ensureMT5Connected]);

  // Holds the real analysis result until at least `scanTargetMsRef.current`
  // has elapsed since the scan started. This is what makes each scan feel
  // like 10–20s of work even though the pixel read is effectively instant.
  // Errors bypass the delay and surface immediately.
  const revealWhenReady = useCallback(
    (result: ChartInsights) => {
      const elapsed = Date.now() - scanStartedAtRef.current;
      const remaining = Math.max(0, scanTargetMsRef.current - elapsed);
      if (scanRevealTimerRef.current) {
        clearTimeout(scanRevealTimerRef.current);
      }
      scanRevealTimerRef.current = setTimeout(() => {
        scanRevealTimerRef.current = null;
        commitInsights(result);
        setScanLoading(false);
      }, remaining);
    },
    [commitInsights]
  );

  const handleScanChart = useCallback(async () => {
    if (!pickedImage) return;
    // Pick a random hold time in [10_000, 20_000] ms. Analysis kicks off
    // immediately but the reveal is gated on this window.
    const targetMs = 10000 + Math.floor(Math.random() * 10001);
    scanTargetMsRef.current = targetMs;
    scanStartedAtRef.current = Date.now();
    // Cancel any lingering reveal from a previous scan.
    if (scanRevealTimerRef.current) {
      clearTimeout(scanRevealTimerRef.current);
      scanRevealTimerRef.current = null;
    }
    setScanLoading(true);
    setScanError(null);
    setInsights(null);
    setScanPhase(0);
    try {
      if (Platform.OS === 'web') {
        // Direct canvas analysis — no network call, no AI.
        const result = await analyzeOnWeb(pickedImage.uri);
        revealWhenReady(result);
      } else {
        // Native: feed the image into a hidden WebView analyzer.
        const base64 = pickedImage.base64;
        if (!base64) {
          throw new Error('Could not read image data. Please pick the image again.');
        }
        const mime = pickedImage.mimeType || 'image/jpeg';
        const dataUri = `data:${mime};base64,${base64}`;
        setAnalyzerDataUri(dataUri);
        // scanLoading stays true until onAnalyzerMessage fires → revealWhenReady.
      }
    } catch (e: any) {
      console.error('Scan chart error:', e);
      setScanError(e?.message || 'Failed to analyze chart. Please try again.');
      setScanLoading(false);
      setScanPhase(-1);
    }
  }, [pickedImage, revealWhenReady]);

  const onAnalyzerMessage = useCallback(
    (event: any) => {
      try {
        const payload = JSON.parse(event?.nativeEvent?.data || '{}');
        if (payload && payload.__error) {
          throw new Error(
            payload.__error === 'image_load_failed'
              ? 'Could not decode the image. Try a PNG/JPG screenshot.'
              : `Analyzer failed (${payload.__error})`
          );
        }
        const result = buildInsights(payload);
        revealWhenReady(result);
      } catch (e: any) {
        console.error('Analyzer message error:', e);
        setScanError(e?.message || 'Analyzer failed. Please try again.');
        setScanLoading(false);
        setScanPhase(-1);
      } finally {
        setAnalyzerDataUri(null);
      }
    },
    [revealWhenReady]
  );

  // Advance scan phases while loading — purely visual, caps at 3 so the last
  // phase stays highlighted until the real result arrives. The per-phase
  // interval is derived from the target hold window so all four phases
  // progress across the full 10–20s delay (roughly one phase per third of
  // the window, with a small buffer so "BUILDING SIGNAL" sits briefly before
  // the reveal rather than racing past it).
  useEffect(() => {
    if (!scanLoading) return;
    const target = scanTargetMsRef.current || 2000;
    const interval = Math.max(700, Math.floor((target - 800) / 3));
    const id = setInterval(() => {
      setScanPhase(p => (p < 3 ? p + 1 : p));
    }, interval);
    return () => clearInterval(id);
  }, [scanLoading]);

  // When a result lands, mark all phases as complete briefly, then idle.
  useEffect(() => {
    if (!insights) return;
    setScanPhase(4);
    const id = setTimeout(() => setScanPhase(-1), 700);
    return () => clearTimeout(id);
  }, [insights]);

  // 15-minute countdown ticker. Only runs while we have a live signal.
  useEffect(() => {
    if (!signalAt) return;
    setNowTick(Date.now());
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [signalAt]);

  // ── Tier 1 animations ────────────────────────────────────────────────
  // Pulsing glow on the signal card while a result is visible.
  const signalPulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!insights) {
      signalPulse.stopAnimation();
      signalPulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(signalPulse, {
          toValue: 1,
          duration: 1400,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: false,
        }),
        Animated.timing(signalPulse, {
          toValue: 0,
          duration: 1400,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: false,
        }),
      ])
    );
    loop.start();
    return () => {
      loop.stop();
    };
  }, [insights, signalPulse]);

  // Scan-line sweep across the preview while scanning.
  const scanLine = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!scanLoading) {
      scanLine.stopAnimation();
      scanLine.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(scanLine, {
        toValue: 1,
        duration: 1600,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => {
      loop.stop();
    };
  }, [scanLoading, scanLine]);

  // Haptic + soft beep the moment a result reveals.
  useEffect(() => {
    if (!insights) return;
    if (Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      return;
    }
    try {
      const w = window as any;
      const Ctor = w.AudioContext || w.webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.exponentialRampToValueAtTime(1320, now + 0.12);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.34);
      osc.onended = () => {
        try {
          ctx.close();
        } catch {}
      };
    } catch {}
  }, [insights]);

  const webGlow = (color: string, intense?: boolean) =>
    Platform.OS === 'web'
      ? ({
          boxShadow: intense
            ? `0 0 8px 2px ${color}80, 0 0 24px 6px ${color}33`
            : `0 0 6px 1px ${color}80, 0 0 18px 4px ${color}33`,
        } as any)
      : {};

  // mm:ss formatter for the signal countdown.
  const formatCountdown = (ms: number): string => {
    const total = Math.max(0, Math.round(ms / 1000));
    const mm = Math.floor(total / 60);
    const ss = total % 60;
    return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  };

  const formatHistoryTime = (at: number): string => {
    const diff = Date.now() - at;
    if (diff < 60_000) return 'just now';
    if (diff < 60 * 60_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 24 * 60 * 60_000) return `${Math.floor(diff / (60 * 60_000))}h ago`;
    return `${Math.floor(diff / (24 * 60 * 60_000))}d ago`;
  };

  const renderInsights = (data: ChartInsights) => {
    const statRows: Array<{ label: string; value: string }> = [
      {
        label: 'BIAS',
        value:
          data.bias === 'bullish'
            ? 'Bullish'
            : data.bias === 'bearish'
            ? 'Bearish'
            : 'Balanced',
      },
      {
        label: 'STRUCTURE',
        value:
          data.trend === 'up'
            ? 'Uptrend'
            : data.trend === 'down'
            ? 'Downtrend'
            : 'Sideways range',
      },
      {
        label: 'VOLATILITY',
        value: data.volatility.charAt(0).toUpperCase() + data.volatility.slice(1),
      },
      {
        label: 'MOMENTUM',
        value: data.momentum.charAt(0).toUpperCase() + data.momentum.slice(1),
      },
    ];

    const signalColor =
      data.signal.action === 'BUY'
        ? '#22C55E'
        : data.signal.action === 'SELL'
        ? '#EF4444'
        : '#9CA3AF';
    const signalBg =
      data.signal.action === 'BUY'
        ? 'rgba(34, 197, 94, 0.12)'
        : data.signal.action === 'SELL'
        ? 'rgba(239, 68, 68, 0.12)'
        : 'rgba(156, 163, 175, 0.10)';
    const SignalIcon =
      data.signal.action === 'BUY'
        ? TrendingUp
        : data.signal.action === 'SELL'
        ? TrendingDown
        : Minus;
    const structureLabel =
      data.trend === 'up' ? 'UPTREND' : data.trend === 'down' ? 'DOWNTREND' : 'SIDEWAYS';

    const strengthBars =
      data.signal.action === 'WAIT'
        ? 0
        : data.signal.strength === 'strong'
        ? 3
        : data.signal.strength === 'moderate'
        ? 2
        : 1;

    // Pulsing glow overlay — animated opacity + slight scale for a breathing feel.
    const pulseOpacity = signalPulse.interpolate({
      inputRange: [0, 1],
      outputRange: [0.35, 0.95],
    });
    const pulseScale = signalPulse.interpolate({
      inputRange: [0, 1],
      outputRange: [1, 1.015],
    });

    return (
      <View style={{ gap: 14 }}>
        {/* ── Large signal hero with pulsing glow ─────────────────── */}
        <Animated.View
          style={[
            styles.scannerSignalBox,
            {
              backgroundColor: signalBg,
              borderColor: signalColor,
              shadowColor: signalColor,
              transform: [{ scale: pulseScale }],
            },
            webGlow(signalColor, true),
          ]}
        >
          {/* Animated glow ring sitting just inside the border */}
          <Animated.View
            pointerEvents="none"
            style={[
              styles.scannerSignalPulse,
              { borderColor: signalColor, opacity: pulseOpacity },
            ]}
          />
          <View style={styles.scannerSignalRow}>
            <SignalIcon color={signalColor} size={44} strokeWidth={2.5} />
            <View style={{ flex: 1 }}>
              <Text
                style={[
                  styles.scannerSignalHeadline,
                  { color: signalColor, textShadowColor: signalColor + 'B3' },
                ]}
              >
                {data.signal.headline}
              </Text>
              <Text style={[styles.scannerSignalMeta, { color: signalColor + 'CC' }]}>
                {data.signal.action === 'WAIT'
                  ? `${structureLabel} \u2022 ${data.volatility.toUpperCase()} VOL`
                  : `${data.signal.strength.toUpperCase()} \u2022 ${structureLabel} \u2022 ${data.volatility.toUpperCase()} VOL`}
              </Text>
              {data.signal.action !== 'WAIT' && (
                <View style={styles.scannerStrengthRow}>
                  {[0, 1, 2].map(i => (
                    <View
                      key={i}
                      style={[
                        styles.scannerStrengthBar,
                        {
                          backgroundColor: i < strengthBars ? signalColor : signalColor + '26',
                          shadowColor: signalColor,
                        },
                        i < strengthBars && webGlow(signalColor, true),
                      ]}
                    />
                  ))}
                </View>
              )}
            </View>
            <ConfidenceGauge value={data.confidence} color={signalColor} label="CONF" />
          </View>
          <Typewriter
            text={data.signal.rationale}
            speed={14}
            startDelay={120}
            style={styles.scannerSignalRationale}
          />
          {/* Particle burst bursts each time a new signal lands */}
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <ParticleBurst trigger={revealCount} color={signalColor} count={16} radius={150} />
          </View>
          {/* 15-minute freshness countdown */}
          {signalAt && (
            <View style={styles.scannerCountdownWrap}>
              <View style={styles.scannerCountdownLabelRow}>
                <Clock color={signalColor + 'CC'} size={12} strokeWidth={2.5} />
                <Text
                  style={[styles.scannerCountdownLabel, { color: signalColor + 'CC' }]}
                >
                  SIGNAL FRESH FOR{' '}
                  {formatCountdown(Math.max(0, SIGNAL_TTL_MS - (nowTick - signalAt)))}
                </Text>
              </View>
              <View style={styles.scannerCountdownTrack}>
                <View
                  style={[
                    styles.scannerCountdownFill,
                    {
                      backgroundColor: signalColor,
                      width: `${Math.max(
                        0,
                        Math.min(100, 100 - ((nowTick - signalAt) / SIGNAL_TTL_MS) * 100)
                      )}%`,
                    },
                  ]}
                />
              </View>
            </View>
          )}
        </Animated.View>

        {/* ── Supporting diagnostics ───────────────────────────────── */}
        <Text style={styles.scannerResultText}>{data.summary}</Text>

        <View style={styles.scannerMixRow}>
          <View
            style={[
              styles.scannerMixBar,
              { flex: Math.max(1, data.bullishPercent), backgroundColor: '#22C55E' },
            ]}
          />
          <View
            style={[
              styles.scannerMixBar,
              { flex: Math.max(1, data.bearishPercent), backgroundColor: '#EF4444' },
            ]}
          />
        </View>
        <View style={styles.scannerMixLabels}>
          <Text style={styles.scannerMixLabel}>{data.bullishPercent}% bullish</Text>
          <Text style={styles.scannerMixLabel}>{data.bearishPercent}% bearish</Text>
        </View>

        <View style={{ gap: 8, marginTop: 4 }}>
          {statRows.map(row => (
            <View key={row.label} style={styles.scannerResultRow}>
              <Text style={[styles.scannerResultLabel, { color: accent }]}>
                {row.label}
              </Text>
              <Text style={styles.scannerResultText}>{row.value}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.scannerDisclaimer}>
          Descriptive chart diagnostics only — not financial advice or a trade recommendation.
        </Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => {
            resetScanner();
            router.back();
          }}
        >
          <ArrowLeft color="#FFFFFF" size={22} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: accent }]}>CHART SCANNER</Text>
        <TouchableOpacity
          onPress={() => setHistoryOpen(v => !v)}
          activeOpacity={0.7}
          style={[styles.synapseHeaderBtn, { borderColor: accent + '66' }, webGlow(accent)]}
        >
          <History color={accent} size={16} />
          {scanHistory.length > 0 && (
            <View style={[styles.synapseHeaderBadge, { backgroundColor: accent }]}>
              <Text style={styles.synapseHeaderBadgeText}>{scanHistory.length}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scannerBody}>
        <Text style={styles.scannerIntro}>
          Drop a chart screenshot. We read the candles on-device and call a BUY, SELL or
          WAIT with a live confidence score — no servers, no AI.
        </Text>

        {/* ── Scan history drawer ───────────────────────────────── */}
        {historyOpen && (
          <View
            style={[
              styles.scannerHistoryBox,
              { borderColor: accent + '66' },
              webGlow(accent),
            ]}
          >
            <View style={styles.scannerHistoryHeader}>
              <Text style={[styles.scannerHistoryTitle, { color: accent }]}>
                RECENT SCANS
              </Text>
              {scanHistory.length > 0 && (
                <TouchableOpacity
                  onPress={() => {
                    setScanHistory([]);
                    AsyncStorage.removeItem(SCAN_HISTORY_KEY).catch(() => {});
                  }}
                  activeOpacity={0.7}
                  style={styles.scannerHistoryClearBtn}
                >
                  <Trash2 color={accent + 'CC'} size={14} />
                  <Text style={[styles.scannerHistoryClearText, { color: accent + 'CC' }]}>
                    CLEAR
                  </Text>
                </TouchableOpacity>
              )}
            </View>
            {scanHistory.length === 0 ? (
              <Text style={styles.scannerHistoryEmpty}>
                No scans yet — upload a chart to get started.
              </Text>
            ) : (
              <View style={{ gap: 8 }}>
                {scanHistory.map(h => {
                  const c =
                    h.action === 'BUY'
                      ? '#22C55E'
                      : h.action === 'SELL'
                      ? '#EF4444'
                      : '#9CA3AF';
                  return (
                    <View
                      key={h.id}
                      style={[
                        styles.scannerHistoryRow,
                        { borderColor: c + '66', backgroundColor: c + '14' },
                      ]}
                    >
                      <View
                        style={[
                          styles.scannerHistoryBadge,
                          { backgroundColor: c + '26', borderColor: c },
                        ]}
                      >
                        <Text style={[styles.scannerHistoryBadgeText, { color: c }]}>
                          {h.action}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.scannerHistoryHeadline}>
                          {h.strength.toUpperCase()} {'\u2022'}{' '}
                          {h.trend === 'up'
                            ? 'UPTREND'
                            : h.trend === 'down'
                            ? 'DOWNTREND'
                            : 'SIDEWAYS'}
                        </Text>
                        <Text style={styles.scannerHistoryMeta}>
                          {h.confidence}% conf {'\u2022'} {h.bullishPercent}/
                          {h.bearishPercent} {'\u2022'} {formatHistoryTime(h.at)}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {/* ── Symbol dropdown ──────────────────────────────────── */}
        <View style={[styles.scannerSymbolPicker, { borderColor: accent + '44' }]}>
          <Text style={[styles.scannerSymbolLabel, { color: accent }]}>SELECT SYMBOL</Text>
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => setSymbolDropdownOpen(v => !v)}
            style={[styles.scannerDropdownTrigger, { borderColor: accent + '66' }]}
          >
            <Text style={[styles.scannerDropdownValue, { color: tradeSymbol.trim() ? '#FFFFFF' : '#4A5568' }]}>
              {tradeSymbol.trim() || 'Select a symbol...'}
            </Text>
            <ChevronDown
              color={accent}
              size={18}
              style={{ transform: [{ rotate: symbolDropdownOpen ? '180deg' : '0deg' }] }}
            />
          </TouchableOpacity>

          {symbolDropdownOpen && (
            <ScrollView style={[styles.scannerDropdownList, { borderColor: accent + '44', maxHeight: 300 }]} nestedScrollEnabled>
              {BROKER_SYMBOLS.map(cat => (
                <View key={cat.name}>
                  <View style={[styles.scannerDropdownCatHeader, { borderBottomColor: accent + '22' }]}>
                    <Text style={[styles.scannerDropdownCatText, { color: accent }]}>
                      {cat.name} ({cat.symbols.length})
                    </Text>
                  </View>
                  {cat.symbols.map(s => {
                    const active = s.symbol === tradeSymbol.trim();
                    const cfg = lookupSymbolConfig(s.symbol);
                    return (
                      <TouchableOpacity
                        key={s.symbol}
                        onPress={() => {
                          setTradeSymbol(s.symbol);
                          if (cfg) {
                            setTradeLot(cfg.lot);
                            setTradeCount(cfg.count);
                          }
                          AsyncStorage.setItem(SCAN_SYMBOL_KEY, s.symbol).catch(() => {});
                          setSymbolDropdownOpen(false);
                        }}
                        activeOpacity={0.7}
                        style={[
                          styles.scannerDropdownItem,
                          {
                            borderColor: active ? accent + '44' : 'transparent',
                            backgroundColor: active ? accent + '18' : 'transparent',
                          },
                        ]}
                      >
                        <View>
                          <Text style={[styles.scannerDropdownItemText, { color: active ? accent : '#FFFFFF' }]}>
                            {s.symbol}
                          </Text>
                          <Text style={[styles.scannerDropdownItemDesc, { color: '#6B7280' }]}>
                            {s.description}
                          </Text>
                        </View>
                        {cfg && (
                          <Text style={[styles.scannerDropdownItemMeta, { color: accent + '99' }]}>
                            {cfg.lot} lot
                          </Text>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ))}
            </ScrollView>
          )}

          {!symbolDropdownOpen && (
            <TextInput
              value={tradeSymbol}
              onChangeText={t => {
                setTradeSymbol(t);
                const cfg = lookupSymbolConfig(t);
                if (cfg) {
                  setTradeLot(cfg.lot);
                  setTradeCount(cfg.count);
                }
                AsyncStorage.setItem(SCAN_SYMBOL_KEY, t).catch(() => {});
              }}
              placeholder="Or type manually: e.g. .US30."
              placeholderTextColor="#4A5568"
              autoCorrect={false}
              style={[styles.scannerSymbolInput, { borderColor: accent + '33', marginTop: 6 }]}
            />
          )}
        </View>

        {/* ── Lot size + count config ──────────────────────────── */}
        <View style={[styles.scannerLotRow, { borderColor: accent + '44' }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.scannerSymbolLabel, { color: accent }]}>LOT SIZE</Text>
            <TextInput
              value={tradeLot}
              onChangeText={setTradeLot}
              placeholder="0.01"
              placeholderTextColor="#4A5568"
              keyboardType="decimal-pad"
              style={[styles.scannerSymbolInput, { borderColor: accent + '66' }]}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.scannerSymbolLabel, { color: accent }]}>TRADES</Text>
            <TextInput
              value={tradeCount}
              onChangeText={setTradeCount}
              placeholder="1"
              placeholderTextColor="#4A5568"
              keyboardType="number-pad"
              style={[styles.scannerSymbolInput, { borderColor: accent + '66' }]}
            />
          </View>
        </View>

        {/* Upload / Preview area */}
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={handlePickChartImage}
          style={[
            styles.scannerDropzone,
            { borderColor: accent + '66' },
            webGlow(accent),
          ]}
        >
          {pickedImage ? (
            <Image
              source={{ uri: pickedImage.uri }}
              style={styles.scannerPreview}
              resizeMode="contain"
            />
          ) : (
            <View style={styles.scannerDropzoneInner}>
              <Upload color={accent} size={36} />
              <Text style={[styles.scannerDropzoneTitle, { color: accent }]}>
                TAP TO UPLOAD CHART
              </Text>
              <Text style={styles.scannerDropzoneSub}>
                PNG or JPG screenshot of your chart
              </Text>
            </View>
          )}

          {/* Detected horizontal levels — absolute-positioned dashed lines over the preview */}
          {pickedImage && insights && insights.levels && insights.levels.length > 0 && (
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
              {insights.levels.map((ly, li) => {
                const signalColor =
                  insights.signal.action === 'BUY'
                    ? '#22C55E'
                    : insights.signal.action === 'SELL'
                    ? '#EF4444'
                    : '#9CA3AF';
                return (
                  <View
                    key={`lvl-${li}`}
                    style={[
                      styles.scannerLevelLine,
                      {
                        top: `${Math.max(2, Math.min(98, ly * 100))}%`,
                        borderColor: signalColor,
                        shadowColor: signalColor,
                      },
                      webGlow(signalColor, true),
                    ]}
                  >
                    <View
                      style={[
                        styles.scannerLevelTag,
                        { backgroundColor: signalColor + 'E6' },
                      ]}
                    >
                      <Text style={styles.scannerLevelTagText}>L{li + 1}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {/* Scan-line sweep during analysis */}
          {scanLoading && pickedImage && (
            <>
              <View pointerEvents="none" style={styles.scannerScanVeil} />
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.scannerScanLine,
                  {
                    backgroundColor: accent,
                    shadowColor: accent,
                    transform: [
                      {
                        translateY: scanLine.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0, 260],
                        }),
                      },
                    ],
                  },
                  webGlow(accent, true),
                ]}
              />
            </>
          )}
        </TouchableOpacity>

        {pickedImage && !scanLoading && (
          <View style={styles.scannerActionsRow}>
            <TouchableOpacity
              onPress={handlePickChartImage}
              activeOpacity={0.8}
              style={[styles.scannerSecondaryBtn, { borderColor: accent + '66' }]}
            >
              <RefreshCw color={accent} size={16} />
              <Text style={[styles.scannerSecondaryText, { color: accent }]}>
                CHANGE IMAGE
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleScanChart}
              activeOpacity={0.8}
              style={[
                styles.scannerPrimaryBtn,
                { borderColor: accent, shadowColor: accent },
                webGlow(accent),
              ]}
            >
              <Scan color={accent} size={18} />
              <Text style={[styles.scannerPrimaryText, { color: accent }]}>
                SCAN CHART
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {pickedImage && scanLoading && (
          <View
            style={[
              styles.scannerPhasesBox,
              { borderColor: accent + '66' },
              webGlow(accent),
            ]}
          >
            <View style={styles.scannerPhasesHeader}>
              <ActivityIndicator color={accent} size="small" />
              <Text style={[styles.scannerPhasesTitle, { color: accent }]}>
                ANALYZING CHART
              </Text>
            </View>
            <ScanPhases phase={scanPhase} color={accent} />
          </View>
        )}

        {scanError && (
          <View style={[styles.scannerErrorBox, { borderColor: '#FF4D4D' }]}>
            <Text style={styles.scannerErrorText}>{scanError}</Text>
          </View>
        )}

        {insights && (
          <View
            style={[
              styles.scannerResultBox,
              { borderColor: accent + '66' },
              webGlow(accent),
            ]}
          >
            <Text style={[styles.scannerResultTitle, { color: accent }]}>
              CHART DIAGNOSTICS
            </Text>
            {renderInsights(insights)}
          </View>
        )}
      </ScrollView>

      {/* Hidden native-only analyzer: renders the image on a canvas and posts back pixel stats. */}
      {Platform.OS !== 'web' && analyzerDataUri && (
        <WebView
          source={{ html: buildAnalyzerHtml(analyzerDataUri) }}
          onMessage={onAnalyzerMessage}
          javaScriptEnabled
          domStorageEnabled
          originWhitelist={['*']}
          style={styles.scannerHiddenWebView}
          pointerEvents="none"
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
    backgroundColor: 'rgba(0,0,0,0.9)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.05)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 1.5,
    textAlign: 'center',
  },
  synapseHeaderBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  synapseHeaderBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  synapseHeaderBadgeText: {
    color: '#000',
    fontSize: 9,
    fontWeight: '900',
  },

  // Chart Scanner Upload
  scannerBody: {
    padding: 20,
    gap: 16,
    paddingBottom: 40,
  },
  scannerIntro: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  // Symbol picker / dropdown / lot inputs (ported from ea-converter)
  scannerSymbolPicker: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    backgroundColor: '#080D1A',
  },
  scannerSymbolLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 6,
  },
  scannerDropdownTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: '#000',
  },
  scannerDropdownValue: {
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  scannerDropdownList: {
    marginTop: 6,
    borderRadius: 10,
    borderWidth: 1,
    backgroundColor: '#000',
  },
  scannerDropdownCatHeader: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  scannerDropdownCatText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
  },
  scannerDropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderLeftWidth: 2,
  },
  scannerDropdownItemText: {
    fontSize: 14,
    fontWeight: '700',
  },
  scannerDropdownItemDesc: {
    fontSize: 11,
    marginTop: 2,
  },
  scannerDropdownItemMeta: {
    fontSize: 11,
    fontWeight: '600',
  },
  scannerSymbolInput: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
    backgroundColor: '#000',
  },
  scannerLotRow: {
    flexDirection: 'row',
    gap: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    backgroundColor: '#080D1A',
  },
  scannerDropzone: {
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: 'dashed',
    backgroundColor: '#080D1A',
    minHeight: 260,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  scannerDropzoneInner: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 24,
  },
  scannerDropzoneTitle: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1.4,
  },
  scannerDropzoneSub: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.5,
  },
  scannerPreview: {
    width: '100%',
    height: 260,
    backgroundColor: '#000',
  },
  scannerActionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  scannerSecondaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 28,
    borderWidth: 1,
    backgroundColor: '#080D1A',
  },
  scannerSecondaryText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  scannerPrimaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 28,
    borderWidth: 1,
    backgroundColor: '#080D1A',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 8,
  },
  scannerPrimaryText: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1.4,
  },
  scannerErrorBox: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    backgroundColor: 'rgba(255, 77, 77, 0.08)',
  },
  scannerErrorText: {
    color: '#FF6B6B',
    fontSize: 13,
    fontWeight: '500',
  },
  scannerResultBox: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    backgroundColor: '#080D1A',
    gap: 12,
  },
  scannerResultTitle: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.6,
  },
  scannerResultRow: {
    gap: 2,
  },
  scannerResultLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  scannerResultText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
  },
  scannerSignalBox: {
    position: 'relative',
    borderRadius: 20,
    borderWidth: 2,
    paddingVertical: 20,
    paddingHorizontal: 20,
    gap: 14,
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 20,
    elevation: 12,
  },
  scannerSignalPulse: {
    position: 'absolute',
    top: 4,
    left: 4,
    right: 4,
    bottom: 4,
    borderRadius: 16,
    borderWidth: 1,
  },
  scannerSignalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  scannerSignalHeadline: {
    fontSize: 32,
    fontWeight: '900',
    letterSpacing: 2,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 12,
  },
  scannerSignalMeta: {
    marginTop: 3,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.4,
  },
  scannerStrengthRow: {
    flexDirection: 'row',
    gap: 5,
    marginTop: 10,
  },
  scannerStrengthBar: {
    width: 22,
    height: 6,
    borderRadius: 3,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 6,
    elevation: 4,
  },
  scannerSignalRationale: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 19,
  },
  scannerScanVeil: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  scannerScanLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: 2,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 10,
    elevation: 8,
  },
  scannerMixRow: {
    flexDirection: 'row',
    height: 10,
    borderRadius: 5,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  scannerMixBar: {
    height: '100%',
  },
  scannerMixLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  scannerMixLabel: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.4,
  },
  scannerDisclaimer: {
    marginTop: 6,
    color: 'rgba(255,255,255,0.45)',
    fontSize: 10,
    fontWeight: '500',
    fontStyle: 'italic',
    lineHeight: 14,
  },
  scannerLevelLine: {
    position: 'absolute',
    left: 10,
    right: 10,
    height: 0,
    borderTopWidth: 1,
    borderStyle: 'dashed',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 8,
  },
  scannerLevelTag: {
    position: 'absolute',
    left: 0,
    top: -8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  scannerLevelTagText: {
    color: '#000',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  scannerPhasesBox: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    backgroundColor: '#080D1A',
    gap: 6,
  },
  scannerPhasesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 2,
  },
  scannerPhasesTitle: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.6,
  },
  scannerCountdownWrap: {
    marginTop: 6,
    gap: 6,
  },
  scannerCountdownLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  scannerCountdownLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  scannerCountdownTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
  },
  scannerCountdownFill: {
    height: '100%',
    borderRadius: 2,
  },
  scannerHistoryBox: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    backgroundColor: '#080D1A',
    gap: 12,
  },
  scannerHistoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  scannerHistoryTitle: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.6,
  },
  scannerHistoryClearBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  scannerHistoryClearText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  scannerHistoryEmpty: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 8,
  },
  scannerHistoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  scannerHistoryBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  scannerHistoryBadgeText: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  scannerHistoryHeadline: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  scannerHistoryMeta: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2,
  },
  scannerHiddenWebView: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
    left: -9999,
    top: -9999,
  },
});
