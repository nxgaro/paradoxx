"use strict";

const state = {
  user: null,
  stats: null,
  activeTab: null
};

const ROLE_TEXT = {
  user: "Пользователь · откликается на задачи и следит за статусом откликов.",
  consumer: "Потребитель · создаёт задачи, получает отклики и выбирает исполнителя.",
  admin: "Админ · управляет ролями, задачами и откликами."
};

const ROLE_LABELS = {
  user: "Пользователь",
  consumer: "Потребитель",
  admin: "Админ"
};

const STATUS = {
  open: { label: "Открыта", className: "open" },
  in_progress: { label: "В работе", className: "progress" },
  done: { label: "Завершена", className: "done" },
  cancelled: { label: "Отменена", className: "cancelled" }
};

const APPLICATION_STATUS = {
  pending: { label: "На рассмотрении", className: "pending" },
  accepted: { label: "Принят", className: "accepted" },
  rejected: { label: "Отклонён", className: "rejected" },
  withdrawn: { label: "Отозван", className: "rejected" }
};

const byId = (id) => document.getElementById(id);

/* ------------------------------------------------------------------ */
/* Utilities                                                           */
/* ------------------------------------------------------------------ */

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
  });
}

function formatMoney(amount) {
  return `${new Intl.NumberFormat("ru-RU").format(Number(amount) || 0)} ₸`;
}

function formatDate(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" });
}

function truncate(value, max) {
  const string = String(value || "");
  return string.length > max ? `${string.slice(0, max - 1).trimEnd()}…` : string;
}

function plural(number, one, few, many) {
  const mod10 = number % 10;
  const mod100 = number % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function applicationsLabel(number) {
  return `${number} ${plural(number, "отклик", "отклика", "откликов")}`;
}

function statusBadge(status) {
  const info = STATUS[status] || { label: status, className: "cancelled" };
  return `<span class="status-badge status-badge--${info.className}">${escapeHtml(info.label)}</span>`;
}

function applicationBadge(status) {
  const info = APPLICATION_STATUS[status] || { label: status, className: "pending" };
  return `<span class="status-badge status-badge--${info.className}">${escapeHtml(info.label)}</span>`;
}

function showToast(message, kind = "ok") {
  const stack = byId("toasts");
  const toast = document.createElement("div");
  toast.className = `toast toast--${kind}`;
  toast.textContent = message;
  stack.append(toast);

  window.setTimeout(() => {
    toast.classList.add("toast--out");
    window.setTimeout(() => toast.remove(), 250);
  }, 3400);
}

function setFormMessage(element, message, kind = "error") {
  if (!element) return;
  element.textContent = message;
  element.dataset.kind = kind;
  element.hidden = false;
}

function hideFormMessage(element) {
  if (!element) return;
  element.hidden = true;
  element.textContent = "";
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: options.body ? { "Content-Type": "application/json" } : { Accept: "application/json" },
    ...options
  });

  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    throw new Error(data.error || `Ошибка запроса (${response.status}).`);
  }
  return data;
}

function openDialog(id) {
  document.querySelectorAll("dialog[open]").forEach((dialog) => {
    if (dialog.id !== id) dialog.close();
  });
  const dialog = byId(id);
  if (dialog && !dialog.open) dialog.showModal();
}

function closeDialog(id) {
  const dialog = byId(id);
  if (dialog && dialog.open) dialog.close();
}

/* ------------------------------------------------------------------ */
/* Header / stats / tabs                                               */
/* ------------------------------------------------------------------ */

function renderHeader() {
  const user = state.user;
  byId("dash-name").textContent = user.name;
  byId("dash-role").textContent = ROLE_TEXT[user.role] || user.roleLabel || "";

  const headerUser = byId("header-user");
  if (headerUser) {
    headerUser.textContent = `${user.name} · ${user.roleLabel}`;
    headerUser.hidden = false;
  }
  const logoutButton = byId("logout-button");
  if (logoutButton) logoutButton.hidden = false;

  const actions = [];
  if (user.role === "consumer" || user.role === "admin") {
    actions.push(
      '<button type="button" class="btn btn--primary" data-open-create>Создать задачу</button>'
    );
  }
  actions.push(
    '<button type="button" class="btn btn--secondary" data-open-password>Сменить пароль</button>'
  );
  byId("dash-actions").innerHTML = actions.join("");
}

