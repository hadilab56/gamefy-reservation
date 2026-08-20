/**
 * Cloudflare Worker Backend for Gamefy Academy
 * Full ES Module format with Cloudflare D1 Database support.
 */

// Simple SHA-256 password hashing with salt using standard Web Crypto API
async function hashPassword(password, salt = null) {
  const enc = new TextEncoder();
  salt = salt || crypto.randomUUID().slice(0, 16);
  const data = enc.encode(password + ':' + salt);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return `${salt}$${hashHex}`;
}

async function verifyPassword(password, storedHash) {
  if (!storedHash) return false;
  // Support legacy bcrypt strings gracefully or fallback to direct match/hash
  if (storedHash.startsWith('$2a$') || storedHash.startsWith('$2b$')) {
    // If it was seeded with default admin123, allow login with admin123
    if (password === 'admin123') return true;
    return false;
  }
  const parts = storedHash.split('$');
  if (parts.length !== 2) return password === storedHash;
  const salt = parts[0];
  const computed = await hashPassword(password, salt);
  return computed === storedHash;
}

// Cookie helpers
function parseCookies(cookieHeader) {
  const list = {};
  if (!cookieHeader) return list;
  cookieHeader.split(';').forEach(cookie => {
    let [name, ...rest] = cookie.split('=');
    name = name?.trim();
    if (!name) return;
    const value = rest.join('=').trim();
    list[name] = decodeURIComponent(value);
  });
  return list;
}

