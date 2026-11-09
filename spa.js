"use strict";

/* Paradox SPA: все страницы в одном документе, History API, переходы между видами.
   Бэкенд — прежний server.js: те же API-эндпоинты, app.html раздаётся на все роуты. */

/* ------------------------------------------------------------------ */
/* Общие утилиты                                                       */
/* ------------------------------------------------------------------ */

const byId = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
  });
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

function setBusy(form, busy, label) {
  const button = form.querySelector('button[type="submit"]');
  if (!button) return;
  if (busy) {
    button.dataset.label = button.textContent;
    button.textContent = label;
    button.disabled = true;
  } else {
    if (button.dataset.label) button.textContent = button.dataset.label;
    button.disabled = false;
  }
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

function closeAllDialogs() {
  document.querySelectorAll("dialog[open]").forEach((dialog) => dialog.close());
}

/* ------------------------------------------------------------------ */
/* Роутер и переходы                                                    */
/* ------------------------------------------------------------------ */

const ROUTES = {
  "/": "home",
  "/problem": "problem",
  "/solution": "solution",
  "/how": "how",
  "/demo": "demo",
  "/market": "market",
  "/team": "team",
  "/login": "login",
  "/match": "match",
  "/dashboard": "dashboard",
  "/faq": "faq",
  "/privacy": "privacy",
  "/terms": "terms"
};

const VIEWS = {
  home: "view-home",
  problem: "view-problem",
  solution: "view-solution",
  how: "view-how",
  demo: "view-demo",
  market: "view-market",
  team: "view-team",
  login: "view-login",
  match: "view-match",
  dashboard: "view-dashboard",
  faq: "view-faq",
  privacy: "view-privacy",
  terms: "view-terms"
};

const TITLES = {
  home: "Paradox — первая работа из первой задачи",
  problem: "Проблема — разрыв между образованием и рынком · Paradox",
  solution: "Решение — задача как точка входа в профессию · Paradox",
  how: "Как работает — четыре шага · Paradox",
  demo: "Демо — попробуйте подбор · Paradox",
  market: "Экономика — каждая сторона платит за своё · Paradox",
  team: "Команда и стек · Paradox",
  login: "Вход и регистрация — Paradox",
  match: "Подбор задачи — Paradox",
  dashboard: "Личный кабинет — Paradox",
  faq: "Вопросы и ответы — Paradox",
  privacy: "Политика конфиденциальности — Paradox",
  terms: "Условия использования — Paradox"
};

const GUARDED = new Set(["match", "dashboard"]);
const NEXT_PATHS = new Set([
  "/problem", "/solution", "/how", "/demo", "/market", "/team",
  "/match", "/dashboard", "/faq", "/privacy", "/terms"
]);

/* Страницы с общим навбаром-содержанием: главная и всё про модель. */
const CONTENT_ROUTES = new Set([
  "home", "problem", "solution", "how", "demo", "market", "team"
]);

let currentRoute = "home";
let currentUser = null;
let pendingHash = null;

function pathToRoute(pathname) {
  let path = pathname;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  if (!path) path = "/";
  const route = ROUTES[path];
  return route || null;
}

function safeNextPath(value) {
  if (typeof value !== "string") return "/dashboard";
  if (!value.startsWith("/") || value.startsWith("//")) return "/dashboard";
  if (!NEXT_PATHS.has(value)) return "/dashboard";
  return value;
}

function navigate(to, { replace = false } = {}) {
  if (replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  renderRoute();
}

function showView(routeName) {
  document.querySelectorAll(".page-view").forEach((view) => {
    view.hidden = true;
    view.classList.remove("is-active");
  });
  const view = document.getElementById(VIEWS[routeName]);
  view.hidden = false;
  /* Перезапуск анимации перехода: reflow перед добавлением класса */
  void view.offsetWidth;
  view.classList.add("is-active");
}

function renderHeader(routeName) {
  const nav = byId("site-nav");
  if (!nav) return;

  const authLink = currentUser
    ? '<a href="/dashboard" class="site-nav__auth">Кабинет</a>'
    : '<a href="/login" class="site-nav__auth">Войти</a>';

  let html = "";

  if (CONTENT_ROUTES.has(routeName)) {
    const links = [
      ["/problem", "Проблема"],
      ["/solution", "Решение"],
      ["/how", "Как работает"],
      ["/demo", "Демо"],
      ["/market", "Бизнес-модель"]
    ];
    html = links
      .map(([href, label]) => `<a href="${href}"${currentRoute === href.slice(1) ? ' class="is-active"' : ""}>${label}</a>`)
      .join("\n");
    html += `\n${authLink}\n<a href="/faq" class="site-nav__cta${currentRoute === "faq" ? " is-active" : ""}">FAQ</a>`;
  } else if (routeName === "dashboard") {
    html = `
      <a href="/">Главная</a>
      ${
        currentUser
          ? `<span class="user-chip">${escapeHtml(currentUser.name)} · ${escapeHtml(currentUser.roleLabel)}</span>`
          : ""
      }
      <button type="button" class="btn btn--secondary btn--small" data-logout>Выйти</button>`;
  } else if (routeName === "login") {
    html = `
      <a href="/">На главную</a>
      <a href="/login" class="site-nav__cta is-active">Войти</a>`;
  } else if (routeName === "match") {
    html = `
      <a href="/">На главную</a>
      ${currentUser ? '<a href="/dashboard" class="site-nav__cta">Кабинет</a>' : ""}`;
  } else {
    html = `
      <a href="/">На главную</a>
      <a href="/faq">Вопросы и ответы</a>
      ${authLink}`;
  }

  nav.innerHTML = html;
}

function renderFooter(routeName) {
  const footer = byId("site-footer");
  if (!footer) return;
  footer.classList.toggle("site-footer--compact", routeName !== "home");

  const mark = '<p class="site-footer__mark">Paradox<span class="brand__dot" aria-hidden="true"></span></p>';
  const legalLinks = '<p class="site-footer__meta site-footer__legal"><a href="/faq">Вопросы и ответы</a> · <a href="/privacy">Политика конфиденциальности</a> · <a href="/terms">Условия использования</a></p>';
  const metaByRoute = {
    home: `
      <p class="site-footer__meta">Кейс «The Experience Gap» · трек Digital Economy &amp; Future Tech · хакатон, ноябрь 2026</p>
      <p class="site-footer__meta">Имена компаний в деме вымышлены, цифры пилота — данные команды</p>`,
    problem: '<p class="site-footer__meta">Проблема · <a href="/">на главную</a></p>',
    solution: '<p class="site-footer__meta">Решение · <a href="/">на главную</a></p>',
    how: '<p class="site-footer__meta">Как работает · <a href="/">на главную</a></p>',
    demo: '<p class="site-footer__meta">Демо MVP · <a href="/">на главную</a></p>',
    market: '<p class="site-footer__meta">Экономика модели · <a href="/">на главную</a></p>',
    team: '<p class="site-footer__meta">Команда и стек · <a href="/">на главную</a></p>',
    login: '<p class="site-footer__meta">Вход и регистрация · <a href="/">на главную</a></p>',
    match: '<p class="site-footer__meta">Подбор задачи · <a href="/">на главную</a></p>',
    dashboard: '<p class="site-footer__meta">Личный кабинет · <a href="/">на главную</a></p>',
    faq: '<p class="site-footer__meta">Вопросы и ответы · <a href="/">на главную</a></p>',
    privacy: '<p class="site-footer__meta">Политика конфиденциальности · <a href="/">на главную</a></p>',
    terms: '<p class="site-footer__meta">Условия использования · <a href="/">на главную</a></p>'
  };
  footer.innerHTML = mark + (metaByRoute[routeName] || metaByRoute.home) + legalLinks;
}

function scrollAfterTransition(routeName) {
  const target = pendingHash || location.hash;
  pendingHash = null;
  if (target && routeName === "home") {
    const element = document.querySelector(target);
    if (element) {
      window.setTimeout(() => element.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
      return;
    }
  }
  window.scrollTo(0, 0);
}

function renderRoute() {
  const routeName = pathToRoute(location.pathname) || "home";

  let route = routeName;

  /* Закрытые виды: нет сессии — на вход (с возвратом через ?next=). */
  if (GUARDED.has(route) && !currentUser) {
    const strRef = safeNextPath("/" + route);
    history.replaceState(null, "", `/login?next=${encodeURIComponent(strRef)}`);
    route = "login";
  }

  /* Вошедший попадает на /login — сразу в кабинет или туда, куда просил ?next=. */
  if (route === "login" && currentUser) {
    const next = safeNextPath(new URLSearchParams(location.search).get("next"));
    history.replaceState(null, "", next);
    route = pathToRoute(next) || "home";
  }

  currentRoute = route;
  document.title = TITLES[route];
  closeAllDialogs();

  showView(route);
  renderHeader(route);
  renderFooter(route);

  if (route === "login") enterLoginView();
  else if (route === "match") enterMatchView();
  else if (route === "dashboard") enterDashboardView();

  scrollAfterTransition(route);
}

/* ------------------------------------------------------------------ */
/* Ссылки, кнопки выхода и перевод по якорям                            */
/* ------------------------------------------------------------------ */

function bindNavigation() {
  document.addEventListener("click", (event) => {
    if (event.defaultPrevented) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const logoutButton = event.target.closest("[data-logout]");
    if (logoutButton) {
      handleLogout();
      return;
    }

    const anchor = event.target.closest("a[href]");
    if (!anchor) return;
    const href = anchor.getAttribute("href");
    if (!href) return;

    /* Якорь на текущей странице — браузерный скролл сам разберётся. */
    if (href.startsWith("#")) {
      if (currentRoute !== "home") {
        event.preventDefault();
        navigate("/");
        pendingHash = href;
      }
      return;
    }

    if (anchor.target && anchor.target !== "_self") return;
    if (anchor.protocol !== location.protocol || anchor.host !== location.host) return;

    const routeName = pathToRoute(anchor.pathname);
    if (!routeName) return;

    event.preventDefault();
    const to = anchor.pathname + anchor.search;
    if (anchor.hash) {
      pendingHash = anchor.hash;
      navigate(to);
      return;
    }
    if (anchor.pathname === location.pathname && anchor.search === location.search && !anchor.hash) {
      renderRoute();
      return;
    }
    navigate(to);
  });

  window.addEventListener("popstate", () => {
    pendingHash = null;
    renderRoute();
  });
}

async function handleLogout() {
  try {
    await api("/api/logout", { method: "POST" });
  } catch {
    /* всё равно выходим на главную */
  }
  currentUser = null;
  dashState.activeTab = null;
  navigate("/");
  showToast("Вы вышли из аккаунта.");
}

/* ------------------------------------------------------------------ */
/* Появление секций лендинга при скролле                                */
/* ------------------------------------------------------------------ */

const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("in-view");
        revealObserver.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.15 }
);

/* Появление секций при скролле — на всех страницах-видах, не только на главной. */
if ("IntersectionObserver" in window) {
  document.querySelectorAll(".page-view .reveal").forEach((el) => revealObserver.observe(el));
} else {
  document.querySelectorAll(".page-view .reveal").forEach((el) => el.classList.add("in-view"));
}

/* ------------------------------------------------------------------ */
/* Вход и регистрация (вид login)                                       */
/* ------------------------------------------------------------------ */

const loginForm = document.getElementById("login-form");
const registerForm = document.getElementById("register-form");
const loginMessage = document.getElementById("form-message");
const registerMessage = document.getElementById("register-message");
const cardTitle = document.getElementById("auth-card-title");
const authTabs = Array.from(document.querySelectorAll(".auth-tab"));

function activateAuthTab(tabName) {
  const isLogin = tabName === "login";
  authTabs.forEach((tab) => {
    const active = tab.dataset.tab === tabName;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  loginForm.hidden = !isLogin;
  registerForm.hidden = isLogin;
  cardTitle.textContent = isLogin ? "Войти в кабинет" : "Создать аккаунт";
  hideFormMessage(loginMessage);
  hideFormMessage(registerMessage);
}

function afterAuthRedirect() {
  const next = safeNextPath(new URLSearchParams(location.search).get("next"));
  currentUser = apiUserCache;
  navigate(next, { replace: true });
}

let apiUserCache = null;

function bindLoginView() {
  authTabs.forEach((tab) => {
    tab.addEventListener("click", () => activateAuthTab(tab.dataset.tab));
  });

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    hideFormMessage(loginMessage);

    const email = loginForm.elements.namedItem("email").value.trim();
    const password = loginForm.elements.namedItem("password").value;

    if (!email || !password) {
      setFormMessage(loginMessage, "Введите email и пароль.");
      return;
    }

    setBusy(loginForm, true, "Входим…");
    try {
      const data = await api("/api/login", {
        method: "POST",
        body: JSON.stringify({ email, password })
      });
      apiUserCache = data.user;
      const who = data.user ? data.user.name : "";
      afterAuthRedirect();
      if (who) showToast(`С возвращением, ${who}.`);
    } catch (error) {
      setFormMessage(loginMessage, error.message);
      setBusy(loginForm, false);
    }
  });

  registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    hideFormMessage(registerMessage);

    const field = (name) => registerForm.elements.namedItem(name);
    const name = field("name").value.trim();
    const email = field("email").value.trim();
    const company = field("company").value.trim();
    const password = field("password").value;
    const password2 = field("password2").value;

    if (name.length < 2) {
      setFormMessage(registerMessage, "Укажите имя (минимум 2 символа).");
      return;
    }
    if (!email) {
      setFormMessage(registerMessage, "Укажите email.");
      return;
    }
    if (password.length < 8) {
      setFormMessage(registerMessage, "Пароль должен быть не короче 8 символов.");
      return;
    }
    if (password !== password2) {
      setFormMessage(registerMessage, "Пароли не совпадают.");
      return;
    }

    setBusy(registerForm, true, "Создаём аккаунт…");
    try {
      const data = await api("/api/register", {
        method: "POST",
        body: JSON.stringify({ name, email, company, password })
      });
      apiUserCache = data.user;
      afterAuthRedirect();
      showToast("Аккаунт создан. Добро пожаловать в Paradox.");
    } catch (error) {
      setFormMessage(registerMessage, error.message);
      setBusy(registerForm, false);
    }
  });
}