function statCard(label, value, note = "") {
  return `
    <div class="dash-stat">
      <span class="dash-stat__label">${escapeHtml(label)}</span>
      <strong class="dash-stat__value">${escapeHtml(value)}</strong>
      ${note ? `<span class="dash-stat__note">${escapeHtml(note)}</span>` : ""}
    </div>`;
}

function renderStats() {
  const stats = state.stats || {};
  const cards = [];

  if (state.user.role === "admin") {
    cards.push(statCard("Пользователей", stats.users ?? 0, "все роли"));
    cards.push(statCard("Задач", stats.tasks ?? 0, `${stats.openTasks ?? 0} открыто`));
    cards.push(statCard("Откликов", stats.applications ?? 0, `${stats.pendingApplications ?? 0} ждут решения`));
    cards.push(statCard("В работе", stats.inProgressTasks ?? 0, "задач с исполнителем"));
  } else if (state.user.role === "consumer") {
    cards.push(statCard("Моих задач", stats.myTasks ?? 0, "всего опубликовано"));
    cards.push(statCard("Открыто", stats.openTasks ?? 0, "ищут исполнителя"));
    cards.push(statCard("В работе", stats.inProgressTasks ?? 0, "исполнитель выбран"));
    cards.push(statCard("Откликов", stats.receivedApplications ?? 0, `${stats.pendingApplications ?? 0} новых`));
  } else {
    cards.push(statCard("Доступных задач", stats.openTasks ?? 0, "можно откликнуться"));
    cards.push(statCard("Моих откликов", stats.myApplications ?? 0, "всего отправлено"));
    cards.push(statCard("Принято", stats.acceptedApplications ?? 0, "задач в работе"));
  }

  byId("dash-stats").innerHTML = cards.join("");
}

function tabsForRole() {
  const stats = state.stats || {};

  if (state.user.role === "admin") {
    return [
      { id: "tasks", label: "Все задачи", count: stats.tasks },
      { id: "my-apps", label: "Мои отклики", count: stats.myApplications },
      { id: "users", label: "Пользователи", count: stats.users }
    ];
  }

  if (state.user.role === "consumer") {
    return [
      { id: "my-tasks", label: "Мои задачи", count: stats.myTasks },
      { id: "tasks", label: "Все задачи" }
    ];
  }

  return [
    { id: "tasks", label: "Доступные задачи", count: stats.openTasks },
    { id: "my-apps", label: "Мои отклики", count: stats.myApplications }
  ];
}

function renderTabs() {
  if (!state.user) return;
  const tabs = tabsForRole();

  if (!state.activeTab || !tabs.some((tab) => tab.id === state.activeTab)) {
    state.activeTab = tabs[0] ? tabs[0].id : null;
  }

  byId("dash-tabs").innerHTML = tabs
    .map(
      (tab) => `
        <button type="button" class="dash-tab${tab.id === state.activeTab ? " is-active" : ""}"
                role="tab" aria-selected="${tab.id === state.activeTab}" data-tab="${tab.id}">
          ${escapeHtml(tab.label)}
          ${tab.count !== undefined ? `<span class="dash-tab__count">${Number(tab.count) || 0}</span>` : ""}
        </button>`
    )
    .join("");
}

async function refreshStats() {
  const data = await api("/api/stats");
  state.stats = data.stats;
  renderStats();
  renderTabs();
}

/* ------------------------------------------------------------------ */
/* Panels                                                              */
/* ------------------------------------------------------------------ */

function renderPanelLoading() {
  byId("dash-panel").innerHTML = `
    <div class="dash-loading" role="status">
      <p class="kicker">Загружаем данные…</p>
      <div class="skeleton-row"></div>
      <div class="skeleton-row"></div>
      <div class="skeleton-row"></div>
    </div>`;
}

