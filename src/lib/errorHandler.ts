// src/lib/errorHandler.ts
// Централизованная обработка ошибок с уведомлениями администратора

import TelegramBot from "node-telegram-bot-api";
import { logger } from "./logger.js";

export class ErrorHandler {
  private static bot: TelegramBot | null = null;
  private static adminChatId: string | null = null;
  private static errorCounts = new Map<string, number>();
  private static readonly MAX_ERRORS_PER_MINUTE = 10;

  static initialize(bot: TelegramBot, adminChatId?: string): void {
    this.bot = bot;
    this.adminChatId = adminChatId || process.env.ADMIN_CHAT_ID || null;
  }

  static async handleBotError(error: Error, context: string, userId?: number, chatId?: number): Promise<void> {
    const errorKey = `${context}:${error.message}`;
    const now = Date.now();
    
    // Rate limiting для ошибок
    const errorCount = this.errorCounts.get(errorKey) || 0;
    if (errorCount > this.MAX_ERRORS_PER_MINUTE) {
      logger.warn(`Error rate limit exceeded for ${context}`, {
        action: 'error_rate_limit',
        context,
        errorKey,
        count: errorCount
      });
      return;
    }

    this.errorCounts.set(errorKey, errorCount + 1);
    
    // Сбрасываем счетчики каждую минуту
    setTimeout(() => {
      this.errorCounts.delete(errorKey);
    }, 60000);

    logger.error(`Bot error in ${context}`, {
      action: 'bot_error',
      context,
      userId,
      chatId,
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name
      }
    });

    // Уведомляем администратора о критических ошибках
    if (this.shouldNotifyAdmin(error, context)) {
      await this.notifyAdmin(error, context, userId, chatId);
    }
  }

  static async handleDatabaseError(error: Error, query: string, context: string): Promise<void> {
    logger.error(`Database error in ${context}`, {
      action: 'database_error',
      context,
      query: query.substring(0, 100) + '...',
      error: error
    });

    // Уведомляем администратора о критических ошибках БД
    if (this.shouldNotifyAdmin(error, context)) {
      await this.notifyAdmin(error, context, undefined, undefined, query);
    }
  }

  static async handleUserError(error: Error, userId: number, chatId: number, action: string): Promise<void> {
    logger.warn(`User error in ${action}`, {
      action: 'user_error',
      userAction: action,
      userId,
      chatId,
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name
      }
    });
  }

  private static shouldNotifyAdmin(error: Error, context: string): boolean {
    // Критические ошибки, о которых нужно уведомлять
    const criticalPatterns = [
      'database',
      'connection',
      'fatal',
      'bootstrap',
      'migration'
    ];

    return criticalPatterns.some(pattern => 
      context.toLowerCase().includes(pattern) || 
      error.message.toLowerCase().includes(pattern)
    );
  }

  private static async notifyAdmin(
    error: Error, 
    context: string, 
    userId?: number, 
    chatId?: number,
    query?: string
  ): Promise<void> {
    if (!this.bot || !this.adminChatId) return;

    try {
      const message = [
        `🚨 <b>Bot Error Alert</b>`,
        ``,
        `<b>Context:</b> ${context}`,
        `<b>Error:</b> ${error.message}`,
        userId ? `<b>User ID:</b> ${userId}` : '',
        chatId ? `<b>Chat ID:</b> ${chatId}` : '',
        query ? `<b>Query:</b> <code>${query.substring(0, 200)}...</code>` : '',
        ``,
        `<b>Time:</b> ${new Date().toISOString()}`,
        ``,
        `<b>Stack:</b>`,
        `<code>${error.stack?.substring(0, 1000)}...</code>`
      ].filter(Boolean).join('\n');

      await this.bot.sendMessage(this.adminChatId, message, {
        parse_mode: 'HTML',
        disable_web_page_preview: true
      });
    } catch (notifyError) {
      logger.error('Failed to notify admin', {
        action: 'admin_notification_failed',
        originalError: error.message,
        notifyError: notifyError
      });
    }
  }

  // Graceful shutdown
  static async gracefulShutdown(signal: string): Promise<void> {
    logger.info(`Received ${signal}, starting graceful shutdown`);
    
    try {
      // Здесь можно добавить очистку ресурсов
      // Например, закрытие соединений с БД, остановка бота и т.д.
      
      logger.info('Graceful shutdown completed');
      process.exit(0);
    } catch (error) {
      logger.error('Error during graceful shutdown', {
        action: 'graceful_shutdown_error',
        error: error as Error
      });
      process.exit(1);
    }
  }
}

// Обработчики сигналов для graceful shutdown
process.on('SIGTERM', () => ErrorHandler.gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => ErrorHandler.gracefulShutdown('SIGINT'));
process.on('SIGUSR2', () => ErrorHandler.gracefulShutdown('SIGUSR2')); // nodemon restart