function enterLoginView() {
  setBusy(loginForm, false);
  setBusy(registerForm, false);
  activateAuthTab("login");
}

/* ------------------------------------------------------------------ */
/* Подбор задачи (вид match)                                            */
/* ------------------------------------------------------------------ */

const SKILLS = [
  "Python", "JavaScript", "React", "SQL", "Figma",
  "HTML/CSS", "Telegram-боты", "Аналитика данных", "Excel", "Видеомонтаж"
];

const SEED_PROJECTS = [
  {
    title: "Мини-CRM для записей клиентов",
    company: "Стоматология «Аралин», Астана",
    tags: ["SQL", "Python", "Figma"],
    area: "IT",
    hours: 18,
    budgetTenge: 45000,
    desc: "Записи ведутся в бумажном журнале, клиенты теряются. Нужна простая таблица заявок со статусами и напоминаниями."
  },
  {
    title: "Телеграм-бот записи в барбершоп «Кесу»",
    company: "Барбершоп «Кесу», Алматы",
    tags: ["Python", "Telegram-боты"],
    area: "IT",
    hours: 12,
    budgetTenge: 30000,
    desc: "Записи приходят в WhatsApp и теряются. Нужен бот: выбор мастера, свободный слот, напоминание за 2 часа."
  },
  {
    title: "Сайт меню и каталог пекарни «Нан»",
    company: "Пекарня «Нан», Шымкент",
    tags: ["HTML/CSS", "Figma"],
    area: "Дизайн",
    hours: 10,
    budgetTenge: 20000,
    desc: "Есть только Instagram-аккаунт. Нужна одна страница с актуальным меню, ценами и картой доставки."
  },
  {
    title: "Дашборд продаж для марки одежды «Kolta»",
    company: "Бренд «Kolta», Алматы",
    tags: ["Excel", "Аналитика данных", "SQL"],
    area: "Аналитика",
    hours: 14,
    budgetTenge: 35000,
    desc: "Выручка склеена из трёх маркетплейсов и оффлайн-кассы. Нужен еженедельный дашборд: продажи, возвраты, топ-SKU."
  },
  {
    title: "Лид-форма и тест-квиз для школы «Lingua Q»",
    company: "Школа английского «Lingua Q», Караганда",
    tags: ["JavaScript", "HTML/CSS"],
    area: "IT",
    hours: 8,
    budgetTenge: 18000,
    desc: "Ученики приходят по сарафанному радио. Нужен тест на уровень языка и форма заявки на пробный урок."
  },
  {
    title: "Ролики для соцсетей мебельной мастерской «Жиһаз К»",
    company: "Мастерская «Жиһаз К», Алматы",
    tags: ["Видеомонтаж", "Figma"],
    area: "Медиа",
    hours: 16,
    budgetTenge: 38000,
    desc: "Есть час отснятого материала о производстве. Нужны 4 коротких вертикальных ролика с титрами о ценах и сроках."
  },
  {
    title: "Дашборд цен на зерно для «Тұжер Агро»",
    company: "КФХ «Тұжер Агро», Костанай",
    tags: ["Python", "SQL", "Аналитика данных"],
    area: "Аналитика",
    hours: 20,
    budgetTenge: 50000,
    desc: "Цены биржи и заготовителей собраны в 5 файлах. Нужен скрипт сводки и простая страница с графиком."
  },
  {
    title: "Каталог мебели с калькулятором заказа",
    company: "Мастерская «Жиһаз К», Алматы",
    tags: ["JavaScript", "React", "HTML/CSS"],
    area: "IT",
    hours: 18,
    budgetTenge: 42000,
    desc: "Клиенты просят прайс в личку. Нужен каталог с фото и калькулятором: материал × размер → стоимость."
  }
];

