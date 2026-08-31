/**
 * src/screens/EmployeeManagementScreen.js
 * Staff tab — FinTrack design.
 *
 * Layout:
 *  - Search bar (rounded, lavender bg)
 *  - Filter pills: All | Active | HR | Admin
 *  - Employee card rows: avatar circle + name/role + salary badge + action buttons
 *  - FAB → full add/edit modal sheet
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Modal, Alert, ActivityIndicator,
  KeyboardAvoidingView, Platform, FlatList,
} from 'react-native';
import { useAppContext } from '../context/AppContext';
import { employeesAPI, attendanceAPI } from '../services/api';
import { useI18n } from '../i18n';
import { MaterialIcons } from '../components/shared/Icon';
import { Colors, Radii, Shadow, Typography } from '../theme/colors';

const DEPARTMENTS = ['Engineering','Marketing','Sales','Human Resources','Finance','Operations','Customer Support'];

/**
 * Fallback role list, used only if /api/employees/meta/roles cannot be reached.
 * The real list comes from the server: an ADMIN may assign any role, HR may
 * assign EMPLOYEE only. Offering a role the server will refuse just produces a
 * 403 after the user has filled in the whole form.
 */
const FALLBACK_ROLES = ['EMPLOYEE'];

function avatarColor(name = '') {
  const p = Colors.avatar; let s = 0;
  for (const c of name) s += c.charCodeAt(0);
  return p[s % p.length];
}
function initials(name = '') {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}
function roleLabel(role) {
  if (role === 'ADMIN') return { bg: Colors.pendingBg, text: Colors.primary };
  if (role === 'HR')    return { bg: Colors.infoLight,  text: '#0891B2' };
  return { bg: Colors.successBg, text: Colors.successText };
}

const EMPTY = { name:'', role:'EMPLOYEE', department:'Engineering', position:'', email:'', phone:'', baseSalary:'', joinDate: new Date().toISOString().slice(0,10) };

