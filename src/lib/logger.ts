// src/lib/logger.ts
// Централизованная система логирования с поддержкой уровней и контекста

export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
}

export interface LogContext {
  userId?: number;
  chatId?: number;
  action?: string;
  error?: Error;
  [key: string]: any;
}

class Logger {
  private level: LogLevel;
  private isDevelopment: boolean;

  constructor() {
    this.level = this.getLogLevel();
    this.isDevelopment = process.env.NODE_ENV !== 'production';
  }

  private getLogLevel(): LogLevel {
    const envLevel = process.env.LOG_LEVEL?.toUpperCase();
    switch (envLevel) {
      case 'ERROR': return LogLevel.ERROR;
      case 'WARN': return LogLevel.WARN;
      case 'INFO': return LogLevel.INFO;
      case 'DEBUG': return LogLevel.DEBUG;
      default: return this.isDevelopment ? LogLevel.DEBUG : LogLevel.INFO;
    }
  }

  private formatMessage(level: string, message: string, context?: LogContext): string {
    const timestamp = new Date().toISOString();
    const contextStr = context ? ` ${JSON.stringify(context)}` : '';
    return `[${timestamp}] [${level}] ${message}${contextStr}`;
  }

  private shouldLog(level: LogLevel): boolean {
    return level <= this.level;
  }

  error(message: string, context?: LogContext): void {
    if (!this.shouldLog(LogLevel.ERROR)) return;
    
    const formatted = this.formatMessage('ERROR', message, context);
    console.error(formatted);
    
    if (context?.error) {
      console.error('Stack trace:', context.error.stack);
    }
  }

  warn(message: string, context?: LogContext): void {
    if (!this.shouldLog(LogLevel.WARN)) return;
    console.warn(this.formatMessage('WARN', message, context));
  }

  info(message: string, context?: LogContext): void {
    if (!this.shouldLog(LogLevel.INFO)) return;
    console.log(this.formatMessage('INFO', message, context));
  }

  debug(message: string, context?: LogContext): void {
    if (!this.shouldLog(LogLevel.DEBUG)) return;
    console.log(this.formatMessage('DEBUG', message, context));
  }

  // Специальные методы для бота
  botAction(action: string, chatId: number, userId?: number, details?: any): void {
    this.info(`Bot action: ${action}`, {
      action,
      chatId,
      userId,
      ...details
    });
  }

  dbQuery(query: string, duration?: number, error?: Error): void {
    if (error) {
      this.error('Database query failed', {
        action: 'db_query',
        query: query.substring(0, 100) + '...',
        error
      });
    } else {
      this.debug('Database query executed', {
        action: 'db_query',
        query: query.substring(0, 100) + '...',
        duration: duration ? `${duration}ms` : undefined
      });
    }
  }

  userAction(action: string, userId: number, chatId: number, details?: any): void {
    this.info(`User action: ${action}`, {
      action,
      userId,
      chatId,
      ...details
    });
  }
}

export const logger = new Logger();
