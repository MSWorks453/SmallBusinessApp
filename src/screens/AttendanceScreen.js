/**
 * src/screens/AttendanceScreen.js
 * Time tab — FinTrack design.
 *
 * Layout:
 *  - Date strip: ‹  Aug 15, 2026  › with "Today" shortcut
 *  - Summary chips: Present / Half-Day / Absent counts
 *  - Employee list — each row has avatar, name, dept, then 3 status pills
 *  - Save button (indigo, full width)
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, Platform,
} from 'react-native';
import { attendanceAPI } from '../services/api';
import { useI18n } from '../i18n';
import { MaterialIcons } from '../components/shared/Icon';
import { Colors, Radii, Shadow, Typography } from '../theme/colors';

const STATUSES = ['Present','Half-Day','Absent'];
const STATUS_CFG = {
  Present:  { icon:'check-circle', color: Colors.successText,  bg: Colors.successBg   },
  'Half-Day':{ icon:'wb-sunny',  color: Colors.warningText,  bg: Colors.warningBg   },
  Absent:   { icon:'cancel', color: Colors.danger,        bg: Colors.dangerLight },
};

/**
 * The device's calendar date. Used only as a first guess before the server
 * replies; `serverToday` replaces it as soon as the roster loads.
 *
 * toISOString() is UTC, so this can name the wrong day — in IST it reports
 * yesterday until 05:30. That is exactly why the server's answer wins.
 */
function deviceToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fmtDateDisplay(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
}
function shiftDate(iso, delta) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}
function avatarColor(name = '') {
  const p = Colors.avatar; let s = 0;
  for (const c of name) s += c.charCodeAt(0);
  return p[s % p.length];
}
function initials(name = '') {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

// ── Status toggle row ─────────────────────────────────────────────────────────
function StatusToggle({ value, onChange }) {
  return (
    <View style={st.row}>
      {STATUSES.map(s => {
        const cfg = STATUS_CFG[s];
        const active = value === s;
        return (
          <TouchableOpacity key={s} style={[st.btn, active && { backgroundColor: cfg.bg, borderColor: cfg.color }]}
            onPress={() => onChange(s)} accessibilityRole="radio" accessibilityState={{ selected: active }}>
            <MaterialIcons name={cfg.icon} size={16} color={active ? cfg.color : Colors.textMuted} />
            <Text style={[st.btnText, { color: active ? cfg.color : Colors.textMuted }]}>{s}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
const st = StyleSheet.create({
  row: { flexDirection:'row' },
  btn: { flex:1, alignItems:'center', paddingVertical:8, borderRadius: Radii.md, borderWidth:1.5, borderColor: Colors.border, backgroundColor: Colors.surface, marginRight:6 },
  btnIcon: { fontSize:15, marginBottom:2 },
  btnText: { fontSize:10, fontWeight:'600' },
});

// ── Employee Attendance Row ────────────────────────────────────────────────────
function AttRow({ emp, status, onChange }) {
  return (
    <View style={ar.wrap}>
      <View style={ar.top}>
        <View style={[ar.avatar, { backgroundColor: avatarColor(emp.name) }]}>
          <Text style={ar.avatarText}>{initials(emp.name)}</Text>
        </View>
        <View>
          <Text style={ar.name}>{emp.name}</Text>
          <Text style={ar.dept}>{emp.department} · {emp.position}</Text>
        </View>
      </View>
      <StatusToggle value={status} onChange={onChange} />
    </View>
  );
}
const ar = StyleSheet.create({
  wrap: { paddingHorizontal:16, paddingVertical:14, borderBottomWidth:1, borderBottomColor: Colors.borderLight },
  top: { flexDirection:'row', alignItems:'center', marginBottom:10 },
  avatar: { width:40, height:40, borderRadius:20, alignItems:'center', justifyContent:'center', flexShrink:0, marginRight:10 },
  avatarText: { color: Colors.white, fontWeight:'700', fontSize:14 },
  name: { fontSize:15, fontWeight:'600', color: Colors.textPrimary },
  dept: { fontSize:12, color: Colors.textMuted },
});

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function AttendanceScreen() {
  // The roster is NOT the staff directory. An ADMIN sees every employee under
  // Staff but may only mark HR here, so this screen asks the server who it is
  // allowed to record rather than reusing the shared `employees` list.
  const [roster, setRoster]         = useState([]);
  const [rosterRoles, setRosterRoles] = useState([]);
  const [rosterLoading, setRosterLoading] = useState(true);
  const [rosterErr, setRosterErr]   = useState('');
  // The server's calendar date, which is what the future-date rule is judged
  // against. Seeded from the device only so the first render has something.
  const [serverToday, setServerToday] = useState(deviceToday());

  const [date, setDate]         = useState(deviceToday());
  const [logs, setLogs]         = useState({});
  const [loading, setLoading]   = useState(false);
  const [saving, setSaving]     = useState(false);
  const [saved, setSaved]       = useState(false);
  const [saveErr, setSaveErr]   = useState('');

  /**
   * Loads the roster for a date and that date's existing logs together.
   *
   * These are one operation, not two: the roster depends on the date (people who
   * had not joined yet are excluded), so changing the date has to refetch both.
   * Fetching them separately let the roster and the logs disagree for a frame.
   */
  const loadForDate = useCallback(async (d) => {
    setRosterLoading(true); setLoading(true);
    setRosterErr(''); setSaved(false); setSaveErr('');

    try {
      const rosterRes = await attendanceAPI.getRoster(d);
      const people = rosterRes.data.employees || [];

      setRoster(people);
      setRosterRoles(rosterRes.data.roles || []);
      if (rosterRes.data.today) setServerToday(rosterRes.data.today);

      // Default everyone to Present, then overlay whatever is already recorded.
      const next = {};
      people.forEach(e => { next[e.id] = 'Present'; });

      try {
        const dayRes = await attendanceAPI.getByDate(d);
        // Only overlay people on this roster: the day's response also carries
        // rows for staff this user does not mark.
        (dayRes.data.logs || []).forEach(l => {
          if (l.employeeId in next) next[l.employeeId] = l.status;
        });
      } catch {
        // No record for that day yet — the Present defaults stand.
      }

      setLogs(next);
    } catch (e) {
      setRoster([]);
      setLogs({});
      setRosterErr(e.message || 'Could not load the roster.');
    } finally {
      setRosterLoading(false);
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadForDate(date); }, [date, loadForDate]);

  function setStatus(empId, s) { setLogs(p => ({ ...p, [empId]: s })); setSaved(false); }
  function goDay(delta) {
    setDate(d => {
      const next = shiftDate(d, delta);
      // Forward navigation stops at the server's today. The API rejects future
      // dates anyway; this just avoids offering a move that cannot succeed.
      return next > serverToday ? d : next;
    });
  }
  function setToday() { setDate(serverToday); }

  const isToday    = date === serverToday;
  const canGoForward = date < serverToday;

  // Summary counts
  const counts = roster.reduce((acc, e) => {
    const st = logs[e.id] || 'Present';
    acc[st] = (acc[st] || 0) + 1;
    return acc;
  }, {});

  // e.g. 'HR' or 'EMPLOYEE' → a readable subtitle for the card.
  const scopeLabel = rosterRoles.length > 0
    ? rosterRoles.map(r => (r === 'EMPLOYEE' ? 'employees' : `${r} staff`)).join(' and ')
    : 'nobody';

  async function handleSave() {
    if (roster.length === 0) return;
    setSaving(true); setSaved(false); setSaveErr('');
    const logsArr = roster.map(e => ({ employeeId: e.id, status: logs[e.id] || 'Absent' }));
    try {
      await attendanceAPI.submitDailyLogs(date, logsArr);
      setSaved(true);
    } catch (e) {
      setSaveErr(e.message || 'Save failed.');
      // A future-date or joining-date rejection means our idea of the roster is
      // stale — the clock may have rolled over, or someone's join date changed.
      if (e.code === 'FUTURE_DATE' || e.code === 'BEFORE_JOIN_DATE') {
        loadForDate(date);
      }
    }
    finally { setSaving(false); }
  }

  return (
    <View style={s.root}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

        {/* ── Date navigator ─────────────────────────────────────── */}
        <View style={s.dateCard}>
          <TouchableOpacity style={s.dateNavBtn} onPress={() => goDay(-1)} accessibilityRole="button" accessibilityLabel="Previous day">
            <MaterialIcons name="chevron-left" size={24} color={Colors.primary} />
          </TouchableOpacity>
          <View style={s.dateMid}>
            <Text style={s.dateText}>{fmtDateDisplay(date)}</Text>
            {!isToday && (
              <TouchableOpacity onPress={setToday} accessibilityRole="button">
                <Text style={s.todayLink}>Jump to Today</Text>
              </TouchableOpacity>
            )}
            {isToday && <Text style={s.todayBadge}>Today</Text>}
          </View>
          <TouchableOpacity style={[s.dateNavBtn, !canGoForward && s.dateNavBtnDisabled]}
            onPress={() => canGoForward && goDay(1)}
            disabled={!canGoForward}
            accessibilityRole="button"
            accessibilityLabel="Next day"
            accessibilityState={{ disabled: !canGoForward }}>
            <MaterialIcons name="chevron-right" size={24} color={!canGoForward ? Colors.textMuted : Colors.primary} />
          </TouchableOpacity>
        </View>

        {/* ── Summary chips ───────────────────────────────────────── */}
        {roster.length > 0 && !loading && (
          <View style={s.summaryRow}>
            {STATUSES.map(st => {
              const cfg = STATUS_CFG[st];
              return (
                <View key={st} style={[s.chip, { backgroundColor: cfg.bg }]}>
                  <MaterialIcons name={cfg.icon} size={14} color={cfg.color} style={s.chipIcon} />
                  <Text style={[s.chipCount, { color: cfg.color }]}>{counts[st] || 0}</Text>
                  <Text style={[s.chipLabel, { color: cfg.color }]}>{st}</Text>
                </View>
              );
            })}
          </View>
        )}

        {/* ── Attendance matrix card ──────────────────────────────── */}
        <View style={s.card}>
          <Text style={s.cardTitle}>Mark Attendance</Text>
          {/* Names whose attendance this is, so the shorter-than-expected list
              reads as intentional rather than as missing data. */}
          {/* Names the scope and the joining-date rule, so a list shorter than
              the full team reads as intentional rather than as missing data. */}
          <Text style={s.cardSub}>
            {roster.length} {scopeLabel} employed on {fmtDateDisplay(date)}
          </Text>
          <View style={s.divider} />

          {rosterErr ? (
            <Text style={s.emptyText}>{rosterErr}</Text>
          ) : rosterLoading || loading ? (
            <ActivityIndicator color={Colors.primary} style={{ paddingVertical:32 }} />
          ) : roster.length === 0 ? (
            <Text style={s.emptyText}>
              Nobody to mark on {fmtDateDisplay(date)}.{'\n\n'}
              You record attendance for {scopeLabel}, and only for staff who had
              already joined by this date.
            </Text>
          ) : (
            roster.map(emp => (
              <AttRow key={emp.id} emp={emp}
                status={logs[emp.id] || 'Present'}
                onChange={s => setStatus(emp.id, s)} />
            ))
          )}
        </View>

        {/* ── Feedback ────────────────────────────────────────────── */}
        {saved && (
          <View style={s.successBanner}>
            <MaterialIcons name="check-circle" size={16} color={Colors.successText} />
            <Text style={s.successText}> Attendance saved for {fmtDateDisplay(date)}</Text>
          </View>
        )}
        {saveErr ? (
          <View style={s.errBanner}><MaterialIcons name="warning" size={16} color={Colors.danger} /><Text style={s.errText}> {saveErr}</Text></View>
        ) : null}

        {/* ── Save button ──────────────────────────────────────────── */}
        <TouchableOpacity style={[s.saveBtn, (saving || roster.length === 0) && s.saveBtnDisabled]}
          onPress={handleSave} disabled={saving || roster.length === 0} accessibilityRole="button">
          {saving ? <ActivityIndicator color={Colors.white} /> : (
            <Text style={s.saveBtnText}><MaterialIcons name="save" size={16} color={Colors.white} />  Save Attendance</Text>
          )}
        </TouchableOpacity>

        <View style={{ height: 32 }} />
      </ScrollView>
    </View>
  );
}
const s = StyleSheet.create({
  root: { flex:1, backgroundColor: Colors.background },
  scroll: { padding:16, paddingBottom:20 },

  dateCard: { flexDirection:'row', alignItems:'center', backgroundColor: Colors.surface, borderRadius: Radii.lg, padding:12, marginBottom:14, ...Shadow.card },
  dateNavBtn: { width:40, height:40, borderRadius: Radii.md, backgroundColor: Colors.primarySoft, alignItems:'center', justifyContent:'center' },
  dateNavBtnDisabled: { backgroundColor: Colors.borderLight },
  dateNavIcon: { fontSize:26, color: Colors.primary, fontWeight:'300', lineHeight:30 },
  dateMid: { flex:1, alignItems:'center' },
  dateText: { fontSize:17, fontWeight:'700', color: Colors.textPrimary, marginBottom:4 },
  todayLink: { fontSize:12, color: Colors.primary, fontWeight:'600' },
  todayBadge: { fontSize:11, color: Colors.primary, fontWeight:'700', backgroundColor: Colors.primarySoft, paddingHorizontal:10, paddingVertical:2, borderRadius: Radii.full },

  summaryRow: { flexDirection:'row', marginBottom:14 },
  chip: { flex:1, flexDirection:'row', alignItems:'center', justifyContent:'center', paddingVertical:10, borderRadius: Radii.md, marginRight:8 },
  chipIcon: { fontSize:16, marginRight:4 },
  chipCount: { fontSize:18, fontWeight:'800', marginRight:4 },
  chipLabel: { fontSize:10, fontWeight:'600' },

  card: { backgroundColor: Colors.surface, borderRadius: Radii.lg, overflow:'hidden', ...Shadow.card, marginBottom:14 },
  cardTitle: { ...Typography.sectionTitle, paddingHorizontal:16, paddingTop:16 },
  cardSub: { fontSize:12, color: Colors.textMuted, paddingHorizontal:16, paddingBottom:8 },
  divider: { height:1, backgroundColor: Colors.borderLight },
  emptyText: { textAlign:'center', color: Colors.textMuted, padding:24, fontSize:14 },

  successBanner: { backgroundColor: Colors.successBg, borderRadius: Radii.md, padding:14, borderLeftWidth:3, borderLeftColor: Colors.success, marginBottom:12 },
  successText: { color: Colors.successText, fontSize:14, fontWeight:'600' },
  errBanner: { backgroundColor: Colors.dangerLight, borderRadius: Radii.md, padding:14, borderLeftWidth:3, borderLeftColor: Colors.danger, marginBottom:12 },
  errText: { color: Colors.danger, fontSize:14, fontWeight:'600' },

  saveBtn: { backgroundColor: Colors.primary, borderRadius: Radii.lg, paddingVertical:16, alignItems:'center', justifyContent:'center', ...Shadow.fab },
  saveBtnDisabled: { opacity:0.6 },
  saveBtnText: { color: Colors.white, fontSize:16, fontWeight:'700' },
});
