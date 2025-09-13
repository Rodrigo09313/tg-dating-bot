# Настройка tg-dating-bot

## Переменные окружения

Создайте файл `.env` в корне проекта со следующими переменными:

```env
# Bot Configuration
BOT_TOKEN=your_bot_token_here
ADMIN_CHAT_ID=your_admin_chat_id_here

# Database Configuration
DATABASE_URL=postgres://tguser:tgpass@localhost:5432/tgdb
DB_HOST=localhost
DB_PORT=5432
POSTGRES_USER=tguser
POSTGRES_PASSWORD=tgpass
POSTGRES_DB=tgdb

# Geocoding Configuration
GEOCODER_PROVIDER=yandex
GEOCODER_EMAIL=your_email@example.com
YANDEX_GEOCODER_KEY=your_yandex_geocoder_key
YANDEX_ALLOW_STORE=false

# Bot Settings
BROWSE_RADIUS_KM=50
SCREEN_TTL_MS=300000

# Logging Configuration
LOG_LEVEL=INFO
NODE_ENV=development
```

## Запуск

1. Установите зависимости:
```bash
npm install
```

2. Запустите базу данных:
```bash
docker-compose up -d
```

3. Запустите миграции:
```bash
npm run db:migrate
```

4. Запустите бота:
```bash
npm run dev
```

## Новые возможности

### Система логирования
- Централизованное логирование с уровнями (ERROR, WARN, INFO, DEBUG)
- Контекстная информация для каждого лога
- Специальные методы для действий бота и пользователей

### Обработка ошибок
- Централизованная обработка ошибок
- Уведомления администратора о критических ошибках
- Graceful shutdown при получении сигналов
- Retry логика для bootstrap

### Новый функционал
- **Избранное**: управление списком избранных контактов
- **Запросы на контакты**: отправка и обработка запросов
- **Система жалоб**: возможность пожаловаться на пользователей
- **Чат-рулетка**: анонимный чат с ближайшим пользователем

## Мониторинг

Логи теперь содержат структурированную информацию:
- Время события
- Уровень логирования
- Контекст (пользователь, действие, ошибка)
- Дополнительные метаданные

Для продакшена рекомендуется настроить сбор логов в централизованную систему (ELK, Grafana, etc.).
