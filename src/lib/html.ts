// src/lib/html.ts
// Простейшее экранирование HTML-тегов для parse_mode="HTML"
// Комменты на русском для новичков:
// - Telegram в HTML-режиме может интерпретировать специальные символы (<, >, &),
//   поэтому мы заменяем их на HTML-сущности, чтобы текст показывался безопасно.
export function esc(s: string | null | undefined): string {
  const x = (s ?? "").toString();
  return x
    .replace(/&/g, "&amp;")  // меняем & на &amp; (иначе поломает остальные замены)
    .replace(/</g, "&lt;")   // защищаем <
    .replace(/>/g, "&gt;");  // защищаем >
}