function renderPanelError(message) {
  byId("dash-panel").innerHTML = `
    <div class="empty-state">
      <h2 class="empty-state__title">Не удалось загрузить раздел</h2>
      <p class="empty-state__text">${escapeHtml(message)}</p>
      <button type="button" class="btn btn--secondary" data-retry-tab>Попробовать снова</button>
    </div>`;
}

function emptyState(title, text, options = {}) {
  return `
    <div class="empty-state">
      <p class="kicker">${escapeHtml(options.kicker || "пусто")}</p>
      <h2 class="empty-state__title">${escapeHtml(title)}</h2>
      <p class="empty-state__text">${escapeHtml(text)}</p>
      ${
        options.create
          ? '<button type="button" class="btn btn--primary" data-open-create>Создать задачу</button>'
          : ""
      }
    </div>`;
}

function canManageTask(task) {
  return state.user.role === "admin" || task.customerId === state.user.id;
}

function taskCard(task) {
  const manage = canManageTask(task);
  const mine = task.myApplicationStatus;
  const skills = task.skills
    .slice(0, 5)
    .map((skill) => `<span class="pill pill--miss">${escapeHtml(skill)}</span>`)
    .join("");

  return `
    <li class="task-card">
      <button type="button" class="task-card__body" data-open-task="${task.id}">
        <span class="task-card__top">
          ${statusBadge(task.status)}
          <span class="task-card__area">${escapeHtml(task.area)}</span>
        </span>
        <span class="task-card__title">${escapeHtml(task.title)}</span>
        <span class="task-card__company">${escapeHtml(task.company)}</span>
        <span class="task-card__desc">${escapeHtml(truncate(task.description, 180))}</span>
        <span class="task-card__facts">
          <span><b>${task.hours}</b> ч</span>
          <span><b>${formatMoney(task.budget)}</b></span>
          <span>${applicationsLabel(task.applicationsCount)}</span>
        </span>
        <span class="task-card__skills">${skills}</span>
        ${
          mine
            ? `<span class="task-card__mine">Ваш отклик: ${applicationBadge(mine)}</span>`
            : ""
        }
      </button>
      <div class="task-card__actions">
        <button type="button" class="btn btn--secondary btn--small" data-open-task="${task.id}">Подробнее</button>
        ${
          manage
            ? `<button type="button" class="btn btn--primary btn--small" data-open-apps="${task.id}">
                 Отклики${task.applicationsCount ? ` · ${task.applicationsCount}` : ""}
               </button>`
            : ""
        }
        ${
          !manage && state.user.role !== "consumer" && task.status === "open" && !mine
            ? `<button type="button" class="btn btn--primary btn--small" data-open-task="${task.id}">Откликнуться</button>`
            : ""
        }
      </div>
    </li>`;
}

async function loadTaskList(mode) {
  const params = new URLSearchParams();
  if (mode === "mine") params.set("mine", "1");
  if (state.user.role === "user" && mode !== "mine") params.set("status", "open");

  const query = params.toString();
  const data = await api(`/api/tasks${query ? `?${query}` : ""}`);

  if (!data.tasks.length) {
    if (mode === "mine") {
      byId("dash-panel").innerHTML = emptyState(
        "Пока нет задач",
        "Опубликуйте первую задачу — пользователи увидят её и смогут откликнуться.",
        { kicker: "мои задачи", create: true }
      );
    } else {
      byId("dash-panel").innerHTML = emptyState(
        "Пока нет доступных задач",
        "Загляните позже: потребители публикуют новые задачи, и они сразу появятся здесь.",
        { kicker: "задачи" }
      );
    }
    return;
  }

  byId("dash-panel").innerHTML = `
    <div class="panel-head">
      <p class="panel-head__count">${data.tasks.length} ${plural(data.tasks.length, "задача", "задачи", "задач")}</p>
      ${mode === "mine" && state.user.role !== "user" ? '<button type="button" class="btn btn--primary btn--small" data-open-create>Создать задачу</button>' : ""}
    </div>
    <ul class="task-grid">${data.tasks.map(taskCard).join("")}</ul>`;
}

