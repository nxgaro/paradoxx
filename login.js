"use strict";

const loginForm = document.getElementById("login-form");
const registerForm = document.getElementById("register-form");
const loginMessage = document.getElementById("form-message");
const registerMessage = document.getElementById("register-message");
const cardTitle = document.getElementById("auth-card-title");
const tabs = Array.from(document.querySelectorAll(".auth-tab"));

function showMessage(element, message, kind = "error") {
  if (!element) return;
  element.textContent = message;
  element.dataset.kind = kind;
  element.hidden = false;
}

function hideMessage(element) {
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

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: options.body ? { "Content-Type": "application/json" } : {},
    ...options
  });
  let data = {};
  try {
    data = await response.json();
  } catch {
    /* empty body */
  }
  if (!response.ok) {
    throw new Error(data.error || "Не удалось выполнить запрос.");
  }
  return data;
}

function activateTab(tabName) {
  const isLogin = tabName === "login";

  tabs.forEach((tab) => {
    const active = tab.dataset.tab === tabName;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
  });

  loginForm.hidden = !isLogin;
  registerForm.hidden = isLogin;
  cardTitle.textContent = isLogin ? "Войти в кабинет" : "Создать аккаунт";
  hideMessage(loginMessage);
  hideMessage(registerMessage);
}

function safeNextPath(value) {
  if (typeof value !== "string") return "dashboard.html";
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  if (/^[a-z0-9-]+\.html$/i.test(value)) return value;
  return "dashboard.html";
}

function redirectAfterAuth() {
  const next = new URLSearchParams(window.location.search).get("next");
  window.location.replace(safeNextPath(next));
}

tabs.forEach((tab) => {
  tab.addEventListener("click", () => activateTab(tab.dataset.tab));
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  hideMessage(loginMessage);

  const email = loginForm.elements.namedItem("email").value.trim();
  const password = loginForm.elements.namedItem("password").value;

  if (!email || !password) {
    showMessage(loginMessage, "Введите email и пароль.");
    return;
  }

  setBusy(loginForm, true, "Входим…");
  try {
    await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
    redirectAfterAuth();
  } catch (error) {
    showMessage(loginMessage, error.message);
    setBusy(loginForm, false);
  }
});

registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  hideMessage(registerMessage);

  const field = (name) => registerForm.elements.namedItem(name);
  const name = field("name").value.trim();
  const email = field("email").value.trim();
  const company = field("company").value.trim();
  const password = field("password").value;
  const password2 = field("password2").value;

  if (name.length < 2) {
    showMessage(registerMessage, "Укажите имя (минимум 2 символа).");
    return;
  }
  if (!email) {
    showMessage(registerMessage, "Укажите email.");
    return;
  }
  if (password.length < 8) {
    showMessage(registerMessage, "Пароль должен быть не короче 8 символов.");
    return;
  }
  if (password !== password2) {
    showMessage(registerMessage, "Пароли не совпадают.");
    return;
  }

  setBusy(registerForm, true, "Создаём аккаунт…");
  try {
    await api("/api/register", {
      method: "POST",
      body: JSON.stringify({ name, email, company, password })
    });
    redirectAfterAuth();
  } catch (error) {
    showMessage(registerMessage, error.message);
    setBusy(registerForm, false);
  }
});

/* Если уже вошли — сразу в кабинет (или туда, куда просил ?next=). */
(async () => {
  try {
    const response = await fetch("/api/me", { credentials: "same-origin" });
    const data = await response.json();
    if (data.user) redirectAfterAuth();
  } catch {
    /* остаёмся на странице входа */
  }
})();
