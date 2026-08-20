const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const { initDatabase, getPool, DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME } = require('./db');
const { router: authRouter } = require('./routes/auth');
const reservationRouter = require('./routes/reservations');
const logsRouter = require('./routes/logs');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

async function startServer() {
  // Initialize MariaDB database and tables
  await initDatabase();

  const pool = await getPool();

  // Session store in MariaDB
  const sessionStore = new MySQLStore({
    clearExpired: true,
    checkExpirationInterval: 900000,
    expiration: 86400000,
    createDatabaseTable: true,
    schema: {
      tableName: 'sessions',
      columnNames: {
        session_id: 'session_id',
        expires: 'expires',
        data: 'data'
      }
    }
  }, pool);

  // Session middleware
  app.use(session({
    key: 'gamefy_session',
    secret: process.env.SESSION_SECRET || 'gamefy-academy-secret-2026',
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 24 * 60 * 60 * 1000,
      httpOnly: true,
      secure: false
    }
  }));

  // Serve static files
  app.use(express.static(path.join(__dirname, 'public')));

  // API routes
  app.use('/api/auth', authRouter);
  app.use('/api/reservations', reservationRouter);
  app.use('/api/logs', logsRouter);

  // Catch-all: serve the SPA
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  // Start server
  app.listen(PORT, () => {
    console.log(`\n🎮 Gamefy Academy (MariaDB) is running at http://localhost:${PORT}`);
    console.log(`   Database: ${DB_NAME} on ${DB_HOST}:${DB_PORT} (HeidiSQL compatible)`);
    console.log(`   Admin Login: admin / admin123\n`);
  });
}

startServer().catch(err => {
  console.error('❌ Failed to start server:', err.message);
  process.exit(1);
});
