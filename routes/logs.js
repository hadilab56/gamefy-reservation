const express = require('express');
const router = express.Router();
const { query, formatLog } = require('../db');
const { requireAuth } = require('./auth');

// Middleware: Admin only
function requireAdmin(req, res, next) {
  if (req.session && req.session.role === 'admin') {
    return next();
  }
  return res.status(403).json({ error: 'Admin access required to view logs' });
}

// Get activity logs with filters & pagination
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { action, username, search, startDate, endDate, page = 1, limit = 50 } = req.query;

    const whereClauses = [];
    const params = [];

    if (action && action !== 'all') {
      whereClauses.push('action = ?');
      params.push(action);
    }

    if (username) {
      whereClauses.push('username LIKE ?');
      params.push(`%${username}%`);
    }

    if (search) {
      whereClauses.push('(details LIKE ? OR username LIKE ? OR action LIKE ? OR ipAddress LIKE ?)');
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }

    if (startDate && endDate) {
      whereClauses.push('createdAt >= ? AND createdAt <= ?');
      params.push(`${startDate} 00:00:00`, `${endDate} 23:59:59`);
    }

    const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';

    // Total count
    const [countRow] = await query(`SELECT COUNT(*) as total FROM activity_logs ${whereSql}`, params);
    const total = countRow.total;

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.max(1, parseInt(limit, 10));
    const offset = (pageNum - 1) * limitNum;

    const rows = await query(
      `SELECT * FROM activity_logs ${whereSql} ORDER BY createdAt DESC LIMIT ${limitNum} OFFSET ${offset}`,
      params
    );

    res.json({
      logs: rows.map(formatLog),
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Clear logs (admin only)
router.delete('/clear', requireAuth, requireAdmin, async (req, res) => {
  try {
    await query('TRUNCATE TABLE activity_logs');
    res.json({ message: 'Activity logs cleared' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