const chipsBox = document.getElementById("skill-chips");
const matcherForm = document.getElementById("matcher");
const matcherReset = document.getElementById("matcher-reset");
const matchCount = document.getElementById("matcher-count");
const emptyBox = document.getElementById("matcher-empty");
const emptyHint = document.getElementById("matcher-empty-hint");
const loadingBox = document.getElementById("matcher-loading");
const listBox = document.getElementById("project-list");

const matcherState = {
  selected: new Set(),
  loadingTimer: null,
  projects: SEED_PROJECTS
};

const EMPTY_HINT_DEFAULT = "Например: SQL и Excel — покажем задачи с максимальным мэтчем.";

function matchLoadingTimerClear() {
  if (matcherState.loadingTimer !== null) {
    clearTimeout(matcherState.loadingTimer);
    matcherState.loadingTimer = null;
  }
}

function renderChips() {
  SKILLS.forEach((skill) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.textContent = skill;
    chip.setAttribute("aria-pressed", "false");
    chip.addEventListener("click", () => toggleSkill(chip, skill));
    chipsBox.append(chip);
  });
}

function toggleSkill(chip, skill) {
  if (matcherState.selected.has(skill)) {
    matcherState.selected.delete(skill);
    chip.setAttribute("aria-pressed", "false");
  } else {
    matcherState.selected.add(skill);
    chip.setAttribute("aria-pressed", "true");
  }
  matchCount.textContent = `Выбрано: ${matcherState.selected.size}`;
  showEmptyState();
}

