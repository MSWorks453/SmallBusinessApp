/**
 * src/screens/ReportsScreen.js
 * Reports tab — per-employee payroll table, one month at a time.
 *
 * Columns: Name · Number of Days · Leaves · Payment
 *
 * ── Column meanings ─────────────────────────────────────────────────────────
 * Number of Days   Attendance-weighted days worked: Present counts 1, Half-Day
 *                  counts 0.5. This is the figure Payment is derived from, so
 *                  showing a raw count of days present instead would leave the
 *                  two columns unable to explain each other.
 * Leaves           Days explicitly marked Absent. Days nobody recorded are not
 *                  counted as leave.
 * Payment          Number of Days / days logged that month × base salary.
 *
 * All of it comes from GET /api/reports/employees, which shares its formula with
 * the dashboard and the payslips so the same month never reports two different
 * totals.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Modal, RefreshControl,
} from 'react-native';
import { reportsAPI } from '../services/api';
import { useI18n } from '../i18n';
import { MaterialIcons } from '../components/shared/Icon';
import { Colors, Radii, Shadow, Typography } from '../theme/colors';

// ── helpers ───────────────────────────────────────────────────────────────────
function money(n) {
  return `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}
function avatarColor(name = '') {
  const p = Colors.avatar;
  let sum = 0;
  for (const c of name) sum += c.charCodeAt(0);
  return p[sum % p.length];
}
function initials(name = '') {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}
/**
 * Trims a trailing '.0' so whole numbers read as "20" while halves stay "20.5".
 * Half-days make fractional totals legitimate, so they cannot just be rounded.
 */