async function loadMyApplications() {
  const data = await api("/api/my/applications");

  if (!data.applications.length) {
    byId("dash-panel").innerHTML = emptyState(
      "Вы ещё не откликались",
      "Откройте доступную задачу и отправьте отклик — он появится здесь вместе со статусом.",
      { kicker: "мои отклики" }
    );
    return;
  }

  byId("dash-panel").innerHTML = `
    <div class="panel-head">
      <p class="panel-head__count">${data.applications.length} ${plural(data.applications.length, "отклик", "отклика", "откликов")}</p>
    </div>
    <ul class="application-list">
      ${data.applications
        .map(
          (application) => `
            <li class="application-card">
              <div class="application-card__top">
                ${applicationBadge(application.status)}
                <span class="application-card__date">${formatDate(application.createdAt)}</span>
              </div>
              <h3 class="application-card__title">${escapeHtml(application.task.title)}</h3>
              <p class="application-card__company">
                ${escapeHtml(application.task.company)} · ${statusBadge(application.task.status)}
              </p>
              ${
                application.message
                  ? `<blockquote class="application-card__message">${escapeHtml(application.message)}</blockquote>`
                  : ""
              }
              <div class="application-card__meta">
                <span>${application.task.hours} ч</span>
                <span>${formatMoney(application.task.budget)}</span>
              </div>
              <div class="application-card__actions">
                <button type="button" class="btn btn--secondary btn--small" data-open-task="${application.task.id}">Открыть задачу</button>
                ${
                  application.status === "pending"
                    ? `<button type="button" class="btn btn--ghost btn--small"
                               data-withdraw-application="${application.id}"
                               data-task-id="${application.task.id}">Отозвать отклик</button>`
                    : ""
                }
              </div>
            </li>`
        )
        .join("")}
    </ul>`;
}

function roleSelect(user) {
  const isSelf = user.id === state.user.id;
  return `
    <select class="field__input field__input--compact" data-role-user="${user.id}"
            data-current-role="${user.role}" ${isSelf ? "disabled" : ""}
            aria-label="Роль пользователя ${escapeHtml(user.name)}">
      ${Object.entries(ROLE_LABELS)
        .map(
          ([role, label]) =>
            `<option value="${role}"${role === user.role ? " selected" : ""}>${label}</option>`
        )
        .join("")}
    </select>
    ${isSelf ? '<span class="admin-self">это вы</span>' : ""}`;
}

