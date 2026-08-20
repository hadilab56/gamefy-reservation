const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { query, formatUser, logActivity } = require('../db');

// Middleware to check if user is authenticated
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }
  return res.status(401).json({ error: 'Authentication required' });
}

// Check if initial setup is needed
router.get('/needs-setup', async (req, res) => {
  try {
    const rows = await query('SELECT COUNT(*) as count FROM users');
    res.json({ needsSetup: rows[0].count === 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// First-time admin setup
router.post('/setup', async (req, res) => {
  try {
    const rows = await query('SELECT COUNT(*) as count FROM users');
    if (rows[0].count > 0) {
      return res.status(400).json({ error: 'Setup already completed. Please login.' });
    }

    const { username, password, displayName } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await query(
      'INSERT INTO users (username, password, displayName, role) VALUES (?, ?, ?, ?)',
      [username.trim().toLowerCase(), hashedPassword, displayName || username, 'admin']
    );

    const [userRow] = await query('SELECT * FROM users WHERE id = ?', [result.insertId]);
    const user = formatUser(userRow);

    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.role = user.role;

    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    await logActivity(user.id, user.username, 'SETUP', `Initial admin setup completed (${user.username})`, ip);

    res.status(201).json({ message: 'Admin account created', user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const rows = await query('SELECT * FROM users WHERE LOWER(username) = ?', [username.trim().toLowerCase()]);
    if (!rows.length) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const userRow = rows[0];
    const isMatch = await bcrypt.compare(password, userRow.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const user = formatUser(userRow);
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.role = user.role;

    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    await logActivity(user.id, user.username, 'LOGIN', `User ${user.displayName} (${user.role}) logged in`, ip);

    res.json({ message: 'Logged in successfully', user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Logout
router.post('/logout', async (req, res) => {
  const userId = req.session ? req.session.userId : null;
  const username = req.session ? req.session.username : 'User';
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';

  if (userId) {
    await logActivity(userId, username, 'LOGOUT', `User ${username} logged out`, ip);
  }

  req.session.destroy(err => {
    if (err) return res.status(500).json({ error: 'Failed to logout' });
    res.json({ message: 'Logged out successfully' });
  });
});

// Get current user
router.get('/me', requireAuth, async (req, res) => {
  try {
    const rows = await query('SELECT * FROM users WHERE id = ?', [req.session.userId]);
    if (!rows.length) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ user: formatUser(rows[0]) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create user/staff account (admin only)
router.post('/users', requireAuth, async (req, res) => {
  try {
    if (req.session.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { username, password, displayName, role } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const existing = await query('SELECT id FROM users WHERE LOWER(username) = ?', [username.trim().toLowerCase()]);
    if (existing.length) {
      return res.status(400).json({ error: 'Username already taken' });
    }

    const userRole = role === 'admin' ? 'admin' : 'staff';
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await query(
      'INSERT INTO users (username, password, displayName, role) VALUES (?, ?, ?, ?)',
      [username.trim().toLowerCase(), hashedPassword, displayName ? displayName.trim() : username.trim(), userRole]
    );

    const [userRow] = await query('SELECT * FROM users WHERE id = ?', [result.insertId]);
    const newUser = formatUser(userRow);

    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    await logActivity(
      req.session.userId,
      req.session.username,
      'CREATE_USER',
      `Created new account "${newUser.username}" (${newUser.displayName}) with role "${newUser.role}"`,
      ip
    );

    res.status(201).json({ message: 'User account created', user: newUser });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List all users (admin only)
router.get('/users', requireAuth, async (req, res) => {
  try {
    if (req.session.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    const rows = await query('SELECT id, username, displayName, role, createdAt, updatedAt FROM users ORDER BY role ASC, createdAt DESC');
    res.json({ users: rows.map(formatUser) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete user account (admin only)
router.delete('/users/:id', requireAuth, async (req, res) => {
  try {
    if (req.session.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    // Prevent deleting yourself
    if (req.params.id === req.session.userId.toString()) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    const [userRow] = await query('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (!userRow) {
      return res.status(404).json({ error: 'User not found' });
    }

    await query('DELETE FROM users WHERE id = ?', [req.params.id]);

    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    await logActivity(
      req.session.userId,
      req.session.username,
      'DELETE_USER',
      `Deleted account "${userRow.username}" (${userRow.displayName})`,
      ip
    );

    res.json({ message: 'User deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = { router, requireAuth };
