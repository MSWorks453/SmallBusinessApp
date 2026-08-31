/**
 * src/screens/EmployeePortalScreen.js
 * Portal tab — FinTrack design.
 * Personal payslip + attendance log for the logged-in employee.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { useAppContext } from '../context/AppContext';
import { analyticsAPI, attendanceAPI } from '../services/api';
import { useI18n } from '../i18n';
import { MaterialIcons } from '../components/shared/Icon';
import { Colors, Radii, Shadow, Typography } from '../theme/colors';

function fmtCur(n) {
  return `₹${Number(n).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
}
function currentYM() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}
function shiftMonth(ym, delta) {
  const [y,m] = ym.split('-').map(Number);
  const d = new Date(y,m-1+delta,1);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}
function monthLabel(ym) {
  const [y,m] = ym.split('-');
  return new Date(parseInt(y),parseInt(m)-1,1).toLocaleString('en-US',{month:'long',year:'numeric'});
}
const STATUS_CFG = {
  Present:   { icon:'check-circle', color: Colors.successText,  bg: Colors.successBg   },
  'Half-Day':{ icon:'wb-sunny',  color: Colors.warningText,  bg: Colors.warningBg   },
  Absent:    { icon:'cancel', color: Colors.danger,        bg: Colors.dangerLight },
  Unknown:   { icon:'help-outline', color: Colors.textMuted,     bg: Colors.borderLight },
};
const W = { Present:1.0, 'Half-Day':0.5, Absent:0.0 };

export default function EmployeePortalScreen() {
  const { currentUser, employees, fetchEmployees } = useAppContext();
  const [selectedMonth, setSelectedMonth] = useState(currentYM());
  const [analyticsData, setAnalyticsData] = useState(null);
  const [allAtt, setAllAtt]               = useState([]);
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState('');

  const myEmployee = employees.find(e => e.id === currentUser?.employeeId);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      if (employees.length === 0) await fetchEmployees();
      const [ar, at] = await Promise.all([analyticsAPI.getSummary(), attendanceAPI.getAll()]);
      setAnalyticsData(ar.data);
      setAllAtt(at.data || []);
    } catch (e) { setError(e.message || 'Failed to load portal.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, []);

  // Compute payslip for selectedMonth
  const payslip = useMemo(() => {
    if (!myEmployee) return null;
    if (analyticsData && selectedMonth === analyticsData.currentMonth) {
      return analyticsData.employeeBreakdown?.find(r => r.employeeId === currentUser?.employeeId) || null;
    }
    const monthLogs = allAtt.filter(e => e.date.startsWith(selectedMonth));
    if (monthLogs.length === 0) return null;
    const totalDays = monthLogs.length;
    let present=0, half=0, absent=0, score=0;
    for (const day of monthLogs) {
      const lg = day.logs?.find(l => l.employeeId === currentUser?.employeeId);
      if (lg) {
        score += W[lg.status]??0;
        if (lg.status==='Present') present++;
        else if (lg.status==='Half-Day') half++;
        else absent++;
      }
    }
    const pct = Math.round((score/totalDays)*100);
    return { name:myEmployee.name, department:myEmployee.department,
      baseSalary:myEmployee.baseSalary, presentDays:present, halfDays:half,
      absentDays:absent, totalDaysLogged:totalDays,
      attendancePercentage:pct, effectiveSalary: parseFloat(((score/totalDays)*myEmployee.baseSalary).toFixed(2)) };
  }, [analyticsData, allAtt, selectedMonth, currentUser, myEmployee]);

  // Day log for selected month
  const dayLog = useMemo(() => {
    if (!currentUser?.employeeId) return [];
    return allAtt.filter(e => e.date.startsWith(selectedMonth))
      .sort((a,b) => a.date.localeCompare(b.date))
      .map(e => {
        const lg = e.logs?.find(l => l.employeeId===currentUser.employeeId);
        return { date:e.date, status: lg?.status||'Unknown' };
      });
  }, [allAtt, selectedMonth, currentUser]);

  const initials = myEmployee
    ? myEmployee.name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase()
    : currentUser?.avatar||'??';

  if (loading) {
    return (
      <View style={{flex:1,backgroundColor:Colors.background,alignItems:'center',justifyContent:'center'}}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={{color:Colors.textSecondary,fontSize:14,marginTop:12}}>Loading your portal…</Text>
      </View>
    );
  }

  const pct = payslip?.attendancePercentage||0;
  const pctColor = pct>=90?Colors.success:pct>=70?Colors.warning:Colors.danger;

  return (
    <ScrollView style={s.root} contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

      {/* ── Profile card ───────────────────────────────────────── */}
      <View style={s.profileCard}>
        <View style={[s.profileAvatar,{backgroundColor:Colors.primary}]}>
          <Text style={s.profileAvatarText}>{initials}</Text>
        </View>
        <View style={s.profileInfo}>
          <Text style={s.profileName}>{myEmployee?.name||currentUser?.name}</Text>
          <Text style={s.profilePos}>{myEmployee?.position||'Employee'}</Text>
          <Text style={s.profileDept}>{myEmployee?.department||currentUser?.department}</Text>
        </View>
        <TouchableOpacity style={s.refreshBtn} onPress={load} accessibilityRole="button">
          <MaterialIcons name="refresh" size={20} color={Colors.primary} />
        </TouchableOpacity>
      </View>

      {/* ── Month navigator ─────────────────────────────────────── */}
      <View style={s.monthNav}>
        <TouchableOpacity style={s.navBtn} onPress={()=>setSelectedMonth(m=>shiftMonth(m,-1))} accessibilityRole="button">
          <MaterialIcons name="chevron-left" size={24} color={Colors.primary} />
        </TouchableOpacity>
        <View style={s.monthMid}>
          <Text style={s.monthText}>{monthLabel(selectedMonth)}</Text>
          {selectedMonth===currentYM() && (
            <View style={s.currentBadge}><Text style={s.currentBadgeText}>Current</Text></View>
          )}
        </View>
        <TouchableOpacity style={[s.navBtn, selectedMonth>=currentYM()&&s.navBtnDisabled]}
          onPress={()=>{ if(selectedMonth<currentYM()) setSelectedMonth(m=>shiftMonth(m,1)); }}
          disabled={selectedMonth>=currentYM()} accessibilityRole="button">
          <MaterialIcons name="chevron-right" size={24} color={selectedMonth>=currentYM() ? Colors.textMuted : Colors.primary} />
        </TouchableOpacity>
      </View>

      {/* ── Payslip card ────────────────────────────────────────── */}
      {payslip ? (
        <View style={s.payslipCard}>
          {/* Header strip */}
          <View style={s.payslipHeader}>
            <View>
              <Text style={s.payslipTitle}>Payslip</Text>
              <Text style={s.payslipPeriod}>{monthLabel(selectedMonth)}</Text>
            </View>
            <View style={s.payslipEarned}>
              <Text style={s.payslipEarnedLabel}>Net Earned</Text>
              <Text style={s.payslipEarnedValue}>{fmtCur(payslip.effectiveSalary)}</Text>
            </View>
          </View>

          {/* Attendance boxes */}
          <View style={s.attRow}>
            {[
              {label:'Present', count:payslip.presentDays, cfg:STATUS_CFG.Present},
              {label:'Half-Day',count:payslip.halfDays,    cfg:STATUS_CFG['Half-Day']},
              {label:'Absent',  count:payslip.absentDays,  cfg:STATUS_CFG.Absent},
              {label:'Total',   count:payslip.totalDaysLogged, cfg:{icon:'event',color:Colors.primary,bg:Colors.primarySoft}},
            ].map(item=>(
              <View key={item.label} style={[s.attBox,{backgroundColor:item.cfg.bg}]}>
                <MaterialIcons name={item.cfg.icon} size={16} color={item.cfg.color} style={s.attBoxIcon} />
                <Text style={[s.attBoxCount,{color:item.cfg.color}]}>{item.count}</Text>
                <Text style={s.attBoxLabel}>{item.label}</Text>
              </View>
            ))}
          </View>

          {/* Calc breakdown */}
          <View style={s.calcSection}>
            {[
              {label:'Base Monthly Salary', val: fmtCur(payslip.baseSalary)},
              {label:'Effective Days (P×1 + H×0.5)', val:`${(payslip.presentDays+payslip.halfDays*0.5).toFixed(1)}`},
              {label:'Total Logged Days', val:`${payslip.totalDaysLogged}`},
            ].map(r=>(
              <View key={r.label} style={s.calcRow}>
                <Text style={s.calcLabel}>{r.label}</Text>
                <Text style={s.calcVal}>{r.val}</Text>
              </View>
            ))}
            <View style={s.calcDivider}/>
            <View style={s.calcRow}>
              <Text style={s.calcLabel}>Attendance Rate</Text>
              <View style={[s.pctPill,{backgroundColor:pctColor+'22'}]}>
                <Text style={[s.pctText,{color:pctColor}]}>{pct}%</Text>
              </View>
            </View>
            <View style={[s.calcRow,{marginTop:4}]}>
              <Text style={[s.calcLabel,{fontWeight:'700',color:Colors.textPrimary}]}>Net Salary</Text>
              <Text style={[s.calcVal,{fontWeight:'800',fontSize:18,color:Colors.primary}]}>
                {fmtCur(payslip.effectiveSalary)}
              </Text>
            </View>
            <View style={s.formulaBox}>
              <Text style={s.formulaText}>
                ({(payslip.presentDays+payslip.halfDays*0.5).toFixed(1)} / {payslip.totalDaysLogged}) × {fmtCur(payslip.baseSalary)} = {fmtCur(payslip.effectiveSalary)}
              </Text>
            </View>
          </View>
        </View>
      ) : (
        <View style={s.emptyPayslip}>
          <MaterialIcons name="assignment" size={40} color={Colors.textMuted} />
          <Text style={s.emptyText}>No payslip data for {monthLabel(selectedMonth)}.</Text>
        </View>
      )}

      {/* ── Day log ─────────────────────────────────────────────── */}
      <View style={s.card}>
        <Text style={s.cardTitle}>Attendance Log</Text>
        <Text style={s.cardSub}>{monthLabel(selectedMonth)}</Text>
        <View style={s.divider}/>
        {dayLog.length===0 ? (
          <Text style={s.noLog}>No records found.</Text>
        ) : (
          <>
            {/* Table header */}
            <View style={[s.tableRow, s.tableHeader]}>
              <Text style={[s.tableCell, s.tableHeaderText, {flex:1.4}]}>Date</Text>
              <Text style={[s.tableCell, s.tableHeaderText]}>Day</Text>
              <Text style={[s.tableCell, s.tableHeaderText]}>Status</Text>
              <Text style={[s.tableCell, s.tableHeaderText]}>Wt.</Text>
            </View>
            {dayLog.map((entry,i)=>{
              const cfg = STATUS_CFG[entry.status]||STATUS_CFG.Unknown;
              const d = new Date(entry.date+'T00:00:00');
              const dayName = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()];
              const wt = W[entry.status]?.toFixed(1)||'0.0';
              return (
                <View key={entry.date} style={[s.tableRow, i%2===0&&s.tableRowEven]}>
                  <Text style={[s.tableCell,s.tableDate,{flex:1.4}]}>{entry.date}</Text>
                  <Text style={[s.tableCell,{color:Colors.textSecondary,fontSize:12}]}>{dayName}</Text>
                  <View style={s.tableCell}>
                    <View style={[s.statusPill,{backgroundColor:cfg.bg}]}>
                      <MaterialIcons name={cfg.icon} size={12} color={cfg.color} style={s.statusIcon} />
                      <Text style={[s.statusText,{color:cfg.color}]}>{entry.status}</Text>
                    </View>
                  </View>
                  <Text style={[s.tableCell,{fontWeight:'700',color:cfg.color,fontSize:13}]}>{wt}</Text>
                </View>
              );
            })}
          </>
        )}
      </View>

      <View style={{height:32}}/>
    </ScrollView>
  );
}
const s = StyleSheet.create({
  root: { flex:1, backgroundColor: Colors.background },
  scroll: { padding:16, paddingBottom:20 },

  profileCard: { flexDirection:'row', alignItems:'center', backgroundColor: Colors.surface, borderRadius: Radii.lg, padding:16, marginBottom:14, ...Shadow.card },
  profileAvatar: { width:56, height:56, borderRadius:28, alignItems:'center', justifyContent:'center', flexShrink:0, marginRight:12 },
  profileAvatarText: { color: Colors.white, fontSize:20, fontWeight:'800' },
  profileInfo: { flex:1 },
  profileName: { fontSize:17, fontWeight:'700', color: Colors.textPrimary },
  profilePos: { fontSize:13, color: Colors.textSecondary, marginTop:2 },
  profileDept: { fontSize:12, color: Colors.textMuted },
  refreshBtn: { width:36, height:36, borderRadius:10, backgroundColor: Colors.primarySoft, alignItems:'center', justifyContent:'center' },
  refreshIcon: { fontSize:18 },

  monthNav: { flexDirection:'row', alignItems:'center', justifyContent:'space-between', backgroundColor: Colors.surface, borderRadius: Radii.lg, padding:12, marginBottom:14, ...Shadow.card },
  navBtn: { width:40, height:40, borderRadius: Radii.md, backgroundColor: Colors.primarySoft, alignItems:'center', justifyContent:'center' },
  navBtnDisabled: { backgroundColor: Colors.borderLight },
  navIcon: { fontSize:26, color: Colors.primary, fontWeight:'300', lineHeight:30 },
  monthMid: { alignItems:'center' },
  monthText: { fontSize:16, fontWeight:'700', color: Colors.textPrimary, marginBottom:4 },
  currentBadge: { backgroundColor: Colors.primarySoft, paddingHorizontal:10, paddingVertical:2, borderRadius: Radii.full },
  currentBadgeText: { fontSize:11, color: Colors.primary, fontWeight:'700' },

  payslipCard: { backgroundColor: Colors.surface, borderRadius: Radii.lg, overflow:'hidden', ...Shadow.card, marginBottom:14 },
  payslipHeader: { flexDirection:'row', justifyContent:'space-between', alignItems:'flex-start', backgroundColor: Colors.primary, padding:16 },
  payslipTitle: { fontSize:20, fontWeight:'800', color: Colors.white },
  payslipPeriod: { fontSize:13, color:'rgba(255,255,255,0.7)', marginTop:2 },
  payslipEarned: { alignItems:'flex-end', backgroundColor:'rgba(255,255,255,0.15)', borderRadius:10, padding:10 },
  payslipEarnedLabel: { fontSize:10, color:'rgba(255,255,255,0.7)', fontWeight:'600' },
  payslipEarnedValue: { fontSize:22, fontWeight:'800', color: Colors.white, marginTop:2 },

  attRow: { flexDirection:'row', padding:14 },
  attBox: { flex:1, alignItems:'center', borderRadius: Radii.md, paddingVertical:10, marginRight:8 },
  attBoxIcon: { fontSize:18, marginBottom:2 },
  attBoxCount: { fontSize:20, fontWeight:'800', marginBottom:2 },
  attBoxLabel: { fontSize:10, color: Colors.textSecondary, fontWeight:'500' },

  calcSection: { padding:16, borderTopWidth:1, borderTopColor: Colors.borderLight },
  calcRow: { flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:8 },
  calcLabel: { fontSize:13, color: Colors.textSecondary, flex:1 },
  calcVal: { fontSize:13, fontWeight:'600', color: Colors.textPrimary },
  calcDivider: { height:1, backgroundColor: Colors.border, marginVertical:4 },
  pctPill: { borderRadius: Radii.full, paddingHorizontal:10, paddingVertical:3 },
  pctText: { fontSize:12, fontWeight:'700' },
  formulaBox: { backgroundColor: Colors.primarySoft, borderRadius: Radii.md, padding:10, marginTop:4 },
  formulaText: { fontSize:11, color: Colors.textSecondary, lineHeight:16 },

  emptyPayslip: { backgroundColor: Colors.surface, borderRadius: Radii.lg, padding:36, alignItems:'center', ...Shadow.card, marginBottom:14 },
  emptyIcon: { fontSize:36, marginBottom:10 },
  emptyText: { fontSize:14, color: Colors.textSecondary, textAlign:'center' },

  card: { backgroundColor: Colors.surface, borderRadius: Radii.lg, overflow:'hidden', ...Shadow.card, marginBottom:14 },
  cardTitle: { ...Typography.sectionTitle, paddingHorizontal:16, paddingTop:16 },
  cardSub: { fontSize:12, color: Colors.textMuted, paddingHorizontal:16, paddingBottom:8 },
  divider: { height:1, backgroundColor: Colors.borderLight },
  noLog: { textAlign:'center', color: Colors.textMuted, padding:24, fontSize:14 },

  tableRow: { flexDirection:'row', alignItems:'center', paddingVertical:9, paddingHorizontal:10 },
  tableRowEven: { backgroundColor: Colors.surfaceAlt },
  tableHeader: { backgroundColor: Colors.primary },
  tableHeaderText: { color: Colors.white, fontSize:11, fontWeight:'700', textTransform:'uppercase', letterSpacing:0.4 },
  tableCell: { flex:1, justifyContent:'center' },
  tableDate: { fontSize:12, fontWeight:'600', color: Colors.textPrimary },
  statusPill: { flexDirection:'row', alignItems:'center', alignSelf:'flex-start', paddingHorizontal:6, paddingVertical:3, borderRadius:8 },
  statusIcon: { fontSize:10, marginRight:3 },
  statusText: { fontSize:10, fontWeight:'600' },
});
