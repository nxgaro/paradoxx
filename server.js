"use strict";

const path = require("node:path");
const express = require("express");
const { db } = require("./db");
const { hashPassword, verifyPassword, randomToken } = require("./security");

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "128kb" }));

const PORT = Number(process.env.PORT) || 3000;
const COOKIE_NAME = "paradox_sid";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const IS_PROD = process.env.NODE_ENV === "production";

const ROLES = ["user", "consumer", "admin"];
const ROLE_LABELS = {
  user: "Пользователь",
  consumer: "Потребитель",
  admin: "Админ"
};
const TASK_STATUSES = ["open", "in_progress", "done", "cancelled"];
const AREAS = ["IT", "Дизайн", "Аналитика", "Медиа", "Другое"];
const MAX_LOGIN_ATTEMPTS = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

const now = () => new Date().toISOString();

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function parseCookies(header = "") {
  const cookies = {};
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    if (!key) continue;
    try {
      cookies[key] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      cookies[key] = part.slice(index + 1).trim();
    }
  }
  return cookies;
}

function fail(res, status, message) {
  return res.status(status).json({ error: message });
}

function text(value, max = 500) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function integer(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function transaction(fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* ignore rollback errors */
    }
    throw error;
  }
}

function normalizeSkills(value) {
  const source = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,;\n]/)
      : [];
  const unique = [];
  for (const item of source) {
    if (typeof item !== "string") continue;
    const skill = item.trim().slice(0, 40);
    if (!skill) continue;
    if (!unique.some((existing) => existing.toLowerCase() === skill.toLowerCase())) {
      unique.push(skill);
    }
    if (unique.length >= 12) break;
  }
  return unique;
}

function publicUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    roleLabel: ROLE_LABELS[row.role] || row.role,
    company: row.company || "",
    createdAt: row.created_at
  };
}

