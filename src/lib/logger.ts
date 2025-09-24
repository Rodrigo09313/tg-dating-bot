// src/lib/logger.ts
type Meta = Record<string, unknown>;

function out(level: 'debug'|'info'|'warn'|'error', msg: string, meta?: Meta) {
  const rec = { level, msg, ts: new Date().toISOString(), ...(meta || {}) };
  // Можно заменить на pino/winston позже
  if (level === 'error')      console.error(rec);
  else if (level === 'warn')  console.warn(rec);
  else if (level === 'debug') console.debug(rec);
  else                        console.log(rec);
}

export const logger = {
  debug: (msg: string, meta?: Meta) => out('debug', msg, meta),
  info:  (msg: string, meta?: Meta) => out('info',  msg, meta),
  warn:  (msg: string, meta?: Meta) => out('warn',  msg, meta),
  error: (msg: string, meta?: Meta) => out('error', msg, meta),

  // Совместимость с текущими вызовами
  userAction: (action: string, meta?: Meta) =>
    out('info', 'user_action', { action, ...(meta || {}) }),
};
