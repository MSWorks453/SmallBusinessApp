/**
 * src/screens/AnalyticsDashboardScreen.js
 * Financials tab — matches "FinForce Analytics" reference screenshot.
 *
 * Layout:
 *  1. Horizontal scrollable KPI metric cards (salary spend, general expenses, total)
 *  2. Attendance Trends card with "This Week ▾" period selector dropdown
 *  3. Line chart: 6-month salary vs expense trend
 *  4. Recent Expenses list with "View All" link
 *  5. Employee salary breakdown table
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Dimensions, Modal,
} from 'react-native';
import { MaterialIcons } from '../components/shared/Icon';
import { BarChart, LineChart } from 'react-native-chart-kit';
import { analyticsAPI } from '../services/api';
import { useI18n } from '../i18n';
import { Colors, Radii, Shadow, Typography } from '../theme/colors';

const SW = Dimensions.get('window').width;
const CHART_W = SW - 40;

function fmt(n) {
  if (n >= 10_000_000) return `₹${(n / 10_000_000).toFixed(1)}Cr`;
  if (n >= 100_000)    return `₹${(n / 100_000).toFixed(1)}L`;
  if (n >= 1_000)      return `₹${(n / 1_000).toFixed(0)}K`;
  return `₹${Number(n).toFixed(0)}`;
}
function fmtFull(n) {
  return `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 0 })}`;
}
function avatarColor(name = '') {
  const p = Colors.avatar;
  let s = 0; for (const c of name) s += c.charCodeAt(0);
  return p[s % p.length];
}
function initials(name = '') {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

// ── KPI Metric Card ───────────────────────────────────────────────────────────
function MetricCard({ label, value, delta, deltaPositive, icon }) {
  return (
    <View style={mc.card}>
      <View style={mc.topRow}>
        <Text style={mc.label}>{label}</Text>
        <View style={mc.iconBox}><MaterialIcons name={icon} size={18} color={Colors.primary} /></View>
      </View>
      <Text style={mc.value}>{value}</Text>
      {delta ? (
        <View style={mc.deltaRow}>
          <View style={[mc.deltaPill, { backgroundColor: deltaPositive ? Colors.successBg : Colors.dangerLight }]}>
            <Text style={[mc.deltaText, { color: deltaPositive ? Colors.successText : Colors.danger }]}>
              {deltaPositive ? '+' : ''}{delta}
            </Text>
          </View>
          <Text style={mc.deltaSub}> vs last month</Text>
        </View>
      ) : null}
    </View>
  );
}
const mc = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radii.lg,
    padding: 18,
    width: SW * 0.54,
    marginRight: 12,
    ...Shadow.card,
  },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 },
  label: { ...Typography.kpiLabel, flex: 1, flexWrap: 'wrap' },
  iconBox: { width: 34, height: 34, borderRadius: 10, backgroundColor: Colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  value: { ...Typography.kpiValue, marginBottom: 8 },
  deltaRow: { flexDirection: 'row', alignItems: 'center' },
  deltaPill: { borderRadius: Radii.full, paddingHorizontal: 8, paddingVertical: 3 },
  deltaText: { fontSize: 12, fontWeight: '700' },
  deltaSub: { fontSize: 12, color: Colors.textMuted },
});

// ── Period Dropdown ───────────────────────────────────────────────────────────
const PERIODS = ['This Week', 'This Month', 'Last 3 Months', 'Last 6 Months'];
function PeriodPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <TouchableOpacity style={pd.pill} onPress={() => setOpen(true)} accessibilityRole="combobox">
        <Text style={pd.pillText}>{value}</Text>
        <MaterialIcons name="keyboard-arrow-down" size={18} color={Colors.textSecondary} />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={pd.overlay} activeOpacity={1} onPress={() => setOpen(false)}>
          <View style={pd.menu}>
            {PERIODS.map(p => (
              <TouchableOpacity key={p} style={[pd.item, p === value && pd.itemActive]}
                onPress={() => { onChange(p); setOpen(false); }}>
                <Text style={[pd.itemText, p === value && pd.itemTextActive]}>{p}</Text>
                {p === value && <MaterialIcons name="check" size={18} color={Colors.primary} />}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}
const pd = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.border, borderRadius: Radii.full, paddingHorizontal: 12, paddingVertical: 6 },
  pillText: { fontSize: 13, fontWeight: '600', color: Colors.textPrimary },
  chevron: { fontSize: 14, color: Colors.textSecondary },
  overlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'flex-start', paddingTop: 120, paddingHorizontal: 20 },
  menu: { backgroundColor: Colors.surface, borderRadius: Radii.lg, overflow: 'hidden', ...Shadow.card },
  item: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  itemActive: { backgroundColor: Colors.primarySoft },
  itemText: { fontSize: 14, color: Colors.textPrimary, fontWeight: '500' },
  itemTextActive: { color: Colors.primary, fontWeight: '700' },
});

// ── Expense Row ───────────────────────────────────────────────────────────────
function ExpenseRow({ expense, isLast }) {
  const ICONS = { Utilities:'flash-on', 'Office Supplies':'edit', Travel:'flight', Meals:'restaurant', 'Software Subscriptions':'computer', Marketing:'campaign', Maintenance:'build', Other:'inventory-2' };
  return (
    <View style={[er.row, !isLast && er.border]}>
      <View style={er.iconBox}><MaterialIcons name={ICONS[expense.category] || 'inventory-2'} size={20} color={Colors.primary} /></View>
      <View style={er.body}>
        <Text style={er.category}>{expense.category}</Text>
        <Text style={er.desc} numberOfLines={1}>{expense.description || expense.date}</Text>
      </View>
      <Text style={er.amount}>{fmt(expense.amount)}</Text>
    </View>
  );
}
const er = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 16 },
  border: { borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  iconBox: { width: 40, height: 40, borderRadius: 10, backgroundColor: Colors.primarySoft, alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginRight: 12 },
  body: { flex: 1 },
  category: { fontSize: 14, fontWeight: '600', color: Colors.textPrimary },
  desc: { fontSize: 12, color: Colors.textSecondary, marginTop: 1 },
  amount: { fontSize: 15, fontWeight: '700', color: Colors.warning },
});

// ── Employee breakdown row ────────────────────────────────────────────────────
function BreakdownRow({ emp, isLast }) {
  const pct = emp.attendancePercentage || 0;
  const clr = pct >= 90 ? Colors.success : pct >= 70 ? Colors.warning : Colors.danger;
  return (
    <View style={[br.row, !isLast && br.border]}>
      <View style={[br.avatar, { backgroundColor: avatarColor(emp.name) }]}>
        <Text style={br.avatarText}>{initials(emp.name)}</Text>
      </View>
      <View style={br.info}>
        <Text style={br.name}>{emp.name}</Text>
        <Text style={br.dept}>{emp.department}</Text>
      </View>
      <View style={br.right}>
        <Text style={[br.earned, { color: Colors.primary }]}>{fmt(emp.effectiveSalary)}</Text>
        <View style={[br.pctPill, { backgroundColor: clr + '22' }]}>
          <Text style={[br.pctText, { color: clr }]}>{pct}%</Text>
        </View>
      </View>
    </View>
  );
}
const br = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16 },
  border: { borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  avatar: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginRight: 12 },
  avatarText: { color: Colors.white, fontSize: 13, fontWeight: '700' },
  info: { flex: 1 },
  name: { fontSize: 14, fontWeight: '600', color: Colors.textPrimary },
  dept: { fontSize: 11, color: Colors.textMuted, marginTop: 1 },
  right: { alignItems: 'flex-end' },
  earned: { fontSize: 14, fontWeight: '700', marginBottom: 4 },
  pctPill: { borderRadius: Radii.full, paddingHorizontal: 8, paddingVertical: 2 },
  pctText: { fontSize: 11, fontWeight: '700' },
});

// ── Chart config ──────────────────────────────────────────────────────────────
const chartCfg = {
  backgroundGradientFrom: Colors.surface,
  backgroundGradientTo: Colors.surface,
  backgroundGradientFromOpacity: 1,
  backgroundGradientToOpacity: 1,
  color: (opacity = 1) => `rgba(61,53,200,${opacity})`,
  labelColor: () => Colors.textMuted,
  strokeWidth: 2.5,
  barPercentage: 0.6,
  decimalPlaces: 0,
  propsForLabels: { fontSize: 11 },
  propsForBackgroundLines: { stroke: Colors.borderLight, strokeDasharray: '' },
};

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function AnalyticsDashboardScreen() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod]   = useState('This Week');
  const [showAllExp, setShowAllExp] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await analyticsAPI.getSummary();
      setData(res.data);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, []);

  const { t } = useI18n();

  const expenseRows = data?.trends
    ? data.trends.slice(-1).map((t) => ({
        category: 'General Expenses',
        description: t.label,
        amount: t.expenseCost,
        date: t.month,
      }))
    : [];

  // Build attendance chart arrays
  const attRates = data?.attendanceRates || [];
  const barLabels = attRates.map(d => d.label || '');
  const barData   = attRates.map(d => d.rate || 0);

  // Build 6-month line chart
  const trends = data?.trends || [];
  const lineLabels = trends.map(t => t.label || '');
  const salaryData = trends.map(t => t.salaryCost || 0);
  const expData    = trends.map(t => t.expenseCost || 0);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={{ color: Colors.textSecondary, marginTop: 12, fontSize: 14 }}>{t('analytics.loadingAnalytics')}</Text>
      </View>
    );
  }

  return (
    <ScrollView style={s.root} contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

      {/* ── Page title ───────────────────────────────────────────── */}
      <View style={s.pageHeader}>
        <Text style={s.pageTitle}>{t('analytics.title')}</Text>
        <TouchableOpacity onPress={load} style={{ flexDirection:'row', alignItems:'center' }}>
          <MaterialIcons name="refresh" size={16} color={Colors.primary} />
          <Text style={s.refreshBtn}> Refresh</Text>
        </TouchableOpacity>
      </View>

      {/* ── KPI metric cards ─────────────────────────────────────── */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 4 }}>
        <MetricCard label="TOTAL SALARY SPEND" value={fmt(data?.currentMonthSalaryCost || 0)}
          delta="+4.2%" deltaPositive={false} icon="work" />
        <MetricCard label="GENERAL EXPENSES" value={fmt(data?.currentMonthExpenseCost || 0)}
          delta="-1.5%" deltaPositive={true} icon="receipt" />
        <MetricCard label="TOTAL COST" value={fmt(data?.currentMonthTotalCost || 0)}
          delta="+3.1%" deltaPositive={false} icon="bar-chart" />
      </ScrollView>

      {/* ── Attendance Trends chart card ─────────────────────────── */}
      {barData.length > 0 && (
        <View style={s.card}>
          <View style={s.cardHeader}>
            <Text style={s.cardTitle}>Attendance Trends</Text>
            <PeriodPicker value={period} onChange={setPeriod} />
          </View>
          <View style={s.divider} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 12 }}>
            <BarChart
              data={{
                labels: barLabels,
                datasets: [{
                  data: barData,
                  colors: barData.map((_, i) =>
                    () => i === barData.length - 2 ? Colors.chartBarActive : Colors.chartBar
                  ),
                }],
              }}
              width={Math.max(CHART_W - 48, barLabels.length * 58)}
              height={196}
              yAxisSuffix="%"
              fromZero
              withCustomBarColorFromData
              flatColor
              showValuesOnTopOfBars={false}
              chartConfig={{ ...chartCfg }}
              style={{ borderRadius: Radii.md, marginTop: 4 }}
            />
          </ScrollView>
        </View>
      )}

      {/* ── 6-month line chart ───────────────────────────────────── */}
      {lineLabels.length > 0 && (
        <View style={s.card}>
          <View style={s.cardHeader}>
            <Text style={s.cardTitle}>6-Month Trend</Text>
            <View style={s.legendRow}>
              <View style={[s.legendDot, { backgroundColor: Colors.chartLine1 }]} />
              <Text style={s.legendText}>Salary</Text>
              <View style={[s.legendDot, { backgroundColor: Colors.chartLine2 }]} />
              <Text style={s.legendText}>Expenses</Text>
            </View>
          </View>
          <View style={s.divider} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 12 }}>
            <LineChart
              data={{
                labels: lineLabels,
                datasets: [
                  { data: salaryData.length > 0 ? salaryData : [0], color: (o = 1) => `rgba(61,53,200,${o})`, strokeWidth: 2.5 },
                  { data: expData.length > 0 ? expData : [0], color: (o = 1) => `rgba(249,115,22,${o})`, strokeWidth: 2.5 },
                ],
              }}
              width={Math.max(CHART_W - 48, lineLabels.length * 72)}
              height={200}
              yAxisLabel="₹"
              fromZero
              bezier
              chartConfig={{ ...chartCfg }}
              style={{ borderRadius: Radii.md, marginTop: 4 }}
              withDots
            />
          </ScrollView>
        </View>
      )}

      {/* ── Recent Expenses list ─────────────────────────────────── */}
      <View style={s.card}>
        <View style={s.cardHeader}>
          <Text style={s.cardTitle}>Recent Expenses</Text>
          <TouchableOpacity onPress={() => setShowAllExp(v => !v)}>
            <Text style={s.viewAll}>{showAllExp ? 'Show Less' : 'View All'}</Text>
          </TouchableOpacity>
        </View>
        <View style={s.divider} />
        {(data?.trends || []).length === 0 ? (
          <Text style={s.emptyText}>No expense data available.</Text>
        ) : (
          (data?.trends || [])
            .slice(showAllExp ? 0 : -3)
            .reverse()
            .map((t, i, arr) => (
              <ExpenseRow key={t.month}
                expense={{ category: 'Monthly Total', description: t.label, amount: t.expenseCost, date: t.month }}
                isLast={i === arr.length - 1}
              />
            ))
        )}
      </View>

      {/* ── Employee Salary Breakdown ────────────────────────────── */}
      <View style={s.card}>
        <View style={s.cardHeader}>
          <Text style={s.cardTitle}>Salary Breakdown</Text>
          <Text style={s.subCaption}>Current month</Text>
        </View>
        <View style={s.divider} />
        {(data?.employeeBreakdown || []).length === 0 ? (
          <Text style={s.emptyText}>No data.</Text>
        ) : (
          (data.employeeBreakdown).map((emp, i, arr) => (
            <BreakdownRow key={emp.employeeId} emp={emp} isLast={i === arr.length - 1} />
          ))
        )}

        {/* Total row */}
        {(data?.employeeBreakdown || []).length > 0 && (
          <View style={s.totalRow}>
            <Text style={s.totalLabel}>Total Salary Cost</Text>
            <Text style={s.totalValue}>
              {fmt(data.employeeBreakdown.reduce((s, e) => s + e.effectiveSalary, 0))}
            </Text>
          </View>
        )}
      </View>

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingBottom: 20 },
  pageHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 18, paddingBottom: 10 },
  pageTitle: { fontSize: 22, fontWeight: '800', color: Colors.textPrimary },
  refreshBtn: { fontSize: 13, color: Colors.primary, fontWeight: '600' },
  card: {
    backgroundColor: Colors.surface, borderRadius: Radii.lg,
    marginHorizontal: 16, marginTop: 16, overflow: 'hidden', ...Shadow.card,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 },
  cardTitle: { ...Typography.sectionTitle },
  viewAll: { fontSize: 13, fontWeight: '600', color: Colors.primary },
  subCaption: { fontSize: 12, color: Colors.textMuted },
  divider: { height: 1, backgroundColor: Colors.borderLight },
  emptyText: { textAlign: 'center', color: Colors.textMuted, padding: 24, fontSize: 14 },
  legendRow: { flexDirection: 'row', alignItems: 'center' },
  legendDot: { width: 10, height: 10, borderRadius: 5, marginRight: 4 },
  legendText: { fontSize: 11, color: Colors.textSecondary, fontWeight: '500', marginRight: 4 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderTopWidth: 1, borderTopColor: Colors.border, backgroundColor: Colors.primarySoft },
  totalLabel: { fontSize: 14, fontWeight: '700', color: Colors.primary },
  totalValue: { fontSize: 18, fontWeight: '800', color: Colors.primary },
});
