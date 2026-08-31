/**
 * routes/expenses.js
 * GET    /api/expenses              – all expenses, newest first
 * POST   /api/expenses              – log an expense                    [ADMIN, HR]
 * DELETE /api/expenses/:id          – remove an expense                  [ADMIN]
 * GET    /api/expenses/meta/categories – category list for the picker
 *
 * The whole router sits behind requireAuth (see server.js); the bracketed roles
 * are the additional per-route restrictions.
 */

const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { toExpense } = require('../db/mappers');
const { generateId } = require('../utils/fileHelpers');
const { requireRole } = require('../middleware/requireAuth');

const VALID_CATEGORIES = [
  'Utilities',
  'Office Supplies',
  'Travel',
  'Meals',
  'Software Subscriptions',
  'Marketing',
  'Maintenance',
  'Salaries',
  'Other',
];

const COLS = `id, date, amount, category, description, submitted_by, created_at`;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PG_FK_VIOLATION = '23503';

// Logging spend is an HR/Admin action; deleting a logged expense erases a
// financial record, so that is Admin only.
const CAN_LOG_EXPENSE = requireRole('ADMIN', 'HR');
const CAN_DELETE_EXPENSE = requireRole('ADMIN');

// ─── Static metadata ──────────────────────────────────────────────────────────
// Declared before '/:id'-style routes so 'meta' is never treated as an id.
router.get('/meta/categories', (_req, res) => {
  res.json({ success: true, data: VALID_CATEGORIES });
});

// ─── GET all expenses ─────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    // created_at breaks ties so same-day expenses keep a stable, meaningful order.
    const { rows } = await query(
      `SELECT ${COLS} FROM expenses ORDER BY date DESC, created_at DESC`
    );
    res.json({ success: true, data: rows.map(toExpense) });
  } catch (err) {
    console.error('[expenses] GET error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to fetch expenses.' });
  }
});

// ─── POST create expense ──────────────────────────────────────────────────────
/**
 * Body: { date, amount, category, description?, submittedBy? }
 */
router.post('/', CAN_LOG_EXPENSE, async (req, res) => {
  try {
    const { date, amount, category, description, submittedBy } = req.body;

    if (!date || amount === undefined || !category) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: date, amount, category.',
      });
    }

    if (!DATE_RE.test(date)) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid date format. Use YYYY-MM-DD.' });
    }

    const parsedAmount = parseFloat(amount);
    if (Number.isNaN(parsedAmount) || parsedAmount <= 0) {
      return res
        .status(400)
        .json({ success: false, message: 'amount must be a positive number.' });
    }

    const trimmedCategory = String(category).trim();
    if (!trimmedCategory) {
      return res.status(400).json({ success: false, message: 'category cannot be blank.' });
    }

    const { rows } = await query(
      `INSERT INTO expenses (id, date, amount, category, description, submitted_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING ${COLS}`,
      [
        generateId('exp'),
        date,
        parsedAmount,
        trimmedCategory,
        description ? String(description).trim() : '',
        submittedBy || null,
      ]
    );

    res.status(201).json({ success: true, data: toExpense(rows[0]) });
  } catch (err) {
    if (err.code === PG_FK_VIOLATION) {
      return res.status(400).json({
        success: false,
        message: 'submittedBy does not match any existing employee.',
      });
    }
    console.error('[expenses] POST error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to create expense.' });
  }
});

// ─── DELETE expense ───────────────────────────────────────────────────────────
router.delete('/:id', CAN_DELETE_EXPENSE, async (req, res) => {
  try {
    const { rows } = await query(`DELETE FROM expenses WHERE id = $1 RETURNING ${COLS}`, [
      req.params.id,
    ]);

    if (rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: 'Expense record not found.' });
    }

    res.json({
      success: true,
      data: toExpense(rows[0]),
      message: 'Expense deleted successfully.',
    });
  } catch (err) {
    console.error('[expenses] DELETE error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to delete expense.' });
  }
});

module.exports = router;
