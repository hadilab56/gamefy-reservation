const express = require('express');
const router = express.Router();
const { query, formatReservation, logActivity } = require('../db');
const { requireAuth } = require('./auth');

// All stations
const ALL_STATIONS = [
  'PC 1', 'PC 2', 'PC 3', 'PC 4', 'PC 5',
  'PC 6', 'PC 7', 'PC 8', 'PC 9', 'PC 10',
  'PS5 (1)', 'PS5 (2)',
  'VIP Room'
];

// List reservations with filters
router.get('/', requireAuth, async (req, res) => {
  try {
    const { date, startDate, endDate, search, station, status, page = 1, limit = 50 } = req.query;
    
    let whereClauses = [];
    let params = [];

    if (date) {
      whereClauses.push('date = ?');
      params.push(date.split('T')[0]);
    } else if (startDate && endDate) {
      whereClauses.push('date >= ? AND date <= ?');
      params.push(startDate.split('T')[0], endDate.split('T')[0]);
    }

    if (status && status !== 'all') {
      whereClauses.push('status = ?');
      params.push(status);
    }

    if (station) {
      whereClauses.push('stations LIKE ?');
      params.push(`%${station}%`);
    }

    if (search) {
      whereClauses.push('(name LIKE ? OR phone LIKE ? OR notes LIKE ?)');
      const s = `%${search}%`;
      params.push(s, s, s);
    }

    const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';
    
    // Count total
    const countRows = await query(`SELECT COUNT(*) as total FROM reservations ${whereSql}`, params);
    const total = countRows[0].total;

    // Fetch page
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.max(1, parseInt(limit, 10));
    const offset = (pageNum - 1) * limitNum;

    // Use string concatenation for limit/offset in mysql2 to avoid parameter type coercion issues
    const selectSql = `SELECT * FROM reservations ${whereSql} ORDER BY date ASC, arrivalTime ASC LIMIT ${limitNum} OFFSET ${offset}`;
    const rows = await query(selectSql, params);

    res.json({
      reservations: rows.map(formatReservation),
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get reservation counts per day for calendar
router.get('/calendar', requireAuth, async (req, res) => {
  try {
    const { month, year } = req.query;
    const m = parseInt(month, 10);
    const y = parseInt(year, 10);

    const startDate = `${y}-${String(m).padStart(2, '0')}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    const endDate = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    const rows = await query(
      `SELECT * FROM reservations 
       WHERE date >= ? AND date <= ? AND status != 'cancelled' 
       ORDER BY date ASC, arrivalTime ASC`,
      [startDate, endDate]
    );

    // Group by date
    const dayMap = {};
    rows.forEach(row => {
      const r = formatReservation(row);
      const dStr = r.date;
      if (!dayMap[dStr]) {
        dayMap[dStr] = {
          _id: dStr,
          count: 0,
          reservations: []
        };
      }
      dayMap[dStr].count++;
      dayMap[dStr].reservations.push({
        _id: r._id,
        name: r.name,
        arrivalTime: r.arrivalTime,
        leavingTime: r.leavingTime,
        stations: r.stations,
        status: r.status
      });
    });

    res.json({ days: Object.values(dayMap) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get station availability for a date
router.get('/stations', requireAuth, async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) {
      return res.status(400).json({ error: 'Date parameter required' });
    }

    const dateStr = date.split('T')[0];
    const rows = await query(
      `SELECT * FROM reservations WHERE date = ? AND status NOT IN ('cancelled', 'done') ORDER BY arrivalTime ASC`,
      [dateStr]
    );
    const reservations = rows.map(formatReservation);

    // Build station status map
    const stationMap = {};
    ALL_STATIONS.forEach(s => {
      stationMap[s] = {
        name: s,
        type: s === 'VIP Room' ? 'vip' : (s.startsWith('PS5') ? 'ps5' : 'pc'),
        reservations: [],
        currentStatus: 'free'
      };
    });

    const now = new Date();
    const isToday = dateStr === now.toISOString().split('T')[0];

    reservations.forEach(r => {
      r.stations.forEach(station => {
        if (stationMap[station]) {
          stationMap[station].reservations.push({
            _id: r._id,
            name: r.name,
            arrivalTime: r.arrivalTime,
            leavingTime: r.leavingTime,
            duration: r.duration,
            status: r.status
          });

          // Determine current status
          if (isToday && r.status === 'active') {
            stationMap[station].currentStatus = 'occupied';
          } else if (r.status === 'confirmed' || r.status === 'pending') {
            if (stationMap[station].currentStatus !== 'occupied') {
              stationMap[station].currentStatus = 'reserved';
            }
          }
        }
      });
    });

    res.json({ stations: Object.values(stationMap), allStations: ALL_STATIONS });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get dashboard stats
router.get('/stats', requireAuth, async (req, res) => {
  try {
    const todayStr = new Date().toISOString().split('T')[0];

    const [todayCountRow] = await query(
      `SELECT COUNT(*) as c FROM reservations WHERE date = ? AND status != 'cancelled'`,
      [todayStr]
    );
    const [activeCountRow] = await query(
      `SELECT COUNT(*) as c FROM reservations WHERE date = ? AND status = 'active'`,
      [todayStr]
    );
    const [pendingCountRow] = await query(
      `SELECT COUNT(*) as c FROM reservations WHERE date = ? AND status = 'pending'`,
      [todayStr]
    );
    const [totalCountRow] = await query(
      `SELECT COUNT(*) as c FROM reservations WHERE status != 'cancelled'`
    );

    // Get upcoming reservations
    const upcomingRows = await query(
      `SELECT * FROM reservations WHERE date >= ? AND status IN ('pending', 'confirmed') ORDER BY date ASC, arrivalTime ASC LIMIT 5`,
      [todayStr]
    );

    res.json({
      today: todayCountRow.c,
      active: activeCountRow.c,
      pending: pendingCountRow.c,
      total: totalCountRow.c,
      upcoming: upcomingRows.map(formatReservation)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create reservation
router.post('/', requireAuth, async (req, res) => {
  try {
    const { name, phone, date, arrivalTime, leavingTime, duration, stations, stationType, notes, status } = req.body;

    if (!name || !date || !arrivalTime) {
      return res.status(400).json({ error: 'Name, date, and arrival time are required' });
    }

    const stationsArr = Array.isArray(stations) ? stations : [];
    const stationsJson = JSON.stringify(stationsArr);
    const dateStr = date.split('T')[0];

    const result = await query(
      `INSERT INTO reservations (name, phone, date, arrivalTime, leavingTime, duration, stations, stationType, notes, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name.trim(),
        phone ? phone.trim() : '',
        dateStr,
        arrivalTime.trim(),
        leavingTime ? leavingTime.trim() : '',
        duration ? duration.trim() : '',
        stationsJson,
        stationType || (stationsJson.includes('VIP Room') ? 'vip' : (stationsArr.some(s => s.startsWith('PS5')) ? 'ps5' : 'pc')),
        notes ? notes.trim() : '',
        status || 'pending'
      ]
    );

    const [newRow] = await query('SELECT * FROM reservations WHERE id = ?', [result.insertId]);
    const reservation = formatReservation(newRow);

    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    await logActivity(
      req.session.userId,
      req.session.username,
      'CREATE_RESERVATION',
      `Created reservation for "${reservation.name}" on ${dateStr} at ${arrivalTime} (Stations: ${stationsArr.join(', ') || 'None'})`,
      ip
    );

    res.status(201).json({ reservation });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update reservation
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const id = req.params.id;
    const [existing] = await query('SELECT * FROM reservations WHERE id = ?', [id]);
    if (!existing) {
      return res.status(404).json({ error: 'Reservation not found' });
    }

    const fields = [];
    const params = [];

    const allowed = ['name', 'phone', 'date', 'arrivalTime', 'leavingTime', 'duration', 'stations', 'stationType', 'notes', 'status'];
    
    allowed.forEach(field => {
      if (req.body[field] !== undefined) {
        if (field === 'stations') {
          fields.push('stations = ?');
          params.push(JSON.stringify(Array.isArray(req.body.stations) ? req.body.stations : []));
        } else if (field === 'date') {
          fields.push('date = ?');
          params.push(req.body.date.split('T')[0]);
        } else {
          fields.push(`${field} = ?`);
          params.push(req.body[field]);
        }
      }
    });

    if (!fields.length) {
      return res.json({ reservation: formatReservation(existing) });
    }

    params.push(id);
    await query(`UPDATE reservations SET ${fields.join(', ')} WHERE id = ?`, params);

    const [updatedRow] = await query('SELECT * FROM reservations WHERE id = ?', [id]);
    const updated = formatReservation(updatedRow);

    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    const isStatusOnly = Object.keys(req.body).length === 1 && req.body.status;
    const action = isStatusOnly ? 'STATUS_CHANGE' : 'UPDATE_RESERVATION';
    const detailMsg = isStatusOnly 
      ? `Changed status for "${updated.name}" from "${existing.status}" to "${updated.status}"`
      : `Updated reservation for "${updated.name}" (Date: ${updated.date}, Time: ${updated.arrivalTime})`;

    await logActivity(req.session.userId, req.session.username, action, detailMsg, ip);

    res.json({ reservation: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete reservation
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const id = req.params.id;
    const [existing] = await query('SELECT * FROM reservations WHERE id = ?', [id]);
    if (!existing) {
      return res.status(404).json({ error: 'Reservation not found' });
    }

    await query('DELETE FROM reservations WHERE id = ?', [id]);

    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    await logActivity(
      req.session.userId,
      req.session.username,
      'DELETE_RESERVATION',
      `Deleted reservation for "${existing.name}" (Date: ${existing.date ? existing.date.toISOString().split('T')[0] : ''}, Time: ${existing.arrivalTime})`,
      ip
    );

    res.json({ message: 'Reservation deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete all reservations (reset)
router.delete('/all/reset', requireAuth, async (req, res) => {
  try {
    if (req.session.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    await query('TRUNCATE TABLE reservations');

    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    await logActivity(req.session.userId, req.session.username, 'RESET_DATABASE', 'Admin cleared all reservations from database', ip);

    res.json({ message: 'All reservations deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Export reservations as CSV
router.get('/export', requireAuth, async (req, res) => {
  try {
    const { date, startDate, endDate, status } = req.query;
    let whereClauses = [];
    let params = [];

    if (date) {
      whereClauses.push('date = ?');
      params.push(date.split('T')[0]);
    } else if (startDate && endDate) {
      whereClauses.push('date >= ? AND date <= ?');
      params.push(startDate.split('T')[0], endDate.split('T')[0]);
    }

    if (status && status !== 'all') {
      whereClauses.push('status = ?');
      params.push(status);
    }

    const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const rows = await query(`SELECT * FROM reservations ${whereSql} ORDER BY date ASC, arrivalTime ASC`, params);
    const reservations = rows.map(formatReservation);

    // Build CSV
    const headers = 'Name,Phone,Date,Arrival Time,Leaving Time,Duration,Stations,Status,Notes\n';
    const csvRows = reservations.map(r => {
      return `"${r.name}","${r.phone}","${r.date}","${r.arrivalTime}","${r.leavingTime}","${r.duration}","${r.stations.join(', ')}","${r.status}","${(r.notes || '').replace(/"/g, '""')}"`;
    }).join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=reservations-${new Date().toISOString().split('T')[0]}.csv`);
    res.send(headers + csvRows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
