const express = require('express');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
let nodemailer = null;
try { nodemailer = require('nodemailer'); } catch {}

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'campus.db');
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOAD_DIR = path.join(__dirname, 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new sqlite3.Database(DB_FILE);
db.serialize(() => db.run('PRAGMA foreign_keys = ON'));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'campus-incident-dev-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax'
    }
  })
);

app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(PUBLIC_DIR));
app.get(['/login', '/login/admin', '/login/staff', '/login/student'], (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const safeBase = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    cb(null, `${safeBase}${path.extname(file.originalname || '')}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 12 * 1024 * 1024 }
});

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function nowIso() {
  return new Date().toISOString();
}

function generateCode(length = 6) {
  return Array.from({ length }, () => Math.floor(Math.random() * 10)).join('');
}

function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}

let mailTransport = null;

async function getMailTransport() {
  const emailUser = process.env.GMAIL_USER || process.env.EMAIL_USER;
  const emailPass = process.env.GMAIL_APP_PASSWORD || process.env.EMAIL_PASS;

  if (!nodemailer || !emailUser || !emailPass) return null;
  if (!mailTransport) {
    mailTransport = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: emailUser, pass: emailPass }
    });
  }
  return mailTransport;
}

async function sendEmail({ to, subject, text }) {
  const transport = await getMailTransport();
  if (!transport) {
    console.log('[mail disabled] To:', to, 'Subject:', subject, 'Message:', text);
    return { skipped: true };
  }
  await transport.sendMail({
    from: process.env.GMAIL_USER || process.env.EMAIL_USER,
    to,
    subject,
    text
  });
  return { skipped: false };
}

function safeBool(value) {
  return value === true || value === 1 || value === '1' || value === 'true' || value === 'on';
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

async function columnExists(table, column) {
  const cols = await all(`PRAGMA table_info(${table})`);
  return cols.some(c => c.name === column);
}

async function ensureColumn(table, columnDef, columnName) {
  const exists = await columnExists(table, columnName);
  if (!exists) {
    await run(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
  }
}

async function logAction(reportId, actor, action, details = '') {
  await run(
    `INSERT INTO activity_logs (reportId, actor, action, details, createdAt)
     VALUES (?, ?, ?, ?, ?)`,
    [reportId, actor, action, details, nowIso()]
  );
}

async function createNotification(userId, type, title, message) {
  if (!userId) return;
  await run(
    `INSERT INTO notifications (userId, type, title, message, isRead, createdAt)
     VALUES (?, ?, ?, ?, 0, ?)`,
    [userId, type, title, message, nowIso()]
  );
}

async function createAdminNotifications(type, title, message) {
  const admins = await all(`SELECT id FROM users WHERE role IN ('admin', 'staff')`);
  for (const admin of admins) {
    await createNotification(admin.id, type, title, message);
  }
}

async function getCurrentUser(req) {
  return get(`SELECT id, username, displayName, role, failedAttempts, lockedUntil FROM users WHERE id = ?`, [
    req.session.userId
  ]);
}

async function getTableSql(tableName) {
  const row = await get(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`, [tableName]);
  return row?.sql || '';
}

async function migrateUsersTableIfNeeded() {
  const sql = await getTableSql('users');
  if (!sql) return;

  const hasStaff = /staff/i.test(sql);
  const hasEmail = /email/i.test(sql);
  if (hasStaff && hasEmail) return;

  await run(`ALTER TABLE users RENAME TO users_legacy`);
  await run(`CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    displayName TEXT NOT NULL,
    email TEXT DEFAULT '',
    role TEXT NOT NULL CHECK(role IN ('admin', 'staff', 'student')),
    passwordHash TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    failedAttempts INTEGER NOT NULL DEFAULT 0,
    lockedUntil TEXT DEFAULT ''
  )`);

  await run(`INSERT INTO users (id, username, displayName, email, role, passwordHash, createdAt, failedAttempts, lockedUntil)
            SELECT id, username, displayName, COALESCE(email, ''),
                   CASE
                     WHEN LOWER(role) IN ('admin', 'staff', 'student') THEN LOWER(role)
                     ELSE 'student'
                   END,
                   passwordHash, createdAt, COALESCE(failedAttempts, 0), COALESCE(lockedUntil, '')
            FROM users_legacy`);

  await run(`DROP TABLE users_legacy`);
}

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

async function requireAdmin(req, res, next) {
  try {
    const user = await getCurrentUser(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    if (!['admin', 'staff'].includes(user.role)) return res.status(403).json({ error: 'Admin only' });
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

function detectSeverity(text = '') {
  const t = String(text).toLowerCase();
  if (/(weapon|fight|assault|threat|intruder|fire|smoke|suspicious|tamper|tampering|theft|stolen|gas leak|chemical|blood)/.test(t)) {
    if (/(weapon|assault|intruder|fire|gas leak|chemical)/.test(t)) return 'Critical';
    return 'High';
  }
  if (/(damage|leak|injury|broken|vandal|blocked|spill|power outage)/.test(t)) return 'Medium';
  return 'Low';
}

async function ensureSchema() {
  await run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    displayName TEXT NOT NULL,
    email TEXT DEFAULT '',
    role TEXT NOT NULL CHECK(role IN ('admin', 'staff', 'student')),
    passwordHash TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    failedAttempts INTEGER NOT NULL DEFAULT 0,
    lockedUntil TEXT DEFAULT ''
  )`);

  await run(`CREATE TABLE IF NOT EXISTS signup_verifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    displayName TEXT NOT NULL,
    email TEXT NOT NULL,
    passwordHash TEXT NOT NULL,
    code TEXT NOT NULL,
    expiresAt TEXT NOT NULL,
    createdAt TEXT NOT NULL
  )`);

  await run(`CREATE TABLE IF NOT EXISTS password_resets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    code TEXT NOT NULL,
    expiresAt TEXT NOT NULL,
    createdAt TEXT NOT NULL
  )`);

  await run(`CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER NOT NULL,
    title TEXT NOT NULL,
    building TEXT NOT NULL,
    area TEXT NOT NULL,
    description TEXT DEFAULT '',
    severity TEXT NOT NULL CHECK(severity IN ('Low','Medium','High','Critical')),
    status TEXT NOT NULL CHECK(status IN ('Pending','Investigating','Resolved')),
    assignedTo TEXT DEFAULT '',
    anonymous INTEGER NOT NULL DEFAULT 0,
    datetime TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE
  )`);

  await run(`CREATE TABLE IF NOT EXISTS evidence (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reportId INTEGER NOT NULL,
    storedName TEXT NOT NULL,
    originalName TEXT NOT NULL,
    mimeType TEXT NOT NULL,
    filePath TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    FOREIGN KEY(reportId) REFERENCES reports(id) ON DELETE CASCADE
  )`);

  await run(`CREATE TABLE IF NOT EXISTS activity_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reportId INTEGER NOT NULL,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    details TEXT DEFAULT '',
    createdAt TEXT NOT NULL,
    FOREIGN KEY(reportId) REFERENCES reports(id) ON DELETE CASCADE
  )`);

  await run(`CREATE TABLE IF NOT EXISTS support_tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER NOT NULL,
    subject TEXT NOT NULL,
    category TEXT NOT NULL,
    message TEXT NOT NULL,
    priority TEXT NOT NULL CHECK(priority IN ('Low','Medium','High')),
    status TEXT NOT NULL CHECK(status IN ('Open','In Progress','Resolved')),
    assignedTo TEXT DEFAULT '',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE
  )`);

  await run(`CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    isRead INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT NOT NULL,
    FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE
  )`);

  // Backward-compatible migrations for older DBs
  await ensureColumn('users', "email TEXT DEFAULT ''", 'email').catch(() => {});
  await ensureColumn('users', "failedAttempts INTEGER NOT NULL DEFAULT 0", 'failedAttempts').catch(() => {});
  await ensureColumn('users', "lockedUntil TEXT DEFAULT ''", 'lockedUntil').catch(() => {});

  const admin = await get(`SELECT id FROM users WHERE username = ?`, ['admin']);
  if (!admin) {
    const passwordHash = await bcrypt.hash('admin123', 10);
    await run(
      `INSERT INTO users (username, displayName, email, role, passwordHash, createdAt, failedAttempts, lockedUntil)
       VALUES (?, ?, ?, ?, ?, ?, 0, '')`,
      ['admin', 'Admin Officer', 'admin@campus.edu', 'admin', passwordHash, nowIso()]
    );
  }

  const student1 = await get(`SELECT id FROM users WHERE username = ?`, ['student1']);
  if (!student1) {
    const passwordHash = await bcrypt.hash('student123', 10);
    await run(
      `INSERT INTO users (username, displayName, email, role, passwordHash, createdAt, failedAttempts, lockedUntil)
       VALUES (?, ?, ?, ?, ?, ?, 0, '')`,
      ['student1', 'Student One', 'student1@campus.edu', 'student', passwordHash, nowIso()]
    );
  }

  const student2 = await get(`SELECT id FROM users WHERE username = ?`, ['student2']);
  if (!student2) {
    const passwordHash = await bcrypt.hash('student123', 10);
    await run(
      `INSERT INTO users (username, displayName, email, role, passwordHash, createdAt, failedAttempts, lockedUntil)
       VALUES (?, ?, ?, ?, ?, ?, 0, '')`,
      ['student2', 'Student Two', 'student2@campus.edu', 'student', passwordHash, nowIso()]
    );
  }

  const staff1 = await get(`SELECT id FROM users WHERE username = ?`, ['staff1']);
  if (!staff1) {
    const passwordHash = await bcrypt.hash('staff123', 10);
    await run(
      `INSERT INTO users (
        username,
        displayName,
        email,
        role,
        passwordHash,
        createdAt,
        failedAttempts,
        lockedUntil
      )
      VALUES (?, ?, ?, ?, ?, ?, 0, '')`,
      [
        'staff1',
        'Staff One',
        'staff1@campus.edu',
        'staff',
        passwordHash,
        nowIso()
      ]
    );
  }

  const reportCount = await get(`SELECT COUNT(*) AS c FROM reports`);
  if ((reportCount?.c || 0) === 0) {
    const s1 = await get(`SELECT id FROM users WHERE username = ?`, ['student1']);
    const s2 = await get(`SELECT id FROM users WHERE username = ?`, ['student2']);

    const r1 = await run(
      `INSERT INTO reports
       (userId, title, building, area, description, severity, status, assignedTo, anonymous, datetime, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        s1.id,
        'Suspicious Activity',
        'Main Campus',
        'South Gate',
        'Individual observed tampering with locker locks near the athletic wing.',
        'Critical',
        'Pending',
        '',
        0,
        '3/24/2026, 08:45 AM',
        nowIso()
      ]
    );
    await logAction(r1.lastID, 'system', 'Created report', 'Seed incident inserted');

    const r2 = await run(
      `INSERT INTO reports
       (userId, title, building, area, description, severity, status, assignedTo, anonymous, datetime, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        s2.id,
        'Infrastructure Damage',
        'Science Building',
        'Lab 2B',
        'Significant water leak detected in ceiling panels.',
        'Medium',
        'Pending',
        '',
        0,
        '3/24/2026, 10:20 AM',
        nowIso()
      ]
    );
    await logAction(r2.lastID, 'system', 'Created report', 'Seed incident inserted');
  }
}

app.post('/api/signup', async (req, res) => {
  try {
    const username = normalizeText(req.body.username);
    const displayName = normalizeText(req.body.displayName);
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password ?? '');

    if (!username || !displayName || !email || !password) {
      return res.status(400).json({ error: 'Username, display name, email, and password required' });
    }

    const existingUser = await get(`SELECT id FROM users WHERE username = ? OR email = ?`, [username, email]);
    if (existingUser) return res.status(409).json({ error: 'Username or email already exists' });

    const passwordHash = await bcrypt.hash(password, 10);
    const code = generateCode(6);
    const expiresAt = addMinutes(new Date(), 15).toISOString();

    await run(`DELETE FROM signup_verifications WHERE email = ? OR username = ?`, [email, username]);
    await run(
      `INSERT INTO signup_verifications (username, displayName, email, passwordHash, code, expiresAt, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [username, displayName, email, passwordHash, code, expiresAt, nowIso()]
    );

    await sendEmail({
      to: email,
      subject: 'Campus account verification code',
      text: `Your verification code is ${code}. It expires in 15 minutes.`
    });

    res.json({ ok: true, message: 'Verification code sent to your email.' });
  } catch (err) {
    console.error('POST /api/signup failed:', err);
    res.status(500).json({ error: 'Signup failed' });
  }
});

