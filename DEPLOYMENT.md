# 🚀 Руководство по развертыванию Telegram Dating Bot

## 📋 Содержание
- [Быстрый старт](#быстрый-старт)
- [Установка зависимостей](#установка-зависимостей)
- [Настройка базы данных](#настройка-базы-данных)
- [Восстановление бэкапа](#восстановление-бэкапа)
- [Запуск приложения](#запуск-приложения)
- [Управление бэкапами](#управление-бэкапами)
- [Troubleshooting](#troubleshooting)

## 🚀 Быстрый старт

### 1. Клонирование репозитория
```bash
git clone <your-repo-url>
cd tg-dating-bot
git checkout feature/ui-improvements
```

### 2. Установка зависимостей
```bash
npm install
```

### 3. Настройка окружения
```bash
cp .env.example .env
# Отредактируйте .env файл с вашими настройками
```

### 4. Настройка базы данных
```bash
# Создание пользователя и базы данных
sudo -u postgres psql
CREATE USER tguser WITH PASSWORD 'tgpass';
CREATE DATABASE tgdb OWNER tguser;
GRANT ALL PRIVILEGES ON DATABASE tgdb TO tguser;
\q
```

### 5. Восстановление данных
```bash
# Восстановление из бэкапа
PGPASSWORD=tgpass psql -h localhost -U tguser -d tgdb < backups/backup_20250915_193935.sql
```

### 6. Запуск
```bash
npm start
```

## 📦 Установка зависимостей

### Системные зависимости
```bash
# Ubuntu/Debian
sudo apt update
sudo apt install postgresql postgresql-contrib nodejs npm

# CentOS/RHEL
sudo yum install postgresql postgresql-server nodejs npm

# macOS
brew install postgresql node
```

### Node.js зависимости
```bash
npm install
# или
yarn install
```

## 🗄️ Настройка базы данных

### Создание базы данных
```bash
# Подключение к PostgreSQL
sudo -u postgres psql

# Создание пользователя
CREATE USER tguser WITH PASSWORD 'tgpass';

# Создание базы данных
CREATE DATABASE tgdb OWNER tguser;

# Предоставление прав
GRANT ALL PRIVILEGES ON DATABASE tgdb TO tguser;

# Выход
\q
```

### Настройка подключения
```bash
# Редактирование .env файла
nano .env
```

Содержимое .env:
```env
DATABASE_URL=postgres://tguser:tgpass@localhost:5432/tgdb
POSTGRES_DB=tgdb
POSTGRES_USER=tguser
POSTGRES_PASSWORD=tgpass
BOT_TOKEN=your_telegram_bot_token
```

## 💾 Восстановление бэкапа

### Автоматическое восстановление
```bash
# Восстановление из последнего бэкапа
PGPASSWORD=tgpass psql -h localhost -U tguser -d tgdb < backups/backup_20250915_193935.sql
```

### Пошаговое восстановление
```bash
# 1. Проверить доступные бэкапы
ls -la backups/

# 2. Выбрать нужный бэкап
# 3. Восстановить данные
PGPASSWORD=tgpass psql -h localhost -U tguser -d tgdb < backups/backup_YYYYMMDD_HHMMSS.sql

# 4. Проверить восстановление
PGPASSWORD=tgpass psql -h localhost -U tguser -d tgdb -c "SELECT COUNT(*) FROM users;"
```

### Создание новой базы с нуля
```bash
# 1. Удалить существующую базу (ОСТОРОЖНО!)
PGPASSWORD=tgpass psql -h localhost -U tguser -c "DROP DATABASE IF EXISTS tgdb;"

# 2. Создать новую базу
PGPASSWORD=tgpass psql -h localhost -U tguser -c "CREATE DATABASE tgdb;"

# 3. Восстановить данные
PGPASSWORD=tgpass psql -h localhost -U tguser -d tgdb < backups/backup_20250915_193935.sql
```

## 🚀 Запуск приложения

### Разработка
```bash
# Запуск в режиме разработки
npm run dev
# или
npm start
```

### Продакшн
```bash
# Сборка проекта
npm run build

# Запуск в продакшне
npm run start:prod
```

### С помощью PM2
```bash
# Установка PM2
npm install -g pm2

# Запуск
pm2 start ecosystem.config.js

# Мониторинг
pm2 monit

# Логи
pm2 logs
```

## 💾 Управление бэкапами

### Создание бэкапа
```bash
# Создание нового бэкапа
PGPASSWORD=tgpass pg_dump -h localhost -U tguser -d tgdb > backups/backup_$(date +%Y%m%d_%H%M%S).sql

# Сжатый бэкап
PGPASSWORD=tgpass pg_dump -h localhost -U tguser -d tgdb | gzip > backups/backup_$(date +%Y%m%d_%H%M%S).sql.gz
```

### Автоматические бэкапы
```bash
# Создание скрипта для автоматических бэкапов
nano backup.sh
```

Содержимое backup.sh:
```bash
#!/bin/bash
BACKUP_DIR="/path/to/tg-dating-bot/backups"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/backup_$DATE.sql"

# Создание бэкапа
PGPASSWORD=tgpass pg_dump -h localhost -U tguser -d tgdb > $BACKUP_FILE

# Сжатие
gzip $BACKUP_FILE

# Удаление старых бэкапов (старше 7 дней)
find $BACKUP_DIR -name "backup_*.sql.gz" -mtime +7 -delete

echo "Backup created: $BACKUP_FILE.gz"
```

```bash
# Сделать скрипт исполняемым
chmod +x backup.sh

# Добавить в crontab (ежедневно в 2:00)
crontab -e
# Добавить строку:
# 0 2 * * * /path/to/tg-dating-bot/backup.sh
```

### Восстановление из бэкапа
```bash
# Обычный бэкап
PGPASSWORD=tgpass psql -h localhost -U tguser -d tgdb < backups/backup_20250915_193935.sql

# Сжатый бэкап
gunzip -c backups/backup_20250915_193935.sql.gz | PGPASSWORD=tgpass psql -h localhost -U tguser -d tgdb
```

## 🔧 Troubleshooting

### Проблемы с базой данных
```bash
# Проверка подключения к базе
PGPASSWORD=tgpass psql -h localhost -U tguser -d tgdb -c "SELECT version();"

# Проверка таблиц
PGPASSWORD=tgpass psql -h localhost -U tguser -d tgdb -c "\dt"

# Проверка пользователей
PGPASSWORD=tgpass psql -h localhost -U tguser -d tgdb -c "SELECT COUNT(*) FROM users;"
```

### Проблемы с приложением
```bash
# Проверка логов
npm run logs

# Перезапуск
npm restart

# Проверка процессов
ps aux | grep node
```

### Проблемы с правами доступа
```bash
# Исправление прав на папку backups
chmod 755 backups/
chmod 644 backups/*.sql

# Исправление прав на .env
chmod 600 .env
```

## 📁 Структура проекта

```
tg-dating-bot/
├── src/                    # Исходный код
│   ├── bot/               # Логика бота
│   ├── router/            # Роутеры
│   ├── ui/                # UI компоненты
│   └── index.ts           # Точка входа
├── backups/               # Бэкапы базы данных
│   └── backup_*.sql       # Файлы бэкапов
├── .env                   # Переменные окружения
├── .gitignore            # Исключения для Git
├── package.json          # Зависимости
└── README.md             # Документация
```

## 🔐 Безопасность

### Рекомендации по безопасности
1. **Никогда не коммитьте .env файлы**
2. **Используйте сильные пароли для базы данных**
3. **Ограничьте доступ к папке backups**
4. **Регулярно создавайте бэкапы**
5. **Мониторьте логи приложения**

### Настройка файрвола
```bash
# Ubuntu/Debian
sudo ufw allow 5432/tcp  # PostgreSQL
sudo ufw enable

# CentOS/RHEL
sudo firewall-cmd --permanent --add-port=5432/tcp
sudo firewall-cmd --reload
```

## 📞 Поддержка

При возникновении проблем:
1. Проверьте логи приложения
2. Убедитесь, что база данных запущена
3. Проверьте настройки в .env файле
4. Создайте новый бэкап и попробуйте восстановить

---

**Последнее обновление:** 15 сентября 2024
**Версия:** feature/ui-improvements
