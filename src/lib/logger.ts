// src/lib/logger.ts
type Meta = Record<string, unknown>;
type Level = 'debug' | 'info' | 'warn' | 'error';

// Единый вывод (сейчас в консоль, позже легко заменить на pino)
function out(level: Level, msg: string, meta?: Meta) {
  const rec = { level, msg, ts: new Date().toISOString(), ...(meta || {}) };
  if (level === 'error')      console.error(rec);
  else if (level === 'warn')  console.warn(rec);
  else if (level === 'debug') console.debug(rec);
  else                        console.log(rec);
}

// Вспомогалка: поддержать 2 формы аргументов — ("msg", meta) ИЛИ (meta, "msg")
function normalizeArgs(a: unknown, b?: unknown): { msg: string; meta?: Meta } {
  if (typeof a === 'string') {
    return { msg: a, meta: (b as Meta) || undefined };
  }
  return { msg: (b as string) || '', meta: (a as Meta) || undefined };
}

// Объявляем перегрузки для каждого уровня
type LogFn = {
  (msg: string, meta?: Meta): void;      // стиль "сначала msg, потом meta"
  (meta: Meta, msg?: string): void;      // стиль "сначала meta, потом msg" (как у pino)
};

const makeLog = (level: Level): LogFn => {
  const fn = ((a: unknown, b?: unknown) => {
    const { msg, meta } = normalizeArgs(a, b);
    out(level, msg, meta);
  }) as LogFn;
  return fn;
};

export const logger = {
  debug: makeLog('debug'),
  info:  makeLog('info'),
  warn:  makeLog('warn'),
  error: makeLog('error'),

  // Удобные хелперы (единый формат событий)
  userAction(action: string, chatId?: number, extra?: Meta) {
    out('info', 'user_action', { action, chatId, ...(extra || {}) });
  },

  dbQuery(meta: { sql?: string; params?: unknown; ms?: number; action?: string } = {}) {
    const { sql, params, ms, action } = meta;
    out('debug', 'db_query', { action: action || 'db_query', sql, params, ms });
  },
};