app.post('/api/signup/verify', async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const code = normalizeText(req.body.code);

    if (!email || !code) {
      return res.status(400).json({ error: 'Email and verification code are required' });
    }

    const pending = await get(
      `SELECT * FROM signup_verifications WHERE email = ? AND code = ? ORDER BY id DESC LIMIT 1`,
      [email, code]
    );

    if (!pending) return res.status(400).json({ error: 'Invalid verification code' });
    if (pending.expiresAt && new Date(pending.expiresAt) < new Date()) {
      return res.status(400).json({ error: 'Verification code has expired' });
    }

    const exists = await get(`SELECT id FROM users WHERE username = ? OR email = ?`, [pending.username, pending.email]);
    if (exists) return res.status(409).json({ error: 'Account already exists' });

    const result = await run(
      `INSERT INTO users (username, displayName, email, role, passwordHash, createdAt, failedAttempts, lockedUntil)
       VALUES (?, ?, ?, 'student', ?, ?, 0, '')`,
      [pending.username, pending.displayName, pending.email, pending.passwordHash, nowIso()]
    );

    await run(`DELETE FROM signup_verifications WHERE id = ?`, [pending.id]);
    req.session.userId = result.lastID;

    res.json({
      id: result.lastID,
      username: pending.username,
      displayName: pending.displayName,
      email: pending.email,
      role: 'student'
    });
  } catch (err) {
    console.error('POST /api/signup/verify failed:', err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

app.post('/api/password/forgot/request', async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const user = await get(`SELECT id, displayName, email FROM users WHERE email = ?`, [email]);
    if (!user) return res.status(404).json({ error: 'No account found for that email' });

    const code = generateCode(6);
    const expiresAt = addMinutes(new Date(), 15).toISOString();
    await run(`DELETE FROM password_resets WHERE email = ?`, [email]);
    await run(
      `INSERT INTO password_resets (email, code, expiresAt, createdAt) VALUES (?, ?, ?, ?)`,
      [email, code, expiresAt, nowIso()]
    );

    await sendEmail({
      to: email,
      subject: 'Campus password reset code',
      text: `Hello ${user.displayName}, your password reset code is ${code}. It expires in 15 minutes.`
    });

    res.json({ ok: true, message: 'Reset code sent to your email.' });
  } catch (err) {
    console.error('POST /api/password/forgot/request failed:', err);
    res.status(500).json({ error: 'Failed to send reset code' });
  }
});

