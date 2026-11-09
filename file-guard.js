"use strict";

/* Если страницу открыли как файл (file://), вход, задачи и кабинет работать не будут:
   им нужен сервер. Показываем понятное сообщение вместо молчаливой поломки. */
(function () {
  if (location.protocol !== "file:") return;
  var bar = document.createElement("div");
  bar.setAttribute("role", "alert");
  bar.style.cssText =
    "position:sticky;top:0;z-index:9999;padding:12px 16px;background:#17130e;color:#f6f0e5;" +
    "font:500 15px/1.4 system-ui,sans-serif;text-align:center";
  bar.textContent =
    "Сайт открыт как файл. Вход, подбор и кабинет работают только через сервер: " +
    "откройте Paradox по ссылке (адрес вида http://localhost:3000 или адрес хостинга).";
  document.body.insertBefore(bar, document.body.firstChild);
})();
