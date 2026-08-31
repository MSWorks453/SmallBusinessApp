/**
 * src/screens/ExpenseLoggerScreen.js
 * Spend tab — FinTrack design.
 *
 * Layout:
 *  - Two KPI mini-cards: this month total + count
 *  - Log form card (amount prominent, category pills, date, description)
 *  - Expense history grouped by month with month totals
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { expensesAPI } from '../services/api';
import { useI18n } from '../i18n';
import { MaterialIcons } from '../components/shared/Icon';
import { Colors, Radii, Shadow, Typography } from '../theme/colors';

const CATEGORIES = ['Utilities','Office Supplies','Travel','Meals','Software Subscriptions','Marketing','Maintenance','Other'];
const CAT_ICONS = { Utilities:'flash-on','Office Supplies':'edit',Travel:'flight',Meals:'restaurant','Software Subscriptions':'computer',Marketing:'campaign',Maintenance:'build',Other:'inventory-2' };

function todayStr() { return new Date().toISOString().slice(0, 10); }
function fmtCur(n) { return `₹${Number(n).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}`; }
function fmtMonthLabel(ym) {
  const [y,m] = ym.split('-');
  return new Date(parseInt(y),parseInt(m)-1,1).toLocaleString('en-US',{month:'long',year:'numeric'});
}
function currentYM() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}

// ── Expense row ───────────────────────────────────────────────────────────────
function ExpRow({ exp, onDelete, isLast }) {
  return (
    <View style={[er.row, !isLast && er.border]}>
      <View style={er.iconBox}><MaterialIcons name={CAT_ICONS[exp.category]||'inventory-2'} size={20} color={Colors.primary} /></View>
      <View style={er.body}>
        <Text style={er.cat}>{exp.category}</Text>
        {exp.description ? <Text style={er.desc} numberOfLines={1}>{exp.description}</Text> : null}
        <View style={{ flexDirection:'row', alignItems:'center', marginTop:2 }}>
          <MaterialIcons name="event" size={11} color={Colors.textMuted} />
          <Text style={er.date}> {exp.date}</Text>
        </View>
      </View>
      <View style={er.right}>
        <Text style={er.amount}>{fmtCur(exp.amount)}</Text>
        <TouchableOpacity style={er.delBtn} onPress={() => onDelete(exp)} accessibilityRole="button">
          <MaterialIcons name="delete" size={14} color={Colors.danger} />
        </TouchableOpacity>
      </View>
    </View>
  );
}
const er = StyleSheet.create({
  row: { flexDirection:'row', alignItems:'center', paddingVertical:12, paddingHorizontal:16 },
  border: { borderBottomWidth:1, borderBottomColor: Colors.borderLight },
  iconBox: { width:40, height:40, borderRadius:10, backgroundColor: Colors.primarySoft, alignItems:'center', justifyContent:'center', flexShrink:0, marginRight:12 },
  icon: { fontSize:20 },
  body: { flex:1 },
  cat: { fontSize:14, fontWeight:'600', color: Colors.textPrimary },
  desc: { fontSize:12, color: Colors.textSecondary, marginTop:1 },
  date: { fontSize:11, color: Colors.textMuted, marginTop:2 },
  right: { alignItems:'flex-end' },
  amount: { fontSize:14, fontWeight:'700', color: Colors.warning, marginBottom:6 },
  delBtn: { width:28, height:28, borderRadius:8, backgroundColor: Colors.dangerLight, alignItems:'center', justifyContent:'center' },
});

// ── Mini KPI ──────────────────────────────────────────────────────────────────
function MiniKpi({ label, value, icon, color }) {
  return (
    <View style={[mk.card, { borderTopWidth:3, borderTopColor: color }]}>
      <View style={mk.row}>
        <Text style={mk.label}>{label}</Text>
        <View style={[mk.iconBox,{backgroundColor:color+'22'}]}><MaterialIcons name={icon} size={18} color={color} /></View>
      </View>
      <Text style={[mk.value,{color}]}>{value}</Text>
    </View>
  );
}
const mk = StyleSheet.create({
  card: { flex:1, backgroundColor: Colors.surface, borderRadius: Radii.lg, padding:14, ...Shadow.card },
  row: { flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:8 },
  label: { fontSize:11, fontWeight:'600', color: Colors.textSecondary, textTransform:'uppercase', letterSpacing:0.6, flex:1 },
  iconBox: { width:30, height:30, borderRadius:8, alignItems:'center', justifyContent:'center' },
  value: { fontSize:22, fontWeight:'800' },
});

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function ExpenseLoggerScreen() {
  const [expenses, setExpenses]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [amount, setAmount]       = useState('');
  const [category, setCategory]   = useState('Utilities');
  const [date, setDate]           = useState(todayStr());
  const [desc, setDesc]           = useState('');
  const [saving, setSaving]       = useState(false);
  const [formErr, setFormErr]     = useState('');
  const [success, setSuccess]     = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await expensesAPI.getAll(); setExpenses(r.data||[]); }
    catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, []);

  const thisMonthExpenses = expenses.filter(e => e.date.startsWith(currentYM()));
  const thisMonthTotal    = thisMonthExpenses.reduce((s,e) => s+parseFloat(e.amount),0);

  function validate() {
    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) return 'Enter a valid amount.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'Date must be YYYY-MM-DD.';
    return null;
  }

  async function handleSubmit() {
    const e = validate(); if (e) { setFormErr(e); return; }
    setSaving(true); setFormErr(''); setSuccess(false);
    try {
      await expensesAPI.create({ amount:parseFloat(amount), category, date, description:desc.trim() });
      setAmount(''); setDesc(''); setDate(todayStr()); setSuccess(true);
      await load();
    } catch (ex) { setFormErr(ex.message || 'Save failed.'); }
    finally { setSaving(false); }
  }

  function handleDelete(exp) {
    Alert.alert('Delete Expense', `Delete ${exp.category} — ${fmtCur(exp.amount)}?`,[
      { text:'Cancel', style:'cancel' },
      { text:'Delete', style:'destructive', onPress: async () => {
        try { await expensesAPI.remove(exp.id); await load(); }
        catch (ex) { Alert.alert('Error', ex.message); }
      }},
    ]);
  }

  // Group by month
  const grouped = expenses.reduce((acc,e) => {
    const ym = e.date.slice(0,7);
    if (!acc[ym]) acc[ym] = [];
    acc[ym].push(e);
    return acc;
  }, {});
  const months = Object.keys(grouped).sort((a,b) => b.localeCompare(a));

  return (
    <KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==='ios'?'padding':undefined} keyboardVerticalOffset={80}>
      <ScrollView style={s.root} contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

        {/* ── KPI row ────────────────────────────────────────────── */}
        <View style={s.kpiRow}>
          <MiniKpi label="This Month" value={fmtCur(thisMonthTotal)} icon="account-balance-wallet" color={Colors.primary} />
          <View style={{ width:12 }} />
          <MiniKpi label="Transactions" value={String(thisMonthExpenses.length)} icon="receipt" color={Colors.warning} />
        </View>

        {/* ── Log form card ───────────────────────────────────────── */}
        <View style={s.card}>
          <Text style={s.cardTitle}>Log Expense</Text>
          <View style={s.divider} />
          <View style={s.formBody}>

            {formErr ? <View style={s.errBox}><MaterialIcons name="warning" size={14} color={Colors.danger} /><Text style={s.errText}> {formErr}</Text></View> : null}
            {success  ? <View style={s.okBox}><MaterialIcons name="check-circle" size={14} color={Colors.successText} /><Text style={s.okText}> Expense logged!</Text></View> : null}

            {/* Amount — large prominent input */}
            <View style={s.amountWrap}>
              <Text style={s.currencySign}>₹</Text>
              <TextInput style={s.amountInput} value={amount}
                onChangeText={v => { setAmount(v); setSuccess(false); }}
                placeholder="0.00" placeholderTextColor={Colors.textMuted}
                keyboardType="decimal-pad" />
            </View>

            {/* Date */}
            <View style={s.field}>
              <Text style={s.label}>Date</Text>
              <View style={s.dateRow}>
                <TextInput style={[s.input,{flex:1}]} value={date}
                  onChangeText={v=>{ setDate(v); setSuccess(false); }}
                  placeholder="YYYY-MM-DD" placeholderTextColor={Colors.textMuted}
                  keyboardType={Platform.OS==='ios'?'numbers-and-punctuation':'default'} autoCorrect={false} />
                <TouchableOpacity style={s.todayBtn} onPress={()=>setDate(todayStr())} accessibilityRole="button">
                  <Text style={s.todayBtnText}>Today</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Category */}
            <View style={s.field}>
              <Text style={s.label}>Category</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={s.pillRow}>
                  {CATEGORIES.map(c => (
                    <TouchableOpacity key={c} style={[s.pill, category===c && s.pillActive]}
                      onPress={()=>{setCategory(c);setSuccess(false);}} accessibilityRole="radio">
                      <MaterialIcons name={CAT_ICONS[c]||'inventory-2'} size={14} color={category===c ? Colors.white : Colors.textSecondary} style={{ marginRight:4 }} />
                      <Text style={[s.pillText, category===c && s.pillTextActive]}>{c}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            </View>

            {/* Description */}
            <View style={s.field}>
              <Text style={s.label}>Note (optional)</Text>
              <TextInput style={[s.input,{minHeight:72,textAlignVertical:'top',paddingTop:12}]}
                value={desc} onChangeText={v=>{setDesc(v);setSuccess(false);}}
                placeholder="Brief description…" placeholderTextColor={Colors.textMuted}
                multiline numberOfLines={3} />
            </View>

            <TouchableOpacity style={[s.submitBtn, saving && {opacity:0.6}]}
              onPress={handleSubmit} disabled={saving} accessibilityRole="button">
              {saving ? <ActivityIndicator color={Colors.white} /> :
                <Text style={s.submitBtnText}><MaterialIcons name="add" size={16} color={Colors.white} />  Log Expense</Text>}
            </TouchableOpacity>
          </View>
        </View>

        {/* ── History ─────────────────────────────────────────────── */}
        <View style={s.historyHeader}>
          <Text style={s.historyTitle}>Expense History</Text>
        </View>

        {loading ? <ActivityIndicator color={Colors.primary} style={{marginVertical:24}} /> :
          months.length === 0 ? <Text style={s.emptyText}>No expenses yet.</Text> :
          months.map(ym => {
            const total = grouped[ym].reduce((sum,e)=>sum+parseFloat(e.amount),0);
            return (
              <View key={ym} style={s.monthBlock}>
                <View style={s.monthHeader}>
                  <Text style={s.monthLabel}>{fmtMonthLabel(ym)}</Text>
                  <View style={s.monthTotalBadge}>
                    <Text style={s.monthTotalText}>{fmtCur(total)}</Text>
                  </View>
                </View>
                <View style={s.monthCard}>
                  {grouped[ym].map((exp,i) => (
                    <ExpRow key={exp.id} exp={exp} onDelete={handleDelete} isLast={i===grouped[ym].length-1} />
                  ))}
                </View>
              </View>
            );
          })
        }
        <View style={{ height:32 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
const s = StyleSheet.create({
  root: { flex:1, backgroundColor: Colors.background },
  scroll: { padding:16, paddingBottom:20 },
  kpiRow: { flexDirection:'row', marginBottom:16 },

  card: { backgroundColor: Colors.surface, borderRadius: Radii.lg, overflow:'hidden', ...Shadow.card, marginBottom:16 },
  cardTitle: { ...Typography.sectionTitle, padding:16 },
  divider: { height:1, backgroundColor: Colors.borderLight },
  formBody: { padding:16 },

  errBox: { backgroundColor: Colors.dangerLight, borderRadius: Radii.sm, padding:10, borderLeftWidth:3, borderLeftColor: Colors.danger, marginBottom:10 },
  errText: { color: Colors.danger, fontSize:13, fontWeight:'500' },
  okBox: { backgroundColor: Colors.successBg, borderRadius: Radii.sm, padding:10, borderLeftWidth:3, borderLeftColor: Colors.success, marginBottom:10 },
  okText: { color: Colors.successText, fontSize:13, fontWeight:'600' },

  amountWrap: { flexDirection:'row', alignItems:'center', backgroundColor: Colors.primarySoft, borderRadius: Radii.lg, paddingHorizontal:18, paddingVertical:12, marginBottom:16 },
  currencySign: { fontSize:28, fontWeight:'800', color: Colors.primary, marginRight:8 },
  amountInput: { flex:1, fontSize:36, fontWeight:'800', color: Colors.primary, padding:0 },

  field: { marginBottom:14 },
  label: { fontSize:13, fontWeight:'600', color: Colors.textSecondary, marginBottom:6 },
  input: { backgroundColor: Colors.surfaceAlt, borderWidth:1.5, borderColor: Colors.border, borderRadius: Radii.md, paddingHorizontal:14, paddingVertical: Platform.OS==='ios'?12:9, fontSize:15, color: Colors.textPrimary },
  dateRow: { flexDirection:'row', alignItems:'center' },
  todayBtn: { backgroundColor: Colors.infoLight, borderWidth:1, borderColor: Colors.primary, paddingHorizontal:12, paddingVertical:10, borderRadius: Radii.md, marginLeft:8 },
  todayBtnText: { color: Colors.primary, fontWeight:'700', fontSize:13 },

  pillRow: { flexDirection:'row' },
  pill: { flexDirection:'row', alignItems:'center', paddingHorizontal:12, paddingVertical:8, borderRadius: Radii.full, borderWidth:1.5, borderColor: Colors.border, backgroundColor: Colors.surface, marginRight:8 },
  pillActive: { borderColor: Colors.primary, backgroundColor: Colors.primarySoft },
  pillIcon: { fontSize:14, marginRight:4 },
  pillText: { fontSize:12, color: Colors.textSecondary, fontWeight:'500' },
  pillTextActive: { color: Colors.primary, fontWeight:'700' },

  submitBtn: { backgroundColor: Colors.primary, borderRadius: Radii.lg, paddingVertical:15, alignItems:'center', marginTop:4, ...Shadow.fab },
  submitBtnText: { color: Colors.white, fontSize:15, fontWeight:'700' },

  historyHeader: { flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:10 },
  historyTitle: { ...Typography.sectionTitle },

  emptyText: { textAlign:'center', color: Colors.textMuted, paddingVertical:32, fontSize:14 },

  monthBlock: { marginBottom:16 },
  monthHeader: { flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:8, paddingHorizontal:4 },
  monthLabel: { fontSize:14, fontWeight:'700', color: Colors.textPrimary },
  monthTotalBadge: { backgroundColor: Colors.warningBg, paddingHorizontal:10, paddingVertical:4, borderRadius: Radii.full },
  monthTotalText: { fontSize:13, fontWeight:'700', color: Colors.warningText },
  monthCard: { backgroundColor: Colors.surface, borderRadius: Radii.lg, overflow:'hidden', ...Shadow.card },
});