app.post('/api/password/forgot/reset', async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const code = normalizeText(req.body.code);
    const newPassword = String(req.body.newPassword ?? '');

    if (!email || !code || !newPassword) {
      return res.status(400).json({ error: 'Email, code, and new password are required' });
    }

    const pending = await get(
      `SELECT * FROM password_resets WHERE email = ? AND code = ? ORDER BY id DESC LIMIT 1`,
      [email, code]
    );

    if (!pending) return res.status(400).json({ error: 'Invalid reset code' });
    if (pending.expiresAt && new Date(pending.expiresAt) < new Date()) {
      return res.status(400).json({ error: 'Reset code has expired' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await run(`UPDATE users SET passwordHash = ? WHERE email = ?`, [passwordHash, email]);
    await run(`DELETE FROM password_resets WHERE email = ?`, [email]);

    res.json({ ok: true, message: 'Password updated successfully.' });
  } catch (err) {
    console.error('POST /api/password/forgot/reset failed:', err);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const username = normalizeText(req.body.username);
    const password = String(req.body.password ?? '');

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const user = await get(`SELECT * FROM users WHERE username = ?`, [username]);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const requestedRole = normalizeText(req.body.role);
    if (requestedRole && user.role !== requestedRole) {
      return res.status(403).json({ error: 'Please use the correct login page for this account type.' });
    }

    if (user.lockedUntil) {
      const lockedUntil = new Date(user.lockedUntil);
      if (!Number.isNaN(lockedUntil.getTime()) && lockedUntil > new Date()) {
        const minutesLeft = Math.max(1, Math.ceil((lockedUntil - new Date()) / 60000));
        return res.status(429).json({
          error: `Account temporarily locked. Try again in ${minutesLeft} minute(s).`
        });
      }
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      const attempts = (user.failedAttempts || 0) + 1;
      const update = {
        failedAttempts: attempts,
        lockedUntil: ''
      };

      if (attempts >= 5) {
        update.failedAttempts = 0;
        update.lockedUntil = addMinutes(new Date(), 15).toISOString();
      }

      await run(
        `UPDATE users SET failedAttempts = ?, lockedUntil = ? WHERE id = ?`,
        [update.failedAttempts, update.lockedUntil, user.id]
      );

      if (attempts >= 5) {
        return res.status(429).json({ error: 'Too many failed attempts. Account locked for 15 minutes.' });
      }

      return res.status(401).json({ error: 'Invalid credentials' });
    }

    await run(`UPDATE users SET failedAttempts = 0, lockedUntil = '' WHERE id = ?`, [user.id]);
    req.session.userId = user.id;

    res.json({
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role
    });
  } catch (err) {
    console.error('POST /api/login failed:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', requireAuth, async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  res.json(user);
});

app.get('/api/users', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const users = await all(
      `SELECT id, username, displayName, email, role, createdAt
       FROM users
       ORDER BY id ASC`
    );
    res.json(users);
  } catch (err) {
    console.error('GET /api/users failed:', err);
    res.status(500).json({ error: 'Failed to load users' });
  }
});

app.post('/api/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { username, displayName, email, role, password } = req.body;
    if (!username || !displayName || !role || !password) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (!['admin', 'staff', 'student'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    const exists = await get(`SELECT id FROM users WHERE username = ?`, [normalizeText(username)]);
    if (exists) return res.status(409).json({ error: 'Username already exists' });

    const passwordHash = await bcrypt.hash(String(password), 10);
    const result = await run(
      `INSERT INTO users (
        username,
        displayName,
        email,
        role,
        passwordHash,
        createdAt,
        failedAttempts,
        lockedUntil
      )
      VALUES (?, ?, ?, ?, ?, ?, 0, '')`,
      [
        normalizeText(username),
        normalizeText(displayName),
        normalizeEmail(email),
        role,
        passwordHash,
        nowIso()
      ]
    );

    res.json({ id: result.lastID });
  } catch (err) {
    console.error('POST /api/users failed:', err);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

app.put('/api/users/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { username, displayName, email, role, password } = req.body;
    const existing = await get(`SELECT * FROM users WHERE id = ?`, [id]);
    if (!existing) return res.status(404).json({ error: 'User not found' });

    if (!username || !displayName || !role) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (!['admin', 'staff', 'student'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    const taken = await get(`SELECT id FROM users WHERE username = ? AND id != ?`, [normalizeText(username), id]);
    if (taken) return res.status(409).json({ error: 'Username already exists' });

    const passwordHash = password ? await bcrypt.hash(String(password), 10) : existing.passwordHash;
    await run(
      `UPDATE users
       SET username = ?, displayName = ?, email = ?, role = ?, passwordHash = ?
       WHERE id = ?`,
      [normalizeText(username), normalizeText(displayName), normalizeEmail(email || existing.email), role, passwordHash, id]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('PUT /api/users/:id failed:', err);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

app.delete('/api/users/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const user = await get(`SELECT username FROM users WHERE id = ?`, [id]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.username === 'admin') {
      return res.status(400).json({ error: 'Default admin cannot be deleted' });
    }

    await run(`DELETE FROM users WHERE id = ?`, [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/users/:id failed:', err);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

app.get('/api/reports', requireAuth, async (req, res) => {
  try {
    const me = await getCurrentUser(req);
    if (!me) return res.status(401).json({ error: 'Not authenticated' });

    const baseQuery = `
      SELECT
        r.id, r.userId, u.username AS user,
        CASE WHEN r.anonymous = 1 THEN 'Anonymous' ELSE u.displayName END AS reporterName,
        r.title, r.building, r.area, r.description, r.severity, r.status,
        r.assignedTo, r.anonymous, r.datetime, r.createdAt,
        (SELECT COUNT(*) FROM evidence e WHERE e.reportId = r.id) AS evidenceCount
      FROM reports r
      JOIN users u ON u.id = r.userId
    `;

    const rows = me.role === 'student'
      ? await all(
          `
          ${baseQuery}
          WHERE r.userId = ?
          ORDER BY r.createdAt DESC
          `,
          [me.id]
        )
      : await all(`
          ${baseQuery}
          ORDER BY
            CASE r.severity
              WHEN 'Critical' THEN 1
              WHEN 'High' THEN 2
              WHEN 'Medium' THEN 3
              ELSE 4
            END,
            CASE r.status
              WHEN 'Pending' THEN 1
              WHEN 'Investigating' THEN 2
              ELSE 3
            END,
            r.createdAt DESC
        `);

    res.json(rows);
  } catch (err) {
    console.error('GET /api/reports failed:', err);
    res.status(500).json({ error: 'Failed to load reports' });
  }
});

app.get('/api/reports/:id', requireAuth, async (req, res) => {
  try {
    const me = await getCurrentUser(req);
    const id = Number(req.params.id);

    const report = await get(
      `
      SELECT
        r.id, r.userId, u.username AS user,
        CASE WHEN r.anonymous = 1 THEN 'Anonymous' ELSE u.displayName END AS reporterName,
        r.title, r.building, r.area, r.description, r.severity, r.status,
        r.assignedTo, r.anonymous, r.datetime, r.createdAt
      FROM reports r
      JOIN users u ON u.id = r.userId
      WHERE r.id = ?
      `,
      [id]
    );

    if (!report) return res.status(404).json({ error: 'Report not found' });
    if (me.role === 'student' && report.userId !== me.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const evidence = await all(
      `
      SELECT id, originalName, filePath, mimeType, createdAt
      FROM evidence
      WHERE reportId = ?
      ORDER BY id ASC
      `,
      [id]
    );

    const logs = await all(
      `
      SELECT id, actor, action, details, createdAt
      FROM activity_logs
      WHERE reportId = ?
      ORDER BY id DESC
      `,
      [id]
    );

    res.json({ report, evidence, logs });
  } catch (err) {
    console.error('GET /api/reports/:id failed:', err);
    res.status(500).json({ error: 'Failed to load report details' });
  }
});

app.post('/api/reports', requireAuth, upload.single('evidence'), async (req, res) => {
  try {
    const me = await getCurrentUser(req);
    const title = normalizeText(req.body.title);
    const building = normalizeText(req.body.building);
    const area = normalizeText(req.body.area);
    const description = normalizeText(req.body.description);
    const severityGuess = normalizeText(req.body.severity);
    const datetime = normalizeText(req.body.datetime);
    const anonymous = false;

    if (!title || !building || !area || !datetime) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const safeSeverity = ['Low', 'Medium', 'High', 'Critical'].includes(severityGuess)
      ? severityGuess
      : detectSeverity(`${title} ${description}`);

    const result = await run(
      `INSERT INTO reports
       (userId, title, building, area, description, severity, status, assignedTo, anonymous, datetime, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, 'Pending', '', ?, ?, ?)`,
      [
        me.id,
        title,
        building,
        area,
        description,
        safeSeverity,
        anonymous ? 1 : 0,
        datetime,
        nowIso()
      ]
    );

    if (req.file) {
      await run(
        `INSERT INTO evidence (reportId, storedName, originalName, mimeType, filePath, createdAt)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          result.lastID,
          req.file.filename,
          req.file.originalname,
          req.file.mimetype,
          `/uploads/${req.file.filename}`,
          nowIso()
        ]
      );
      await logAction(result.lastID, me.username, 'Evidence attached', req.file.originalname);
    }

    await logAction(
      result.lastID,
      me.username,
      'Created report',
      `${safeSeverity} / ${building} / ${area}${anonymous ? ' / anonymous' : ''}`
    );

    await createAdminNotifications(
      'report',
      'New incident report',
      `${me.displayName} submitted "${title}" in ${building} / ${area}.`
    );

    res.json({ id: result.lastID });
  } catch (err) {
    console.error('POST /api/reports failed:', err);
    res.status(500).json({ error: 'Failed to create report' });
  }
});

app.put('/api/reports/:id/status', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { status } = req.body;

    if (!['Pending', 'Investigating', 'Resolved'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const report = await get(`SELECT * FROM reports WHERE id = ?`, [id]);
    if (!report) return res.status(404).json({ error: 'Report not found' });

    await run(`UPDATE reports SET status = ? WHERE id = ?`, [status, id]);
    await logAction(id, req.user.username, 'Status updated', status);

    await createNotification(
      report.userId,
      'report',
      `Report #${id} status updated`,
      `Your report "${report.title}" is now marked as ${status}.`
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('PUT /api/reports/:id/status failed:', err);
    res.status(500).json({ error: 'Failed to update report status' });
  }
});

app.put('/api/reports/:id/assign', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const assignedTo = normalizeText(req.body.assignedTo);

    const report = await get(`SELECT * FROM reports WHERE id = ?`, [id]);
    if (!report) return res.status(404).json({ error: 'Report not found' });

    await run(`UPDATE reports SET assignedTo = ? WHERE id = ?`, [assignedTo, id]);
    await logAction(id, req.user.username, 'Assignment updated', assignedTo || 'Unassigned');

    await createNotification(
      report.userId,
      'report',
      `Report #${id} assignment updated`,
      assignedTo ? `Your report has been assigned to ${assignedTo}.` : 'Your report is now unassigned.'
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('PUT /api/reports/:id/assign failed:', err);
    res.status(500).json({ error: 'Failed to update assignment' });
  }
});

app.put('/api/reports/:id/anonymous', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const me = await getCurrentUser(req);
    const report = await get(`SELECT * FROM reports WHERE id = ?`, [id]);

    if (!report) return res.status(404).json({ error: 'Report not found' });
    if (me.role === 'student' && report.userId !== me.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const anon = safeBool(req.body.anonymous) ? 1 : 0;
    await run(`UPDATE reports SET anonymous = ? WHERE id = ?`, [anon, id]);
    await logAction(id, me.username, 'Anonymous setting changed', anon ? 'Enabled' : 'Disabled');

    res.json({ ok: true });
  } catch (err) {
    console.error('PUT /api/reports/:id/anonymous failed:', err);
    res.status(500).json({ error: 'Failed to update anonymity' });
  }
});

app.get('/api/activity-logs', requireAuth, async (req, res) => {
  const me = await getCurrentUser(req);
  if (!me || me.role === 'student') {
    return res.status(403).json({ error: 'Admin/staff only' });
  }
  try {
    const logs = await all(
      `
      SELECT al.id, al.reportId, al.actor, al.action, al.details, al.createdAt,
             r.title AS reportTitle
      FROM activity_logs al
      JOIN reports r ON r.id = al.reportId
      ORDER BY al.id DESC
      `
    );
    res.json(logs);
  } catch (err) {
    console.error('GET /api/activity-logs failed:', err);
    res.status(500).json({ error: 'Failed to load activity logs' });
  }
});

app.get('/api/stats', requireAuth, requireAdmin, async (req, res) => {
  try {
    const total = await get(`SELECT COUNT(*) AS c FROM reports`);
    const pending = await get(`SELECT COUNT(*) AS c FROM reports WHERE status = 'Pending'`);
    const investigating = await get(`SELECT COUNT(*) AS c FROM reports WHERE status = 'Investigating'`);
    const resolved = await get(`SELECT COUNT(*) AS c FROM reports WHERE status = 'Resolved'`);
    const critical = await get(`SELECT COUNT(*) AS c FROM reports WHERE severity = 'Critical'`);
    const severity = await all(
      `
      SELECT severity, COUNT(*) AS c
      FROM reports
      GROUP BY severity
      `
    );
    const openTickets = await get(`SELECT COUNT(*) AS c FROM support_tickets WHERE status IN ('Open','In Progress')`);
    const unreadNotifications = await get(
      `SELECT COUNT(*) AS c FROM notifications WHERE userId = ? AND isRead = 0`,
      [req.session.userId]
    );

    res.json({
      total: total?.c || 0,
      pending: pending?.c || 0,
      investigating: investigating?.c || 0,
      resolved: resolved?.c || 0,
      critical: critical?.c || 0,
      severity,
      openTickets: openTickets?.c || 0,
      unreadNotifications: unreadNotifications?.c || 0
    });
  } catch (err) {
    console.error('GET /api/stats failed:', err);
    res.status(500).json({ error: 'Failed to load stats' });
  }
});

app.get('/api/notifications', requireAuth, async (req, res) => {
  try {
    const me = await getCurrentUser(req);
    const rows = await all(
      `
      SELECT id, type, title, message, isRead, createdAt
      FROM notifications
      WHERE userId = ?
      ORDER BY id DESC
      LIMIT 100
      `,
      [me.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('GET /api/notifications failed:', err);
    res.status(500).json({ error: 'Failed to load notifications' });
  }
});

app.put('/api/notifications/:id/read', requireAuth, async (req, res) => {
  try {
    const me = await getCurrentUser(req);
    const id = Number(req.params.id);
    const row = await get(`SELECT * FROM notifications WHERE id = ?`, [id]);
    if (!row) return res.status(404).json({ error: 'Notification not found' });
    if (me.role !== 'admin' && row.userId !== me.id) return res.status(403).json({ error: 'Forbidden' });

    await run(`UPDATE notifications SET isRead = 1 WHERE id = ?`, [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('PUT /api/notifications/:id/read failed:', err);
    res.status(500).json({ error: 'Failed to update notification' });
  }
});

app.put('/api/notifications/read-all', requireAuth, async (req, res) => {
  try {
    const me = await getCurrentUser(req);
    await run(`UPDATE notifications SET isRead = 1 WHERE userId = ?`, [me.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('PUT /api/notifications/read-all failed:', err);
    res.status(500).json({ error: 'Failed to mark notifications read' });
  }
});

app.get('/api/support', requireAuth, async (req, res) => {
  try {
    const me = await getCurrentUser(req);
    const tickets = me.role === 'student'
      ? await all(
          `
          SELECT st.*, u.username, u.displayName
          FROM support_tickets st
          JOIN users u ON u.id = st.userId
          WHERE st.userId = ?
          ORDER BY st.id DESC
          `,
          [me.id]
        )
      : await all(
          `
          SELECT st.*, u.username, u.displayName
          FROM support_tickets st
          JOIN users u ON u.id = st.userId
          ORDER BY st.id DESC
          `
        );

    res.json(tickets);
  } catch (err) {
    console.error('GET /api/support failed:', err);
    res.status(500).json({ error: 'Failed to load support tickets' });
  }
});

app.post('/api/support', requireAuth, async (req, res) => {
  try {
    const me = await getCurrentUser(req);
    const subject = normalizeText(req.body.subject);
    const category = normalizeText(req.body.category) || 'General';
    const message = normalizeText(req.body.message);
    const priority = ['Low', 'Medium', 'High'].includes(req.body.priority) ? req.body.priority : 'Medium';

    if (!subject || !message) {
      return res.status(400).json({ error: 'Subject and message are required' });
    }

    const result = await run(
      `
      INSERT INTO support_tickets
      (userId, subject, category, message, priority, status, assignedTo, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, 'Open', '', ?, ?)
      `,
      [me.id, subject, category, message, priority, nowIso(), nowIso()]
    );

    await createAdminNotifications('support', 'New support ticket', `${me.displayName} submitted a support request: "${subject}".`);
    await createNotification(me.id, 'support', 'Support ticket received', `We received your request: "${subject}".`);

    res.json({ id: result.lastID });
  } catch (err) {
    console.error('POST /api/support failed:', err);
    res.status(500).json({ error: 'Failed to create support ticket' });
  }
});

app.put('/api/support/:id/status', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const status = normalizeText(req.body.status);
    const assignedToProvided = Object.prototype.hasOwnProperty.call(req.body, 'assignedTo');
    const assignedTo = assignedToProvided ? normalizeText(req.body.assignedTo) : null;

    if (!['Open', 'In Progress', 'Resolved'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const ticket = await get(`SELECT * FROM support_tickets WHERE id = ?`, [id]);
    if (!ticket) return res.status(404).json({ error: 'Support ticket not found' });

    const nextAssignedTo = assignedToProvided ? assignedTo : (ticket.assignedTo || '');

    await run(
      `UPDATE support_tickets SET status = ?, assignedTo = ?, updatedAt = ? WHERE id = ?`,
      [status, nextAssignedTo, nowIso(), id]
    );

    await createNotification(
      ticket.userId,
      'support',
      `Support ticket #${id} updated`,
      `Your ticket "${ticket.subject}" is now ${status}.`
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('PUT /api/support/:id/status failed:', err);
    res.status(500).json({ error: 'Failed to update support ticket' });
  }
});

app.delete('/api/support/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const ticket = await get(`SELECT * FROM support_tickets WHERE id = ?`, [id]);
    if (!ticket) return res.status(404).json({ error: 'Support ticket not found' });
    await run(`DELETE FROM support_tickets WHERE id = ?`, [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/support/:id failed:', err);
    res.status(500).json({ error: 'Failed to delete support ticket' });
  }
});

ensureSchema()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  })
  .catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });