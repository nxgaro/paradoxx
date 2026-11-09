"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { hashPassword } = require("./security");

const DATA_DIR = path.join(__dirname, "data");
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, "paradox.db");

if (DB_PATH !== ":memory:") {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
}

const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'consumer', 'admin')),
    company       TEXT NOT NULL DEFAULT '',
    created_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

  CREATE TABLE IF NOT EXISTS tasks (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id  INTEGER NOT NULL REFERENCES users(id),
    title        TEXT NOT NULL,
    company      TEXT NOT NULL,
    area         TEXT NOT NULL DEFAULT 'IT',
    description  TEXT NOT NULL,
    skills       TEXT NOT NULL DEFAULT '[]',
    hours        INTEGER NOT NULL DEFAULT 8,
    budget       INTEGER NOT NULL DEFAULT 0,
    deadline     TEXT,
    status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'done', 'cancelled')),
    assignee_id  INTEGER REFERENCES users(id),
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_tasks_customer ON tasks(customer_id);
  CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
  CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at);

  CREATE TABLE IF NOT EXISTS applications (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message    TEXT NOT NULL DEFAULT '',
    status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'withdrawn')),
    created_at TEXT NOT NULL,
    UNIQUE (task_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_applications_task ON applications(task_id);
  CREATE INDEX IF NOT EXISTS idx_applications_user ON applications(user_id);
`);

const now = () => new Date().toISOString();

function seedAdmin() {
  const email = (process.env.ADMIN_EMAIL || "admin@paradox.kz").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || "admin123";
  const name = process.env.ADMIN_NAME || "Администратор Paradox";

  const existing = db.prepare("SELECT id, role FROM users WHERE email = ?").get(email);

  if (!existing) {
    db.prepare(
      "INSERT INTO users (name, email, password_hash, role, company, created_at) VALUES (?, ?, ?, 'admin', ?, ?)"
    ).run(name, email, hashPassword(password), "Paradox", now());
    console.log(`[db] Создан встроенный админ: ${email}`);
    return;
  }

  if (existing.role !== "admin") {
    db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(existing.id);
    console.log(`[db] Аккаунту ${email} выдана роль администратора.`);
  }
}

const DEMO_TASKS = [
  {
    title: "Мини-CRM для записей клиентов",
    company: "Стоматология «Аралин», Астана",
    tags: ["SQL", "Python", "Figma"],
    area: "IT",
    hours: 18,
    budget: 45000,
    desc: "Записи ведутся в бумажном журнале, клиенты теряются. Нужна простая таблица заявок со статусами и напоминаниями."
  },
  {
    title: "Телеграм-бот записи в барбершоп «Кесу»",
    company: "Барбершоп «Кесу», Алматы",
    tags: ["Python", "Telegram-боты"],
    area: "IT",
    hours: 12,
    budget: 30000,
    desc: "Записи приходят в WhatsApp и теряются. Нужен бот: выбор мастера, свободный слот, напоминание за 2 часа."
  },
  {
    title: "Сайт меню и каталог пекарни «Нан»",
    company: "Пекарня «Нан», Шымкент",
    tags: ["HTML/CSS", "Figma"],
    area: "Дизайн",
    hours: 10,
    budget: 20000,
    desc: "Есть только Instagram-аккаунт. Нужна одна страница с актуальным меню, ценами и картой доставки."
  },
  {
    title: "Дашборд продаж для марки одежды «Kolta»",
    company: "Бренд «Kolta», Алматы",
    tags: ["Excel", "Аналитика данных", "SQL"],
    area: "Аналитика",
    hours: 14,
    budget: 35000,
    desc: "Выручка склеена из трёх маркетплейсов и оффлайн-кассы. Нужен еженедельный дашборд: продажи, возвраты, топ-SKU."
  },
  {
    title: "Лид-форма и тест-квиз для школы «Lingua Q»",
    company: "Школа английского «Lingua Q», Караганда",
    tags: ["JavaScript", "HTML/CSS"],
    area: "IT",
    hours: 8,
    budget: 18000,
    desc: "Ученики приходят по сарафанному радио. Нужен тест на уровень языка и форма заявки на пробный урок."
  },
  {
    title: "Ролики для соцсетей мебельной мастерской «Жиһаз К»",
    company: "Мастерская «Жиһаз К», Алматы",
    tags: ["Видеомонтаж", "Figma"],
    area: "Медиа",
    hours: 16,
    budget: 38000,
    desc: "Есть час отснятого материала о производстве. Нужны 4 коротких вертикальных ролика с титрами о ценах и сроках."
  },
  {
    title: "Дашборд цен на зерно для «Тұжер Агро»",
    company: "КФХ «Тұжер Агро», Костанай",
    tags: ["Python", "SQL", "Аналитика данных"],
    area: "Аналитика",
    hours: 20,
    budget: 50000,
    desc: "Цены биржи и заготовителей собраны в 5 файлах. Нужен скрипт сводки и простая страница с графиком."
  },
  {
    title: "Каталог мебели с калькулятором заказа",
    company: "Мастерская «Жиһаз К», Алматы",
    tags: ["JavaScript", "React", "HTML/CSS"],
    area: "IT",
    hours: 18,
    budget: 42000,
    desc: "Клиенты просят прайс в личку. Нужен каталог с фото и калькулятором: материал × размер → стоимость."
  }
];

function seedDemoTasks() {
  const count = db.prepare("SELECT COUNT(*) AS count FROM tasks").get().count;
  if (count > 0) return;

  const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get();
  if (!admin) return;

  const insert = db.prepare(`
    INSERT INTO tasks (customer_id, title, company, area, description, skills, hours, budget, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)
  `);

  const stamp = now();
  db.exec("BEGIN");
  try {
    for (const task of DEMO_TASKS) {
      insert.run(
        admin.id,
        task.title,
        task.company,
        task.area,
        task.desc,
        JSON.stringify(task.tags),
        task.hours,
        task.budget,
        stamp,
        stamp
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  console.log(`[db] Добавлено демо-задач: ${DEMO_TASKS.length}`);
}

seedAdmin();
seedDemoTasks();

module.exports = { db, DB_PATH };
