import React, { useRef, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Dimensions, Platform, TouchableWithoutFeedback } from 'react-native';
import { Home, TrendingUp, Landmark, Settings, X } from 'lucide-react-native';
import { router, usePathname } from 'expo-router';
import { useSidebar } from '@/providers/sidebar-provider';
import { useTheme } from '@/providers/theme-provider';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const SIDEBAR_WIDTH = 280;

const NAV_ITEMS = [
  { key: '/', label: 'Home', icon: Home, route: '/' },
  { key: '/metatrader', label: 'MetaTrader', icon: TrendingUp, route: '/metatrader' },
  { key: '/fundamentals', label: 'Fundamentals', icon: Landmark, route: '/fundamentals' },
  { key: '/settings', label: 'Settings', icon: Settings, route: '/settings' },
];

export function Sidebar() {
  const { isOpen, close } = useSidebar();
  const { theme } = useTheme();
  const a = theme.accentRgb;
  const ac = theme.accent;
  const pathname = usePathname();

  const slideAnim = useRef(new Animated.Value(-SIDEBAR_WIDTH)).current;
  const overlayAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isOpen) {
      Animated.parallel([
        Animated.spring(slideAnim, {
          toValue: 0,
          useNativeDriver: true,
          tension: 65,
          friction: 11,
        }),
        Animated.timing(overlayAnim, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.spring(slideAnim, {
          toValue: -SIDEBAR_WIDTH,
          useNativeDriver: true,
          tension: 65,
          friction: 11,
        }),
        Animated.timing(overlayAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [isOpen]);

  const handleNav = (route: string) => {
    close();
    setTimeout(() => {
      router.push(route as any);
    }, 100);
  };

  return (
    <>
      {/* Backdrop overlay */}
      <Animated.View
        pointerEvents={isOpen ? 'auto' : 'none'}
        style={[
          styles.overlay,
          { opacity: overlayAnim },
        ]}
      >
        <TouchableWithoutFeedback onPress={close}>
          <View style={styles.overlayTouch} />
        </TouchableWithoutFeedback>
      </Animated.View>

      {/* Sidebar panel */}
      <Animated.View
        style={[
          styles.sidebar,
          { transform: [{ translateX: slideAnim }] },
        ]}
      >
        {/* Glass shine overlay */}
        <View style={styles.sidebarShine} />
        <View style={styles.sidebarEdge} />

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>TRADE PORT</Text>
          <TouchableOpacity onPress={close} style={styles.closeBtn}>
            <X color="rgba(255,255,255,0.6)" size={20} />
          </TouchableOpacity>
        </View>

        {/* Nav items */}
        <View style={styles.navList}>
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.key || 
              (item.key === '/' && pathname === '/index') ||
              (item.key === '/' && pathname === '');
            const Icon = item.icon;
            return (
              <TouchableOpacity
                key={item.key}
                style={[
                  styles.navItem,
                  isActive && styles.navItemActive,
                  isActive && { backgroundColor: 'rgba(' + a + ', 0.12)' },
                  isActive && Platform.OS === 'web' && { boxShadow: 'inset 0 1px 2px rgba(255,255,255,0.15), 0 0 12px rgba(' + a + ', 0.15)' },
                ]}
                onPress={() => handleNav(item.route)}
                activeOpacity={0.6}
              >
                <View style={[
                  styles.navIconWrap,
                  isActive && { backgroundColor: 'rgba(' + a + ', 0.2)', borderColor: 'rgba(' + a + ', 0.3)' },
                ]}>
                  <Icon color={isActive ? ac : 'rgba(255,255,255,0.5)'} size={18} />
                </View>
                <Text style={[
                  styles.navLabel,
                  isActive && { color: '#FFFFFF' },
                ]}>{item.label}</Text>
                {isActive && (
                  <View style={[styles.activeIndicator, { backgroundColor: ac }]} />
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Bottom brand */}
        <View style={styles.sidebarFooter}>
          <View style={[styles.footerDot, { backgroundColor: ac }]} />
          <Text style={styles.footerText}>v1.0</Text>
        </View>
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    zIndex: 998,
  },
  overlayTouch: {
    flex: 1,
  },
  sidebar: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    width: SIDEBAR_WIDTH,
    backgroundColor: 'rgba(15, 15, 15, 0.85)',
    zIndex: 999,
    borderRightWidth: 2,
    borderTopRightRadius: 28,
    borderBottomRightRadius: 28,
    borderRightColor: 'rgba(255, 255, 255, 0.15)',
    paddingTop: 60,
    paddingHorizontal: 16,
    paddingBottom: 30,
    overflow: 'hidden',
    ...(Platform.OS === 'web' && {
      backdropFilter: 'blur(60px) saturate(180%)',
      WebkitBackdropFilter: 'blur(60px) saturate(180%)',
      boxShadow: 'inset 0 1px 3px rgba(255,255,255,0.15), 8px 0 40px rgba(0,0,0,0.5)',
    }),
  },
  sidebarShine: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '40%',
    borderTopRightRadius: 28,
    ...(Platform.OS === 'web' && {
      background: 'linear-gradient(180deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.03) 60%, rgba(255,255,255,0) 100%)',
      pointerEvents: 'none',
    }),
  },
  sidebarEdge: {
    position: 'absolute',
    top: 60,
    right: 0,
    width: 2,
    bottom: 30,
    ...(Platform.OS === 'web' && {
      background: 'linear-gradient(180deg, rgba(255,255,255,0.2) 0%, rgba(255,255,255,0.05) 50%, rgba(255,255,255,0.15) 100%)',
      pointerEvents: 'none',
    }),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 40,
    paddingHorizontal: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 2,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  navList: {
    flex: 1,
    gap: 6,
  },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  navItemActive: {
    borderWidth: 1.5,
    borderTopColor: 'rgba(255,255,255,0.2)',
    borderLeftColor: 'rgba(255,255,255,0.12)',
    borderRightColor: 'rgba(255,255,255,0.08)',
    borderBottomColor: 'rgba(0,0,0,0.15)',
    ...(Platform.OS === 'web' && {
      backdropFilter: 'blur(40px)',
      WebkitBackdropFilter: 'blur(40px)',
    }),
  },
  navIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  navLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.5)',
    letterSpacing: 0.3,
    flex: 1,
  },
  activeIndicator: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  sidebarFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 4,
  },
  footerDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  footerText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.3)',
    letterSpacing: 0.5,
  },
});
