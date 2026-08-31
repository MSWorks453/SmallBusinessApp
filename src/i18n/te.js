/**
 * Telugu translations — అన్ని UI స్ట్రింగ్‌లు.
 */
export default {
  // ── Common ──────────────────────────────────────────────────────────────────
  appName: 'FinTrack',
  appTagline: 'FinTrack ఎంటర్‌ప్రైజ్',
  save: 'సేవ్ చేయండి',
  cancel: 'రద్దు చేయండి',
  delete: 'తొలగించండి',
  refresh: 'రిఫ్రెష్',
  loading: 'లోడ్ అవుతోంది…',
  noData: 'డేటా అందుబాటులో లేదు.',
  error: 'లోపం',
  retry: 'మళ్ళీ ప్రయత్నించండి',
  today: 'ఈ రోజు',
  signOut: 'సైన్ అవుట్',
  switchRole: 'పాత్ర మార్చండి',
  viewAll: 'అన్నీ చూడండి',
  showLess: 'తక్కువ చూపించు',
  current: 'ప్రస్తుతం',
  total: 'మొత్తం',

  // ── Login Screen (SMS OTP) ──────────────────────────────────────────────────
  login: {
    title: 'FinTrack ఎంటర్‌ప్రైజ్',
    subtitle: 'మీ మొబైల్ నంబర్‌తో సైన్ ఇన్ చేయండి',
    selectLanguage: 'భాషను ఎంచుకోండి',

    // దశ 1 — ఫోన్
    phoneLabel: 'మొబైల్ నంబర్',
    phonePlaceholder: '98765 43210',
    phoneHelp: 'మేము మీకు 6-అంకెల కోడ్‌ను SMS చేస్తాము. మీ యజమాని వద్ద నమోదు చేసిన నంబర్‌ను ఉపయోగించండి.',
    sendCode: 'కోడ్ పంపండి',

    // దశ 2 — కోడ్
    codeLabel: 'ధృవీకరణ కోడ్',
    codeSentTo: '{phone}కు పంపబడింది',
    verify: 'ధృవీకరించి సైన్ ఇన్ చేయండి',
    resend: 'కోడ్ మళ్ళీ పంపండి',
    resendIn: '{seconds}సె తర్వాత మళ్ళీ పంపండి',
    changeNumber: 'నంబర్ మార్చండి',

    // ధృవీకరణ
    phoneRequired: 'దయచేసి మీ మొబైల్ నంబర్‌ను నమోదు చేయండి.',
    phoneInvalid: 'ఇది చెల్లుబాటు అయ్యే మొబైల్ నంబర్ లాగా కనిపించడం లేదు.',
    codeRequired: 'మేము పంపిన 6-అంకెల కోడ్‌ను నమోదు చేయండి.',

    // సర్వర్ లోపాలు
    phoneNotRegistered: 'ఈ నంబర్‌తో ఏ క్రియాశీల ఉద్యోగి నమోదు కాలేదు.',
    codeInvalid: 'ఆ కోడ్ చెల్లదు లేదా గడువు ముగిసింది. కొత్తది అడగండి.',
    codeTooManyAttempts: 'చాలా తప్పు ప్రయత్నాలు. కొత్త కోడ్ అడగండి.',
    codeCooldown: 'మరో కోడ్ అడగడానికి {seconds}సె వేచి ఉండండి.',
    codeRateLimited: 'ఈ నంబర్ కోసం చాలా కోడ్‌లు అడిగారు. తర్వాత ప్రయత్నించండి.',
    smsFailed: 'కోడ్ పంపడం సాధ్యం కాలేదు. దయచేసి మళ్ళీ ప్రయత్నించండి.',
    accountInactive: 'ఈ ఖాతా ఇకపై క్రియాశీలం కాదు. మీ నిర్వాహకుడిని సంప్రదించండి.',
    networkError: 'సర్వర్‌ను చేరుకోలేకపోయాము. మీ కనెక్షన్‌ను తనిఖీ చేసి మళ్ళీ ప్రయత్నించండి.',
    genericError: 'సైన్ ఇన్ విఫలమైంది. దయచేసి మళ్ళీ ప్రయత్నించండి.',

    // నోటీసులు
    sessionEnded: 'మీ సెషన్ ముగిసింది. దయచేసి మళ్ళీ సైన్ ఇన్ చేయండి.',
    devCodeNotice: 'డెవలప్‌మెంట్ మోడ్ — మీ కోడ్ {code}',
    secureNote: 'ఒన్-టైమ్ SMS ధృవీకరణ ద్వారా రక్షించబడింది.',
  },

  // ── Dashboard ───────────────────────────────────────────────────────────────
  dashboard: {
    greeting: 'శుభోదయం,',
    totalSalarySpend: 'మొత్తం జీతం ఖర్చు',
    headcount: 'ఉద్యోగుల సంఖ్య',
    generalExpenses: 'సాధారణ ఖర్చులు',
    totalCost: 'మొత్తం ఖర్చు',
    vsLastMonth: 'గత నెలతో పోల్చి',
    newHires: 'కొత్త నియామకాలు',
    attendanceTrends: 'హాజరు ధోరణులు',
    recentApprovals: 'ఇటీవలి ఆమోదాలు',
    noApprovals: 'చూపించడానికి ఆమోదాలు లేవు.',
    quickAdd: 'త్వరిత జోడింపు',
    quickLogExpense: 'త్వరిత ఖర్చు నమోదు',
    amount: 'మొత్తం ($)',
    description: 'వివరణ',
    logExpense: 'ఖర్చు నమోదు చేయండి',
    payslip: 'పే స్లిప్',
  },

  // ── Analytics / Financials ──────────────────────────────────────────────────
  analytics: {
    title: 'ఆర్థిక విశ్లేషణలు',
    attendanceTrends: 'హాజరు ధోరణులు',
    sixMonthTrend: '6 నెలల ధోరణి',
    salary: 'జీతం',
    expenses: 'ఖర్చులు',
    recentExpenses: 'ఇటీవలి ఖర్చులు',
    salaryBreakdown: 'జీతం విభజన',
    currentMonth: 'ప్రస్తుత నెల',
    totalSalaryCost: 'మొత్తం జీతం ఖర్చు',
    monthlyTotal: 'నెలవారీ మొత్తం',
    thisWeek: 'ఈ వారం',
    thisMonth: 'ఈ నెల',
    last3Months: 'గత 3 నెలలు',
    last6Months: 'గత 6 నెలలు',
    loadingAnalytics: 'విశ్లేషణలు లోడ్ అవుతున్నాయి…',
  },

  // ── Employee Management / Staff ─────────────────────────────────────────────
  employees: {
    title: 'సిబ్బంది',
    searchPlaceholder: 'సిబ్బందిని శోధించండి…',
    addEmployee: 'ఉద్యోగిని జోడించండి',
    newEmployee: 'కొత్త ఉద్యోగి',
    editEmployee: 'ఉద్యోగిని సవరించండి',
    noEmployees: 'ఉద్యోగులు కనుగొనబడలేదు.',
    removeEmployee: 'ఉద్యోగిని తొలగించండి',
    removeConfirm: '{name}ని తొలగించాలా?',
    fullName: 'పూర్తి పేరు',
    jobTitle: 'ఉద్యోగ శీర్షిక',
    emailLabel: 'ఇమెయిల్',
    phone: 'ఫోన్',
    baseSalary: 'ప్రాథమిక జీతం ($/నెల)',
    joinDate: 'చేరిక తేదీ',
    role: 'పాత్ర',
    department: 'విభాగం',
    nameRequired: 'పేరు అవసరం.',
    positionRequired: 'ఉద్యోగం అవసరం.',
    emailRequired: 'చెల్లుబాటు అయ్యే ఇమెయిల్ అవసరం.',
    salaryRequired: 'చెల్లుబాటు అయ్యే జీతం అవసరం.',
    employeeCount: '{count} ఉద్యోగి(లు)',
    all: 'అన్ని',
  },

  // ── Attendance / Time ───────────────────────────────────────────────────────
  attendance: {
    title: 'హాజరు',
    markAttendance: 'హాజరు నమోదు',
    present: 'ప్రెజెంట్',
    halfDay: 'అర్ధ రోజు',
    absent: 'గైర్హాజరు',
    saveAttendance: 'హాజరు సేవ్ చేయండి',
    savedSuccess: '{date} కోసం హాజరు సేవ్ చేయబడింది',
    saveFailed: 'సేవ్ విఫలమైంది.',
    jumpToToday: 'ఈ రోజుకు వెళ్ళండి',
    previousDay: 'మునుపటి రోజు',
    nextDay: 'తదుపరి రోజు',
  },

  // ── Expenses / Spend ────────────────────────────────────────────────────────
  expenses: {
    title: 'ఖర్చులు',
    logExpense: 'ఖర్చు నమోదు',
    thisMonth: 'ఈ నెల',
    transactions: 'లావాదేవీలు',
    date: 'తేదీ',
    category: 'వర్గం',
    noteOptional: 'గమనిక (ఐచ్ఛికం)',
    notePlaceholder: 'సంక్షిప్త వివరణ…',
    logButton: 'ఖర్చు నమోదు చేయండి',
    expenseHistory: 'ఖర్చుల చరిత్ర',
    noExpenses: 'ఇంకా ఖర్చులు లేవు.',
    deleteExpense: 'ఖర్చును తొలగించండి',
    deleteConfirm: '{category} — {amount} తొలగించాలా?',
    logged: 'ఖర్చు నమోదు చేయబడింది!',
    validAmount: 'చెల్లుబాటు అయ్యే మొత్తాన్ని నమోదు చేయండి.',
    validDate: 'తేదీ YYYY-MM-DD ఆకృతిలో ఉండాలి.',
    categories: {
      Utilities: 'యుటిలిటీలు',
      'Office Supplies': 'ఆఫీసు సామాగ్రి',
      Travel: 'ప్రయాణం',
      Meals: 'భోజనం',
      'Software Subscriptions': 'సాఫ్ట్‌వేర్ సబ్‌స్క్రిప్షన్‌లు',
      Marketing: 'మార్కెటింగ్',
      Maintenance: 'నిర్వహణ',
      Other: 'ఇతర',
    },
  },

  // ── Employee Portal ─────────────────────────────────────────────────────────
  portal: {
    title: 'నా పోర్టల్',
    payslip: 'పే స్లిప్',
    netEarned: 'నికర ఆదాయం',
    attendanceBreakdown: 'హాజరు విభజన',
    salaryCalculation: 'జీతం లెక్కింపు',
    baseMonthlySalary: 'ప్రాథమిక నెలవారీ జీతం',
    effectiveDays: 'ప్రభావవంతమైన రోజులు (P×1 + H×0.5)',
    totalLoggedDays: 'మొత్తం నమోదు రోజులు',
    attendanceRate: 'హాజరు రేటు',
    netSalary: 'నికర జీతం',
    attendanceLog: 'హాజరు లాగ్',
    noRecords: 'రికార్డులు కనుగొనబడలేదు.',
    noPayslipData: '{month} కోసం పే స్లిప్ డేటా లేదు.',
    loadingPortal: 'మీ పోర్టల్ లోడ్ అవుతోంది…',
    dateCol: 'తేదీ',
    dayCol: 'రోజు',
    statusCol: 'స్థితి',
    weightCol: 'భారం',
  },

  // ── Settings ────────────────────────────────────────────────────────────────
  // ── Reports ─────────────────────────────────────────────────────────────────
  reports: {
    title: 'నివేదికలు',
    month: 'నెల',
    selectMonth: 'నెలను ఎంచుకోండి',
    payrollTitle: 'ఉద్యోగుల వేతనాలు',
    summaryLine: '{count} ఉద్యోగి(లు) · {days} రోజుల హాజరు నమోదైంది',
    colName: 'పేరు',
    colDays: 'రోజులు',
    colLeaves: 'సెలవులు',
    colPayment: 'చెల్లింపు',
    presentHalf: '{present} హాజరు · {half} అర్ధ రోజు',
    inactive: 'ఇకపై క్రియాశీలం కాదు',
    noData: 'ఈ నెలకు ఉద్యోగుల రికార్డులు లేవు.',
    loadFailed: 'నివేదికను లోడ్ చేయడం సాధ్యం కాలేదు.',
    legendDays: 'రోజులు — హాజరు ఆధారంగా: పూర్తి రోజు 1, అర్ధ రోజు 0.5.',
    legendLeaves: 'సెలవులు — గైర్హాజరుగా నమోదైన రోజులు. నమోదు చేయని రోజులు సెలవుగా లెక్కించబడవు.',
    legendPayment: 'చెల్లింపు — రోజులు ÷ నమోదైన రోజులు × ప్రాథమిక జీతం.',
    legendScope: '{roles} సిబ్బంది మాత్రమే చూపబడుతున్నారు.',
  },

  // ── Settings ────────────────────────────────────────────────────────────────
  settings: {
    title: 'సెట్టింగ్‌లు',
    signOutAllDevices: 'అన్ని పరికరాల నుండి సైన్ అవుట్ చేయండి',
  },

  // ── Tab labels ──────────────────────────────────────────────────────────────
  tabs: {
    home: 'హోమ్',
    staff: 'సిబ్బంది',
    time: 'సమయం',
    spend: 'ఖర్చు',
    financials: 'ఆర్థికం',
    reports: 'నివేదికలు',
    settings: 'సెట్టింగ్‌లు',
    portal: 'పోర్టల్',
  },

  // ── Status labels ───────────────────────────────────────────────────────────
  status: {
    pending: 'పెండింగ్',
    approved: 'ఆమోదించబడింది',
    rejected: 'తిరస్కరించబడింది',
    active: 'యాక్టివ్',
  },
};
