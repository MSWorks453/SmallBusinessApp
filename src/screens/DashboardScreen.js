/**
 * src/screens/DashboardScreen.js
 * Home tab — matches "Workforce Intelligence" reference screenshot.
 *
 * Layout (top → bottom):
 *  1. Horizontal scrollable KPI cards ($1.2M salary, 342 headcount, etc.)
 *  2. Attendance Trends bar chart (today's bar highlighted indigo)
 *  3. Recent Approvals list (avatar + name + subtitle + status pill)
 *  4. Floating Action Button (+)
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
  SafeAreaView,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { BarChart } from 'react-native-chart-kit';
import { MaterialIcons } from '../components/shared/Icon';
import { analyticsAPI, expensesAPI, employeesAPI } from '../services/api';
import { useAppContext } from '../context/AppContext';
import { useI18n } from '../i18n';
import { Colors, Radii, Shadow, Typography } from '../theme/colors';

const SW = Dimensions.get('window').width;
const CHART_W = SW - 40;

// ── helpers ───────────────────────────────────────────────────────────────────
function fmt(n) {
  if (n >= 10_000_000) return `₹${(n / 10_000_000).toFixed(1)}Cr`;
  if (n >= 100_000)    return `₹${(n / 100_000).toFixed(1)}L`;
  if (n >= 1_000)      return `₹${(n / 1_000).toFixed(0)}K`;
  return `₹${n}`;
}
function fmtFull(n) {
  return `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 0 })}`;
}
function avatarColor(name = '') {
  const palette = Colors.avatar;
  let sum = 0;
  for (const c of name) sum += c.charCodeAt(0);
  return palette[sum % palette.length];
}
function initials(name = '') {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

/**
 * Month-over-month change as a signed percentage string.
 *
 * Returns null when there is no comparable previous figure. That matters: the
 * KPI deltas used to be hard-coded ('-2.4%', '+3.1%') regardless of the data,
 * which is worse than showing nothing in an app people use to judge spend.
 *
 * @param {number} current
 * @param {number} previous
 * @returns {string|null}
 */
function pctChange(current, previous) {
  if (!previous || previous === 0) return null;
  const change = ((current - previous) / previous) * 100;
  if (!Number.isFinite(change)) return null;
  const sign = change >= 0 ? '+' : '';
  return `${sign}${change.toFixed(1)}%`;
}

/** Shared bar-chart config, so the three charts stay visually consistent. */
function barChartConfig(overrides = {}) {
  return {
    backgroundGradientFrom: Colors.surface,
    backgroundGradientTo: Colors.surface,
    backgroundGradientFromOpacity: 1,
    backgroundGradientToOpacity: 1,
    color: () => Colors.chartBar,
    labelColor: () => Colors.textMuted,
    barPercentage: 0.6,
    decimalPlaces: 0,
    propsForLabels: { fontSize: 11 },
    propsForBackgroundLines: { stroke: Colors.borderLight, strokeDasharray: '' },
    ...overrides,
  };
}

// ── Attendance detail table (the "View All" sheet) ────────────────────────────
/**
 * Per-employee Present / Half-Day / Leave counts for the current month.
 *
 * Reads analytics `employeeBreakdown`, which is the same source the payslip and
 * the salary totals use — so the numbers here reconcile with what people are
 * paid, rather than being a second, subtly different count.
 */
