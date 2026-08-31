/**
 * src/theme/colors.js
 * FinTrack design system tokens.
 * Extracted from the WorkforceIntelligence / FinForce Analytics reference screens.
 */

export const Colors = {
  // ── Brand / Primary ────────────────────────────────────────────────────────
  primary:        '#3D35C8',   // deep indigo — active tab, buttons, highlights
  primaryDark:    '#2D27A0',   // pressed state
  primaryLight:   '#5B54D6',   // hover / lighter indigo
  primarySoft:    '#ECEEFF',   // indigo tint background for icons/pills
  primaryMid:     '#6C63FF',   // mid-violet accent

  // ── Page / Surface ─────────────────────────────────────────────────────────
  background:     '#EEEFFE',   // lavender page background
  backgroundAlt:  '#E8E9FF',   // slightly deeper lavender for contrast sections
  surface:        '#FFFFFF',   // white card surface
  surfaceAlt:     '#F8F8FF',   // near-white for input backgrounds

  // ── Status badges ──────────────────────────────────────────────────────────
  pendingBg:      '#ECEEFF',   // lavender pill
  pendingText:    '#3D35C8',
  approvedBg:     '#FFE8DF',   // peach pill
  approvedText:   '#C44B0A',
  rejectedBg:     '#FFE4E4',
  rejectedText:   '#C42B2B',
  successBg:      '#E3F9EE',
  successText:    '#0F7B45',

  // ── Semantic ───────────────────────────────────────────────────────────────
  success:        '#0F7B45',
  successLight:   '#E3F9EE',
  warning:        '#D97706',
  warningLight:   '#FEF3C7',
  warningBg:      '#FFF4E0',
  warningText:    '#A85C00',
  danger:         '#DC2626',
  dangerLight:    '#FEE2E2',
  info:           '#3D35C8',
  infoLight:      '#ECEEFF',

  // ── Chart ──────────────────────────────────────────────────────────────────
  chartBar:       '#DDDCF5',   // inactive bar (grey-lavender)
  chartBarActive: '#3D35C8',   // today / highlighted bar (deep indigo)
  chartLine1:     '#3D35C8',
  chartLine2:     '#F97316',

  // ── Text ───────────────────────────────────────────────────────────────────
  textPrimary:    '#111827',
  textSecondary:  '#6B7280',
  textMuted:      '#9CA3AF',
  textOnDark:     '#FFFFFF',
  textIndigo:     '#3D35C8',

  // ── Border ─────────────────────────────────────────────────────────────────
  border:         '#E5E7EB',
  borderLight:    '#F3F4F6',

  // ── Avatar palette (cycling) ────────────────────────────────────────────────
  avatar: ['#3D35C8', '#0891B2', '#059669', '#D97706', '#DC2626', '#7C3AED'],

  // ── Misc ───────────────────────────────────────────────────────────────────
  white:          '#FFFFFF',
  black:          '#000000',
  overlay:        'rgba(0,0,0,0.35)',
};

export const Typography = {
  // KPI large number
  kpiValue: {
    fontSize: 32,
    fontWeight: '800',
    color: Colors.textPrimary,
    letterSpacing: -1,
  },
  kpiLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  // Section titles (e.g. "Attendance Trends")
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  // Card body text
  body: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  bodyStrong: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  caption: {
    fontSize: 12,
    color: Colors.textMuted,
  },
};

export const Radii = {
  sm:   8,
  md:   14,
  lg:   20,
  xl:   28,
  full: 999,
};

export const Shadow = {
  card: {
    shadowColor: '#3D35C8',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  fab: {
    shadowColor: '#3D35C8',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 8,
  },
};

export default { Colors, Typography, Radii, Shadow };
