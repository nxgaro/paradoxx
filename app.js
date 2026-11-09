"use strict";

/* Появление секций при скролле — один входной паттерн на всю страницу.
   Сам подбор задачи живёт на отдельной странице /match (match.js). */
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add("in-view");
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.15 });

document.querySelectorAll(".reveal").forEach((el) => revealObserver.observe(el));