function AttendanceDetailModal({ visible, onClose, breakdown, monthLabel, days }) {
  const rows = breakdown || [];

  const totals = rows.reduce(
    (acc, r) => ({
      present: acc.present + (r.presentDays || 0),
      half: acc.half + (r.halfDays || 0),
      absent: acc.absent + (r.absentDays || 0),
    }),
    { present: 0, half: 0, absent: 0 }
  );

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={ad.safe}>
        <View style={ad.header}>
          <TouchableOpacity onPress={onClose} style={ad.closeBtn} accessibilityRole="button">
            <MaterialIcons name="chevron-left" size={24} color={Colors.primary} />
          </TouchableOpacity>
          <Text style={ad.title}>Attendance Detail</Text>
          <View style={{ width: 32 }} />
        </View>

        <Text style={ad.subtitle}>
          {monthLabel}{days ? ` · ${days} day(s) logged` : ''}
        </Text>

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          {/* Column headers */}
          <View style={[ad.row, ad.headRow]}>
            <Text style={[ad.cell, ad.nameCell, ad.headCell]}>Employee</Text>
            <Text style={[ad.cell, ad.headCell]}>Present</Text>
            <Text style={[ad.cell, ad.headCell]}>Half</Text>
            <Text style={[ad.cell, ad.headCell]}>Leave</Text>
          </View>

          {rows.length === 0 ? (
            <Text style={ad.empty}>No attendance recorded this month.</Text>
          ) : (
            rows.map((r, i) => (
              <View key={r.employeeId} style={[ad.row, i < rows.length - 1 && ad.rowBorder]}>
                <View style={[ad.nameCell, { flexDirection: 'row', alignItems: 'center' }]}>
                  <View style={[ad.avatar, { backgroundColor: avatarColor(r.name) }]}>
                    <Text style={ad.avatarText}>{initials(r.name)}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={ad.name} numberOfLines={1}>{r.name}</Text>
                    <Text style={ad.dept} numberOfLines={1}>{r.department}</Text>
                  </View>
                </View>
                <Text style={[ad.cell, ad.num, { color: Colors.successText }]}>{r.presentDays || 0}</Text>
                <Text style={[ad.cell, ad.num, { color: Colors.warningText }]}>{r.halfDays || 0}</Text>
                <Text style={[ad.cell, ad.num, { color: Colors.danger }]}>{r.absentDays || 0}</Text>
              </View>
            ))
          )}

          {rows.length > 0 && (
            <View style={[ad.row, ad.totalRow]}>
              <Text style={[ad.nameCell, ad.totalLabel]}>Total</Text>
              <Text style={[ad.cell, ad.num, ad.totalVal]}>{totals.present}</Text>
              <Text style={[ad.cell, ad.num, ad.totalVal]}>{totals.half}</Text>
              <Text style={[ad.cell, ad.num, ad.totalVal]}>{totals.absent}</Text>
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}
const ad = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Colors.surface, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.border },
  closeBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 17, fontWeight: '700', color: Colors.textPrimary },
  subtitle: { fontSize: 13, color: Colors.textSecondary, paddingHorizontal: 16, paddingTop: 12 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12, backgroundColor: Colors.surface },
  headRow: { backgroundColor: Colors.primary, borderTopLeftRadius: 10, borderTopRightRadius: 10 },
  headCell: { color: Colors.white, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  cell: { flex: 1, textAlign: 'center' },
  nameCell: { flex: 2.4, textAlign: 'left' },
  num: { fontSize: 14, fontWeight: '700' },
  avatar: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  avatarText: { color: Colors.white, fontSize: 11, fontWeight: '700' },
  name: { fontSize: 13, fontWeight: '600', color: Colors.textPrimary },
  dept: { fontSize: 11, color: Colors.textMuted },
  totalRow: { backgroundColor: Colors.primarySoft, borderBottomLeftRadius: 10, borderBottomRightRadius: 10 },
  totalLabel: { fontSize: 13, fontWeight: '800', color: Colors.primary },
  totalVal: { color: Colors.primary, fontWeight: '800' },
  empty: { textAlign: 'center', color: Colors.textMuted, padding: 24, fontSize: 14, backgroundColor: Colors.surface },
});

