/* ============================================================
   db.js — SQLite через better-sqlite3
   ============================================================
   Создаёт таблицы, если их нет. Экспортирует готовый db.
   ============================================================ */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

// Создаём папки, если их нет
if(!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if(!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

export const UPLOADS_PATH = UPLOADS_DIR;

// Открываем / создаём БД
const db = new Database(path.join(DATA_DIR, 'studio.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ============================================================
// Схема
// ============================================================
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    email TEXT UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    bio TEXT DEFAULT '',
    is_admin INTEGER NOT NULL DEFAULT 0,
    is_banned INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS artworks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    file_path TEXT NOT NULL,
    thumb_path TEXT NOT NULL,
    is_public INTEGER NOT NULL DEFAULT 0,
    is_deleted INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS likes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    artwork_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(artwork_id, user_id),
    FOREIGN KEY (artwork_id) REFERENCES artworks(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    artwork_id INTEGER NOT NULL,
    reporter_id INTEGER NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL,
    FOREIGN KEY (artwork_id) REFERENCES artworks(id) ON DELETE CASCADE,
    FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_artworks_user ON artworks(user_id);
  CREATE INDEX IF NOT EXISTS idx_artworks_public ON artworks(is_public, is_deleted);
  CREATE INDEX IF NOT EXISTS idx_likes_artwork ON likes(artwork_id);
`);

export default db;