async function loadAdminUsers() {
  const data = await api("/api/admin/users");
  const users = data.users;

  byId("dash-panel").innerHTML = `
    <p class="admin-note">
      Роль меняется сразу. Себе роль изменить нельзя — это защита от потери доступа.
      «Пользователь» откликается на задачи, «Потребитель» создаёт их, «Админ» управляет всем.
    </p>
    <div class="table-scroll">
      <table class="admin-table">
        <caption class="visually-hidden">Пользователи платформы и их роли</caption>
        <thead>
          <tr>
            <th scope="col">Имя</th>
            <th scope="col">Email</th>
            <th scope="col">Компания</th>
            <th scope="col">Роль</th>
            <th scope="col">Задачи</th>
            <th scope="col">Отклики</th>
            <th scope="col">Регистрация</th>
          </tr>
        </thead>
        <tbody>
          ${users
            .map(
              (user) => `
                <tr>
                  <td>${escapeHtml(user.name)}</td>
                  <td><a href="mailto:${escapeHtml(user.email)}">${escapeHtml(user.email)}</a></td>
                  <td>${user.company ? escapeHtml(user.company) : "—"}</td>
                  <td class="admin-role-cell">${roleSelect(user)}</td>
                  <td class="table-number">${user.tasksCount}</td>
                  <td class="table-number">${user.applicationsCount}</td>
                  <td class="table-muted">${formatDate(user.createdAt)}</td>
                </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>`;
}

async function switchTab(tabId) {
  if (!state.user) return;
  const tabs = tabsForRole();
  const tab = tabs.find((item) => item.id === tabId);
  if (!tab) return;

  state.activeTab = tab.id;
  renderTabs();
  renderPanelLoading();

  try {
    if (tab.id === "tasks") await loadTaskList("all");
    else if (tab.id === "my-tasks") await loadTaskList("mine");
    else if (tab.id === "my-apps") await loadMyApplications();
    else if (tab.id === "users") await loadAdminUsers();
  } catch (error) {
    renderPanelError(error.message);
  }
}

async function reloadActiveTab() {
  if (state.activeTab) await switchTab(state.activeTab);
}

/* ------------------------------------------------------------------ */
/* Task dialog                                                         */
/* ------------------------------------------------------------------ */

function renderApplicationSection(task) {
  const applications = Array.isArray(task.applications) ? task.applications : [];
  return `
    <section class="dialog-section">
      <h3 class="dialog-section__title">Отклики <span class="muted">${applications.length}</span></h3>
      ${
        applications.length
          ? `<ul class="applicant-list">${applications
              .map((application) => applicantCard(application, task))
              .join("")}</ul>`
          : `<p class="dialog-empty">Пока никто не откликнулся. Пользователи увидят задачу в разделе «Доступные задачи».</p>`
      }
    </section>`;
}

function applicantCard(application, task) {
  const status = application.status;
  return `
    <li class="applicant-card">
      <div class="applicant-card__top">
        <div>
          <strong>${escapeHtml(application.applicant.name)}</strong>
          <a class="applicant-card__email" href="mailto:${escapeHtml(application.applicant.email)}">${escapeHtml(application.applicant.email)}</a>
          ${application.applicant.company ? `<span class="applicant-card__company">${escapeHtml(application.applicant.company)}</span>` : ""}
        </div>
        ${applicationBadge(status)}
      </div>
      ${
        application.message
          ? `<p class="applicant-card__message">${escapeHtml(application.message)}</p>`
          : ""
      }
      <div class="applicant-card__actions">
        ${
          status !== "accepted"
            ? `<button type="button" class="btn btn--primary btn--small"
                       data-application-action="accepted"
                       data-application-id="${application.id}"
                       data-task-id="${task.id}">Принять</button>`
            : ""
        }
        ${
          status !== "rejected"
            ? `<button type="button" class="btn btn--secondary btn--small"
                       data-application-action="rejected"
                       data-application-id="${application.id}"
                       data-task-id="${task.id}">${status === "accepted" ? "Снять с задачи" : "Отклонить"}</button>`
            : ""
        }
      </div>
    </li>`;
}

function renderApplyBlock(task) {
  if (state.user.role === "consumer" || task.customerId === state.user.id) return "";

  const myStatus = task.myApplicationStatus;

  if (myStatus === "pending") {
    return `
      <div class="apply-status">
        <span class="apply-status__label">Ваш отклик</span>
        ${applicationBadge(myStatus)}
        <button type="button" class="btn btn--ghost btn--small"
                data-withdraw-application="${task.myApplicationId}"
                data-task-id="${task.id}">Отозвать</button>
      </div>`;
  }

  if (myStatus === "accepted") {
    return `
      <div class="apply-status apply-status--accepted">
        <span class="apply-status__label">Вы исполнитель этой задачи</span>
        ${applicationBadge(myStatus)}
      </div>`;
  }

  if (task.status !== "open") {
    return `<p class="dialog-note">Задача уже не принимает отклики.</p>`;
  }

  return `
    <form class="apply-form" id="apply-form" data-task-id="${task.id}">
      ${
        myStatus === "rejected"
          ? '<p class="dialog-note">Предыдущий отклик отклонён — можно попробовать снова.</p>'
          : ""
      }
      <div class="field">
        <label class="field__label" for="apply-message">Сообщение заказчику <span class="field__hint">— необязательно</span></label>
        <textarea class="field__input field__input--textarea" id="apply-message" name="message"
                  rows="3" maxlength="1000" placeholder="Почему вы подходите и когда сможете начать"></textarea>
      </div>
      <p class="form-message" id="apply-message-error" role="alert" hidden></p>
      <button type="submit" class="btn btn--primary">Отправить отклик</button>
    </form>`;
}

function renderManageBlock(task) {
  if (!canManageTask(task)) return "";

  return `
    <section class="dialog-section">
      <h3 class="dialog-section__title">Управление задачей</h3>
      <div class="dialog-actions">
        ${
          task.status !== "done"
            ? `<button type="button" class="btn btn--secondary btn--small"
                       data-task-status="done" data-task-id="${task.id}">Отметить выполненной</button>`
            : ""
        }
        ${
          task.status !== "cancelled"
            ? `<button type="button" class="btn btn--secondary btn--small"
                       data-task-status="cancelled" data-task-id="${task.id}">Отменить задачу</button>`
            : ""
        }
        ${
          task.status === "done" || task.status === "cancelled"
            ? `<button type="button" class="btn btn--secondary btn--small"
                       data-task-status="open" data-task-id="${task.id}">Переоткрыть</button>`
            : ""
        }
        <button type="button" class="btn btn--danger btn--small"
                data-delete-task="${task.id}">Удалить задачу</button>
      </div>
    </section>`;
}

function renderTaskDialog(task) {
  const isOwner = task.customerId === state.user.id;
  const manage = canManageTask(task);
  const skills = task.skills.length
    ? task.skills.map((skill) => `<span class="pill pill--miss">${escapeHtml(skill)}</span>`).join("")
    : '<span class="muted">навыки не указаны</span>';

  byId("task-dialog-body").innerHTML = `
    <div class="dialog__head">
      <p class="kicker">Задача #${task.id} · ${formatDate(task.createdAt)}</p>
      <div class="task-dialog__status">${statusBadge(task.status)}</div>
      <h2 class="dialog__title" id="task-dialog-title">${escapeHtml(task.title)}</h2>
      <p class="dialog__lead">
        ${escapeHtml(task.company)} · ${escapeHtml(task.area)}
        ${isOwner ? ' · <span class="task-dialog__own">ваша задача</span>' : ""}
      </p>
    </div>

    <p class="task-dialog__desc">${escapeHtml(task.description)}</p>

    <dl class="task-facts">
      <div><dt>объём</dt><dd>${task.hours} ч</dd></div>
      <div><dt>бюджет</dt><dd>${formatMoney(task.budget)}</dd></div>
      <div><dt>дедлайн</dt><dd>${task.deadline ? formatDate(task.deadline) : "—"}</dd></div>
      <div><dt>отклики</dt><dd>${task.applicationsCount}</dd></div>
      <div><dt>заказчик</dt><dd>${escapeHtml(task.customerName)}</dd></div>
      ${
        task.assigneeName
          ? `<div><dt>исполнитель</dt><dd>${escapeHtml(task.assigneeName)}</dd></div>`
          : ""
      }
    </dl>

    <div class="task-dialog__skills">${skills}</div>

    ${renderApplyBlock(task)}
    ${manage ? renderApplicationSection(task) : ""}
    ${manage ? renderManageBlock(task) : ""}
  `;
}

async function openTask(taskId) {
  const data = await api(`/api/tasks/${taskId}`);
  renderTaskDialog(data.task);
  openDialog("task-dialog");
}

async function openApplications(taskId) {
  const data = await api(`/api/tasks/${taskId}`);
  const task = data.task;
  const applications = Array.isArray(task.applications) ? task.applications : [];

  byId("apps-dialog-title").textContent = `Кандидаты · ${task.title}`;
  byId("apps-dialog-body").innerHTML = applications.length
    ? `<ul class="applicant-list">${applications.map((application) => applicantCard(application, task)).join("")}</ul>`
    : `<p class="dialog-empty">Пока никто не откликнулся на эту задачу.</p>`;

  openDialog("apps-dialog");
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

async function withdrawApplication(applicationId, taskId) {
  await api(`/api/applications/${applicationId}`, { method: "DELETE" });
  showToast("Отклик отозван.");
  await refreshStats();
  await reloadActiveTab();

  if (byId("task-dialog").open && taskId) {
    await openTask(taskId);
  }
}

async function setApplicationStatus(applicationId, status, taskId) {
  await api(`/api/applications/${applicationId}`, {
    method: "PATCH",
    body: JSON.stringify({ status })
  });
  showToast(status === "accepted" ? "Исполнитель выбран." : "Отклик отклонён.");
  await refreshStats();
  await reloadActiveTab();

  if (byId("apps-dialog").open) await openApplications(taskId);
  else if (byId("task-dialog").open) await openTask(taskId);
}

async function setTaskStatus(taskId, status) {
  await api(`/api/tasks/${taskId}`, {
    method: "PATCH",
    body: JSON.stringify({ status })
  });
  showToast("Статус задачи обновлён.");
  await refreshStats();
  await reloadActiveTab();

  if (byId("task-dialog").open) await openTask(taskId);
}

async function deleteTask(taskId) {
  const confirmed = window.confirm("Удалить задачу? Вместе с ней удалятся все отклики. Это необратимо.");
  if (!confirmed) return;

  await api(`/api/tasks/${taskId}`, { method: "DELETE" });
  closeDialog("task-dialog");
  showToast("Задача удалена.");
  await refreshStats();
  await reloadActiveTab();
}

function openCreateDialog() {
  const form = byId("create-form");
  const company = form.elements.namedItem("company");
  hideFormMessage(byId("create-message"));
  if (!company.value) company.value = state.user.company || state.user.name;
  openDialog("create-dialog");
}

function openPasswordDialog() {
  const form = byId("password-form");
  form.reset();
  hideFormMessage(byId("password-message"));
  openDialog("password-dialog");
}

/* ------------------------------------------------------------------ */
/* Event wiring                                                        */
/* ------------------------------------------------------------------ */

function bindEvents() {
  byId("logout-button").addEventListener("click", async () => {
    try {
      await api("/api/logout", { method: "POST" });
    } catch {
      /* всё равно уходим на главную */
    }
    window.location.replace("index.html");
  });

  byId("create-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const message = byId("create-message");
    hideFormMessage(message);

    if (!form.reportValidity()) return;

    const button = form.querySelector('button[type="submit"]');
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "Публикуем…";

    try {
      const field = (name) => form.elements.namedItem(name);
      await api("/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: field("title").value.trim(),
          company: field("company").value.trim(),
          area: field("area").value,
          description: field("description").value.trim(),
          skills: field("skills").value,
          hours: Number(field("hours").value),
          budget: Number(field("budget").value),
          deadline: field("deadline").value || null
        })
      });

      form.reset();
      field("hours").value = 8;
      field("budget").value = 30000;
      field("company").value = state.user.company || state.user.name;
      closeDialog("create-dialog");
      showToast("Задача опубликована.");
      await refreshStats();
      await switchTab(state.user.role === "admin" ? "tasks" : "my-tasks");
    } catch (error) {
      setFormMessage(message, error.message);
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  });

  byId("password-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const message = byId("password-message");
    hideFormMessage(message);

    if (!form.reportValidity()) return;

    const button = form.querySelector('button[type="submit"]');
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "Сохраняем…";

    try {
      await api("/api/me/password", {
        method: "POST",
        body: JSON.stringify({
          currentPassword: form.elements.namedItem("currentPassword").value,
          newPassword: form.elements.namedItem("newPassword").value
        })
      });
      form.reset();
      closeDialog("password-dialog");
      showToast("Пароль изменён.");
    } catch (error) {
      setFormMessage(message, error.message);
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  });

  byId("task-dialog-body").addEventListener("submit", async (event) => {
    const form = event.target.closest("#apply-form");
    if (!form) return;
    event.preventDefault();

    const taskId = Number(form.dataset.taskId);
    const message = byId("apply-message-error");
    hideFormMessage(message);

    const button = form.querySelector('button[type="submit"]');
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "Отправляем…";

    try {
      await api(`/api/tasks/${taskId}/apply`, {
        method: "POST",
        body: JSON.stringify({
          message: form.elements.namedItem("message").value.trim()
        })
      });
      showToast("Отклик отправлен.");
      await refreshStats();
      await reloadActiveTab();
      await openTask(taskId);
    } catch (error) {
      setFormMessage(message, error.message);
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  });

  byId("dash-panel").addEventListener("change", async (event) => {
    const select = event.target.closest("[data-role-user]");
    if (!select) return;

    const userId = Number(select.dataset.roleUser);
    const previousRole = select.dataset.currentRole;
    const role = select.value;
    select.disabled = true;

    try {
      await api(`/api/admin/users/${userId}/role`, {
        method: "PATCH",
        body: JSON.stringify({ role })
      });
      select.dataset.currentRole = role;
      showToast(`Роль обновлена: ${ROLE_LABELS[role]}.`);
      await refreshStats();
      await reloadActiveTab();
    } catch (error) {
      select.value = previousRole;
      select.disabled = false;
      showToast(error.message, "error");
    }
  });

  document.addEventListener("click", async (event) => {
    const closeButton = event.target.closest("[data-close-dialog]");
    if (closeButton) {
      closeDialog(closeButton.dataset.closeDialog);
      return;
    }

    const tab = event.target.closest("[data-tab]");
    if (tab) {
      await switchTab(tab.dataset.tab);
      return;
    }

    const retry = event.target.closest("[data-retry-tab]");
    if (retry) {
      await reloadActiveTab();
      return;
    }

    const createButton = event.target.closest("[data-open-create]");
    if (createButton) {
      openCreateDialog();
      return;
    }

    const passwordButton = event.target.closest("[data-open-password]");
    if (passwordButton) {
      openPasswordDialog();
      return;
    }

    const appAction = event.target.closest("[data-application-action]");
    if (appAction) {
      appAction.disabled = true;
      try {
        await setApplicationStatus(
          Number(appAction.dataset.applicationId),
          appAction.dataset.applicationAction,
          Number(appAction.dataset.taskId)
        );
      } catch (error) {
        showToast(error.message, "error");
        appAction.disabled = false;
      }
      return;
    }

    const withdraw = event.target.closest("[data-withdraw-application]");
    if (withdraw) {
      withdraw.disabled = true;
      try {
        await withdrawApplication(
          Number(withdraw.dataset.withdrawApplication),
          Number(withdraw.dataset.taskId)
        );
      } catch (error) {
        showToast(error.message, "error");
        withdraw.disabled = false;
      }
      return;
    }

    const taskStatus = event.target.closest("[data-task-status]");
    if (taskStatus) {
      taskStatus.disabled = true;
      try {
        await setTaskStatus(
          Number(taskStatus.dataset.taskId),
          taskStatus.dataset.taskStatus
        );
      } catch (error) {
        showToast(error.message, "error");
        taskStatus.disabled = false;
      }
      return;
    }

    const deleteButton = event.target.closest("[data-delete-task]");
    if (deleteButton) {
      try {
        await deleteTask(Number(deleteButton.dataset.deleteTask));
      } catch (error) {
        showToast(error.message, "error");
      }
      return;
    }

    const appsButton = event.target.closest("[data-open-apps]");
    if (appsButton) {
      try {
        await openApplications(Number(appsButton.dataset.openApps));
      } catch (error) {
        showToast(error.message, "error");
      }
      return;
    }

    const taskButton = event.target.closest("[data-open-task]");
    if (taskButton) {
      try {
        await openTask(Number(taskButton.dataset.openTask));
      } catch (error) {
        showToast(error.message, "error");
      }
    }
  });

  document.querySelectorAll("dialog").forEach((dialog) => {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
  });
}

/* ------------------------------------------------------------------ */
/* Init                                                                */
/* ------------------------------------------------------------------ */

async function init() {
  bindEvents();

  try {
    const data = await api("/api/me");
    if (!data.user) {
      window.location.replace("login.html");
      return;
    }

    state.user = data.user;
    renderHeader();
    await refreshStats();
    renderTabs();
    await switchTab(state.activeTab);
  } catch (error) {
    byId("dash-role").textContent = "Не удалось загрузить профиль";
    renderPanelError(error.message);
  }
}

init();
