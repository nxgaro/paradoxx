"use strict";

/* Обновляет ссылку в шапке лендинга: «Войти» / «Кабинет». */
(async () => {
  const link = document.getElementById("auth-link");
  if (!link) return;

  try {
    const response = await fetch("/api/me", {
      headers: { Accept: "application/json" },
      credentials: "same-origin"
    });
    if (!response.ok) return;
    const data = await response.json();

    if (data.user) {
      link.textContent = "Кабинет";
      link.href = "dashboard.html";
      link.classList.add("site-nav__auth--active");
      link.title = `${data.user.name} · ${data.user.roleLabel}`;
    }
  } catch {
    /* Если API недоступен (например, файл открыт напрямую), оставляем «Войти». */
  }
})();