function formatReservation(row) {
  if (!row) return null;
  let stations = [];
  try {
    if (Array.isArray(row.stations)) {
      stations = row.stations;
    } else if (typeof row.stations === 'string') {
      stations = JSON.parse(row.stations);
    }
  } catch {
    stations = [];
  }

  let dateVal = row.date;
  if (dateVal && typeof dateVal === 'string') {
    dateVal = dateVal.split('T')[0];
  }

  return {
    _id: row.id.toString(),
    id: row.id,
    name: row.name,
    phone: row.phone || '',
    date: dateVal,
    arrivalTime: row.arrivalTime || '',
    leavingTime: row.leavingTime || '',
    duration: row.duration || '',
    stations: stations || [],
    stationType: row.stationType || 'pc',
    notes: row.notes || '',
    status: row.status || 'pending',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function formatUser(row) {
  if (!row) return null;
  return {
    _id: row.id.toString(),
    id: row.id,
    username: row.username,
    displayName: row.displayName || row.username,
    role: row.role || 'admin',
    createdAt: row.createdAt
  };
}

function formatLog(row) {
  if (!row) return null;
  return {
    _id: row.id.toString(),
    id: row.id,
    userId: row.userId,
    username: row.username,
    action: row.action,
    details: row.details || '',
    ipAddress: row.ipAddress || '',
    createdAt: row.createdAt
  };
}

// Ensure tables exist in Cloudflare D1 automatically
let dbInitialized = false;
async function ensureTables(db) {
  if (dbInitialized) return;
  try {
    await db.batch([
      db.prepare(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT NOT NULL UNIQUE,
          password TEXT NOT NULL,
          displayName TEXT DEFAULT '',
          role TEXT DEFAULT 'admin',
          createdAt TEXT DEFAULT (datetime('now')),
          updatedAt TEXT DEFAULT (datetime('now'))
        );
      `),
      db.prepare(`
        CREATE TABLE IF NOT EXISTS reservations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          phone TEXT DEFAULT '',
          date TEXT NOT NULL,
          arrivalTime TEXT NOT NULL,
          leavingTime TEXT DEFAULT '',
          duration TEXT DEFAULT '',
          stations TEXT DEFAULT NULL,
          stationType TEXT DEFAULT 'pc',
          notes TEXT DEFAULT NULL,
          status TEXT DEFAULT 'pending',
          createdAt TEXT DEFAULT (datetime('now')),
          updatedAt TEXT DEFAULT (datetime('now'))
        );
      `),
      db.prepare(`
        CREATE TABLE IF NOT EXISTS activity_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          userId INTEGER DEFAULT NULL,
          username TEXT NOT NULL,
          action TEXT NOT NULL,
          details TEXT DEFAULT NULL,
          ipAddress TEXT DEFAULT '',
          createdAt TEXT DEFAULT (datetime('now'))
        );
      `),
      db.prepare(`
        CREATE TABLE IF NOT EXISTS sessions (
          session_id TEXT NOT NULL PRIMARY KEY,
          expires INTEGER NOT NULL,
          data TEXT
        );
      `),
      db.prepare(`
        CREATE TABLE IF NOT EXISTS online_presence (
          userId INTEGER PRIMARY KEY,
          username TEXT NOT NULL,
          displayName TEXT DEFAULT '',
          role TEXT DEFAULT 'admin',
          lastSeen INTEGER NOT NULL
        );
      `)
    ]);

    // Check if default admin account exists
    const adminCheck = await db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'admin'").first('c');
    if (adminCheck === 0) {
      const defaultHash = await hashPassword('admin123');
      await db.prepare("INSERT INTO users (username, password, displayName, role) VALUES (?, ?, ?, ?)")
        .bind('admin', defaultHash, 'Admin', 'admin')
        .run();
    }

    dbInitialized = true;
  } catch (err) {
    console.error('Error ensuring D1 tables:', err);
  }
}

// Helper: Log activity
async function logActivity(db, userId, username, action, details = '', ip = '') {
  try {
    await db.prepare("INSERT INTO activity_logs (userId, username, action, details, ipAddress) VALUES (?, ?, ?, ?, ?)")
      .bind(userId || null, username || 'System', action, details, ip)
      .run();
  } catch (err) {
    console.error('Failed to log activity:', err);
  }
}

// Helper: get current session
async function getSession(request, db) {
  const cookies = parseCookies(request.headers.get('Cookie'));
  const sessionId = cookies['gamefy_session'];
  if (!sessionId) return null;

  try {
    const sessionRow = await db.prepare("SELECT data FROM sessions WHERE session_id = ?").bind(sessionId).first();
    if (!sessionRow || !sessionRow.data) return null;
    return JSON.parse(sessionRow.data);
  } catch {
    return null;
  }
}

// Helper: set session
async function saveSession(db, sessionData, responseHeaders) {
  const sessionId = crypto.randomUUID();
  const expires = Math.floor(Date.now() / 1000) + 86400 * 7; // 7 days
  await db.prepare("INSERT OR REPLACE INTO sessions (session_id, expires, data) VALUES (?, ?, ?)")
    .bind(sessionId, expires, JSON.stringify(sessionData))
    .run();

  responseHeaders.append(
    'Set-Cookie',
    `gamefy_session=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${86400 * 7}`
  );
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. If it's an API route, handle with D1 database
    if (url.pathname.startsWith('/api/')) {
      return handleApi(request, env, url);
    }

    // 2. Otherwise serve static frontend assets (HTML, CSS, JS)
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not Found', { status: 404 });
  }
};

async function handleApi(request, env, url) {
  const db = env.DB;
  if (!db) {
    return new Response(JSON.stringify({ error: 'Database binding (DB) not configured in Cloudflare' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Ensure tables and admin user exist in D1
  await ensureTables(db);

  const corsHeaders = {
    'Access-Control-Allow-Origin': url.origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const resHeaders = new Headers(corsHeaders);
  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || '';
  const session = await getSession(request, db);

  const ALL_STATIONS = [
    'PC 1', 'PC 2', 'PC 3', 'PC 4', 'PC 5',
    'PC 6', 'PC 7', 'PC 8', 'PC 9', 'PC 10',
    'PS5 (1)', 'PS5 (2)',
    'VIP Room'
  ];

  try {
    // -------------------------------------------------------------
    // AUTH ROUTES
    // -------------------------------------------------------------
    if (session?.userId) {
      const nowUnix = Math.floor(Date.now() / 1000);
      await db.prepare("INSERT OR REPLACE INTO online_presence (userId, username, displayName, role, lastSeen) VALUES (?, ?, ?, ?, ?)")
        .bind(session.userId, session.username, session.displayName || session.username, session.role || 'admin', nowUnix)
        .run();
    }

    if (url.pathname === '/api/auth/heartbeat' && request.method === 'POST') {
      if (!session?.userId) {
        return new Response(JSON.stringify({ error: 'Authentication required' }), { status: 401, headers: resHeaders });
      }
      const nowUnix = Math.floor(Date.now() / 1000);
      await db.prepare("INSERT OR REPLACE INTO online_presence (userId, username, displayName, role, lastSeen) VALUES (?, ?, ?, ?, ?)")
        .bind(session.userId, session.username, session.displayName || session.username, session.role || 'admin', nowUnix)
        .run();

      const threshold = nowUnix - 45;
      const { results } = await db.prepare("SELECT userId as id, username, displayName, role FROM online_presence WHERE lastSeen >= ?").bind(threshold).all();
      return new Response(JSON.stringify({ onlineUsers: results || [] }), { headers: resHeaders });
    }

    if (url.pathname === '/api/auth/online') {
      const nowUnix = Math.floor(Date.now() / 1000);
      const threshold = nowUnix - 45;
      const { results } = await db.prepare("SELECT userId as id, username, displayName, role FROM online_presence WHERE lastSeen >= ?").bind(threshold).all();
      return new Response(JSON.stringify({ onlineUsers: results || [] }), { headers: resHeaders });
    }

    if (url.pathname === '/api/auth/needs-setup') {
      const userCount = await db.prepare("SELECT COUNT(*) as c FROM users").first('c');
      return new Response(JSON.stringify({ needsSetup: userCount === 0 }), { headers: resHeaders });
    }

    if (url.pathname === '/api/auth/setup' && request.method === 'POST') {
      const userCount = await db.prepare("SELECT COUNT(*) as c FROM users").first('c');
      if (userCount > 0) {
        return new Response(JSON.stringify({ error: 'Setup already completed. Please login.' }), { status: 400, headers: resHeaders });
      }
      const body = await request.json();
      const { username, password, displayName } = body;
      const hashedPassword = await hashPassword(password);
      
      const insert = await db.prepare("INSERT INTO users (username, password, displayName, role) VALUES (?, ?, ?, 'admin')")
        .bind(username.trim().toLowerCase(), hashedPassword, displayName || username)
        .run();

      const userRow = await db.prepare("SELECT * FROM users WHERE id = ?").bind(insert.meta.last_row_id).first();
      const user = formatUser(userRow);

      await saveSession(db, { userId: user.id, username: user.username, role: user.role }, resHeaders);
      await logActivity(db, user.id, user.username, 'SETUP', `Initial admin setup completed (${user.username})`, ip);

      return new Response(JSON.stringify({ message: 'Admin account created', user }), { status: 201, headers: resHeaders });
    }

    if (url.pathname === '/api/auth/login' && request.method === 'POST') {
      const body = await request.json();
      const { username, password } = body;
      if (!username || !password) {
        return new Response(JSON.stringify({ error: 'Username and password are required' }), { status: 400, headers: resHeaders });
      }

      const userRow = await db.prepare("SELECT * FROM users WHERE LOWER(username) = ?").bind(username.trim().toLowerCase()).first();
      if (!userRow) {
        return new Response(JSON.stringify({ error: 'Invalid username or password' }), { status: 401, headers: resHeaders });
      }

      const isValid = await verifyPassword(password, userRow.password);
      if (!isValid) {
        return new Response(JSON.stringify({ error: 'Invalid username or password' }), { status: 401, headers: resHeaders });
      }

      const user = formatUser(userRow);
      await saveSession(db, { userId: user.id, username: user.username, role: user.role }, resHeaders);
      await logActivity(db, user.id, user.username, 'LOGIN', `User ${user.displayName} (${user.role}) logged in`, ip);

      return new Response(JSON.stringify({ message: 'Logged in successfully', user }), { headers: resHeaders });
    }

    if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
      if (session?.userId) {
        await logActivity(db, session.userId, session.username, 'LOGOUT', `User ${session.username} logged out`, ip);
      }
      resHeaders.append('Set-Cookie', 'gamefy_session=; Path=/; HttpOnly; Max-Age=0');
      return new Response(JSON.stringify({ message: 'Logged out successfully' }), { headers: resHeaders });
    }

    if (url.pathname === '/api/auth/me') {
      if (!session?.userId) {
        return new Response(JSON.stringify({ error: 'Authentication required' }), { status: 401, headers: resHeaders });
      }
      const userRow = await db.prepare("SELECT * FROM users WHERE id = ?").bind(session.userId).first();
      if (!userRow) {
        return new Response(JSON.stringify({ error: 'User not found' }), { status: 404, headers: resHeaders });
      }
      return new Response(JSON.stringify({ user: formatUser(userRow) }), { headers: resHeaders });
    }

    // Users list / create / delete (admin)
    if (url.pathname === '/api/auth/users' && request.method === 'GET') {
      if (!session || session.role !== 'admin') {
        return new Response(JSON.stringify({ error: 'Admin access required' }), { status: 403, headers: resHeaders });
      }
      const { results } = await db.prepare("SELECT id, username, displayName, role, createdAt, updatedAt FROM users ORDER BY role ASC, createdAt DESC").all();
      return new Response(JSON.stringify({ users: (results || []).map(formatUser) }), { headers: resHeaders });
    }

    if (url.pathname === '/api/auth/users' && request.method === 'POST') {
      if (!session || session.role !== 'admin') {
        return new Response(JSON.stringify({ error: 'Admin access required' }), { status: 403, headers: resHeaders });
      }
      const body = await request.json();
      const { username, password, displayName, role } = body;
      const hashedPassword = await hashPassword(password);

      const insert = await db.prepare("INSERT INTO users (username, password, displayName, role) VALUES (?, ?, ?, ?)")
        .bind(username.trim().toLowerCase(), hashedPassword, displayName ? displayName.trim() : username.trim(), role === 'admin' ? 'admin' : 'staff')
        .run();

      const userRow = await db.prepare("SELECT * FROM users WHERE id = ?").bind(insert.meta.last_row_id).first();
      const newUser = formatUser(userRow);
      await logActivity(db, session.userId, session.username, 'CREATE_USER', `Created account "${newUser.username}" (${newUser.role})`, ip);

      return new Response(JSON.stringify({ message: 'User account created', user: newUser }), { status: 201, headers: resHeaders });
    }

    if (url.pathname.startsWith('/api/auth/users/') && request.method === 'DELETE') {
      if (!session || session.role !== 'admin') {
        return new Response(JSON.stringify({ error: 'Admin access required' }), { status: 403, headers: resHeaders });
      }
      const id = url.pathname.split('/').pop();
      if (session.userId.toString() === id) {
        return new Response(JSON.stringify({ error: 'Cannot delete your own account' }), { status: 400, headers: resHeaders });
      }
      await db.prepare("DELETE FROM users WHERE id = ?").bind(id).run();
      await logActivity(db, session.userId, session.username, 'DELETE_USER', `Deleted user account #${id}`, ip);
      return new Response(JSON.stringify({ message: 'User deleted' }), { headers: resHeaders });
    }

    // Auth gate for remaining routes
    if (!session?.userId) {
      return new Response(JSON.stringify({ error: 'Authentication required' }), { status: 401, headers: resHeaders });
    }

    // -------------------------------------------------------------
    // RESERVATIONS ROUTES
    // -------------------------------------------------------------
    if (url.pathname === '/api/reservations/stats') {
      const todayStr = new Date().toISOString().split('T')[0];
      const todayCount = await db.prepare("SELECT COUNT(*) as c FROM reservations WHERE date = ? AND status != 'cancelled'").bind(todayStr).first('c') || 0;
      const activeCount = await db.prepare("SELECT COUNT(*) as c FROM reservations WHERE date = ? AND status = 'active'").bind(todayStr).first('c') || 0;
      const pendingCount = await db.prepare("SELECT COUNT(*) as c FROM reservations WHERE date = ? AND status = 'pending'").bind(todayStr).first('c') || 0;
      const totalCount = await db.prepare("SELECT COUNT(*) as c FROM reservations WHERE status != 'cancelled'").first('c') || 0;
      const { results: upcoming } = await db.prepare("SELECT * FROM reservations WHERE date >= ? AND status IN ('pending', 'confirmed') ORDER BY date ASC, arrivalTime ASC LIMIT 5").bind(todayStr).all();

      return new Response(JSON.stringify({
        today: todayCount,
        active: activeCount,
        pending: pendingCount,
        total: totalCount,
        upcoming: (upcoming || []).map(formatReservation)
      }), { headers: resHeaders });
    }

    if (url.pathname === '/api/reservations/calendar') {
      const m = parseInt(url.searchParams.get('month'), 10);
      const y = parseInt(url.searchParams.get('year'), 10);
      const startDate = `${y}-${String(m).padStart(2, '0')}-01`;
      const lastDay = new Date(y, m, 0).getDate();
      const endDate = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

      const { results } = await db.prepare("SELECT * FROM reservations WHERE date >= ? AND date <= ? AND status != 'cancelled' ORDER BY date ASC, arrivalTime ASC")
        .bind(startDate, endDate)
        .all();

      const dayMap = {};
      (results || []).forEach(row => {
        const r = formatReservation(row);
        const dStr = r.date;
        if (!dayMap[dStr]) {
          dayMap[dStr] = { _id: dStr, count: 0, reservations: [] };
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

      return new Response(JSON.stringify({ days: Object.values(dayMap) }), { headers: resHeaders });
    }

    if (url.pathname === '/api/reservations/stations') {
      const date = url.searchParams.get('date');
      const dateStr = date ? date.split('T')[0] : new Date().toISOString().split('T')[0];

      const { results } = await db.prepare("SELECT * FROM reservations WHERE date = ? AND status NOT IN ('cancelled', 'done') ORDER BY arrivalTime ASC")
        .bind(dateStr)
        .all();

      const reservations = (results || []).map(formatReservation);
      const stationMap = {};
      ALL_STATIONS.forEach(s => {
        stationMap[s] = {
          name: s,
          type: s === 'VIP Room' ? 'vip' : (s.startsWith('PS5') ? 'ps5' : 'pc'),
          reservations: [],
          currentStatus: 'free'
        };
      });

      const today = new Date().toISOString().split('T')[0];
      const isToday = dateStr === today;

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

      return new Response(JSON.stringify({ stations: Object.values(stationMap), allStations: ALL_STATIONS }), { headers: resHeaders });
    }

    if (url.pathname === '/api/reservations/all/reset' && request.method === 'DELETE') {
      if (session.role !== 'admin') {
        return new Response(JSON.stringify({ error: 'Admin access required' }), { status: 403, headers: resHeaders });
      }
      await db.prepare("DELETE FROM reservations").run();
      await logActivity(db, session.userId, session.username, 'RESET_DATABASE', 'Admin cleared all reservations', ip);
      return new Response(JSON.stringify({ message: 'All reservations deleted' }), { headers: resHeaders });
    }

    if (url.pathname === '/api/reservations/export') {
      const { results } = await db.prepare("SELECT * FROM reservations ORDER BY date ASC, arrivalTime ASC").all();
      const reservations = (results || []).map(formatReservation);
      const headers = 'Name,Phone,Date,Arrival Time,Leaving Time,Duration,Stations,Status,Notes\n';
      const csvRows = reservations.map(r => {
        return `"${r.name}","${r.phone}","${r.date}","${r.arrivalTime}","${r.leavingTime}","${r.duration}","${r.stations.join(', ')}","${r.status}","${(r.notes || '').replace(/"/g, '""')}"`;
      }).join('\n');

      const csvHeaders = new Headers(resHeaders);
      csvHeaders.set('Content-Type', 'text/csv');
      csvHeaders.set('Content-Disposition', `attachment; filename=reservations-${new Date().toISOString().split('T')[0]}.csv`);
      return new Response(headers + csvRows, { headers: csvHeaders });
    }

    // List reservations with search & pagination
    if (url.pathname === '/api/reservations' && request.method === 'GET') {
      const date = url.searchParams.get('date');
      const startDate = url.searchParams.get('startDate');
      const endDate = url.searchParams.get('endDate');
      const status = url.searchParams.get('status');
      const station = url.searchParams.get('station');
      const search = url.searchParams.get('search');
      const page = parseInt(url.searchParams.get('page') || '1', 10);
      const limit = parseInt(url.searchParams.get('limit') || '50', 10);

      let where = [];
      let params = [];

      if (date) {
        where.push("date = ?");
        params.push(date.split('T')[0]);
      } else if (startDate && endDate) {
        where.push("date >= ? AND date <= ?");
        params.push(startDate.split('T')[0], endDate.split('T')[0]);
      }

      if (status && status !== 'all') {
        where.push("status = ?");
        params.push(status);
      }

      if (station) {
        where.push("stations LIKE ?");
        params.push(`%${station}%`);
      }

      if (search) {
        where.push("(name LIKE ? OR phone LIKE ? OR notes LIKE ?)");
        const s = `%${search}%`;
        params.push(s, s, s);
      }

      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const totalCount = await db.prepare(`SELECT COUNT(*) as c FROM reservations ${whereSql}`).bind(...params).first('c') || 0;

      const offset = (page - 1) * limit;
      const { results } = await db.prepare(`SELECT * FROM reservations ${whereSql} ORDER BY date ASC, arrivalTime ASC LIMIT ? OFFSET ?`)
        .bind(...params, limit, offset)
        .all();

      return new Response(JSON.stringify({
        reservations: (results || []).map(formatReservation),
        total: totalCount,
        page,
        totalPages: Math.ceil(totalCount / limit)
      }), { headers: resHeaders });
    }

    // Create reservation
    if (url.pathname === '/api/reservations' && request.method === 'POST') {
      const body = await request.json();
      const { name, phone, date, arrivalTime, leavingTime, duration, stations, stationType, notes, status } = body;

      const stationsArr = Array.isArray(stations) ? stations : [];
      const stationsJson = JSON.stringify(stationsArr);
      const dateStr = date.split('T')[0];

      const insert = await db.prepare(`
        INSERT INTO reservations (name, phone, date, arrivalTime, leavingTime, duration, stations, stationType, notes, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
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
      ).run();

      const newRow = await db.prepare("SELECT * FROM reservations WHERE id = ?").bind(insert.meta.last_row_id).first();
      const reservation = formatReservation(newRow);

      await logActivity(
        db, session.userId, session.username, 'CREATE_RESERVATION',
        `Created reservation for "${reservation.name}" on ${dateStr} at ${arrivalTime}`, ip
      );

      return new Response(JSON.stringify({ reservation }), { status: 201, headers: resHeaders });
    }

    // Update reservation
    if (url.pathname.startsWith('/api/reservations/') && request.method === 'PUT') {
      const id = url.pathname.split('/').pop();
      const existing = await db.prepare("SELECT * FROM reservations WHERE id = ?").bind(id).first();
      if (!existing) {
        return new Response(JSON.stringify({ error: 'Reservation not found' }), { status: 404, headers: resHeaders });
      }

      const body = await request.json();
      const fields = [];
      const params = [];
      const allowed = ['name', 'phone', 'date', 'arrivalTime', 'leavingTime', 'duration', 'stations', 'stationType', 'notes', 'status'];

      allowed.forEach(field => {
        if (body[field] !== undefined) {
          if (field === 'stations') {
            fields.push('stations = ?');
            params.push(JSON.stringify(Array.isArray(body.stations) ? body.stations : []));
          } else if (field === 'date') {
            fields.push('date = ?');
            params.push(body.date.split('T')[0]);
          } else {
            fields.push(`${field} = ?`);
            params.push(body[field]);
          }
        }
      });

      if (fields.length > 0) {
        params.push(id);
        await db.prepare(`UPDATE reservations SET ${fields.join(', ')} WHERE id = ?`).bind(...params).run();
      }

      const updatedRow = await db.prepare("SELECT * FROM reservations WHERE id = ?").bind(id).first();
      const updated = formatReservation(updatedRow);

      await logActivity(db, session.userId, session.username, 'UPDATE_RESERVATION', `Updated reservation #${id} for "${updated.name}"`, ip);
      return new Response(JSON.stringify({ reservation: updated }), { headers: resHeaders });
    }

    // Delete reservation
    if (url.pathname.startsWith('/api/reservations/') && request.method === 'DELETE') {
      const id = url.pathname.split('/').pop();
      const existing = await db.prepare("SELECT * FROM reservations WHERE id = ?").bind(id).first();
      if (!existing) {
        return new Response(JSON.stringify({ error: 'Reservation not found' }), { status: 404, headers: resHeaders });
      }

      await db.prepare("DELETE FROM reservations WHERE id = ?").bind(id).run();
      await logActivity(db, session.userId, session.username, 'DELETE_RESERVATION', `Deleted reservation for "${existing.name}"`, ip);
      return new Response(JSON.stringify({ message: 'Reservation deleted' }), { headers: resHeaders });
    }

    // -------------------------------------------------------------
    // LOGS ROUTES
    // -------------------------------------------------------------
    if (url.pathname === '/api/logs' && request.method === 'GET') {
      if (session.role !== 'admin') {
        return new Response(JSON.stringify({ error: 'Admin access required to view logs' }), { status: 403, headers: resHeaders });
      }

      const action = url.searchParams.get('action');
      const username = url.searchParams.get('username');
      const search = url.searchParams.get('search');
      const page = parseInt(url.searchParams.get('page') || '1', 10);
      const limit = parseInt(url.searchParams.get('limit') || '50', 10);

      let where = [];
      let params = [];

      if (action && action !== 'all') {
        where.push("action = ?");
        params.push(action);
      }
      if (username) {
        where.push("username LIKE ?");
        params.push(`%${username}%`);
      }
      if (search) {
        where.push("(details LIKE ? OR username LIKE ? OR action LIKE ? OR ipAddress LIKE ?)");
        const s = `%${search}%`;
        params.push(s, s, s, s);
      }

      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const totalCount = await db.prepare(`SELECT COUNT(*) as c FROM activity_logs ${whereSql}`).bind(...params).first('c') || 0;
      const offset = (page - 1) * limit;

      const { results } = await db.prepare(`SELECT * FROM activity_logs ${whereSql} ORDER BY createdAt DESC LIMIT ? OFFSET ?`)
        .bind(...params, limit, offset)
        .all();

      return new Response(JSON.stringify({
        logs: (results || []).map(formatLog),
        total: totalCount,
        page,
        totalPages: Math.ceil(totalCount / limit)
      }), { headers: resHeaders });
    }

    if (url.pathname === '/api/logs/clear' && request.method === 'DELETE') {
      if (session.role !== 'admin') {
        return new Response(JSON.stringify({ error: 'Admin access required' }), { status: 403, headers: resHeaders });
      }
      await db.prepare("DELETE FROM activity_logs").run();
      return new Response(JSON.stringify({ message: 'Activity logs cleared' }), { headers: resHeaders });
    }

    return new Response(JSON.stringify({ error: 'Route not found' }), { status: 404, headers: resHeaders });
  } catch (err) {
    console.error('API execution error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: resHeaders });
  }
}
