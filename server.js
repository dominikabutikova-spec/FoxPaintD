/* ============================================================
   server.js — REST API для Studio Paint (Node.js ONLY)
   ============================================================ */
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
const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_ME_IN_PRODUCTION_' + Math.random().toString(36).slice(2);
const JWT_EXPIRES = '30d';

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));

/* Multer для загрузки картинок */
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_PATH),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.png';
    const name = 'a_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10) + ext;
    cb(null, name);
  }
});
const upload = multer({ storage });

/* JWT функции */
function signToken(user){
  return jwt.sign({ uid: user.id, username: user.username, isAdmin: !!user.is_admin }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

function authOptional(req, res, next){
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if(!m){ req.user = null; return next(); }
  try {
    const payload = jwt.verify(m[1], JWT_SECRET);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.uid);
    if(!user || user.is_banned){ req.user = null; return next(); }
    req.user = user; next();
  } catch { req.user = null; next(); }
}

function authRequired(req, res, next){
  if(!req.user) return res.status(401).json({ error: 'Не авторизован' });
  next();
}

function adminRequired(req, res, next){
  if(!req.user || !req.user.is_admin) return res.status(403).json({ error: 'Только для админа' });
  next();
}

/* Форматирование пользователя */
function publicUser(u){
  if(!u) return null;
  return { id: u.id, username: u.username, email: u.email, displayName: u.display_name, bio: u.bio || '', isAdmin: !!u.is_admin, isBanned: !!u.is_banned, createdAt: u.created_at };
}

/* --- AUTH --- */
app.post('/api/auth/register', (req, res) => {
  const { username, password, email, displayName } = req.body || {};
  if(!username || !password || !email) return res.status(400).json({ error: 'Заполните все поля' });
  if(username.length < 3) return res.status(400).json({ error: 'Имя минимум 3 символа' });
  if(password.length < 6) return res.status(400).json({ error: 'Пароль минимум 6 символов' });

  const exists = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE').get(username, email);
  if(exists) return res.status(409).json({ error: 'Пользователь уже существует' });

  const hash = bcrypt.hashSync(password, 10);
  const now = Date.now();
  const info = db.prepare('INSERT INTO users (username, email, password_hash, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(username, email, hash, displayName || username, now, now);
  
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  res.json({ user: publicUser(user), token: signToken(user) });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE').get(username, username);
  if(!user || !bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({ error: 'Неверное имя или пароль' });
  res.json({ user: publicUser(user), token: signToken(user) });
});

app.get('/api/me', authRequired, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

app.patch('/api/me', authRequired, (req, res) => {
  const { displayName, bio } = req.body || {};
  db.prepare('UPDATE users SET display_name = ?, bio = ?, updated_at = ? WHERE id = ?').run(displayName || req.user.username, bio || '', Date.now(), req.user.id);
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
});

/* --- ARTWORKS --- */
function artworkToJson(a, extra = {}){
  return { id: a.id, userId: a.user_id, title: a.title, width: a.width, height: a.height, thumbUrl: '/uploads/' + a.thumb_path, fileUrl: '/uploads/' + a.file_path, isPublic: !!a.is_public, createdAt: a.created_at, likes: extra.likes ?? 0, author: extra.author ?? null };
}

app.post('/api/artworks', authRequired, upload.fields([{ name: 'file', maxCount: 1 }, { name: 'thumb', maxCount: 1 }]), (req, res) => {
  const { title, width, height, isPublic } = req.body;
  const file = req.files?.file?.[0];
  if(!file) return res.status(400).json({ error: 'Файл обязателен' });
  const now = Date.now();
  const info = db.prepare('INSERT INTO artworks (user_id, title, width, height, file_path, thumb_path, is_public, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(req.user.id, title || 'Без названия', parseInt(width) || 0, parseInt(height) || 0, file.filename, req.files?.thumb?.[0]?.filename || file.filename, isPublic === '1' ? 1 : 0, now, now);
  const a = db.prepare('SELECT * FROM artworks WHERE id = ?').get(info.lastInsertRowid);
  res.json({ artwork: artworkToJson(a, { author: req.user.username }) });
});

app.get('/api/artworks/mine', authRequired, (req, res) => {
  const rows = db.prepare('SELECT a.*, (SELECT COUNT(*) FROM likes WHERE artwork_id = a.id) AS likes FROM artworks a WHERE a.user_id = ? AND a.is_deleted = 0 ORDER BY a.updated_at DESC').all(req.user.id);
  res.json({ artworks: rows.map(r => artworkToJson(r, { likes: r.likes })) });
});

app.get('/api/artworks/public', authOptional, (req, res) => {
  const rows = db.prepare('SELECT a.*, u.username AS author_username FROM artworks a JOIN users u ON u.id = a.user_id WHERE a.is_public = 1 AND a.is_deleted = 0 ORDER BY a.created_at DESC LIMIT 100').all();
  res.json({ artworks: rows.map(r => artworkToJson(r, { author: r.author_username })) });
});

app.post('/api/artworks/:id/like', authRequired, (req, res) => {
  const id = parseInt(req.params.id);
  const existing = db.prepare('SELECT id FROM likes WHERE artwork_id = ? AND user_id = ?').get(id, req.user.id);
  if(existing){ db.prepare('DELETE FROM likes WHERE id = ?').run(existing.id); return res.json({ liked: false }); }
  db.prepare('INSERT INTO likes (artwork_id, user_id, created_at) VALUES (?, ?, ?)').run(id, req.user.id, Date.now());
  res.json({ liked: true });
});

/* --- ADMIN --- */
app.get('/api/admin/stats', adminRequired, (req, res) => {
  const users = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  const artworks = db.prepare('SELECT COUNT(*) AS c FROM artworks WHERE is_deleted = 0').get().c;
  res.json({ users, artworks });
});

/* --- STATIC FILES --- */
app.use('/uploads', express.static(UPLOADS_PATH));
app.use(express.static(__dirname, { index: false }));

app.get('*', (req, res, next) => {
  if(req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next();
  res.sendFile(path.join(__dirname, 'index.html'));
});

/* --- СТАРТ --- */
app.listen(PORT, () => {
  console.log(`\n✅ Studio Paint — сервер запущен`);
  console.log(`👉 Открой в браузере: http://localhost:${PORT}\n`);
});
