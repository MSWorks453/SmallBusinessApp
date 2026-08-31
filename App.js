/**
 * App.js — FinTrack Enterprise navigation shell with i18n support.
 */

import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Platform, ActivityIndicator,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppProvider, useAppContext, ROLES } from './src/context/AppContext';
import { I18nProvider, useI18n } from './src/i18n';
import { useMaterialIconsFont, MaterialIcons } from './src/components/shared/Icon';
import { Colors, Radii, Shadow } from './src/theme/colors';

// ── Screens ───────────────────────────────────────────────────────────────────
import LoginScreen              from './src/screens/LoginScreen';
import DashboardScreen          from './src/screens/DashboardScreen';
import AnalyticsDashboardScreen from './src/screens/AnalyticsDashboardScreen';
import EmployeeManagementScreen from './src/screens/EmployeeManagementScreen';
import AttendanceScreen         from './src/screens/AttendanceScreen';
import ExpenseLoggerScreen      from './src/screens/ExpenseLoggerScreen';
import EmployeePortalScreen     from './src/screens/EmployeePortalScreen';
import ReportsScreen            from './src/screens/ReportsScreen';

const Tab   = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

// ── Helpers ───────────────────────────────────────────────────────────────────
function getInitials(name = '') {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}
function roleColor(role) {
  if (role === ROLES.ADMIN) return Colors.primary;
  if (role === ROLES.HR)    return '#0891B2';
  return '#059669';
}

// ── Tab icon map ──────────────────────────────────────────────────────────────
const TAB_ICONS = {
  Home: 'home', Staff: 'group', Time: 'assignment', Spend: 'credit-card',
  Financials: 'bar-chart', Reports: 'description', Settings: 'settings', Portal: 'person',
};

