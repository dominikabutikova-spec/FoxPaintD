/* ============================================================
   seed-admin.js — создание администратора
   ============================================================
   Запуск:
       node seed-admin.js <username> <password> [email]
   Пример:
       node seed-admin.js admin SuperSecret123 admin@example.com
   ============================================================ */
import bcrypt from 'bcryptjs';
import db from './db.js';

const [, , username, password, email] = process.argv;

if(!username || !password){
  console.log('Использование: node seed-admin.js <username> <password> [email]');
  console.log('Пример:        node seed-admin.js admin SuperSecret123 admin@example.com');
  process.exit(1);
}
if(password.length < 6){
  console.error('Пароль должен быть минимум 6 символов');
  process.exit(1);
}

const existing = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(username);
const now = Date.now();
const hash = bcrypt.hashSync(password, 10);

if(existing){
  db.prepare('UPDATE users SET is_admin = 1, password_hash = ?, updated_at = ? WHERE id = ?')
    .run(hash, now, existing.id);
  console.log(`✅ Пользователь «${username}» обновлён и назначен администратором`);
} else {
  db.prepare(`
    INSERT INTO users (username, email, password_hash, display_name, is_admin, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, ?, ?)
  `).run(username, email || `${username}@local`, hash, username, now, now);
  console.log(`✅ Создан администратор «${username}»`);
}
console.log('');
console.log('Теперь можешь войти в приложение под этими данными.');
process.exit(0);