// ── KPI Card ──────────────────────────────────────────────────────────────────
function KpiCard({ label, value, delta, deltaPositive, icon, caption }) {
  return (
    <View style={kpi.card}>
      <View style={kpi.topRow}>
        <Text style={kpi.label}>{label}</Text>
        <View style={kpi.iconBox}>
          <MaterialIcons name={icon} size={20} color={Colors.primary} />
        </View>
      </View>
      <Text style={kpi.value}>{value}</Text>
      {/* `delta` is null when there is no comparable prior month, in which case
          nothing is shown rather than a placeholder that looks like real data. */}
      {delta ? (
        <View style={kpi.deltaRow}>
          <View style={[kpi.deltaPill, { backgroundColor: deltaPositive ? Colors.successBg : Colors.dangerLight }]}>
            <Text style={[kpi.deltaText, { color: deltaPositive ? Colors.successText : Colors.danger }]}>
              {delta}
            </Text>
          </View>
          <Text style={kpi.deltaCaption}> vs last month</Text>
        </View>
      ) : null}
      {caption ? <Text style={kpi.deltaCaption}>{caption}</Text> : null}
    </View>
  );
}
const kpi = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radii.lg,
    padding: 18,
    width: SW * 0.54,
    marginRight: 12,
    ...Shadow.card,
  },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  label: { ...Typography.kpiLabel, flex: 1 },
  iconBox: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: Colors.primarySoft,
    alignItems: 'center', justifyContent: 'center',
  },
  value: { ...Typography.kpiValue, marginBottom: 8 },
  deltaRow: { flexDirection: 'row', alignItems: 'center' },
  deltaPill: { borderRadius: Radii.full, paddingHorizontal: 8, paddingVertical: 3 },
  deltaText: { fontSize: 12, fontWeight: '700' },
  deltaCaption: { fontSize: 12, color: Colors.textMuted },
});

// ── Approval Row ──────────────────────────────────────────────────────────────
function ApprovalRow({ item, isLast }) {
  const statusStyle = {
    Pending:  { bg: Colors.pendingBg,  text: Colors.pendingText  },
    Approved: { bg: Colors.approvedBg, text: Colors.approvedText },
    Rejected: { bg: Colors.rejectedBg, text: Colors.rejectedText },
  }[item.status] || { bg: Colors.borderLight, text: Colors.textMuted };

  return (
    <View style={[appr.row, !isLast && appr.border]}>
      <View style={[appr.avatar, { backgroundColor: avatarColor(item.name) }]}>
        <Text style={appr.avatarText}>{initials(item.name)}</Text>
      </View>
      <View style={appr.body}>
        <Text style={appr.name}>{item.name}</Text>
        <Text style={appr.sub}>{item.subtitle}</Text>
      </View>
      <View style={[appr.pill, { backgroundColor: statusStyle.bg }]}>
        <Text style={[appr.pillText, { color: statusStyle.text }]}>{item.status}</Text>
      </View>
    </View>
  );
}
const appr = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16 },
  border: { borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  avatar: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginRight: 12 },
  avatarText: { color: Colors.white, fontWeight: '700', fontSize: 14 },
  body: { flex: 1 },
  name: { fontSize: 15, fontWeight: '600', color: Colors.textPrimary },
  sub:  { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  pill: { borderRadius: Radii.full, paddingHorizontal: 12, paddingVertical: 5 },
  pillText: { fontSize: 12, fontWeight: '700' },
});