// ── Top Header ────────────────────────────────────────────────────────────────
function TopHeader() {
  const { currentUser, logout } = useAppContext();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();

  if (!currentUser) return null;

  const initials = getInitials(currentUser.name);
  const rc = roleColor(currentUser.role);

  return (
    <View style={[hdr.bar, { paddingTop: insets.top + 10 }]}>
      <View style={hdr.left}>
        <View style={hdr.logoBox}>
          <Text style={hdr.logoLetter}>F</Text>
        </View>
        <Text style={hdr.appName}>{t('appName')}</Text>
      </View>
      <View style={hdr.right}>
        <View style={[hdr.avatar, { backgroundColor: rc }]}>
          <Text style={hdr.avatarText}>{initials}</Text>
        </View>
        <TouchableOpacity style={hdr.logoutBtn} onPress={logout} accessibilityRole="button" accessibilityLabel={t('signOut')}>
          <MaterialIcons name="logout" size={20} color={Colors.danger} />
          <Text style={hdr.logoutText}>{t('signOut')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const hdr = StyleSheet.create({
  bar: { flexDirection:'row', alignItems:'center', justifyContent:'space-between', backgroundColor: Colors.surface, paddingHorizontal:16, paddingBottom:12, borderBottomWidth:1, borderBottomColor: Colors.border },
  left: { flexDirection:'row', alignItems:'center' },
  logoBox: { width:34, height:34, borderRadius:9, backgroundColor: Colors.primary, alignItems:'center', justifyContent:'center', marginRight:10 },
  logoLetter: { color: Colors.white, fontSize:18, fontWeight:'900', lineHeight:22 },
  appName: { fontSize:18, fontWeight:'800', color: Colors.primary, letterSpacing:-0.4 },
  right: { flexDirection:'row', alignItems:'center' },
  avatar: { width:34, height:34, borderRadius:17, alignItems:'center', justifyContent:'center', marginRight:10 },
  avatarText: { color: Colors.white, fontSize:13, fontWeight:'700' },
  logoutBtn: { flexDirection:'row', alignItems:'center', backgroundColor: Colors.dangerLight, borderRadius: Radii.full, paddingHorizontal:12, paddingVertical:7 },
  logoutText: { fontSize:13, fontWeight:'700', color: Colors.danger, marginLeft:4 },
});

// ── Custom Bottom Tab Bar (with translated labels) ────────────────────────────
function CustomTabBar({ state, descriptors, navigation }) {
  const insets = useSafeAreaInsets();
  const { t } = useI18n();

  // Map route names to translated labels
  const tabLabels = {
    Home: t('tabs.home'), Staff: t('tabs.staff'), Time: t('tabs.time'),
    Spend: t('tabs.spend'), Financials: t('tabs.financials'),
    Reports: t('tabs.reports'), Settings: t('tabs.settings'),
    Portal: t('tabs.portal'),
  };

  return (
    <View style={[tab.bar, { paddingBottom: insets.bottom + 6 }]}>
      {state.routes.map((route, index) => {
        const isFocused = state.index === index;
        const icon = TAB_ICONS[route.name] || '●';
        const label = tabLabels[route.name] || route.name;

        function onPress() {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!isFocused && !event.defaultPrevented) navigation.navigate(route.name);
        }

        return (
          <TouchableOpacity key={route.key} style={tab.item} onPress={onPress}
            accessibilityRole="tab" accessibilityState={{ selected: isFocused }} accessibilityLabel={label}>
            <View style={[tab.iconWrap, isFocused && tab.iconWrapActive]}>
              <MaterialIcons name={icon} size={22} color={isFocused ? Colors.white : Colors.textMuted} />
            </View>
            <Text style={[tab.label, isFocused && tab.labelActive]}>{label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const tab = StyleSheet.create({
  bar: { flexDirection:'row', backgroundColor: Colors.surface, borderTopWidth:1, borderTopColor: Colors.border, paddingTop:8, paddingHorizontal:4 },
  item: { flex:1, alignItems:'center', paddingBottom:2 },
  iconWrap: { width:48, height:36, borderRadius:12, alignItems:'center', justifyContent:'center', marginBottom:3 },
  iconWrapActive: { backgroundColor: Colors.primary },
  icon: { fontSize:20 },
  label: { fontSize:10, fontWeight:'500', color: Colors.textMuted },
  labelActive: { color: Colors.primary, fontWeight:'700' },
});

// ── Screen wrapper ────────────────────────────────────────────────────────────
function ScreenWithHeader({ children }) {
  return (
    <View style={{ flex:1, backgroundColor: Colors.background }}>
      <TopHeader />
      {children}
    </View>
  );
}
function withHeader(Component) {
  return function Wrapped(props) {
    return <ScreenWithHeader><Component {...props} /></ScreenWithHeader>;
  };
}

const DashboardWithHeader   = withHeader(DashboardScreen);
const AnalyticsWithHeader   = withHeader(AnalyticsDashboardScreen);
const EmployeesWithHeader   = withHeader(EmployeeManagementScreen);
const AttendanceWithHeader  = withHeader(AttendanceScreen);
const ExpensesWithHeader    = withHeader(ExpenseLoggerScreen);
const PortalWithHeader      = withHeader(EmployeePortalScreen);
const ReportsWithHeader     = withHeader(ReportsScreen);

function SettingsScreen() {
  const { logout, logoutAllDevices, currentUser } = useAppContext();
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);

  // Both actions revoke server-side before clearing local state, so they are
  // async. The flag stops a second tap firing a second revoke against a session
  // that is already gone.
  async function run(action) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex:1, backgroundColor: Colors.background, alignItems:'center', justifyContent:'center', paddingHorizontal:24 }}>
      <MaterialIcons name="settings" size={40} color={Colors.textMuted} style={{ marginBottom:16 }} />
      <Text style={{ fontSize:18, fontWeight:'700', color: Colors.textPrimary, marginBottom:4 }}>{t('settings.title')}</Text>
      <Text style={{ fontSize:13, color: Colors.textSecondary, marginBottom:24, textAlign:'center' }}>
        {currentUser?.name}{currentUser?.phone ? ` · ${currentUser.phone}` : ''}
      </Text>

      <TouchableOpacity
        style={{ backgroundColor: Colors.primary, borderRadius:12, paddingHorizontal:28, paddingVertical:12, opacity: busy ? 0.7 : 1 }}
        onPress={() => run(logout)}
        disabled={busy}
        accessibilityRole="button"
      >
        <Text style={{ color: Colors.white, fontWeight:'700', fontSize:15 }}>{t('signOut')}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={{ marginTop:14, paddingHorizontal:20, paddingVertical:10 }}
        onPress={() => run(logoutAllDevices)}
        disabled={busy}
        accessibilityRole="button"
      >
        <Text style={{ color: Colors.danger, fontWeight:'600', fontSize:14 }}>{t('settings.signOutAllDevices')}</Text>
      </TouchableOpacity>
    </View>
  );
}
const SettingsWithHeader = withHeader(SettingsScreen);

// ── Role tab navigators ───────────────────────────────────────────────────────
function AdminTabs() {
  return (
    <Tab.Navigator tabBar={(p) => <CustomTabBar {...p} />} screenOptions={{ headerShown:false }}>
      <Tab.Screen name="Home"       component={DashboardWithHeader} />
      <Tab.Screen name="Staff"      component={EmployeesWithHeader} />
      <Tab.Screen name="Time"       component={AttendanceWithHeader} />
      <Tab.Screen name="Reports"    component={ReportsWithHeader} />
      <Tab.Screen name="Spend"      component={ExpensesWithHeader} />
      <Tab.Screen name="Financials" component={AnalyticsWithHeader} />
    </Tab.Navigator>
  );
}
function HRTabs() {
  return (
    <Tab.Navigator tabBar={(p) => <CustomTabBar {...p} />} screenOptions={{ headerShown:false }}>
      <Tab.Screen name="Home"    component={DashboardWithHeader}  />
      <Tab.Screen name="Staff"   component={EmployeesWithHeader}  />
      <Tab.Screen name="Time"    component={AttendanceWithHeader} />
      {/* HR sees the same table, scoped server-side to the staff they manage. */}
      <Tab.Screen name="Reports" component={ReportsWithHeader}    />
      <Tab.Screen name="Spend"   component={ExpensesWithHeader}   />
    </Tab.Navigator>
  );
}
function EmployeeTabs() {
  return (
    <Tab.Navigator tabBar={(p) => <CustomTabBar {...p} />} screenOptions={{ headerShown:false }}>
      <Tab.Screen name="Home"   component={DashboardWithHeader} />
      <Tab.Screen name="Portal" component={PortalWithHeader}    />
    </Tab.Navigator>
  );
}

// ── Splash ────────────────────────────────────────────────────────────────────
// Shown only while a stored session is being restored and verified. Without this
// the login screen would flash on every cold start for an already-signed-in user,
// because reading the token from secure storage is asynchronous.
function BootSplash() {
  return (
    <View style={{ flex:1, backgroundColor: Colors.background, alignItems:'center', justifyContent:'center' }}>
      <View style={{ width:56, height:56, borderRadius:14, backgroundColor: Colors.primary, alignItems:'center', justifyContent:'center', marginBottom:20 }}>
        <Text style={{ fontSize:28, fontWeight:'900', color: Colors.white, lineHeight:34 }}>F</Text>
      </View>
      <ActivityIndicator color={Colors.primary} />
    </View>
  );
}

// ── Root navigator ────────────────────────────────────────────────────────────
function RootNavigator() {
  const { currentUser, isBootstrapping, isSignedIn } = useAppContext();

  // Three states, not two: 'restoring a session' is distinct from 'signed out'.
  if (isBootstrapping) {
    return <BootSplash />;
  }

  if (!isSignedIn || !currentUser) {
    return <Stack.Navigator screenOptions={{ headerShown:false }}><Stack.Screen name="Login" component={LoginScreen} /></Stack.Navigator>;
  }
  if (currentUser.role === ROLES.ADMIN) {
    return <Stack.Navigator screenOptions={{ headerShown:false }}><Stack.Screen name="AdminApp" component={AdminTabs} /></Stack.Navigator>;
  }
  if (currentUser.role === ROLES.HR) {
    return <Stack.Navigator screenOptions={{ headerShown:false }}><Stack.Screen name="HRApp" component={HRTabs} /></Stack.Navigator>;
  }
  return <Stack.Navigator screenOptions={{ headerShown:false }}><Stack.Screen name="EmployeeApp" component={EmployeeTabs} /></Stack.Navigator>;
}

// ── App root — I18nProvider wraps everything ──────────────────────────────────
export default function App() {
  const fontsLoaded = useMaterialIconsFont();

  if (!fontsLoaded) return null;

  return (
    <SafeAreaProvider>
      <I18nProvider>
        <AppProvider>
          <NavigationContainer>
            <StatusBar style="dark" backgroundColor={Colors.surface} />
            <RootNavigator />
          </NavigationContainer>
        </AppProvider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}
