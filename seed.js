const bcrypt = require('bcryptjs');
const { initDatabase, query } = require('./db');

// Seed data from the spreadsheet (optional seed script)
const seedReservations = [
  {
    name: 'Achref Rekik',
    phone: '24070475',
    date: '2026-08-18',
    arrivalTime: '16:00',
    leavingTime: '',
    duration: '3h',
    stations: ['PC 4', 'PC 5'],
    stationType: 'pc',
    notes: 'yheb ysob RUST: aatih free time ken moush maabya l blassa ysob',
    status: 'confirmed'
  },
  {
    name: 'Bal7a',
    phone: '54413178',
    date: '2026-08-18',
    arrivalTime: '13:00',
    leavingTime: '',
    duration: '',
    stations: ['PC 1', 'PC 2', 'PC 3', 'PC 4', 'PC 5'],
    stationType: 'pc',
    notes: 'done',
    status: 'done'
  },
  {
    name: 'Sedek',
    phone: '52849642',
    date: '2026-08-18',
    arrivalTime: '13:00',
    leavingTime: '19:00',
    duration: '6h',
    stations: ['PC 6', 'PC 7', 'PC 8', 'PC 9'],
    stationType: 'pc',
    notes: '',
    status: 'confirmed'
  },
  {
    name: 'Illyes',
    phone: '',
    date: '2026-08-18',
    arrivalTime: '19:00',
    leavingTime: '23:00',
    duration: '4h',
    stations: ['PC 1', 'PC 2'],
    stationType: 'pc',
    notes: '',
    status: 'confirmed'
  },
  {
    name: 'Adam Belhadj',
    phone: '53249190',
    date: '2026-08-18',
    arrivalTime: '20:00',
    leavingTime: '',
    duration: '2h+',
    stations: ['PC 3', 'PC 4'],
    stationType: 'pc',
    notes: '',
    status: 'confirmed'
  },
  {
    name: 'Nabil Hamdi',
    phone: '',
    date: '2026-08-18',
    arrivalTime: '19:30',
    leavingTime: '23:30',
    duration: '4h',
    stations: ['VIP Room'],
    stationType: 'vip',
    notes: 'Instagram contact',
    status: 'confirmed'
  },
  {
    name: 'Saif Saidi',
    phone: '95637128',
    date: '2026-08-18',
    arrivalTime: '18:00',
    leavingTime: '',
    duration: '',
    stations: ['PC 6'],
    stationType: 'pc',
    notes: '',
    status: 'confirmed'
  },
  {
    name: 'Feres',
    phone: '26094942',
    date: '2026-08-18',
    arrivalTime: '19:30',
    leavingTime: '',
    duration: '2h+',
    stations: ['PC 1', 'PC 2', 'PC 3'],
    stationType: 'pc',
    notes: 'Poste 1, 2 et 3',
    status: 'confirmed'
  },
  {
    name: 'Aser',
    phone: '92565511',
    date: '2026-08-18',
    arrivalTime: '19:00',
    leavingTime: '',
    duration: 'libre',
    stations: ['PC 7', 'PC 8'],
    stationType: 'pc',
    notes: 'kalmou kbal b se3a (at 6 pm) to confirm ken fama 2 blayes or not',
    status: 'pending'
  },
  {
    name: 'Skander / Rim',
    phone: '21438551',
    date: '2026-08-19',
    arrivalTime: '16:00',
    leavingTime: '20:00',
    duration: '4h',
    stations: ['PC 1', 'PC 2', 'PC 3'],
    stationType: 'pc',
    notes: 'bahdha b3adhhom',
    status: 'confirmed'
  },
  {
    name: 'Moncef',
    phone: '20075917',
    date: '2026-08-20',
    arrivalTime: '13:00',
    leavingTime: '16:00',
    duration: '3h',
    stations: ['PC 1', 'PC 2', 'PC 3'],
    stationType: 'pc',
    notes: '',
    status: 'confirmed'
  },
  {
    name: 'Eya',
    phone: '98141087',
    date: '2026-08-21',
    arrivalTime: '21:00',
    leavingTime: '',
    duration: '',
    stations: ['PC 10'],
    stationType: 'pc',
    notes: 'Poste 10',
    status: 'confirmed'
  },
  {
    name: 'Eya',
    phone: '98141087',
    date: '2026-08-22',
    arrivalTime: '21:00',
    leavingTime: '',
    duration: '',
    stations: ['PC 10'],
    stationType: 'pc',
    notes: 'Poste 10',
    status: 'confirmed'
  },
  {
    name: 'Eya',
    phone: '98141087',
    date: '2026-08-23',
    arrivalTime: '21:00',
    leavingTime: '',
    duration: '',
    stations: ['PC 10'],
    stationType: 'pc',
    notes: 'Poste 10',
    status: 'confirmed'
  },
  {
    name: 'Rim Thabti',
    phone: '21438551',
    date: '2026-08-02',
    arrivalTime: '11:00',
    leavingTime: '14:00',
    duration: '3h',
    stations: ['PC 2', 'PC 3'],
    stationType: 'pc',
    notes: 'POSTE 2+3',
    status: 'done'
  }
];

async function seed() {
  try {
    await initDatabase();
    console.log('✅ Connected to MariaDB');

    // Clear existing reservations
    await query('TRUNCATE TABLE reservations');
    console.log('🗑️  Cleared existing reservations');

    // Insert reservations
    for (const r of seedReservations) {
      await query(
        `INSERT INTO reservations (name, phone, date, arrivalTime, leavingTime, duration, stations, stationType, notes, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          r.name,
          r.phone,
          r.date,
          r.arrivalTime,
          r.leavingTime,
          r.duration,
          JSON.stringify(r.stations),
          r.stationType,
          r.notes,
          r.status
        ]
      );
    }
    console.log(`📝 Seeded ${seedReservations.length} reservations into MariaDB`);

    // Ensure admin user
    const [users] = await query('SELECT COUNT(*) as c FROM users WHERE role = "admin"');
    if (users[0].c === 0) {
      const hash = await bcrypt.hash('admin123', 10);
      await query(
        'INSERT INTO users (username, password, displayName, role) VALUES (?, ?, ?, ?)',
        ['admin', hash, 'Admin', 'admin']
      );
      console.log('👤 Created default admin account (admin / admin123)');
    }

    console.log('\n✅ Seed complete! You can now view tables in HeidiSQL (database: gamefy_academy)');
    process.exit(0);
  } catch (err) {
    console.error('❌ Seed error:', err.message);
    process.exit(1);
  }
}

seed();
