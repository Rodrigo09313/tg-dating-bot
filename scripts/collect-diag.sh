#!/usr/bin/env bash
set -euo pipefail
OUT=diag
rm -rf "$OUT"; mkdir -p "$OUT"

# 1) дерево
{ echo "### TREE"; date; } > "$OUT/summary.txt"
which tree >/dev/null 2>&1 && tree -a -L 3 -I 'node_modules|.git|dist|coverage|.nyc_output|.vscode|.idea' > "$OUT/tree.txt" || true
find . -maxdepth 3 -type f -not -path "./node_modules/*" -not -path "./.git/*" -printf "%P\n" | sort > "$OUT/find.txt"

# 2) ключевые файлы
for f in docker-compose.yml .env.example tsconfig.json package.json; do
  [ -f "$f" ] && { echo "----- $f" >> "$OUT/summary.txt"; sed -n '1,200p' "$f" >> "$OUT/summary.txt"; echo >> "$OUT/summary.txt"; }
done
ls -la docker/initdb > "$OUT/initdb_ls.txt" 2>/dev/null || true
for f in docker/initdb/*.sql; do
  [ -f "$f" ] && { echo "----- $f" >> "$OUT/initdb_preview.txt"; sed -n '1,200p' "$f" >> "$OUT/initdb_preview.txt"; echo >> "$OUT/initdb_preview.txt"; }
done

# 3) docker
{ echo "### docker compose version"; docker compose version; } > "$OUT/docker.txt" 2>&1 || true
{ echo "### docker compose config"; docker compose config; } >> "$OUT/docker.txt" 2>&1 || true
{ echo "### docker compose ps"; docker compose ps; } >> "$OUT/docker.txt" 2>&1 || true
{ echo "### docker logs db (tail 200)"; docker compose logs -n 200 db; } >> "$OUT/docker.txt" 2>&1 || true
{ echo "### db env & initdb dir"; docker compose exec -T db bash -lc 'echo "$POSTGRES_USER / $POSTGRES_DB"; ls -la /docker-entrypoint-initdb.d'; } >> "$OUT/docker.txt" 2>&1 || true
{ echo "### inspect"; docker inspect tg_dating_db --format '{{json .State.Health}}'; docker inspect tg_dating_db --format '{{json .NetworkSettings.Ports}}'; } >> "$OUT/docker.txt" 2>&1 || true

# 4) psql проверки
{ echo "### \dx / \dt"; docker compose exec -T db bash -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "\dx"; psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "\dt"'; } > "$OUT/psql.txt" 2>&1 || true

tar czf diag.tgz "$OUT"
echo "готово: diag/ и diag.tgz"