// ── Employee Card ─────────────────────────────────────────────────────────────
function EmployeeCard({ emp, onEdit, onDelete, onPress, canDelete }) {
  const rl = roleLabel(emp.role);
  return (
    <TouchableOpacity style={ec.card} onPress={() => onPress(emp)} activeOpacity={0.7} accessibilityRole="button">
      <View style={[ec.avatar, { backgroundColor: avatarColor(emp.name) }]}>
        <Text style={ec.avatarText}>{initials(emp.name)}</Text>
      </View>
      <View style={ec.info}>
        <View style={ec.nameRow}>
          <Text style={ec.name}>{emp.name}</Text>
          <View style={[ec.rolePill, { backgroundColor: rl.bg }]}>
            <Text style={[ec.roleText, { color: rl.text }]}>{emp.role}</Text>
          </View>
        </View>
        <Text style={ec.position}>{emp.position}</Text>
        <Text style={ec.dept}>{emp.department}</Text>
        <Text style={ec.salary}>
          ₹ {emp.baseSalary?.toLocaleString('en-IN')}/mo
        </Text>
      </View>
      <View style={ec.actions}>
        <TouchableOpacity style={ec.editBtn} onPress={() => onEdit(emp)} accessibilityRole="button">
          <MaterialIcons name="edit" size={16} color={Colors.primary} />
        </TouchableOpacity>
        {/* Removing staff is ADMIN-only on the server, so HR is not offered a
            button that would only ever return 403. */}
        {canDelete ? (
          <TouchableOpacity style={ec.delBtn} onPress={() => onDelete(emp)} accessibilityRole="button">
            <MaterialIcons name="delete" size={16} color={Colors.danger} />
          </TouchableOpacity>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}
const ec = StyleSheet.create({
  card: { flexDirection:'row', alignItems:'flex-start', backgroundColor: Colors.surface, borderRadius: Radii.lg, padding:14, marginBottom:10, ...Shadow.card },
  avatar: { width:48, height:48, borderRadius:24, alignItems:'center', justifyContent:'center', flexShrink:0, marginRight:12 },
  avatarText: { color: Colors.white, fontSize:16, fontWeight:'700' },
  info: { flex:1 },
  nameRow: { flexDirection:'row', alignItems:'center', flexWrap:'wrap', marginBottom:2 },
  name: { fontSize:15, fontWeight:'700', color: Colors.textPrimary, marginRight:8 },
  rolePill: { borderRadius: Radii.full, paddingHorizontal:8, paddingVertical:2 },
  roleText: { fontSize:10, fontWeight:'700', letterSpacing:0.5 },
  position: { fontSize:13, color: Colors.textSecondary, fontWeight:'500' },
  dept: { fontSize:12, color: Colors.textMuted },
  salary: { fontSize:12, color: Colors.textSecondary, marginTop:3 },
  actions: { flexDirection:'column', flexShrink:0 },
  editBtn: { width:32, height:32, borderRadius:8, backgroundColor: Colors.primarySoft, alignItems:'center', justifyContent:'center', marginBottom:6 },
  editIcon: { fontSize:14 },
  delBtn: { width:32, height:32, borderRadius:8, backgroundColor: Colors.dangerLight, alignItems:'center', justifyContent:'center' },
  delIcon: { fontSize:14 },
});

// ── Add/Edit Modal ────────────────────────────────────────────────────────────
function EmployeeModal({ visible, editing, onClose, onSaved, assignableRoles }) {
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const roleOptions = assignableRoles.length > 0 ? assignableRoles : FALLBACK_ROLES;

  useEffect(() => {
    if (editing) {
      setForm({ name:editing.name, role:editing.role, department:editing.department,
        position:editing.position, email:editing.email, phone:editing.phone||'',
        baseSalary:String(editing.baseSalary), joinDate:editing.joinDate });
    } else {
      // Default to the first role this user may actually assign, so HR does not
      // start on a role the server would reject.
      setForm({ ...EMPTY, role: roleOptions[0] });
    }
    setErr('');
  }, [editing, visible]);

  function set(k, v) { setForm(p => ({ ...p, [k]: v })); }

  function validate() {
    if (!form.name.trim()) return 'Name is required.';
    if (!form.position.trim()) return 'Position is required.';
    if (!form.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) return 'Valid email required.';
    if (!form.baseSalary || isNaN(parseFloat(form.baseSalary)) || parseFloat(form.baseSalary) <= 0) return 'Valid salary required.';
    return null;
  }

  async function save() {
    const e = validate(); if (e) { setErr(e); return; }
    setSaving(true); setErr('');
    const payload = { ...form, baseSalary: parseFloat(form.baseSalary), email: form.email.trim().toLowerCase() };
    try {
      if (editing) await employeesAPI.update(editing.id, payload);
      else await employeesAPI.create(payload);
      onSaved();
    } catch (ex) { setErr(ex.message || 'Save failed.'); }
    finally { setSaving(false); }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex:1 }} behavior={Platform.OS==='ios'?'padding':'height'}>
        <View style={em.safe}>
          {/* header */}
          <View style={em.header}>
            <TouchableOpacity onPress={onClose} style={em.cancelBtn} accessibilityRole="button">
              <Text style={em.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <Text style={em.title}>{editing ? 'Edit Employee' : 'New Employee'}</Text>
            <TouchableOpacity style={[em.saveBtn, saving && {opacity:0.6}]} onPress={save} disabled={saving} accessibilityRole="button">
              {saving ? <ActivityIndicator size="small" color={Colors.white} /> : <Text style={em.saveBtnText}>Save</Text>}
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={em.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {err ? <View style={em.errBox}><MaterialIcons name="warning" size={14} color={Colors.danger} /><Text style={em.errText}> {err}</Text></View> : null}

            {[
              { label:'Full Name*', key:'name', placeholder:'Jane Smith' },
              { label:'Job Title*', key:'position', placeholder:'Senior Developer' },
              { label:'Email*', key:'email', placeholder:'jane@company.com', autoCapitalize:'none', keyboardType:'email-address' },
              // Phone is how this person signs in (SMS OTP), so the label says so.
              // Leaving it blank creates a valid record that simply cannot log in.
              { label:'Phone — used to sign in', key:'phone', placeholder:'+91 98765 43210', keyboardType:'phone-pad' },
              { label:'Base Salary (₹/mo)*', key:'baseSalary', placeholder:'45000', keyboardType:'numeric' },
              { label:'Join Date', key:'joinDate', placeholder:'2026-01-15' },
            ].map(f => (
              <View key={f.key} style={em.field}>
                <Text style={em.label}>{f.label}</Text>
                <TextInput style={em.input} value={form[f.key]} onChangeText={v => set(f.key, v)}
                  placeholder={f.placeholder} placeholderTextColor={Colors.textMuted}
                  keyboardType={f.keyboardType || 'default'} autoCapitalize={f.autoCapitalize || 'words'} autoCorrect={false} />
              </View>
            ))}

            <View style={em.field}>
              <Text style={em.label}>Role</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={em.pillRow}>
                  {roleOptions.map(r => (
                    <TouchableOpacity key={r} style={[em.pill, form.role===r && em.pillActive]} onPress={() => set('role', r)} accessibilityRole="radio">
                      <Text style={[em.pillText, form.role===r && em.pillTextActive]}>{r}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
              {roleOptions.length === 1 ? (
                <Text style={em.hint}>
                  You can create {roleOptions[0]} accounts. An ADMIN can create any role.
                </Text>
              ) : null}
            </View>

            <View style={em.field}>
              <Text style={em.label}>Department</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={em.pillRow}>
                  {DEPARTMENTS.map(d => (
                    <TouchableOpacity key={d} style={[em.pill, form.department===d && em.pillActive]} onPress={() => set('department', d)} accessibilityRole="radio">
                      <Text style={[em.pillText, form.department===d && em.pillTextActive]}>{d}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
const em = StyleSheet.create({
  safe: { flex:1, backgroundColor: Colors.background },
  header: { flexDirection:'row', alignItems:'center', justifyContent:'space-between', backgroundColor: Colors.surface, paddingHorizontal:16, paddingVertical:14, borderBottomWidth:1, borderBottomColor: Colors.border },
  title: { fontSize:17, fontWeight:'700', color: Colors.textPrimary },
  cancelBtn: { padding:4 },
  cancelText: { fontSize:15, color: Colors.danger, fontWeight:'500' },
  saveBtn: { backgroundColor: Colors.primary, paddingHorizontal:18, paddingVertical:7, borderRadius:10, minWidth:60, alignItems:'center' },
  saveBtnText: { color: Colors.white, fontWeight:'700', fontSize:14 },
  scroll: { padding:16, paddingBottom:40 },
  errBox: { backgroundColor: Colors.dangerLight, borderRadius: Radii.sm, padding:10, borderLeftWidth:3, borderLeftColor: Colors.danger, marginBottom:12 },
  errText: { fontSize:13, color: Colors.danger, fontWeight:'500' },
  field: { marginBottom:14 },
  label: { fontSize:13, fontWeight:'600', color: Colors.textSecondary, marginBottom:6 },
  input: { backgroundColor: Colors.surface, borderWidth:1.5, borderColor: Colors.border, borderRadius: Radii.md, paddingHorizontal:14, paddingVertical: Platform.OS==='ios'?12:9, fontSize:15, color: Colors.textPrimary },
  pillRow: { flexDirection:'row' },
  pill: { paddingHorizontal:14, paddingVertical:7, borderRadius: Radii.full, borderWidth:1.5, borderColor: Colors.border, backgroundColor: Colors.surface, marginRight:8 },
  pillActive: { borderColor: Colors.primary, backgroundColor: Colors.primarySoft },
  pillText: { fontSize:13, color: Colors.textSecondary, fontWeight:'500' },
  pillTextActive: { color: Colors.primary, fontWeight:'700' },
  hint: { fontSize:11, color: Colors.textMuted, marginTop:6 },
});

// ── Employee Detail Modal (Attendance & Salary table) ─────────────────────────
function EmployeeDetailModal({ visible, employee, onClose }) {
  const [attData, setAttData] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (visible && employee) {
      loadAttendance();
    }
  }, [visible, employee]);

  async function loadAttendance() {
    setLoading(true);
    try {
      const res = await attendanceAPI.getAll();
      const allRecords = res.data || [];
      // Group by month for this employee
      const monthMap = {};
      for (const dayEntry of allRecords) {
        const log = dayEntry.logs?.find(l => l.employeeId === employee.id);
        if (!log) continue;
        const ym = dayEntry.date.slice(0, 7); // "2026-08"
        if (!monthMap[ym]) monthMap[ym] = { present: 0, halfDay: 0, absent: 0, totalDays: 0 };
        monthMap[ym].totalDays++;
        if (log.status === 'Present') monthMap[ym].present++;
        else if (log.status === 'Half-Day') monthMap[ym].halfDay++;
        else monthMap[ym].absent++;
      }
      // Convert to sorted array
      const rows = Object.entries(monthMap)
        .sort((a, b) => b[0].localeCompare(a[0]))
        .map(([ym, data]) => {
          const effectiveDays = data.present + data.halfDay * 0.5;
          const salaryPaid = data.totalDays > 0
            ? ((effectiveDays / data.totalDays) * employee.baseSalary).toFixed(0)
            : 0;
          return { month: ym, ...data, effectiveDays, salaryPaid: Number(salaryPaid) };
        });
      setAttData(rows);
    } catch { setAttData([]); }
    finally { setLoading(false); }
  }

  function monthLabel(ym) {
    const [y, m] = ym.split('-');
    return new Date(parseInt(y), parseInt(m) - 1, 1).toLocaleString('en-IN', { month: 'short', year: 'numeric' });
  }

  if (!employee) return null;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={ed.safe}>
        {/* Header */}
        <View style={ed.header}>
          <TouchableOpacity onPress={onClose} style={ed.closeBtn} accessibilityRole="button">
            <MaterialIcons name="chevron-left" size={24} color={Colors.primary} />
          </TouchableOpacity>
          <Text style={ed.title}>Employee Details</Text>
          <View style={{ width: 32 }} />
        </View>

        {/* Profile summary */}
        <View style={ed.profile}>
          <View style={[ed.avatar, { backgroundColor: avatarColor(employee.name) }]}>
            <Text style={ed.avatarText}>{initials(employee.name)}</Text>
          </View>
          <View style={ed.profileInfo}>
            <Text style={ed.profileName}>{employee.name}</Text>
            <Text style={ed.profileSub}>{employee.position} · {employee.department}</Text>
            <Text style={ed.profileSalary}>₹ {employee.baseSalary?.toLocaleString('en-IN')}/mo</Text>
          </View>
        </View>

        {/* Table */}
        <Text style={ed.sectionTitle}>Monthly Attendance & Salary</Text>

        {loading ? (
          <ActivityIndicator color={Colors.primary} style={{ marginTop: 30 }} />
        ) : attData.length === 0 ? (
          <View style={ed.emptyWrap}>
            <MaterialIcons name="event" size={36} color={Colors.textMuted} />
            <Text style={ed.emptyText}>No attendance records found.</Text>
          </View>
        ) : (
          <ScrollView style={ed.tableWrap} showsVerticalScrollIndicator={false}>
            {/* Table header */}
            <View style={[ed.tableRow, ed.tableHeaderRow]}>
              <Text style={[ed.tableCell, ed.headerCell, { flex: 1.4 }]}>Month</Text>
              <Text style={[ed.tableCell, ed.headerCell]}>Present</Text>
              <Text style={[ed.tableCell, ed.headerCell]}>Half</Text>
              <Text style={[ed.tableCell, ed.headerCell]}>Absent</Text>
              <Text style={[ed.tableCell, ed.headerCell, { flex: 1.3 }]}>Salary Paid</Text>
            </View>
            {/* Table rows */}
            {attData.map((row, i) => (
              <View key={row.month} style={[ed.tableRow, i % 2 === 0 && ed.tableRowEven]}>
                <Text style={[ed.tableCell, ed.monthCell, { flex: 1.4 }]}>{monthLabel(row.month)}</Text>
                <Text style={[ed.tableCell, ed.dataCell, { color: Colors.success }]}>{row.present}</Text>
                <Text style={[ed.tableCell, ed.dataCell, { color: Colors.warning }]}>{row.halfDay}</Text>
                <Text style={[ed.tableCell, ed.dataCell, { color: Colors.danger }]}>{row.absent}</Text>
                <Text style={[ed.tableCell, ed.salaryCell, { flex: 1.3 }]}>₹{row.salaryPaid.toLocaleString('en-IN')}</Text>
              </View>
            ))}
            {/* Total row */}
            <View style={[ed.tableRow, ed.totalRow]}>
              <Text style={[ed.tableCell, ed.totalLabel, { flex: 1.4 }]}>Total</Text>
              <Text style={[ed.tableCell, ed.totalVal]}>{attData.reduce((s, r) => s + r.present, 0)}</Text>
              <Text style={[ed.tableCell, ed.totalVal]}>{attData.reduce((s, r) => s + r.halfDay, 0)}</Text>
              <Text style={[ed.tableCell, ed.totalVal]}>{attData.reduce((s, r) => s + r.absent, 0)}</Text>
              <Text style={[ed.tableCell, ed.totalVal, { flex: 1.3 }]}>₹{attData.reduce((s, r) => s + r.salaryPaid, 0).toLocaleString('en-IN')}</Text>
            </View>
            <View style={{ height: 40 }} />
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}
const ed = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Colors.surface, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.border },
  closeBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 17, fontWeight: '700', color: Colors.textPrimary },
  profile: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, margin: 16, borderRadius: Radii.lg, padding: 16, ...Shadow.card },
  avatar: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  avatarText: { color: Colors.white, fontSize: 18, fontWeight: '800' },
  profileInfo: { flex: 1 },
  profileName: { fontSize: 18, fontWeight: '700', color: Colors.textPrimary },
  profileSub: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  profileSalary: { fontSize: 14, fontWeight: '600', color: Colors.primary, marginTop: 4 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary, paddingHorizontal: 16, marginBottom: 10 },
  tableWrap: { flex: 1, marginHorizontal: 16 },
  tableRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 10 },
  tableRowEven: { backgroundColor: Colors.surfaceAlt },
  tableHeaderRow: { backgroundColor: Colors.primary, borderRadius: 8 },
  headerCell: { color: Colors.white, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3 },
  tableCell: { flex: 1, textAlign: 'center' },
  monthCell: { fontSize: 12, fontWeight: '600', color: Colors.textPrimary, textAlign: 'left' },
  dataCell: { fontSize: 13, fontWeight: '700' },
  salaryCell: { fontSize: 12, fontWeight: '700', color: Colors.primary, textAlign: 'right' },
  totalRow: { backgroundColor: Colors.primarySoft, borderRadius: 8, marginTop: 4 },
  totalLabel: { fontSize: 12, fontWeight: '800', color: Colors.primary, textAlign: 'left' },
  totalVal: { fontSize: 13, fontWeight: '800', color: Colors.primary },
  emptyWrap: { alignItems: 'center', paddingTop: 50 },
  emptyText: { fontSize: 14, color: Colors.textSecondary, marginTop: 10 },
});

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function EmployeeManagementScreen() {
  const { employees, employeesLoading, employeesError, fetchEmployees, isAdmin } = useAppContext();
  const [search, setSearch]       = useState('');
  const [filter, setFilter]       = useState('All');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing]     = useState(null);
  const [detailEmp, setDetailEmp] = useState(null);

  // Which roles this user may assign, and therefore which filter pills are worth
  // showing. Asked of the server rather than derived from the role locally, so
  // the rule lives in one place.
  const [assignableRoles, setAssignableRoles] = useState([]);
  const [visibleRoles, setVisibleRoles]       = useState([]);

  useEffect(() => { fetchEmployees(); }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await employeesAPI.getRoleOptions();
        if (cancelled) return;
        setAssignableRoles(res.data.assignable || []);
        setVisibleRoles(res.data.visible || []);
      } catch {
        // Non-fatal: the modal falls back to the safest option (EMPLOYEE only)
        // and the server still enforces the real rule.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // A filter for a role you can never see would always return nothing.
  const filters = ['All', ...visibleRoles];

  const filtered = employees.filter(e => {
    const q = search.toLowerCase();
    const matchQ = e.name.toLowerCase().includes(q) || e.department.toLowerCase().includes(q) || e.position.toLowerCase().includes(q);
    const matchF = filter === 'All' || e.role === filter;
    return matchQ && matchF;
  });

  function openAdd() { setEditing(null); setModalOpen(true); }
  function openEdit(emp) { setEditing(emp); setModalOpen(true); }
  function handleDelete(emp) {
    Alert.alert('Remove Employee', `Remove ${emp.name}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        try { await employeesAPI.remove(emp.id); await fetchEmployees(); }
        catch (e) { Alert.alert('Error', e.message); }
      }},
    ]);
  }

  return (
    <View style={s.root}>
      {/* Search */}
      <View style={s.searchBar}>
        <MaterialIcons name="search" size={18} color={Colors.textMuted} style={{ marginRight: 8 }} />
        <TextInput style={s.searchInput} value={search} onChangeText={setSearch}
          placeholder="Search staff…" placeholderTextColor={Colors.textMuted}
          autoCorrect={false} clearButtonMode="while-editing" />
      </View>

      {/* Filter pills */}
      <View style={s.filterRow}>
        {filters.map(f => (
          <TouchableOpacity key={f} style={[s.filterPill, filter===f && s.filterPillActive]}
            onPress={() => setFilter(f)} accessibilityRole="radio">
            <Text style={[s.filterText, filter===f && s.filterTextActive]}>{f}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Count */}
      <Text style={s.countText}>{filtered.length} employee{filtered.length !== 1 ? 's' : ''}</Text>

      {/* List */}
      {employeesLoading && employees.length === 0 ? (
        <ActivityIndicator color={Colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={i => i.id}
          renderItem={({ item }) => <EmployeeCard emp={item} onEdit={openEdit} onDelete={handleDelete} onPress={setDetailEmp} canDelete={isAdmin} />}
          contentContainerStyle={s.list}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={<View style={s.empty}><MaterialIcons name="group" size={44} color={Colors.textMuted} style={{ marginBottom: 12 }} /><Text style={s.emptyText}>No employees found.</Text></View>}
        />
      )}

      {/* FAB */}
      <TouchableOpacity style={s.fab} onPress={openAdd} accessibilityRole="button" accessibilityLabel="Add employee">
        <Text style={s.fabIcon}>+</Text>
      </TouchableOpacity>

      <EmployeeModal visible={modalOpen} editing={editing} assignableRoles={assignableRoles}
        onClose={() => setModalOpen(false)}
        onSaved={async () => { setModalOpen(false); await fetchEmployees(); }} />

      <EmployeeDetailModal visible={!!detailEmp} employee={detailEmp}
        onClose={() => setDetailEmp(null)} />
    </View>
  );
}
const s = StyleSheet.create({
  root: { flex:1, backgroundColor: Colors.background },
  searchBar: { flexDirection:'row', alignItems:'center', marginHorizontal:16, marginTop:16, marginBottom:12, backgroundColor: Colors.surface, borderRadius: Radii.full, borderWidth:1.5, borderColor: Colors.border, paddingHorizontal:14, paddingVertical:8, ...Shadow.card },
  searchIcon: { fontSize:16, marginRight:8 },
  searchInput: { flex:1, fontSize:14, color: Colors.textPrimary, height:28 },
  filterRow: { flexDirection:'row', paddingHorizontal:16, paddingBottom:4 },
  filterPill: { paddingHorizontal:16, paddingVertical:8, borderRadius: 20, borderWidth:1.5, borderColor: Colors.border, backgroundColor: Colors.surface, marginRight:8 },
  filterPillActive: { borderColor: Colors.primary, backgroundColor: Colors.primarySoft },
  filterText: { fontSize:13, color: Colors.textSecondary, fontWeight:'500' },
  filterTextActive: { color: Colors.primary, fontWeight:'700' },
  countText: { fontSize:12, color: Colors.textMuted, paddingHorizontal:16, marginTop:10, marginBottom:4 },
  list: { paddingHorizontal:16, paddingBottom:80 },
  empty: { alignItems:'center', paddingTop:60 },
  emptyIcon: { fontSize:44, marginBottom:12 },
  emptyText: { fontSize:15, color: Colors.textSecondary },
  fab: { position:'absolute', bottom:24, right:20, width:56, height:56, borderRadius:28, backgroundColor: Colors.primary, alignItems:'center', justifyContent:'center', ...Shadow.fab },
  fabIcon: { color: Colors.white, fontSize:28, fontWeight:'300', lineHeight:32 },
});
