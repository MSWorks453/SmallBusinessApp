/**
 * English translations — all UI strings for the app.
 */
export default {
  // ── Common ──────────────────────────────────────────────────────────────────
  appName: 'FinTrack',
  appTagline: 'FinTrack Enterprise',
  save: 'Save',
  cancel: 'Cancel',
  delete: 'Delete',
  refresh: 'Refresh',
  loading: 'Loading…',
  noData: 'No data available.',
  error: 'Error',
  retry: 'Retry',
  today: 'Today',
  signOut: 'Sign Out',
  switchRole: 'Switch Role',
  viewAll: 'View All',
  showLess: 'Show Less',
  current: 'Current',
  total: 'Total',

  // ── Login Screen (SMS OTP) ──────────────────────────────────────────────────
  login: {
    title: 'FinTrack Enterprise',
    subtitle: 'Sign in with your mobile number',
    selectLanguage: 'Select Language',

    // Step 1 — phone
    phoneLabel: 'Mobile Number',
    phonePlaceholder: '98765 43210',
    phoneHelp: 'We will text you a 6-digit code. Use the number registered with your employer.',
    sendCode: 'Send Code',

    // Step 2 — code
    codeLabel: 'Verification Code',
    codeSentTo: 'Sent to {phone}',
    verify: 'Verify & Sign In',
    resend: 'Resend code',
    resendIn: 'Resend in {seconds}s',
    changeNumber: 'Change number',

    // Validation
    phoneRequired: 'Please enter your mobile number.',
    phoneInvalid: 'That does not look like a valid mobile number.',
    codeRequired: 'Enter the 6-digit code we sent you.',

    // Server-reported failures
    phoneNotRegistered: 'No active employee is registered with this number.',
    codeInvalid: 'That code is invalid or has expired. Request a new one.',
    codeTooManyAttempts: 'Too many incorrect attempts. Request a new code.',
    codeCooldown: 'Please wait {seconds}s before requesting another code.',
    codeRateLimited: 'Too many codes requested for this number. Try again later.',
    smsFailed: 'We could not send the code. Please try again.',
    accountInactive: 'This account is no longer active. Contact your administrator.',
    networkError: 'Cannot reach the server. Check your connection and try again.',
    genericError: 'Sign in failed. Please try again.',

    // Notices
    sessionEnded: 'Your session ended. Please sign in again.',
    devCodeNotice: 'Development mode — your code is {code}',
    secureNote: 'Protected by one-time SMS verification.',
  },

  // ── Dashboard ───────────────────────────────────────────────────────────────
  dashboard: {
    greeting: 'Good morning,',
    totalSalarySpend: 'TOTAL SALARY SPEND',
    headcount: 'HEADCOUNT',
    generalExpenses: 'GENERAL EXPENSES',
    totalCost: 'TOTAL COST',
    vsLastMonth: 'vs last month',
    newHires: 'new hires',
    attendanceTrends: 'Attendance Trends',
    recentApprovals: 'Recent Approvals',
    noApprovals: 'No approvals to show.',
    quickAdd: 'Quick add',
    quickLogExpense: 'Quick Log Expense',
    amount: 'Amount ($)',
    description: 'Description',
    logExpense: 'Log Expense',
    payslip: 'Payslip',
  },

  // ── Analytics / Financials ──────────────────────────────────────────────────
  analytics: {
    title: 'Financials',
    attendanceTrends: 'Attendance Trends',
    sixMonthTrend: '6-Month Trend',
    salary: 'Salary',
    expenses: 'Expenses',
    recentExpenses: 'Recent Expenses',
    salaryBreakdown: 'Salary Breakdown',
    currentMonth: 'Current month',
    totalSalaryCost: 'Total Salary Cost',
    monthlyTotal: 'Monthly Total',
    thisWeek: 'This Week',
    thisMonth: 'This Month',
    last3Months: 'Last 3 Months',
    last6Months: 'Last 6 Months',
    loadingAnalytics: 'Loading analytics…',
  },

  // ── Employee Management / Staff ─────────────────────────────────────────────
  employees: {
    title: 'Staff',
    searchPlaceholder: 'Search staff…',
    addEmployee: 'Add employee',
    newEmployee: 'New Employee',
    editEmployee: 'Edit Employee',
    noEmployees: 'No employees found.',
    removeEmployee: 'Remove Employee',
    removeConfirm: 'Remove {name}?',
    fullName: 'Full Name',
    jobTitle: 'Job Title',
    emailLabel: 'Email',
    phone: 'Phone',
    baseSalary: 'Base Salary ($/mo)',
    joinDate: 'Join Date',
    role: 'Role',
    department: 'Department',
    nameRequired: 'Name is required.',
    positionRequired: 'Position is required.',
    emailRequired: 'Valid email required.',
    salaryRequired: 'Valid salary required.',
    employeeCount: '{count} employee(s)',
    all: 'All',
  },

  // ── Attendance / Time ───────────────────────────────────────────────────────
  attendance: {
    title: 'Attendance',
    markAttendance: 'Mark Attendance',
    present: 'Present',
    halfDay: 'Half-Day',
    absent: 'Absent',
    saveAttendance: 'Save Attendance',
    savedSuccess: 'Attendance saved for {date}',
    saveFailed: 'Save failed.',
    jumpToToday: 'Jump to Today',
    previousDay: 'Previous day',
    nextDay: 'Next day',
  },

  // ── Expenses / Spend ────────────────────────────────────────────────────────
  expenses: {
    title: 'Expenses',
    logExpense: 'Log Expense',
    thisMonth: 'This Month',
    transactions: 'Transactions',
    date: 'Date',
    category: 'Category',
    noteOptional: 'Note (optional)',
    notePlaceholder: 'Brief description…',
    logButton: 'Log Expense',
    expenseHistory: 'Expense History',
    noExpenses: 'No expenses yet.',
    deleteExpense: 'Delete Expense',
    deleteConfirm: 'Delete {category} — {amount}?',
    logged: 'Expense logged!',
    validAmount: 'Enter a valid amount.',
    validDate: 'Date must be YYYY-MM-DD.',
    categories: {
      Utilities: 'Utilities',
      'Office Supplies': 'Office Supplies',
      Travel: 'Travel',
      Meals: 'Meals',
      'Software Subscriptions': 'Software Subscriptions',
      Marketing: 'Marketing',
      Maintenance: 'Maintenance',
      Other: 'Other',
    },
  },

  // ── Employee Portal ─────────────────────────────────────────────────────────
  portal: {
    title: 'My Portal',
    payslip: 'Payslip',
    netEarned: 'Net Earned',
    attendanceBreakdown: 'Attendance Breakdown',
    salaryCalculation: 'Salary Calculation',
    baseMonthlySalary: 'Base Monthly Salary',
    effectiveDays: 'Effective Days (P×1 + H×0.5)',
    totalLoggedDays: 'Total Logged Days',
    attendanceRate: 'Attendance Rate',
    netSalary: 'Net Salary',
    attendanceLog: 'Attendance Log',
    noRecords: 'No records found.',
    noPayslipData: 'No payslip data for {month}.',
    loadingPortal: 'Loading your portal…',
    dateCol: 'Date',
    dayCol: 'Day',
    statusCol: 'Status',
    weightCol: 'Wt.',
  },

  // ── Reports ─────────────────────────────────────────────────────────────────
  reports: {
    title: 'Reports',
    month: 'Month',
    selectMonth: 'Select month',
    payrollTitle: 'Employee Payroll',
    summaryLine: '{count} employee(s) · {days} day(s) of attendance logged',
    colName: 'Name',
    colDays: 'Days',
    colLeaves: 'Leaves',
    colPayment: 'Payment',
    presentHalf: '{present} present · {half} half-day',
    inactive: 'No longer active',
    noData: 'No employee records for this month.',
    loadFailed: 'Could not load the report.',
    legendDays: 'Days — attendance-weighted: a Present day counts 1, a Half-Day counts 0.5.',
    legendLeaves: 'Leaves — days marked Absent. Days nobody recorded are not counted as leave.',
    legendPayment: 'Payment — days ÷ days logged × base salary.',
    legendScope: 'Showing {roles} staff only.',
  },

  // ── Settings ────────────────────────────────────────────────────────────────
  settings: {
    title: 'Settings',
    signOutAllDevices: 'Sign out of all devices',
  },

  // ── Tab labels ──────────────────────────────────────────────────────────────
  tabs: {
    home: 'Home',
    staff: 'Staff',
    time: 'Time',
    spend: 'Spend',
    financials: 'Financials',
    reports: 'Reports',
    settings: 'Settings',
    portal: 'Portal',
  },

  // ── Status labels ───────────────────────────────────────────────────────────
  status: {
    pending: 'Pending',
    approved: 'Approved',
    rejected: 'Rejected',
    active: 'Active',
  },
};
