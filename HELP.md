# перейти в проект
cd ~/project/tg-dating-vip
# проверить доступ и ремоут
git remote -v
# origin git@github.com:Rodrigo09313/tg-dating-vip.git (fetch/push)

Открыть в Cursor
cd ~/project/tg-dating-bot
cursor .
# из WSL (внутри папки проекта)
cursor .

# Запуск базы данных
docker compose up -d db

# Установка зависимостей
npm install

# Разработка
npm run dev

# Продакшн
npm run build && npm start

Ежедневная работа (git)
# Клонируем
git clone https://github.com/<your_user>/tg-dating-bot.git
cd tg-dating-bot

# Создаём .env на основе примера
cp .env.example .env
# Открой и заполни TELEGRAM_TOKEN и YANDEX_GEOCODER_KEY
# nano .env  (или любым редактором)

# Поднимаем БД (создастся с initdb-скриптами)
docker compose up -d db
docker compose logs -f db | sed -n '1,120p'  # убедиться, что ready

# Устанавливаем зависимости и стартуем бота
npm i
npm run dev

git add .
git commit -m "Рабочее меню и регистрация новая"
git push

# 1) посмотреть изменения

git status

# 2) подсветить diff по файлам

git diff # неиндексированные
git diff --staged # то, что уже в индексе

# 3) добавить и коммитнуть

git add .
git commit -m "feat: ... / fix: ... / docs: ..."

# 4) подтянуть чужие изменения аккуратно

git pull --rebase

# 5) отправить свои

git push

Ветки

# создать и перейти

git switch -c feature/city-search

# переключиться назад

git switch main

# слить фичу в main (если без PR)

git switch main && git pull --rebase && git merge --no-ff feature/city-search
git push

# удалить локально и на GitHub

git branch -D feature/city-search
git push origin --delete feature/city-search

Быстрый откат и «спасалки»

# отменить изменения в файле до HEAD

git checkout -- path/to/file

# убрать все незакоммиченные изменения (ОПАСНО)

git reset --hard HEAD

# временно спрятать грязь и обновиться

git stash push -m "wip"
git pull --rebase
git stash pop

# откатить последний коммит, сохранив изменения в рабочей директории

git reset --soft HEAD~1

# создать тэг релиза

git tag -a v0.1.0 -m "first cut"
git push origin v0.1.0

Чистый старт main (если снова понадобится)

git checkout --orphan clean-main
find . -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
git commit --allow-empty -m "Новый чистый репозиторий"
git branch -M main
git push -u origin main --force

Полезные настройки

# имя/почта (как на GitHub)

git config --global user.name "Rodrigo"
git config --global user.email "radik.093@gmail.com"

# дефолтная ветка и поведение pull

git config --global init.defaultBranch main
git config --global pull.rebase true

# удобная подсветка

git config --global color.ui auto

# глобальный .gitignore

echo -e "node_modules/\n.dist/\n.env*\n*.log\n" >> ~/.gitignore_global
git config --global core.excludesfile ~/.gitignore_global

SSH и агент (если терминал «забывает» ключ)
eval "$(ssh-agent -s)"
ssh-add ~/.ssh/id*ed25519
ssh -T git@github.com # должен сказать Hi <твой*логин>!

Практический план

Открой проект:

cd ~/project/tg-dating-vip
cursor .

Проверь ремоут и SSH:

git remote -v
ssh -T git@github.com

Рабочий цикл на фиче:

git switch -c feature/<имя>

# код → тест → формат

git add . && git commit -m "feat: <описание>"
git pull --rebase
git push --set-upstream origin feature/<имя>

# дальше PR на GitHub

После мерджа — локальная чистка:

git switch main && git pull
git branch -D feature/<имя>
git push origin --delete feature/<имя>
