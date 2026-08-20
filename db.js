const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const DB_HOST = process.env.DB_HOST || '127.0.0.1';
const DB_PORT = parseInt(process.env.DB_PORT || '3306', 10);
const DB_USER = process.env.DB_USER || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || '';
const DB_NAME = process.env.DB_NAME || 'gamefy_academy';

let pool;

async function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: DB_HOST,
      port: DB_PORT,
      user: DB_USER,
      password: DB_PASSWORD,
      database: DB_NAME,
      waitForConnections: true,
      connectionLimit: 15,
      queueLimit: 0,
      charset: 'utf8mb4'
    });
  }
  return pool;
}

async function query(sql, params = []) {
  const p = await getPool();
  const [rows] = await p.execute(sql, params);
  return rows;
}

// Convert MariaDB reservation row to standard API format
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

  // Format date to ISO string
  let dateVal = row.date;
  if (dateVal instanceof Date) {
    dateVal = dateVal.toISOString().split('T')[0];
  } else if (typeof dateVal === 'string') {
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

// Convert user row
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

// Convert log row
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

// Log activity helper
async function logActivity(userId, username, action, details = '', ipAddress = '') {
  try {
    await query(
      `INSERT INTO activity_logs (userId, username, action, details, ipAddress) VALUES (?, ?, ?, ?, ?)`,
      [userId || null, username || 'System', action, details, ipAddress]
    );
  } catch (err) {
    console.error('Failed to write activity log:', err.message);
  }
}

async function initDatabase() {
  try {
    // 1. Connect without database to ensure database exists
    const rootConn = await mysql.createConnection({
      host: DB_HOST,
      port: DB_PORT,
      user: DB_USER,
      password: DB_PASSWORD
    });

    await rootConn.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);
    await rootConn.end();

    // 2. Connect with pool and ensure tables exist
    const p = await getPool();

    // Users table
    await p.query(`
      CREATE TABLE IF NOT EXISTS \`users\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`username\` VARCHAR(50) NOT NULL UNIQUE,
        \`password\` VARCHAR(255) NOT NULL,
        \`displayName\` VARCHAR(100) DEFAULT '',
        \`role\` ENUM('admin', 'staff') DEFAULT 'admin',
        \`createdAt\` DATETIME DEFAULT CURRENT_TIMESTAMP,
        \`updatedAt\` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Reservations table
    await p.query(`
      CREATE TABLE IF NOT EXISTS \`reservations\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`name\` VARCHAR(100) NOT NULL,
        \`phone\` VARCHAR(50) DEFAULT '',
        \`date\` DATE NOT NULL,
        \`arrivalTime\` VARCHAR(10) NOT NULL,
        \`leavingTime\` VARCHAR(10) DEFAULT '',
        \`duration\` VARCHAR(50) DEFAULT '',
        \`stations\` LONGTEXT DEFAULT NULL,
        \`stationType\` ENUM('pc', 'vip', 'ps5') DEFAULT 'pc',
        \`notes\` TEXT DEFAULT NULL,
        \`status\` ENUM('pending', 'confirmed', 'active', 'done', 'cancelled') DEFAULT 'pending',
        \`createdAt\` DATETIME DEFAULT CURRENT_TIMESTAMP,
        \`updatedAt\` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX \`idx_date\` (\`date\`),
        INDEX \`idx_status\` (\`status\`),
        INDEX \`idx_date_status\` (\`date\`, \`status\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Sessions table
    await p.query(`
      CREATE TABLE IF NOT EXISTS \`sessions\` (
        \`session_id\` VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
        \`expires\` INT(11) UNSIGNED NOT NULL,
        \`data\` MEDIUMTEXT COLLATE utf8mb4_bin,
        PRIMARY KEY (\`session_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
    `);

    // Activity Logs table
    await p.query(`
      CREATE TABLE IF NOT EXISTS \`activity_logs\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`userId\` INT DEFAULT NULL,
        \`username\` VARCHAR(50) NOT NULL,
        \`action\` VARCHAR(50) NOT NULL,
        \`details\` TEXT DEFAULT NULL,
        \`ipAddress\` VARCHAR(50) DEFAULT '',
        \`createdAt\` DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX \`idx_action\` (\`action\`),
        INDEX \`idx_username\` (\`username\`),
        INDEX \`idx_createdAt\` (\`createdAt\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Check if default admin account exists, if not create one
    const [users] = await p.query(`SELECT COUNT(*) as count FROM users WHERE role = 'admin'`);
    if (users[0].count === 0) {
      const hashedPassword = await bcrypt.hash('admin123', 10);
      await p.query(
        `INSERT INTO users (username, password, displayName, role) VALUES (?, ?, ?, ?)`,
        ['admin', hashedPassword, 'Admin', 'admin']
      );
      console.log('👤 Created default admin account in MariaDB (username: admin, password: admin123)');
    }

    console.log(`✅ Connected to MariaDB database "${DB_NAME}" at ${DB_HOST}:${DB_PORT}`);
  } catch (err) {
    console.error('❌ MariaDB initialization error:', err.message);
    throw err;
  }
}

module.exports = {
  getPool,
  query,
  initDatabase,
  formatReservation,
  formatUser,
  formatLog,
  logActivity,
  DB_HOST,
  DB_PORT,
  DB_USER,
  DB_PASSWORD,
  DB_NAME
};