function days(n) {
  const value = Number(n || 0);
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

// ── Month select box ──────────────────────────────────────────────────────────
/**
 * React Native has no native select, so this is a field that opens a sheet.
 * Only months the server says have data are offered, which means the picker can
 * never land on an empty report.
 */
function MonthSelect({ value, label, options, onChange }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <>
      <TouchableOpacity
        style={ms.field}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={t('reports.selectMonth')}
      >
        <MaterialIcons name="event" size={18} color={Colors.primary} />
        <View style={ms.fieldBody}>
          <Text style={ms.fieldLabel}>{t('reports.month')}</Text>
          <Text style={ms.fieldValue}>{label || value}</Text>
        </View>
        <MaterialIcons name="expand-more" size={22} color={Colors.textMuted} />
      </TouchableOpacity>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={ms.backdrop} activeOpacity={1} onPress={() => setOpen(false)}>
          <View style={ms.sheet}>
            <View style={ms.sheetHeader}>
              <Text style={ms.sheetTitle}>{t('reports.selectMonth')}</Text>
              <TouchableOpacity onPress={() => setOpen(false)} accessibilityRole="button">
                <MaterialIcons name="close" size={22} color={Colors.textMuted} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 360 }}>
              {options.map((opt) => {
                const active = opt.month === value;
                return (
                  <TouchableOpacity
                    key={opt.month}
                    style={[ms.option, active && ms.optionActive]}
                    onPress={() => { onChange(opt.month); setOpen(false); }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                  >
                    <Text style={[ms.optionText, active && ms.optionTextActive]}>{opt.label}</Text>
                    {active ? <MaterialIcons name="check" size={18} color={Colors.primary} /> : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}
const ms = StyleSheet.create({
  field: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface,
    borderRadius: Radii.lg, paddingHorizontal: 14, paddingVertical: 12,
    marginBottom: 14, ...Shadow.card,
  },
  fieldBody: { flex: 1, marginLeft: 12 },
  fieldLabel: { fontSize: 11, color: Colors.textMuted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.6 },
  fieldValue: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary, marginTop: 2 },
  backdrop: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: Colors.surface, borderTopLeftRadius: Radii.xl, borderTopRightRadius: Radii.xl, paddingBottom: 28 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 18, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  sheetTitle: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary },
  option: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  optionActive: { backgroundColor: Colors.primarySoft },
  optionText: { fontSize: 15, color: Colors.textPrimary },
  optionTextActive: { color: Colors.primary, fontWeight: '700' },
});

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function ReportsScreen() {
  const { t } = useI18n();

  const [month, setMonth]     = useState(null); // null → server picks current
  const [report, setReport]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]     = useState('');

  const load = useCallback(async (targetMonth, isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    setError('');
    try {
      const res = await reportsAPI.getEmployeeMonthly(targetMonth);
      setReport(res.data);
      // Adopt the month the server actually used, so the picker label and the
      // table can never drift apart.
      setMonth(res.data.month);
    } catch (e) {
      setError(e.message || t('reports.loadFailed'));
    } finally {
      isRefresh ? setRefreshing(false) : setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(null); }, []);

  const rows    = report?.employees || [];
  const totals  = report?.totals;
  const options = report?.availableMonths || [];
  const currentLabel = options.find((o) => o.month === month)?.label || report?.monthLabel;

  return (
    <View style={s.root}>
      <ScrollView
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => load(month, true)} tintColor={Colors.primary} />
        }
      >
        <MonthSelect
          value={month}
          label={currentLabel}
          options={options}
          onChange={(m) => load(m)}
        />

        {error ? (
          <View style={s.errBanner}>
            <MaterialIcons name="warning" size={16} color={Colors.danger} />
            <Text style={s.errText}> {error}</Text>
          </View>
        ) : null}

        {loading ? (
          <ActivityIndicator color={Colors.primary} style={{ marginTop: 40 }} />
        ) : (
          <View style={s.card}>
            <View style={s.cardHead}>
              <Text style={s.cardTitle}>{t('reports.payrollTitle')}</Text>
              <Text style={s.cardSub}>
                {t('reports.summaryLine', {
                  count: rows.length,
                  days: days(report?.daysLogged),
                })}
              </Text>
            </View>

            {/* Column headers */}
            <View style={[s.row, s.headRow]}>
              <Text style={[s.nameCol, s.headCell]}>{t('reports.colName')}</Text>
              <Text style={[s.numCol, s.headCell]}>{t('reports.colDays')}</Text>
              <Text style={[s.numCol, s.headCell]}>{t('reports.colLeaves')}</Text>
              <Text style={[s.payCol, s.headCell]}>{t('reports.colPayment')}</Text>
            </View>

            {rows.length === 0 ? (
              <Text style={s.empty}>{t('reports.noData')}</Text>
            ) : (
              rows.map((r, i) => (
                <View key={r.employeeId} style={[s.row, i < rows.length - 1 && s.rowBorder]}>
                  <View style={[s.nameCol, s.nameWrap]}>
                    <View style={[s.avatar, { backgroundColor: avatarColor(r.name) }]}>
                      <Text style={s.avatarText}>{initials(r.name)}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.name} numberOfLines={1}>{r.name}</Text>
                      {/* The Present/Half split explains a fractional day count
                          without adding a column the brief did not ask for. */}
                      <Text style={s.sub} numberOfLines={1}>
                        {t('reports.presentHalf', { present: r.presentDays, half: r.halfDays })}
                      </Text>
                      {r.status !== 'active' ? (
                        <Text style={s.inactive}>{t('reports.inactive')}</Text>
                      ) : null}
                    </View>
                  </View>
                  <Text style={[s.numCol, s.num]}>{days(r.daysWorked)}</Text>
                  <Text style={[s.numCol, s.num, r.leaves > 0 && { color: Colors.danger }]}>
                    {r.leaves}
                  </Text>
                  <Text style={[s.payCol, s.pay]}>{money(r.payment)}</Text>
                </View>
              ))
            )}

            {rows.length > 0 && totals ? (
              <View style={[s.row, s.totalRow]}>
                <Text style={[s.nameCol, s.totalLabel]}>{t('total')}</Text>
                <Text style={[s.numCol, s.num, s.totalVal]}>{days(totals.daysWorked)}</Text>
                <Text style={[s.numCol, s.num, s.totalVal]}>{totals.leaves}</Text>
                <Text style={[s.payCol, s.pay, s.totalVal]}>{money(totals.payment)}</Text>
              </View>
            ) : null}
          </View>
        )}

        {/* Says plainly what the numbers mean, so nobody has to guess whether
            "Number of Days" counts half-days. */}
        {!loading && rows.length > 0 ? (
          <View style={s.legend}>
            <Text style={s.legendText}>{t('reports.legendDays')}</Text>
            <Text style={s.legendText}>{t('reports.legendLeaves')}</Text>
            <Text style={s.legendText}>{t('reports.legendPayment')}</Text>
            {report?.scopedToRoles?.length === 1 ? (
              <Text style={s.legendText}>
                {t('reports.legendScope', { roles: report.scopedToRoles.join(', ') })}
              </Text>
            ) : null}
          </View>
        ) : null}

        <View style={{ height: 32 }} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: 16, paddingBottom: 24 },

  card: { backgroundColor: Colors.surface, borderRadius: Radii.lg, overflow: 'hidden', ...Shadow.card },
  cardHead: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 10 },
  cardTitle: { ...Typography.sectionTitle },
  cardSub: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },

  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, paddingHorizontal: 12 },
  headRow: { backgroundColor: Colors.primary },
  headCell: { color: Colors.white, fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.borderLight },

  nameCol: { flex: 2.6, textAlign: 'left' },
  numCol:  { flex: 1, textAlign: 'center' },
  payCol:  { flex: 1.5, textAlign: 'right' },

  nameWrap: { flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginRight: 9 },
  avatarText: { color: Colors.white, fontSize: 11, fontWeight: '700' },
  name: { fontSize: 13.5, fontWeight: '600', color: Colors.textPrimary },
  sub: { fontSize: 11, color: Colors.textMuted, marginTop: 1 },
  inactive: { fontSize: 10, color: Colors.warningText, fontWeight: '600', marginTop: 1 },

  num: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary },
  pay: { fontSize: 13.5, fontWeight: '700', color: Colors.primary },

  totalRow: { backgroundColor: Colors.primarySoft },
  totalLabel: { fontSize: 13, fontWeight: '800', color: Colors.primary },
  totalVal: { color: Colors.primary, fontWeight: '800' },

  empty: { textAlign: 'center', color: Colors.textMuted, padding: 28, fontSize: 14 },

  errBanner: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.dangerLight, borderRadius: Radii.md, padding: 12, borderLeftWidth: 3, borderLeftColor: Colors.danger, marginBottom: 12 },
  errText: { color: Colors.danger, fontSize: 13, fontWeight: '600', flex: 1 },

  legend: { marginTop: 14, paddingHorizontal: 4 },
  legendText: { fontSize: 11, color: Colors.textMuted, lineHeight: 17 },
});