function mapTask(row) {
  let skills = [];
  try {
    const parsed = JSON.parse(row.skills || "[]");
    if (Array.isArray(parsed)) {
      skills = parsed.filter((item) => typeof item === "string");
    }
  } catch {
    skills = [];
  }

  return {
    id: row.id,
    title: row.title,
    company: row.company,
    area: row.area,
    description: row.description,
    skills,
    hours: row.hours,
    budget: row.budget,
    deadline: row.deadline || null,
    status: row.status,
    customerId: row.customer_id,
    customerName: row.customer_name || "",
    customerCompany: row.customer_company || "",
    assigneeId: row.assignee_id || null,
    assigneeName: row.assignee_name || "",
    applicationsCount: Number(row.applications_count || 0),
    myApplicationStatus: row.my_application_status || null,
    myApplicationId: row.my_application_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapApplication(row) {
  return {
    id: row.id,
    taskId: row.task_id,
    userId: row.user_id,
    message: row.message,
    status: row.status,
    createdAt: row.created_at,
    applicant: {
      id: row.user_id,
      name: row.name,
      email: row.email,
      company: row.company || ""
    }
  };
}

const TASK_SELECT = `
  SELECT
    t.*,
    c.name AS customer_name,
    c.company AS customer_company,
    a.name AS assignee_name,
    (SELECT COUNT(*) FROM applications ap
       WHERE ap.task_id = t.id AND ap.status != 'withdrawn') AS applications_count,
    (SELECT ap.status FROM applications ap
       WHERE ap.task_id = t.id AND ap.user_id = ? AND ap.status != 'withdrawn'
       LIMIT 1) AS my_application_status,
    (SELECT ap.id FROM applications ap
       WHERE ap.task_id = t.id AND ap.user_id = ? AND ap.status != 'withdrawn'
       LIMIT 1) AS my_application_id
  FROM tasks t
  JOIN users c ON c.id = t.customer_id
  LEFT JOIN users a ON a.id = t.assignee_id
`;

function getTaskForViewer(taskId, viewerId) {
  const viewer = viewerId || 0;
  return db.prepare(`${TASK_SELECT} WHERE t.id = ?`).get(viewer, viewer, taskId);
}

function getApplications(taskId) {
  const rows = db
    .prepare(
      `SELECT ap.*, u.name, u.email, u.company
         FROM applications ap
         JOIN users u ON u.id = ap.user_id
        WHERE ap.task_id = ? AND ap.status != 'withdrawn'
        ORDER BY ap.created_at DESC`
    )
    .all(taskId);
  return rows.map(mapApplication);
}

/* ------------------------------------------------------------------ */
/* Sessions & auth                                                     */
/* ------------------------------------------------------------------ */

function createSession(userId) {
  const token = randomToken(32);
  const createdAt = Date.now();
  db.prepare(
    "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)"
  ).run(token, userId, createdAt, createdAt + SESSION_TTL_MS);
  return token;
}

function sessionCookie(token, maxAgeSeconds) {
  const parts = [
    `${COOKIE_NAME}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`
  ];
  if (IS_PROD) parts.push("Secure");
  return parts.join("; ");
}

function setSessionCookie(res, token) {
  res.setHeader("Set-Cookie", sessionCookie(token, Math.floor(SESSION_TTL_MS / 1000)));
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", sessionCookie("", 0));
}

app.use((req, res, next) => {
  const token = parseCookies(req.headers.cookie || "")[COOKIE_NAME];
  if (!token) return next();

  const session = db
    .prepare(
      `SELECT s.expires_at, u.id, u.name, u.email, u.role, u.company, u.created_at
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token = ?`
    )
    .get(token);

  if (!session || session.expires_at <= Date.now()) {
    if (session) db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
    return next();
  }

  req.user = session;
  req.sessionToken = token;
  next();
});

function requireAuth(req, res, next) {
  if (!req.user) return fail(res, 401, "Требуется авторизация.");
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return fail(res, 401, "Требуется авторизация.");
    if (!roles.includes(req.user.role)) return fail(res, 403, "Недостаточно прав для этого действия.");
    next();
  };
}

/* Защита от межсайтовых POST/PATCH/DELETE-запросов */
app.use("/api", (req, res, next) => {
  if (!["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (!origin) return next();
  const host = req.headers.host;
  if (origin !== `http://${host}` && origin !== `https://${host}`) {
    return fail(res, 403, "Запрос с другого источника отклонён.");
  }
  next();
});

/* Простое ограничение попыток входа */
const loginAttempts = new Map();

function attemptState(ip) {
  const timestamp = Date.now();
  let state = loginAttempts.get(ip);
  if (!state || timestamp > state.resetAt) {
    state = { count: 0, resetAt: timestamp + LOGIN_WINDOW_MS };
    loginAttempts.set(ip, state);
  }
  return state;
}

function isLoginBlocked(ip) {
  return attemptState(ip).count >= MAX_LOGIN_ATTEMPTS;
}

function recordLoginFailure(ip) {
  attemptState(ip).count += 1;
}

setInterval(() => {
  const timestamp = Date.now();
  for (const [ip, state] of loginAttempts) {
    if (timestamp > state.resetAt) loginAttempts.delete(ip);
  }
}, LOGIN_WINDOW_MS).unref();

/* ------------------------------------------------------------------ */
/* Auth API                                                            */
/* ------------------------------------------------------------------ */

app.post("/api/register", (req, res) => {
  const body = req.body || {};
  const name = text(body.name, 80);
  const email = text(body.email, 160).toLowerCase();
  const password = typeof body.password === "string" ? body.password : "";
  const company = text(body.company, 120);

  if (name.length < 2) return fail(res, 400, "Укажите имя (минимум 2 символа).");
  if (!isEmail(email)) return fail(res, 400, "Укажите корректный email.");
  if (password.length < 8) return fail(res, 400, "Пароль должен быть не короче 8 символов.");
  if (password.length > 200) return fail(res, 400, "Пароль слишком длинный.");

  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (existing) return fail(res, 409, "Аккаунт с таким email уже существует.");

  const info = db
    .prepare(
      "INSERT INTO users (name, email, password_hash, role, company, created_at) VALUES (?, ?, ?, 'user', ?, ?)"
    )
    .run(name, email, hashPassword(password), company, now());

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid);
  const token = createSession(user.id);
  setSessionCookie(res, token);
  res.status(201).json({ user: publicUser(user) });
});

app.post("/api/login", (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  if (isLoginBlocked(ip)) {
    return fail(res, 429, "Слишком много попыток входа. Попробуйте через 15 минут.");
  }

  const body = req.body || {};
  const email = text(body.email, 160).toLowerCase();
  const password = typeof body.password === "string" ? body.password : "";

  if (!isEmail(email) || !password) {
    recordLoginFailure(ip);
    return fail(res, 400, "Введите email и пароль.");
  }

  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!user || !verifyPassword(password, user.password_hash)) {
    recordLoginFailure(ip);
    return fail(res, 401, "Неверный email или пароль.");
  }

  loginAttempts.delete(ip);
  const token = createSession(user.id);
  setSessionCookie(res, token);
  res.json({ user: publicUser(user) });
});

app.post("/api/logout", (req, res) => {
  if (req.sessionToken) {
    db.prepare("DELETE FROM sessions WHERE token = ?").run(req.sessionToken);
  }
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get("/api/me", (req, res) => {
  if (!req.user) return res.json({ user: null });
  res.json({ user: publicUser(req.user) });
});

app.post("/api/me/password", requireAuth, (req, res) => {
  const body = req.body || {};
  const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";

  if (newPassword.length < 8) {
    return fail(res, 400, "Новый пароль должен быть не короче 8 символов.");
  }
  if (newPassword.length > 200) {
    return fail(res, 400, "Новый пароль слишком длинный.");
  }

  const row = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(req.user.id);
  if (!row || !verifyPassword(currentPassword, row.password_hash)) {
    return fail(res, 400, "Текущий пароль указан неверно.");
  }

  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
    hashPassword(newPassword),
    req.user.id
  );
  db.prepare("DELETE FROM sessions WHERE user_id = ? AND token != ?").run(
    req.user.id,
    req.sessionToken
  );
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* Tasks API                                                           */
/* ------------------------------------------------------------------ */

app.get("/api/tasks", (req, res) => {
  const viewerId = req.user ? req.user.id : 0;
  const conditions = [];
  const params = [viewerId, viewerId];

  const status = text(req.query.status, 20);
  if (status && TASK_STATUSES.includes(status)) {
    conditions.push("t.status = ?");
    params.push(status);
  }

  if (req.query.mine === "1" || req.query.scope === "mine") {
    if (!req.user) return fail(res, 401, "Требуется авторизация.");
    conditions.push("t.customer_id = ?");
    params.push(req.user.id);
  }

  const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
  const rows = db
    .prepare(`${TASK_SELECT}${where} ORDER BY t.created_at DESC LIMIT 200`)
    .all(...params);

  res.json({ tasks: rows.map(mapTask) });
});

app.get("/api/tasks/:id", (req, res) => {
  const taskId = Number(req.params.id);
  if (!Number.isInteger(taskId)) return fail(res, 400, "Некорректный идентификатор задачи.");

  const row = getTaskForViewer(taskId, req.user ? req.user.id : 0);
  if (!row) return fail(res, 404, "Задача не найдена.");

  const canSeeApplications =
    req.user && (req.user.role === "admin" || req.user.id === row.customer_id);

  const task = mapTask(row);
  if (canSeeApplications) task.applications = getApplications(taskId);
  res.json({ task });
});

app.post("/api/tasks", requireRole("consumer", "admin"), (req, res) => {
  const body = req.body || {};
  const title = text(body.title, 120);
  const company = text(body.company, 120) || req.user.company || req.user.name;
  const description = text(body.description, 4000);
  const area = AREAS.includes(text(body.area, 30)) ? text(body.area, 30) : "Другое";
  const skills = normalizeSkills(body.skills);
  const hours = integer(body.hours, 8, 1, 200);
  const budget = integer(body.budget, 0, 0, 10000000);
  const deadline = /^\d{4}-\d{2}-\d{2}$/.test(text(body.deadline, 10))
    ? text(body.deadline, 10)
    : null;

  if (title.length < 3) return fail(res, 400, "Название задачи должно быть не короче 3 символов.");
  if (company.length < 2) return fail(res, 400, "Укажите компанию или имя заказчика.");
  if (description.length < 10) {
    return fail(res, 400, "Описание должно быть не короче 10 символов.");
  }

  const stamp = now();
  const info = db
    .prepare(
      `INSERT INTO tasks
        (customer_id, title, company, area, description, skills, hours, budget, deadline, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`
    )
    .run(
      req.user.id,
      title,
      company,
      area,
      description,
      JSON.stringify(skills),
      hours,
      budget,
      deadline,
      stamp,
      stamp
    );

  const row = getTaskForViewer(info.lastInsertRowid, req.user.id);
  res.status(201).json({ task: mapTask(row) });
});

app.patch("/api/tasks/:id", requireAuth, (req, res) => {
  const taskId = Number(req.params.id);
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
  if (!task) return fail(res, 404, "Задача не найдена.");
  if (req.user.role !== "admin" && req.user.id !== task.customer_id) {
    return fail(res, 403, "Менять задачу может только её автор или админ.");
  }

  const body = req.body || {};
  const fields = [];
  const values = [];

  if (body.title !== undefined) {
    const title = text(body.title, 120);
    if (title.length < 3) return fail(res, 400, "Название задачи слишком короткое.");
    fields.push("title = ?");
    values.push(title);
  }

  if (body.company !== undefined) {
    const company = text(body.company, 120);
    if (company.length < 2) return fail(res, 400, "Укажите компанию или имя заказчика.");
    fields.push("company = ?");
    values.push(company);
  }

  if (body.description !== undefined) {
    const description = text(body.description, 4000);
    if (description.length < 10) return fail(res, 400, "Описание задачи слишком короткое.");
    fields.push("description = ?");
    values.push(description);
  }

  if (body.area !== undefined) {
    const area = AREAS.includes(text(body.area, 30)) ? text(body.area, 30) : "Другое";
    fields.push("area = ?");
    values.push(area);
  }

  if (body.skills !== undefined) {
    fields.push("skills = ?");
    values.push(JSON.stringify(normalizeSkills(body.skills)));
  }

  if (body.hours !== undefined) {
    fields.push("hours = ?");
    values.push(integer(body.hours, task.hours, 1, 200));
  }

  if (body.budget !== undefined) {
    fields.push("budget = ?");
    values.push(integer(body.budget, task.budget, 0, 10000000));
  }

  if (body.deadline !== undefined) {
    const deadline = /^\d{4}-\d{2}-\d{2}$/.test(text(body.deadline, 10))
      ? text(body.deadline, 10)
      : null;
    fields.push("deadline = ?");
    values.push(deadline);
  }

  if (body.status !== undefined) {
    const status = text(body.status, 20);
    if (!TASK_STATUSES.includes(status)) return fail(res, 400, "Неизвестный статус задачи.");
    if (status === "in_progress" && !task.assignee_id) {
      return fail(res, 400, "Сначала выберите исполнителя из откликов.");
    }
    fields.push("status = ?");
    values.push(status);
    if (status === "open") fields.push("assignee_id = NULL");
  }

  if (fields.length === 0) return fail(res, 400, "Нет изменений для сохранения.");

  fields.push("updated_at = ?");
  values.push(now(), taskId);

  transaction(() => {
    db.prepare(`UPDATE tasks SET ${fields.join(", ")} WHERE id = ?`).run(...values);
    if (body.status === "open") {
      db.prepare(
        "UPDATE applications SET status = 'rejected' WHERE task_id = ? AND status = 'accepted'"
      ).run(taskId);
    }
  });

  const row = getTaskForViewer(taskId, req.user.id);
  res.json({ task: mapTask(row) });
});

app.delete("/api/tasks/:id", requireAuth, (req, res) => {
  const taskId = Number(req.params.id);
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
  if (!task) return fail(res, 404, "Задача не найдена.");
  if (req.user.role !== "admin" && req.user.id !== task.customer_id) {
    return fail(res, 403, "Удалить задачу может только её автор или админ.");
  }
  db.prepare("DELETE FROM tasks WHERE id = ?").run(taskId);
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* Applications API                                                    */
/* ------------------------------------------------------------------ */

app.post("/api/tasks/:id/apply", requireRole("user", "admin"), (req, res) => {
  const taskId = Number(req.params.id);
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
  if (!task) return fail(res, 404, "Задача не найдена.");
  if (task.status !== "open") return fail(res, 400, "На эту задачу уже нельзя откликнуться.");
  if (task.customer_id === req.user.id) {
    return fail(res, 400, "Нельзя откликнуться на собственную задачу.");
  }

  const message = text((req.body || {}).message, 1000);
  const existing = db
    .prepare("SELECT status FROM applications WHERE task_id = ? AND user_id = ?")
    .get(taskId, req.user.id);

  if (existing && ["pending", "accepted"].includes(existing.status)) {
    return fail(res, 409, "Вы уже откликнулись на эту задачу.");
  }

  db.prepare(
    `INSERT INTO applications (task_id, user_id, message, status, created_at)
     VALUES (?, ?, ?, 'pending', ?)
     ON CONFLICT(task_id, user_id)
     DO UPDATE SET message = excluded.message, status = 'pending', created_at = excluded.created_at`
  ).run(taskId, req.user.id, message, now());

  const row = db
    .prepare(
      `SELECT ap.*, u.name, u.email, u.company
         FROM applications ap
         JOIN users u ON u.id = ap.user_id
        WHERE ap.task_id = ? AND ap.user_id = ?`
    )
    .get(taskId, req.user.id);

  res.status(201).json({ application: mapApplication(row) });
});

app.get("/api/tasks/:id/applications", requireAuth, (req, res) => {
  const taskId = Number(req.params.id);
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
  if (!task) return fail(res, 404, "Задача не найдена.");
  if (req.user.role !== "admin" && req.user.id !== task.customer_id) {
    return fail(res, 403, "Отклики видит только автор задачи или админ.");
  }
  res.json({ applications: getApplications(taskId) });
});

app.patch("/api/applications/:id", requireAuth, (req, res) => {
  const applicationId = Number(req.params.id);
  const application = db.prepare("SELECT * FROM applications WHERE id = ?").get(applicationId);
  if (!application) return fail(res, 404, "Отклик не найден.");

  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(application.task_id);
  if (!task) return fail(res, 404, "Задача не найдена.");
  if (req.user.role !== "admin" && req.user.id !== task.customer_id) {
    return fail(res, 403, "Управлять откликами может только автор задачи или админ.");
  }

  const status = text((req.body || {}).status, 20);
  if (!["accepted", "rejected"].includes(status)) {
    return fail(res, 400, "Статус отклика должен быть accepted или rejected.");
  }
  if (application.status === "withdrawn") {
    return fail(res, 400, "Отклик был отозван исполнителем.");
  }

  transaction(() => {
    if (status === "accepted") {
      db.prepare(
        "UPDATE applications SET status = 'rejected' WHERE task_id = ? AND id != ? AND status = 'accepted'"
      ).run(task.id, application.id);
      db.prepare("UPDATE applications SET status = 'accepted' WHERE id = ?").run(application.id);
      db.prepare(
        "UPDATE tasks SET assignee_id = ?, status = 'in_progress', updated_at = ? WHERE id = ?"
      ).run(application.user_id, now(), task.id);
    } else {
      db.prepare("UPDATE applications SET status = 'rejected' WHERE id = ?").run(application.id);
      if (task.assignee_id === application.user_id && task.status !== "done") {
        db.prepare(
          "UPDATE tasks SET assignee_id = NULL, status = 'open', updated_at = ? WHERE id = ?"
        ).run(now(), task.id);
      }
    }
  });

  const updated = db
    .prepare(
      `SELECT ap.*, u.name, u.email, u.company
         FROM applications ap
         JOIN users u ON u.id = ap.user_id
        WHERE ap.id = ?`
    )
    .get(application.id);

  res.json({ application: mapApplication(updated) });
});

app.delete("/api/applications/:id", requireAuth, (req, res) => {
  const applicationId = Number(req.params.id);
  const application = db.prepare("SELECT * FROM applications WHERE id = ?").get(applicationId);
  if (!application) return fail(res, 404, "Отклик не найден.");
  if (application.user_id !== req.user.id) {
    return fail(res, 403, "Отозвать можно только свой отклик.");
  }
  if (application.status !== "pending") {
    return fail(res, 400, "Отозвать можно только отклик на рассмотрении.");
  }
  db.prepare("UPDATE applications SET status = 'withdrawn' WHERE id = ?").run(applicationId);
  res.json({ ok: true });
});

app.get("/api/my/applications", requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT ap.id, ap.status, ap.message, ap.created_at,
              t.id AS task_id, t.title, t.company, t.description,
              t.hours, t.budget, t.status AS task_status, t.created_at AS task_created_at
         FROM applications ap
         JOIN tasks t ON t.id = ap.task_id
        WHERE ap.user_id = ? AND ap.status != 'withdrawn'
        ORDER BY ap.created_at DESC`
    )
    .all(req.user.id);

  res.json({
    applications: rows.map((row) => ({
      id: row.id,
      status: row.status,
      message: row.message,
      createdAt: row.created_at,
      task: {
        id: row.task_id,
        title: row.title,
        company: row.company,
        description: row.description,
        hours: row.hours,
        budget: row.budget,
        status: row.task_status,
        createdAt: row.task_created_at
      }
    }))
  });
});

/* ------------------------------------------------------------------ */
/* Stats & admin API                                                   */
/* ------------------------------------------------------------------ */

app.get("/api/stats", requireAuth, (req, res) => {
  const count = (sql, ...params) => Number(db.prepare(sql).get(...params).count || 0);
  let stats;

  if (req.user.role === "admin") {
    stats = {
      users: count("SELECT COUNT(*) AS count FROM users"),
      tasks: count("SELECT COUNT(*) AS count FROM tasks"),
      openTasks: count("SELECT COUNT(*) AS count FROM tasks WHERE status = 'open'"),
      inProgressTasks: count("SELECT COUNT(*) AS count FROM tasks WHERE status = 'in_progress'"),
      applications: count("SELECT COUNT(*) AS count FROM applications WHERE status != 'withdrawn'"),
      pendingApplications: count(
        "SELECT COUNT(*) AS count FROM applications WHERE status = 'pending'"
      ),
      myApplications: count(
        "SELECT COUNT(*) AS count FROM applications WHERE user_id = ? AND status != 'withdrawn'",
        req.user.id
      )
    };
  } else if (req.user.role === "consumer") {
    stats = {
      myTasks: count("SELECT COUNT(*) AS count FROM tasks WHERE customer_id = ?", req.user.id),
      openTasks: count(
        "SELECT COUNT(*) AS count FROM tasks WHERE customer_id = ? AND status = 'open'",
        req.user.id
      ),
      inProgressTasks: count(
        "SELECT COUNT(*) AS count FROM tasks WHERE customer_id = ? AND status = 'in_progress'",
        req.user.id
      ),
      receivedApplications: count(
        `SELECT COUNT(*) AS count
           FROM applications ap
           JOIN tasks t ON t.id = ap.task_id
          WHERE t.customer_id = ? AND ap.status != 'withdrawn'`,
        req.user.id
      ),
      pendingApplications: count(
        `SELECT COUNT(*) AS count
           FROM applications ap
           JOIN tasks t ON t.id = ap.task_id
          WHERE t.customer_id = ? AND ap.status = 'pending'`,
        req.user.id
      )
    };
  } else {
    stats = {
      openTasks: count("SELECT COUNT(*) AS count FROM tasks WHERE status = 'open'"),
      myApplications: count(
        "SELECT COUNT(*) AS count FROM applications WHERE user_id = ? AND status != 'withdrawn'",
        req.user.id
      ),
      acceptedApplications: count(
        "SELECT COUNT(*) AS count FROM applications WHERE user_id = ? AND status = 'accepted'",
        req.user.id
      )
    };
  }

  res.json({ stats });
});

app.get("/api/admin/users", requireRole("admin"), (req, res) => {
  const rows = db
    .prepare(
      `SELECT u.id, u.name, u.email, u.role, u.company, u.created_at,
              (SELECT COUNT(*) FROM tasks t WHERE t.customer_id = u.id) AS tasks_count,
              (SELECT COUNT(*) FROM applications a WHERE a.user_id = u.id) AS applications_count
         FROM users u
        ORDER BY u.created_at ASC`
    )
    .all();

  res.json({
    users: rows.map((row) => ({
      ...publicUser(row),
      tasksCount: Number(row.tasks_count || 0),
      applicationsCount: Number(row.applications_count || 0)
    }))
  });
});

app.patch("/api/admin/users/:id/role", requireRole("admin"), (req, res) => {
  const userId = Number(req.params.id);
  const role = text((req.body || {}).role, 20);
  if (!ROLES.includes(role)) return fail(res, 400, "Неизвестная роль.");

  const target = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  if (!target) return fail(res, 404, "Пользователь не найден.");
  if (target.id === req.user.id) {
    return fail(res, 400, "Нельзя менять собственную роль — это защита от потери доступа.");
  }

  if (target.role === "admin" && role !== "admin") {
    const admins = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'").get();
    if (Number(admins.count) <= 1) {
      return fail(res, 400, "В системе должен остаться хотя бы один администратор.");
    }
  }

  db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, userId);
  const updated = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  res.json({ user: publicUser(updated) });
});

/* ------------------------------------------------------------------ */
/* Static files                                                        */
/* ------------------------------------------------------------------ */

const PUBLIC_FILES = new Set([
  "index.html",
  "styles.css",
  "app.js",
  "auth-nav.js",
  "login.html",
  "login.js",
  "dashboard.html",
  "dashboard.js",
  "match.html",
  "match.js",
  "faq.html",
  "privacy.html",
  "terms.html",
  "file-guard.js",
  "app.html",
  "spa.js",
  "paradox.html"
]);

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "app.html"));
});

/* Отдельные страницы-документы: лендинг, вход, кабинет, подбор задачи.
   Всё отдаёт одностраничник app.html — переходы и логика внутри spa.js. */
app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "app.html"));
});

app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "app.html"));
});

/* Страницы-разделы лендинга. */
["/problem", "/solution", "/how", "/demo", "/market", "/team"].forEach((route) => {
  app.get(route, (req, res) => {
    res.sendFile(path.join(__dirname, "app.html"));
  });
});

/* Подбор доступен только вошедшим: нет сессии — редирект на вход. */
app.get("/match", (req, res) => {
  if (!req.user) return res.redirect("/login?next=%2Fmatch");
  res.sendFile(path.join(__dirname, "app.html"));
});

app.get("/faq", (req, res) => {
  res.sendFile(path.join(__dirname, "app.html"));
});

app.get("/privacy", (req, res) => {
  res.sendFile(path.join(__dirname, "app.html"));
});

app.get("/terms", (req, res) => {
  res.sendFile(path.join(__dirname, "app.html"));
});

/* Старые адреса остаются рабочими: редирект на SPA-экраны. */
app.get("/match.html", (req, res) => {
  if (req.user) return res.redirect(301, "/match");
  res.redirect(301, "/login?next=%2Fmatch");
});
app.get("/login.html", (req, res) => res.redirect(301, "/login"));
app.get("/dashboard.html", (req, res) => res.redirect(301, "/dashboard"));
app.get("/index.html", (req, res) => res.redirect(301, "/"));
app.get("/faq.html", (req, res) => res.redirect(301, "/faq"));
app.get("/privacy.html", (req, res) => res.redirect(301, "/privacy"));
app.get("/terms.html", (req, res) => res.redirect(301, "/terms"));

app.use((req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  const name = decodeURIComponent(req.path.replace(/^\/+/, ""));
  if (!name || name.includes("/") || name.includes("..")) return next();
  if (!PUBLIC_FILES.has(name)) return next();
  /* Оболочка и клиентский код отдаем без кеша: вкладка всегда подхватывает свежую версию по Ctrl+R */
  if (name === "app.html" || name === "spa.js" || name === "styles.css") {
    res.set("Cache-Control", "no-cache");
  }
  res.sendFile(path.join(__dirname, name));
});

app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    return fail(res, 404, "Метод API не найден.");
  }
  res.status(404).type("text/plain").send("404 — страница не найдена.");
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error && error.type === "entity.parse.failed") {
    return fail(res, 400, "Некорректный JSON в запросе.");
  }
  console.error("[server]", error);
  return fail(res, 500, "Внутренняя ошибка сервера.");
});

/* ------------------------------------------------------------------ */
/* Start                                                               */
/* ------------------------------------------------------------------ */

db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
setInterval(() => {
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
}, 60 * 60 * 1000).unref();
if (require.main === module) {
  app.listen(PORT, () => {
    const adminEmail = (process.env.ADMIN_EMAIL || "admin@paradox.kz").trim().toLowerCase();
    console.log("");
    console.log(`  Paradox запущен: http://localhost:${PORT}`);
    console.log(`  Встроенный админ: ${adminEmail}`);
    console.log(
      `  Пароль админа: ${process.env.ADMIN_PASSWORD ? "из переменной ADMIN_PASSWORD" : "admin123"}`
    );
    console.log("");
  });
}

/* Экспорт для serverless-окружения (Vercel): app.require как обработчик запросов. */
module.exports = app;