function scoreProject(project) {
  if (matcherState.selected.size === 0) return 0;
  const matched = project.tags.filter((tag) => matcherState.selected.has(tag));
  const coverage = matched.length / matcherState.selected.size;
  const fit = matched.length / project.tags.length;
  return Math.round((0.6 * coverage + 0.4 * fit) * 100);
}

const formatTenge = (amount) => `${new Intl.NumberFormat("ru-RU").format(amount)} ₸`;

function matchedSkillPills(project) {
  return project.tags
    .map((tag) =>
      matcherState.selected.has(tag)
        ? `<span class="pill pill--hit">${tag}</span>`
        : `<span class="pill pill--miss">${tag}</span>`
    )
    .join("");
}

function whyMatched(project, score) {
  if (score === 0) {
    return "Совпадений по навыкам нет — задача показана для контекста, что запрашивает рынок.";
  }
  const list = project.tags.filter((tag) => matcherState.selected.has(tag)).join(", ");
  return `Совпало: ${list}. Остальное закрывается чек-листом приёмки заказчика.`;
}

function renderMatchResults() {
  const ranked = matcherState.projects
    .map((project) => ({ ...project, score: scoreProject(project) }))
    .sort((a, b) => b.score - a.score || b.budgetTenge - a.budgetTenge);

  listBox.innerHTML = "";
  ranked.forEach((project, index) => {
    const card = document.createElement("li");
    card.className = `project-card${index === 0 && project.score > 0 ? " project-card--top" : ""}`;
    card.style.animationDelay = `${index * 60}ms`;
    card.innerHTML = `
      <h3>${escapeHtml(project.title)}</h3>
      <div class="project-card__match"><span class="match-label">мэтч</span>${project.score}%</div>
      <p class="project-card__company">${escapeHtml(project.company)}</p>
      <p class="project-card__desc">${escapeHtml(project.desc)}</p>
      <div class="project-card__foot">
        <dl class="project-card__facts">
          <div><dt>объём</dt><dd>${project.hours} ч</dd></div>
          <div><dt>бюджет</dt><dd>${formatTenge(project.budgetTenge)}</dd></div>
          <div><dt>навыки</dt><dd class="match-badge">${project.tags.map(escapeHtml).join(" · ")}</dd></div>
        </dl>
      </div>
      <div class="match-why">${matchedSkillPills(project)}</div>
      <p class="match-why">${escapeHtml(whyMatched(project, project.score))}</p>
    `;
    listBox.append(card);
  });

  emptyBox.hidden = true;
  loadingBox.hidden = true;
  listBox.hidden = false;
}

