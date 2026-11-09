"use strict";

/* Подбор доступен только вошедшим. Сервер уже перенаправит на /login, это страховка. */
(async () => {
  try {
    const response = await fetch("/api/me", { credentials: "same-origin" });
    const data = await response.json();
    if (!data.user) {
      window.location.replace("login.html?next=match.html");
      return;
    }
    const user = data.user;
    const lead = document.querySelector(".section__lead");
    if (lead) {
      const who = document.createElement("p");
      who.className = "matcher-user";
      who.textContent = `${user.name} · ${user.roleLabel}`;
      lead.append(who);
    }
  } catch {
    window.location.replace("login.html?next=match.html");
  }
})();

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

const selectedSkills = new Set();
let loadingTimer = null;
let allProjects = SEED_PROJECTS;

/* Открытые задачи берём из БД, чтобы подбор показывал актуальное.
   Если API недоступен, остаётся встроенный демо-набор. */
async function loadProjectsFromApi() {
  try {
    const response = await fetch("/api/tasks?status=open", {
      headers: { Accept: "application/json" }
    });
    if (!response.ok) return;
    const data = await response.json();
    if (!Array.isArray(data.tasks) || data.tasks.length === 0) return;

    allProjects = data.tasks.map((task) => ({
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

const EMPTY_HINT_DEFAULT = "Например: SQL и Excel — покажем задачи с максимальным мэтчем.";

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
  if (selectedSkills.has(skill)) {
    selectedSkills.delete(skill);
    chip.setAttribute("aria-pressed", "false");
  } else {
    selectedSkills.add(skill);
    chip.setAttribute("aria-pressed", "true");
  }
  matchCount.textContent = `Выбрано: ${selectedSkills.size}`;
  showEmptyState();
}

function scoreProject(project) {
  if (selectedSkills.size === 0) return 0;
  const matched = project.tags.filter((tag) => selectedSkills.has(tag));
  const coverage = matched.length / selectedSkills.size;
  const fit = matched.length / project.tags.length;
  return Math.round((0.6 * coverage + 0.4 * fit) * 100);
}

const formatTenge = (amount) =>
  `${new Intl.NumberFormat("ru-RU").format(amount)} ₸`;

function matchedSkillPills(project) {
  return project.tags.map((tag) =>
    selectedSkills.has(tag)
      ? `<span class="pill pill--hit">${tag}</span>`
      : `<span class="pill pill--miss">${tag}</span>`
  ).join("");
}

function whyMatched(project, score) {
  if (score === 0) {
    return "Совпадений по навыкам нет — задача показана для контекста, что запрашивает рынок.";
  }
  const list = project.tags.filter((tag) => selectedSkills.has(tag)).join(", ");
  return `Совпало: ${list}. Остальное закрывается чек-листом приёмки заказчика.`;
}

function renderResults() {
  const ranked = allProjects
    .map((project) => ({ ...project, score: scoreProject(project) }))
    .sort((a, b) => b.score - a.score || b.budgetTenge - a.budgetTenge);

  listBox.innerHTML = "";
  ranked.forEach((project, index) => {
    const card = document.createElement("li");
    card.className = `project-card${index === 0 && project.score > 0 ? " project-card--top" : ""}`;
    card.style.animationDelay = `${index * 60}ms`;
    card.innerHTML = `
      <h3>${project.title}</h3>
      <div class="project-card__match"><span class="match-label">мэтч</span>${project.score}%</div>
      <p class="project-card__company">${project.company}</p>
      <p class="project-card__desc">${project.desc}</p>
      <div class="project-card__foot">
        <dl class="project-card__facts">
          <div><dt>объём</dt><dd>${project.hours} ч</dd></div>
          <div><dt>бюджет</dt><dd>${formatTenge(project.budgetTenge)}</dd></div>
          <div><dt>навыки</dt><dd class="match-badge">${project.tags.join(" · ")}</dd></div>
        </dl>
      </div>
      <div class="match-why">${matchedSkillPills(project)}</div>
      <p class="match-why">${whyMatched(project, project.score)}</p>
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

function clearLoadingTimer() {
  if (loadingTimer !== null) {
    clearTimeout(loadingTimer);
    loadingTimer = null;
  }
}

matcherForm.addEventListener("submit", (event) => {
  event.preventDefault();
  clearLoadingTimer();
  if (selectedSkills.size === 0) {
    emptyHint.textContent = "Сначала отметьте хотя бы один навык — иначе сравнивать не с чем.";
    showEmptyState();
    return;
  }
  emptyHint.textContent = EMPTY_HINT_DEFAULT;
  showLoadingState();
  // Скелетон виден намеренно: в проде ответ мэтчинга server-side занимает ~0.5–1 c
  loadingTimer = setTimeout(renderResults, 700);
});

matcherReset.addEventListener("click", () => {
  clearLoadingTimer();
  selectedSkills.clear();
  matchCount.textContent = "Выбрано: 0";
  chipsBox.querySelectorAll(".chip").forEach((chip) => chip.setAttribute("aria-pressed", "false"));
  emptyHint.textContent = EMPTY_HINT_DEFAULT;
  showEmptyState();
});

renderChips();
emptyHint.textContent = EMPTY_HINT_DEFAULT;
showEmptyState();
loadProjectsFromApi();
