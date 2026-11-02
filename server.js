import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db, { UPLOADS_PATH } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'SECRET_KEY_12345';

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_PATH),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.png';
    cb(null, 'a_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + ext);
  }
});
const upload = multer({ storage });

function signToken(user) {
  return jwt.sign({ uid: user.id, username: user.username, isAdmin: !!user.is_admin }, JWT_SECRET, { expiresIn: '30d' });
}

function authOptional(req, res, next) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) { req.user = null; return next(); }
  try {
    const payload = jwt.verify(m[1], JWT_SECRET);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.uid);
    if (!user || user.is_banned) { req.user = null; return next(); }
    req.user = user; next();
  } catch { req.user = null; next(); }
}

function authRequired(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Не авторизован' });
  next();
}

function adminRequired(req, res, next) {
  if (!req.user || !req.user.is_admin) return res.status(403).json({ error: 'Только для админа' });
  next();
}

function publicUser(u) {
  if (!u) return null;
  return { id: u.id, username: u.username, email: u.email, displayName: u.display_name, bio: u.bio || '', isAdmin: !!u.is_admin, createdAt: u.created_at };
}

// --- API AUTH ---
app.post('/api/auth/register', (req, res) => {
  const { username, password, email, displayName } = req.body || {};
  if (!username || !password || !email) return res.status(400).json({ error: 'Заполните все поля' });
  if (password.length < 6) return res.status(400).json({ error: 'Пароль минимум 6 символов' });
  
  const exists = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(username);
  if (exists) return res.status(409).json({ error: 'Имя занято' });

  const hash = bcrypt.hashSync(password, 10);
  const now = Date.now();
  const info = db.prepare('INSERT INTO users (username, email, password_hash, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(username, email, hash, displayName || username, now, now);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  res.json({ user: publicUser(user), token: signToken(user) });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Неверное имя или пароль' });
  }
  res.json({ user: publicUser(user), token: signToken(user) });
});

app.get('/api/me', authRequired, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

app.patch('/api/me', authRequired, (req, res) => {
  const { displayName, bio } = req.body || {};
  db.prepare('UPDATE users SET display_name = ?, bio = ? WHERE id = ?').run(displayName || req.user.username, bio || '', req.user.id);
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
});

// --- API ARTWORKS ---
app.post('/api/artworks', authRequired, upload.fields([{ name: 'file', maxCount: 1 }]), (req, res) => {
  const { title, width, height, isPublic } = req.body;
  const file = req.files?.file?.[0];
  if (!file) return res.status(400).json({ error: 'Файл обязателен' });
  
  const now = Date.now();
  const info = db.prepare('INSERT INTO artworks (user_id, title, width, height, file_path, thumb_path, is_public, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(req.user.id, title || 'Без названия', parseInt(width) || 0, parseInt(height) || 0, file.filename, file.filename, isPublic === '1' ? 1 : 0, now, now);
  res.json({ id: info.lastInsertRowid });
});

app.get('/api/artworks/mine', authRequired, (req, res) => {
  const rows = db.prepare('SELECT * FROM artworks WHERE user_id = ? AND is_deleted = 0 ORDER BY created_at DESC').all(req.user.id);
  res.json({ artworks: rows.map(r => ({ id: r.id, title: r.title, url: '/uploads/' + r.file_path })) });
});

// --- STATIC ---
app.use('/uploads', express.static(UPLOADS_PATH));
app.use(express.static(__dirname, { index: false }));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next();
  res.sendFile(path.join(__dirname, 'index.html'));
});

// --- START ---
app.listen(PORT, () => {
  console.log(`\n=========================================`);
  console.log(`✅ СЕРВЕР ЗАПУЩЕН`);
  console.log(`👉 Открой в браузере: http://localhost:${PORT}`);
  console.log(`=========================================\n`);
});