function showEmptyState() {
  emptyBox.hidden = false;
  loadingBox.hidden = true;
  listBox.hidden = true;
}

function showLoadingState() {
  emptyBox.hidden = true;
  listBox.hidden = true;
  loadingBox.hidden = false;
}

async function loadMatchProjects() {
  try {
    const response = await fetch("/api/tasks?status=open", {
      headers: { Accept: "application/json" }
    });
    if (!response.ok) return;
    const data = await response.json();
    if (!Array.isArray(data.tasks) || data.tasks.length === 0) return;

    matcherState.projects = data.tasks.map((task) => ({
      title: task.title,
      company: task.company,
      tags: task.skills,
      area: task.area,
      hours: task.hours,
      budgetTenge: task.budget,
      desc: task.description
    }));
  } catch {
    /* оставляем встроенный набор */
  }
}

function bindMatchView() {
  matcherForm.addEventListener("submit", (event) => {
    event.preventDefault();
    matchLoadingTimerClear();
    if (matcherState.selected.size === 0) {
      emptyHint.textContent = "Сначала отметьте хотя бы один навык — иначе сравнивать не с чем.";
      showEmptyState();
      return;
    }
    emptyHint.textContent = EMPTY_HINT_DEFAULT;
    showLoadingState();
    /* Скелетон виден намеренно: в проде ответ мэтчинга занимает ~0.5–1 c */
    matcherState.loadingTimer = setTimeout(renderMatchResults, 700);
  });

  matcherReset.addEventListener("click", () => {
    matchLoadingTimerClear();
    matcherState.selected.clear();
    matchCount.textContent = "Выбрано: 0";
    chipsBox.querySelectorAll(".chip").forEach((chip) => chip.setAttribute("aria-pressed", "false"));
    emptyHint.textContent = EMPTY_HINT_DEFAULT;
    showEmptyState();
  });

  renderChips();
  emptyHint.textContent = EMPTY_HINT_DEFAULT;
  showEmptyState();
}

function enterMatchView() {
  if (!currentUser) {
    navigate("/login?next=%2Fmatch", { replace: true });
    return;
  }
  let userLine = byId("matcher-user");
  if (!userLine) {
    const lead = document.querySelector("#view-match .section__lead");
    userLine = document.createElement("p");
    userLine.id = "matcher-user";
    userLine.className = "matcher-user";
    userLine.textContent = `${currentUser.name} · ${currentUser.roleLabel}`;
    if (lead) lead.insertAdjacentElement("afterend", userLine);
    else byId("view-match").querySelector(".container").prepend(userLine);
  } else {
    userLine.textContent = `${currentUser.name} · ${currentUser.roleLabel}`;
  }
  loadMatchProjects();
}

/* ------------------------------------------------------------------ */
/* Кабинет (вид dashboard)                                              */
/* ------------------------------------------------------------------ */

const dashState = {
  activeTab: null,
  stats: null
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

function canManageTask(task) {
  return currentUser.role === "admin" || task.customerId === currentUser.id;
}

function renderDashHead() {
  const user = currentUser;
  byId("dash-name").textContent = user.name;
  byId("dash-role").textContent = ROLE_TEXT[user.role] || user.roleLabel || "";

  const actions = [];
  if (user.role === "consumer" || user.role === "admin") {
    actions.push('<button type="button" class="btn btn--primary" data-open-create>Создать задачу</button>');
  }
  actions.push('<button type="button" class="btn btn--secondary" data-open-password>Сменить пароль</button>');
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
  const stats = dashState.stats || {};
  const cards = [];

  if (currentUser.role === "admin") {
    cards.push(statCard("Пользователей", stats.users ?? 0, "все роли"));
    cards.push(statCard("Задач", stats.tasks ?? 0, `${stats.openTasks ?? 0} открыто`));
    cards.push(statCard("Откликов", stats.applications ?? 0, `${stats.pendingApplications ?? 0} ждут решения`));
    cards.push(statCard("В работе", stats.inProgressTasks ?? 0, "задач с исполнителем"));
  } else if (currentUser.role === "consumer") {
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
  const stats = dashState.stats || {};

  if (currentUser.role === "admin") {
    return [
      { id: "tasks", label: "Все задачи", count: stats.tasks },
      { id: "my-apps", label: "Мои отклики", count: stats.myApplications },
      { id: "users", label: "Пользователи", count: stats.users }
    ];
  }

  if (currentUser.role === "consumer") {
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

function renderDashTabs() {
  const tabs = tabsForRole();

  if (!dashState.activeTab || !tabs.some((tab) => tab.id === dashState.activeTab)) {
    dashState.activeTab = tabs[0] ? tabs[0].id : null;
  }

  byId("dash-tabs").innerHTML = tabs
    .map(
      (tab) => `
        <button type="button" class="dash-tab${tab.id === dashState.activeTab ? " is-active" : ""}"
                role="tab" aria-selected="${tab.id === dashState.activeTab}" data-tab="${tab.id}">
          ${escapeHtml(tab.label)}
          ${tab.count !== undefined ? `<span class="dash-tab__count">${Number(tab.count) || 0}</span>` : ""}
        </button>`
    )
    .join("");
}

async function refreshStats() {
  const data = await api("/api/stats");
  dashState.stats = data.stats;
  renderStats();
  renderDashTabs();
}

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
      ${options.create ? '<button type="button" class="btn btn--primary" data-open-create>Создать задачу</button>' : ""}
    </div>`;
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
          <span>${escapeHtml(applicationsLabel(task.applicationsCount))}</span>
        </span>
        <span class="task-card__skills">${skills}</span>
        ${mine ? `<span class="task-card__mine">Ваш отклик: ${applicationBadge(mine)}</span>` : ""}
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
          !manage && currentUser.role !== "consumer" && task.status === "open" && !mine
            ? '<button type="button" class="btn btn--primary btn--small" data-open-task="' + task.id + '">Откликнуться</button>'
            : ""
        }
      </div>
    </li>`;
}

async function loadTaskList(mode) {
  const params = new URLSearchParams();
  if (mode === "mine") params.set("mine", "1");
  if (currentUser.role === "user" && mode !== "mine") params.set("status", "open");

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
      ${mode === "mine" && currentUser.role !== "user" ? '<button type="button" class="btn btn--primary btn--small" data-open-create>Создать задачу</button>' : ""}
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
  const isSelf = user.id === currentUser.id;
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
  const tabs = tabsForRole();
  const tab = tabs.find((item) => item.id === tabId);
  if (!tab) return;

  dashState.activeTab = tab.id;
  renderDashTabs();
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
  if (dashState.activeTab) await switchTab(dashState.activeTab);
}

/* ------------------------------------------------------------------ */
/* Диалоги кабинета                                                     */
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
          : '<p class="dialog-empty">Пока никто не откликнулся. Пользователи увидят задачу в разделе «Доступные задачи».</p>'
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
      ${application.message ? `<p class="applicant-card__message">${escapeHtml(application.message)}</p>` : ""}
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
  if (currentUser.role === "consumer" || task.customerId === currentUser.id) return "";

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
    return '<p class="dialog-note">Задача уже не принимает отклики.</p>';
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
  const isOwner = task.customerId === currentUser.id;
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
      ${task.assigneeName ? `<div><dt>исполнитель</dt><dd>${escapeHtml(task.assigneeName)}</dd></div>` : ""}
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
    : "<p class=\"dialog-empty\">Пока никто не откликнулся на эту задачу.</p>";

  openDialog("apps-dialog");
}

/* ------------------------------------------------------------------ */
/* Действия кабинета                                                    */
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
  if (!company.value) company.value = currentUser.company || currentUser.name;
  openDialog("create-dialog");
}

function openPasswordDialog() {
  const form = byId("password-form");
  form.reset();
  hideFormMessage(byId("password-message"));
  openDialog("password-dialog");
}

/* ------------------------------------------------------------------ */
/* Связывание событий кабинета                                          */
/* ------------------------------------------------------------------ */

function bindDashboardView() {
  byId("create-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const message = byId("create-message");
    hideFormMessage(message);

    if (!form.reportValidity()) return;

    setBusy(form, true, "Публикуем…");
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
      field("company").value = currentUser.company || currentUser.name;
      closeDialog("create-dialog");
      showToast("Задача опубликована.");
      await refreshStats();
      await switchTab(currentUser.role === "admin" ? "tasks" : "my-tasks");
    } catch (error) {
      setFormMessage(message, error.message);
    } finally {
      setBusy(form, false);
    }
  });

  byId("password-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const message = byId("password-message");
    hideFormMessage(message);

    if (!form.reportValidity()) return;

    setBusy(form, true, "Сохраняем…");
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
      setBusy(form, false);
    }
  });

  byId("task-dialog-body").addEventListener("submit", async (event) => {
    const form = event.target.closest("#apply-form");
    if (!form) return;
    event.preventDefault();

    const taskId = Number(form.dataset.taskId);
    const message = byId("apply-message-error");
    hideFormMessage(message);

    setBusy(form, true, "Отправляем…");
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
      setBusy(form, false);
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
      const fresh = document.querySelector(`[data-role-user="${userId}"]`);
      if (fresh) fresh.disabled = false;
    } catch (error) {
      select.value = previousRole;
      select.disabled = false;
      showToast(error.message, "error");
    }
  });

  document.addEventListener("click", async (event) => {
    const closeButton = event.target.closest("[data-close-dialog]");
    if (closeButton) {
      event.preventDefault();
      closeDialog(closeButton.dataset.closeDialog);
      return;
    }

    const tab = event.target.closest("[data-tab]");
    if (tab && tab.closest("#dash-tabs")) {
      event.preventDefault();
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
        await setTaskStatus(Number(taskStatus.dataset.taskId), taskStatus.dataset.taskStatus);
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
    if (taskButton && currentUser) {
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

function enterDashboardView() {
  if (!currentUser) {
    navigate("/login?next=%2Fdashboard", { replace: true });
    return;
  }
  void (async () => {
    renderDashHead();
    try {
      await refreshStats();
      renderDashTabs();
      await switchTab(dashState.activeTab);
    } catch (error) {
      byId("dash-role").textContent = "Не удалось загрузить профиль";
      renderPanelError(error.message);
    }
  })();
}

/* ------------------------------------------------------------------ */
/* Запуск                                                               */
/* ------------------------------------------------------------------ */

async function boot() {
  bindNavigation();
  bindLoginView();
  bindMatchView();
  bindDashboardView();

  try {
    const data = await api("/api/me");
    currentUser = data.user;
  } catch {
    currentUser = null;
  }

  renderRoute();
  apiUserCache = null;
}

boot();