// ── Quick Expense FAB Modal ────────────────────────────────────────────────────
function QuickAddModal({ visible, onClose, onSaved }) {
  const [amount, setAmount] = useState('');
  const [desc, setDesc] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!amount || isNaN(parseFloat(amount))) return;
    setSaving(true);
    try {
      await expensesAPI.create({
        amount: parseFloat(amount),
        category: 'Other',
        date: new Date().toISOString().slice(0, 10),
        description: desc.trim() || 'Quick expense',
      });
      setAmount(''); setDesc('');
      onSaved();
      onClose();
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableOpacity style={fab.overlay} activeOpacity={1} onPress={onClose} />
        <View style={fab.sheet}>
          <View style={fab.handle} />
          <Text style={fab.sheetTitle}>Quick Log Expense</Text>
          <View style={fab.field}>
            <Text style={fab.fieldLabel}>Amount (₹)</Text>
            <TextInput style={fab.input} value={amount} onChangeText={setAmount}
              placeholder="0.00" placeholderTextColor={Colors.textMuted}
              keyboardType="decimal-pad" />
          </View>
          <View style={fab.field}>
            <Text style={fab.fieldLabel}>Description</Text>
            <TextInput style={fab.input} value={desc} onChangeText={setDesc}
              placeholder="Brief description…" placeholderTextColor={Colors.textMuted} />
          </View>
          <TouchableOpacity style={fab.saveBtn} onPress={handleSave} disabled={saving}>
            {saving ? <ActivityIndicator color={Colors.white} /> :
              <Text style={fab.saveBtnText}>Log Expense</Text>}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
const fab = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: Colors.overlay },
  sheet: {
    backgroundColor: Colors.surface, borderTopLeftRadius: Radii.xl, borderTopRightRadius: Radii.xl,
    padding: 24, paddingBottom: 40,
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center', marginBottom: 16 },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: Colors.textPrimary, marginBottom: 16 },
  field: { marginBottom: 14 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary, marginBottom: 6 },
  input: {
    backgroundColor: Colors.surfaceAlt, borderWidth: 1.5, borderColor: Colors.border,
    borderRadius: Radii.md, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: Colors.textPrimary,
  },
  saveBtn: {
    backgroundColor: Colors.primary, borderRadius: Radii.md, paddingVertical: 15,
    alignItems: 'center', marginTop: 8,
  },
  saveBtnText: { color: Colors.white, fontWeight: '700', fontSize: 15 },
});

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function DashboardScreen() {
  const { currentUser, employees, fetchEmployees, isAdmin, isHR } = useAppContext();
  const { t } = useI18n();
  const [summary, setSummary]         = useState(null);
  const [expenses, setExpenses]       = useState([]);
  const [loading, setLoading]         = useState(true);
  const [fabOpen, setFabOpen]         = useState(false);
  const [refreshKey, setRefreshKey]   = useState(0);
  const [expenseMonth, setExpenseMonth] = useState(null);
  const [attendanceDetail, setAttendanceDetail] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (employees.length === 0) await fetchEmployees();
      const [summaryRes, expensesRes] = await Promise.all([
        analyticsAPI.getSummary(),
        expensesAPI.getAll(),
      ]);
      setSummary(summaryRes.data);
      setExpenses(expensesRes.data || []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [refreshKey]);

  useEffect(() => { load(); }, [refreshKey]);

  // ── Day-to-day attendance ────────────────────────────────────────────────
  const chartDays   = summary?.attendanceRates || [];
  const chartLabels = chartDays.map((d) => d.label || d.date?.slice(5));
  const chartData   = chartDays.map((d) => d.rate || 0);

  // ── This week's expenses (7 calendar days, zero-filled by the API) ────────
  const weekDays    = summary?.weeklyExpenses || [];
  const weekLabels  = weekDays.map((d) => d.label);
  const weekData    = weekDays.map((d) => d.total || 0);
  const weekTotal   = weekData.reduce((sum, n) => sum + n, 0);

  // ── Monthly expenses, from the 6-month trend ─────────────────────────────
  const monthTrend  = summary?.trends || [];
  const monthLabels = monthTrend.map((m) => m.label);
  const monthData   = monthTrend.map((m) => m.expenseCost || 0);

  // ── Headcount ────────────────────────────────────────────────────────────
  // From the API, not from the local `employees` list: that list is role-scoped,
  // so HR only receives EMPLOYEE records and counting it locally under-reports
  // the real size of the business.
  const headcount    = summary?.headcount?.active ?? employees.filter((e) => e.status === 'active').length;
  const newThisMonth = summary?.headcount?.joinedThisMonth ?? 0;
  const byRole       = summary?.headcount?.byRole;

  // ── Real month-over-month deltas ─────────────────────────────────────────
  // Previously these were hard-coded percentages that never changed with the
  // data. `trends` is oldest-first, so the two most recent entries are the
  // current month and the one before it.
  const thisMonth = monthTrend[monthTrend.length - 1];
  const prevMonth = monthTrend[monthTrend.length - 2];

  const salaryDelta  = prevMonth ? pctChange(thisMonth?.salaryCost, prevMonth.salaryCost) : null;
  const expenseDelta = prevMonth ? pctChange(thisMonth?.expenseCost, prevMonth.expenseCost) : null;
  const totalDelta   = prevMonth ? pctChange(thisMonth?.totalCost, prevMonth.totalCost) : null;

  /** For a cost, spending less than last month is the good direction. */
  const costIsGood = (delta) => delta !== null && delta.startsWith('-');

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      <ScrollView
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* greeting */}
        <View style={s.greeting}>
          <Text style={s.greetHi}>{t('dashboard.greeting')}</Text>
          <Text style={s.greetName}>{currentUser?.name?.split(' ')[0]} </Text>
        </View>

        {/* ── KPI Cards (horizontal scroll) ────────────────────── */}
        {loading ? (
          <ActivityIndicator color={Colors.primary} style={{ marginVertical: 24 }} />
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.kpiScroll}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 4 }}>
            <KpiCard
              label="TOTAL SALARY SPEND"
              value={fmt(summary?.currentMonthSalaryCost || 0)}
              delta={salaryDelta}
              deltaPositive={costIsGood(salaryDelta)}
              icon="work"
            />
            <KpiCard
              label="HEADCOUNT"
              value={String(headcount)}
              // Real hires this month, and the role split, instead of an
              // invented "new hires" figure.
              delta={newThisMonth > 0 ? `+${newThisMonth} joined` : null}
              deltaPositive
              caption={byRole ? `${byRole.ADMIN} admin · ${byRole.HR} HR · ${byRole.EMPLOYEE} staff` : null}
              icon="group"
            />
            <KpiCard
              label="GENERAL EXPENSES"
              value={fmt(summary?.currentMonthExpenseCost || 0)}
              delta={expenseDelta}
              deltaPositive={costIsGood(expenseDelta)}
              icon="receipt"
            />
            <KpiCard
              label="TOTAL COST"
              value={fmt(summary?.currentMonthTotalCost || 0)}
              delta={totalDelta}
              deltaPositive={costIsGood(totalDelta)}
              icon="bar-chart"
            />
          </ScrollView>
        )}

        {/* ── Attendance Trends bar chart ───────────────────────── */}
        {!loading && chartData.length > 0 && (
          <View style={s.card}>
            <View style={s.cardHeader}>
              <View style={{ flex: 1 }}>
                <Text style={s.cardTitle}>Day-to-Day Attendance</Text>
                <Text style={s.cardSub}>
                  Attendance rate, last {chartDays.length} recorded day(s)
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setAttendanceDetail(true)}
                accessibilityRole="button"
                accessibilityLabel="View attendance detail table"
              >
                <Text style={s.viewAll}>View All</Text>
              </TouchableOpacity>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <BarChart
                data={{
                  labels: chartLabels,
                  datasets: [{
                    data: chartData.length > 0 ? chartData : [0],
                    colors: chartData.map((_, i) =>
                      () => i === chartData.length - 2
                        ? Colors.chartBarActive
                        : Colors.chartBar
                    ),
                  }],
                }}
                width={Math.max(CHART_W - 32, chartLabels.length * 56)}
                height={200}
                yAxisSuffix="%"
                fromZero
                withCustomBarColorFromData
                flatColor
                showValuesOnTopOfBars={false}
                chartConfig={{
                  backgroundGradientFrom: Colors.surface,
                  backgroundGradientTo: Colors.surface,
                  backgroundGradientFromOpacity: 1,
                  backgroundGradientToOpacity: 1,
                  color: () => Colors.chartBar,
                  labelColor: () => Colors.textMuted,
                  barPercentage: 0.6,
                  decimalPlaces: 0,
                  propsForLabels: { fontSize: 12 },
                  propsForBackgroundLines: { stroke: Colors.borderLight, strokeDasharray: '' },
                }}
                style={{ borderRadius: Radii.md, marginTop: 8 }}
              />
            </ScrollView>
          </View>
        )}

        {/* ── Recent Approvals ──────────────────────────────────── */}
        {/* <View style={s.card}>
          <View style={[s.cardHeader, { paddingHorizontal: 16, paddingTop: 16 }]}>
            <Text style={s.cardTitle}>Recent Approvals</Text>
          </View>
          {approvals.length === 0 && !loading ? (
            <Text style={s.emptyText}>No approvals to show.</Text>
          ) : (
            approvals.map((item, i) => (
              <ApprovalRow key={i} item={item} isLast={i === approvals.length - 1} />
            ))
          )}
        </View> */}

        {/* ── This Week's Expenses ─────────────────────────────── */}
        {/* Seven calendar days, zero-filled by the API. Days with no spend are
            kept as empty bars on purpose: dropping them would compress the axis
            and make a quiet week look continuously busy. */}
        {!loading && (isAdmin || isHR) && weekData.length > 0 && (
          <View style={s.card}>
            <View style={s.cardHeader}>
              <View style={{ flex: 1 }}>
                <Text style={s.cardTitle}>This Week's Expenses</Text>
                <Text style={s.cardSub}>Last 7 days · {fmtFull(weekTotal)} total</Text>
              </View>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <BarChart
                data={{
                  labels: weekLabels,
                  datasets: [{
                    data: weekData.some((n) => n > 0) ? weekData : [0],
                    colors: weekData.map((_, i) => () =>
                      i === weekData.length - 1 ? Colors.chartBarActive : Colors.chartBar
                    ),
                  }],
                }}
                width={Math.max(CHART_W - 32, weekLabels.length * 56)}
                height={200}
                fromZero
                withCustomBarColorFromData
                flatColor
                showValuesOnTopOfBars={false}
                chartConfig={barChartConfig()}
                style={{ borderRadius: Radii.md, marginTop: 8 }}
              />
            </ScrollView>
          </View>
        )}

        {/* ── Monthly Expenses (Admin & HR only) ─────────────── */}
        {(isAdmin || isHR) && (
        <View style={s.card}>
          <View style={[s.cardHeader, { paddingHorizontal: 16, paddingTop: 16 }]}>
            <View style={{ flex: 1 }}>
              <Text style={s.cardTitle}>Monthly Expenses</Text>
              <Text style={s.cardSub}>Last 6 months · tap a month for detail</Text>
            </View>
          </View>

          {!loading && monthData.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <BarChart
                data={{
                  labels: monthLabels,
                  datasets: [{
                    data: monthData.some((n) => n > 0) ? monthData : [0],
                    colors: monthData.map((_, i) => () =>
                      i === monthData.length - 1 ? Colors.chartBarActive : Colors.chartBar
                    ),
                  }],
                }}
                width={Math.max(CHART_W - 32, monthLabels.length * 60)}
                height={200}
                fromZero
                withCustomBarColorFromData
                flatColor
                showValuesOnTopOfBars={false}
                chartConfig={barChartConfig()}
                style={{ borderRadius: Radii.md, marginTop: 8, marginHorizontal: 8 }}
              />
            </ScrollView>
          )}
          {expenses.length === 0 && !loading ? (
            <Text style={s.emptyText}>No expenses logged yet.</Text>
          ) : (
            Object.entries(
              expenses.reduce((acc, exp) => {
                const ym = exp.date?.slice(0, 7) || 'Unknown';
                if (!acc[ym]) acc[ym] = { total: 0, count: 0 };
                acc[ym].total += exp.amount || 0;
                acc[ym].count++;
                return acc;
              }, {})
            )
              .sort((a, b) => b[0].localeCompare(a[0]))
              .slice(0, 6)
              .map(([ym, data], i, arr) => {
                const [y, m] = ym.split('-');
                const label = new Date(parseInt(y), parseInt(m) - 1, 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' });
                return (
                  <TouchableOpacity
                    key={ym}
                    style={[s.expenseRow, i < arr.length - 1 && s.expenseBorder]}
                    onPress={() => setExpenseMonth(ym)}
                    activeOpacity={0.7}
                  >
                    <View style={s.expenseIconWrap}>
                      <MaterialIcons name="event" size={18} color={Colors.primary} />
                    </View>
                    <View style={s.expenseBody}>
                      <Text style={s.expenseCat}>{label}</Text>
                      <Text style={s.expenseDesc}>{data.count} expense{data.count !== 1 ? 's' : ''}</Text>
                    </View>
                    <Text style={s.expenseAmount}>{fmt(data.total)}</Text>
                    <MaterialIcons name="chevron-right" size={18} color={Colors.textMuted} style={{ marginLeft: 4 }} />
                  </TouchableOpacity>
                );
              })
          )}
        </View>
        )}

        <View style={{ height: 80 }} />
      </ScrollView>

      {/* ── FAB ──────────────────────────────────────────────────── */}
      <TouchableOpacity
        style={s.fab}
        onPress={() => setFabOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Quick add"
      >
        <Text style={s.fabIcon}>+</Text>
      </TouchableOpacity>

      <QuickAddModal
        visible={fabOpen}
        onClose={() => setFabOpen(false)}
        onSaved={() => setRefreshKey((k) => k + 1)}
      />

      <AttendanceDetailModal
        visible={attendanceDetail}
        onClose={() => setAttendanceDetail(false)}
        breakdown={summary?.employeeBreakdown}
        monthLabel={thisMonth?.label || summary?.currentMonth || ''}
        days={summary?.employeeBreakdown?.[0]?.totalDaysLogged}
      />

      {/* ── Monthly Expense Detail Modal ──────────────────────── */}
      <Modal visible={!!expenseMonth} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setExpenseMonth(null)}>
        <View style={ms.safe}>
          <View style={ms.header}>
            <TouchableOpacity onPress={() => setExpenseMonth(null)} style={ms.closeBtn} accessibilityRole="button">
              <MaterialIcons name="chevron-left" size={24} color={Colors.primary} />
            </TouchableOpacity>
            <Text style={ms.title}>
              {expenseMonth ? (() => {
                const [y, m] = expenseMonth.split('-');
                return new Date(parseInt(y), parseInt(m) - 1, 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' });
              })() : ''}
            </Text>
            <View style={{ width: 32 }} />
          </View>

          {/* Summary */}
          <View style={ms.summaryRow}>
            <View style={ms.summaryCard}>
              <Text style={ms.summaryLabel}>Total Expenses</Text>
              <Text style={ms.summaryValue}>
                {fmt(expenses.filter(e => e.date?.startsWith(expenseMonth)).reduce((s, e) => s + (e.amount || 0), 0))}
              </Text>
            </View>
            <View style={ms.summaryCard}>
              <Text style={ms.summaryLabel}>Transactions</Text>
              <Text style={ms.summaryValue}>
                {expenses.filter(e => e.date?.startsWith(expenseMonth)).length}
              </Text>
            </View>
          </View>

          {/* Date-wise list */}
          <ScrollView style={ms.list} showsVerticalScrollIndicator={false}>
            <View style={[ms.tableRow, ms.tableHeaderRow]}>
              <Text style={[ms.tableCell, ms.headerCell, { flex: 1.2 }]}>Date</Text>
              <Text style={[ms.tableCell, ms.headerCell, { flex: 1.5 }]}>Category</Text>
              <Text style={[ms.tableCell, ms.headerCell, { flex: 2 }]}>Description</Text>
              <Text style={[ms.tableCell, ms.headerCell, { flex: 1 }]}>Amount</Text>
            </View>
            {expenses
              .filter(e => e.date?.startsWith(expenseMonth))
              .sort((a, b) => a.date.localeCompare(b.date))
              .map((exp, i) => (
                <View key={exp.id || i} style={[ms.tableRow, i % 2 === 0 && ms.tableRowEven]}>
                  <Text style={[ms.tableCell, ms.dateCell, { flex: 1.2 }]}>{exp.date?.slice(5)}</Text>
                  <Text style={[ms.tableCell, ms.catCell, { flex: 1.5 }]}>{exp.category}</Text>
                  <Text style={[ms.tableCell, ms.descCell, { flex: 2 }]} numberOfLines={1}>{exp.description || '—'}</Text>
                  <Text style={[ms.tableCell, ms.amountCell, { flex: 1 }]}>₹{exp.amount?.toLocaleString('en-IN')}</Text>
                </View>
              ))
            }
            {expenses.filter(e => e.date?.startsWith(expenseMonth)).length === 0 && (
              <Text style={s.emptyText}>No expenses for this month.</Text>
            )}
            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  scroll: { paddingBottom: 20 },
  greeting: { paddingHorizontal: 16, paddingTop: 18, paddingBottom: 8 },
  greetHi:   { fontSize: 13, color: Colors.textSecondary },
  greetName: { fontSize: 22, fontWeight: '800', color: Colors.textPrimary, marginTop: 2 },
  kpiScroll: { paddingTop: 4, paddingBottom: 8 },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radii.lg,
    marginHorizontal: 16,
    marginTop: 16,
    overflow: 'hidden',
    ...Shadow.card,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 4,
  },
  cardTitle: { ...Typography.sectionTitle },
  cardSub:   { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  viewAll:   { fontSize: 13, fontWeight: '600', color: Colors.primary },
  emptyText: { textAlign: 'center', color: Colors.textMuted, padding: 24, fontSize: 14 },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadow.fab,
  },
  fabIcon: { color: Colors.white, fontSize: 28, fontWeight: '300', lineHeight: 32 },
  expenseRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16 },
  expenseBorder: { borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  expenseIconWrap: { width: 38, height: 38, borderRadius: 10, backgroundColor: Colors.primarySoft, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  expenseBody: { flex: 1 },
  expenseCat: { fontSize: 14, fontWeight: '600', color: Colors.textPrimary },
  expenseDesc: { fontSize: 12, color: Colors.textSecondary, marginTop: 1 },
  expenseDate: { fontSize: 11, color: Colors.textMuted, marginTop: 2 },
  expenseAmount: { fontSize: 15, fontWeight: '700', color: Colors.danger },
});

const ms = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Colors.surface, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.border },
  closeBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 17, fontWeight: '700', color: Colors.textPrimary },
  summaryRow: { flexDirection: 'row', padding: 16, paddingBottom: 8 },
  summaryCard: { flex: 1, backgroundColor: Colors.surface, borderRadius: Radii.lg, padding: 16, marginRight: 8, alignItems: 'center', ...Shadow.card },
  summaryLabel: { fontSize: 11, fontWeight: '600', color: Colors.textMuted, textTransform: 'uppercase', marginBottom: 4 },
  summaryValue: { fontSize: 20, fontWeight: '800', color: Colors.primary },
  list: { flex: 1, marginHorizontal: 16 },
  tableRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 10 },
  tableRowEven: { backgroundColor: Colors.surfaceAlt },
  tableHeaderRow: { backgroundColor: Colors.primary, borderRadius: 8 },
  headerCell: { color: Colors.white, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3 },
  tableCell: { flex: 1 },
  dateCell: { fontSize: 12, fontWeight: '600', color: Colors.textPrimary },
  catCell: { fontSize: 12, fontWeight: '500', color: Colors.textSecondary },
  descCell: { fontSize: 12, color: Colors.textMuted },
  amountCell: { fontSize: 13, fontWeight: '700', color: Colors.danger, textAlign: 'right' },
});
