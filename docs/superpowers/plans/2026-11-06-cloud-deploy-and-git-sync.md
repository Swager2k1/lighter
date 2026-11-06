# Cloud Deploy & Zero-Conflict Git Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реализовать 24/7 автономную работу бота в облачном сервисе Render.com с защитой от засыпания через `/health` сервер, безопасную атомарную синхронизацию сделок (`pnl_and_points_analysis.csv`) и активных связок (`config.json`) через GitHub REST API, бесконфликтные команды обновления на ПК (`npm run sync`, `npm run deploy`), флаг отключения дублирующего поллинга (`DISABLE_POLLING`) и детальную инструкцию пользователя.

**Architecture:**
1. `src/services/healthServer.ts`: Легковесный нативный HTTP-сервер на Node.js (`node:http`) для порта 8080 (или `process.env.PORT`). Отдает `200 OK` на `/` и `/health` для UptimeRobot; 404 на любые другие запросы. Защита от утечки заголовков и системной информации.
2. `src/services/githubSyncService.ts`: Клиент к GitHub REST API v3 на нативном `fetch`. Выполняет атомарные коммиты файлов `pnl_and_points_analysis.csv` и `config.json` с токеном `GITHUB_PAT`. Добавляет маркер `[skip ci]`. Graceful fallback при отсутствии токена.
3. `src/services/positionSyncService.ts` & `src/config.ts`: Интеграция вызова `githubSyncService` при вызове `appendRowToCsv` и `saveHedgeConfig`.
4. `src/index.ts`: Запуск `healthServer` при старте приложения; поддержка флага `DISABLE_POLLING=true` для безопасного запуска на локальном ПК без ошибки конфликта Telegram; корректная остановка сервера при SIGINT / SIGTERM.
5. `package.json`: Добавление скриптов `"sync"` (`git pull --rebase --autostash origin main`) и `"deploy"` (`npm run typecheck && npm test && git pull --rebase --autostash origin main && git push origin main`), а также расширение скрипта `"test"`.
6. `docs/CLOUD_DEPLOY_GUIDE.md`: Подробное пошаговое руководство на русском языке по настройке GitHub PAT, Render.com, UptimeRobot и повседневной работе.

**Tech Stack:** TypeScript, Node.js (`node:http`, `fetch`), Node.js Test Runner (`node --test`), Render.com PaaS, UptimeRobot, GitHub REST API v3.

---

### Task 1: Сервер проверки доступности (`src/services/healthServer.ts`)

**Files:**
- Create: `src/services/healthServer.ts`
- Create: `tests/healthServer.test.ts`

- [ ] **Step 1: Написать failing test для `healthServer`**

В `tests/healthServer.test.ts` протестировать:
- Запуск сервера на свободном порту (например, 8088).
- `GET /` возвращает статус 200 и тело `OK`.
- `GET /health` возвращает статус 200 и тело `OK`.
- `GET /unauthorized_path` возвращает статус 404 и тело `Not Found`.
- Сервер успешно останавливается методом `stopHealthServer`.

```typescript
import test from 'node:test';
import assert from 'node:assert/strict';
import { startHealthServer, stopHealthServer } from '../src/services/healthServer.js';

test('healthServer responds 200 OK on / and /health and 404 on others', async () => {
  const port = 8991;
  const server = startHealthServer(port);

  try {
    const resRoot = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(resRoot.status, 200);
    assert.equal(await resRoot.text(), 'OK');

    const resHealth = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(resHealth.status, 200);
    assert.equal(await resHealth.text(), 'OK');

    const resOther = await fetch(`http://127.0.0.1:${port}/secret-logs`);
    assert.equal(resOther.status, 404);
  } finally {
    await stopHealthServer(server);
  }
});
```

- [ ] **Step 2: Запустить тест и убедиться в ошибке**

Run: `& "C:\Program Files\nodejs\node.exe" --import tsx --test ./tests/healthServer.test.ts`  
Expected: FAIL (`Cannot find module '../src/services/healthServer.js'`).

- [ ] **Step 3: Реализовать `src/services/healthServer.ts`**

Реализовать функции:
- `startHealthServer(port?: number): http.Server`
- `stopHealthServer(server: http.Server): Promise<void>`

```typescript
import http from 'node:http';

export function startHealthServer(port: number = Number(process.env.PORT) || 8080): http.Server {
  const server = http.createServer((req, res) => {
    const url = req.url || '';
    if (req.method === 'GET' && (url === '/' || url === '/health' || url.startsWith('/health?'))) {
      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      });
      res.end('OK');
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  });

  server.listen(port, () => {
    console.log(`[HealthServer] Сервер проверки доступности запущен на порту ${port}`);
  });

  server.on('error', (err) => {
    console.error('[HealthServer] Ошибка сервера:', err);
  });

  return server;
}

export function stopHealthServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}
```

- [ ] **Step 4: Запустить тест и убедиться, что он проходит**

Run: `& "C:\Program Files\nodejs\node.exe" --import tsx --test ./tests/healthServer.test.ts`  
Expected: PASS.

---

### Task 2: Сервис синхронизации через GitHub REST API (`src/services/githubSyncService.ts`)

**Files:**
- Create: `src/services/githubSyncService.ts`
- Create: `tests/githubSyncService.test.ts`

- [ ] **Step 1: Написать failing test для `githubSyncService`**

В `tests/githubSyncService.test.ts` проверить:
- Корректное кодирование контента в Base64.
- Отправку `PUT` запроса с заголовком `Authorization: Bearer <PAT>`, правильным `sha` и маркером `[skip ci]`.
- Корректный fallback при отсутствии `GITHUB_PAT` (возврат `{ success: false, reason: 'missing_token' }` без выброса исключений).
- Мокирование `globalThis.fetch` для проверки логики.

- [ ] **Step 2: Запустить тест и убедиться в ошибке**

Run: `& "C:\Program Files\nodejs\node.exe" --import tsx --test ./tests/githubSyncService.test.ts`  
Expected: FAIL (`Cannot find module '../src/services/githubSyncService.js'`).

- [ ] **Step 3: Реализовать `src/services/githubSyncService.ts`**

Реализовать:
- `GithubSyncService` класс со статическими или экземплярными методами:
  - `isConfigured(): boolean`
  - `syncFile(relativePath: string, content: string, commitMessage: string): Promise<{ success: boolean; commitSha?: string; error?: string }>`
  - `syncCsvFile(csvContent: string, message?: string): Promise<any>`
  - `syncConfigFile(configContent: string, message?: string): Promise<any>`
- Конфигурация через:
  - `process.env.GITHUB_PAT`
  - `process.env.GITHUB_REPO || 'Swager2k1/Lighter'`
  - `process.env.GITHUB_BRANCH || 'main'`
- Получение текущего SHA через `GET https://api.github.com/repos/{owner}/{repo}/contents/{path}?ref={branch}`.
- Запись через `PUT https://api.github.com/repos/{owner}/{repo}/contents/{path}` с base64-контентом и заголовками `User-Agent: LighterHedger-Bot` и `Accept: application/vnd.github.v3+json`.

- [ ] **Step 4: Запустить тест и убедиться, что он проходит**

Run: `& "C:\Program Files\nodejs\node.exe" --import tsx --test ./tests/githubSyncService.test.ts`  
Expected: PASS.

---

### Task 3: Интеграция синхронизации в `positionSyncService.ts` и `config.ts`

**Files:**
- Modify: `src/services/positionSyncService.ts`
- Modify: `src/config.ts`
- Modify: `tests/positionSyncService.test.ts`

- [ ] **Step 1: Написать failing test на запуск фоновой синхронизации в `positionSyncService.test.ts`**

Проверить:
- При вызове `appendRowToCsv(row)` вызывается отправка в `githubSyncService`.
- При вызове `saveHedgeConfig(config)` вызывается отправка в `githubSyncService`.
- Функции не блокируются и не бросают исключение, если синхронизация завершилась с ошибкой.

- [ ] **Step 2: Запустить тест и убедиться в ошибке**

Run: `& "C:\Program Files\nodejs\node.exe" --import tsx --test ./tests/positionSyncService.test.ts`  
Expected: FAIL или отсутствие проверки триггера синхронизации.

- [ ] **Step 3: Внедрить вызовы `githubSyncService`**

1. В `src/services/positionSyncService.ts`:
   - Внутри `appendRowToCsv(csvRow: string)`:
     ```typescript
     // Синхронная запись на диск
     fs.appendFileSync(csvPath, `\n${csvRow}`);
     // Асинхронная отправка в GitHub
     const fullContent = fs.readFileSync(csvPath, 'utf-8');
     githubSyncService.syncCsvFile(fullContent, `sync: log trade row [skip ci]`).catch((err) => {
       console.error('[PositionSync] Ошибка облачной синхронизации CSV:', err);
     });
     ```
2. В `src/config.ts`:
   - Внутри `saveHedgeConfig(config: AppConfig)`:
     ```typescript
     fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
     githubSyncService.syncConfigFile(JSON.stringify(config, null, 2), `sync: update config.json [skip ci]`).catch((err) => {
       console.error('[Config] Ошибка облачной синхронизации config.json:', err);
     });
     ```

- [ ] **Step 4: Запустить тест и убедиться, что он проходит**

Run: `& "C:\Program Files\nodejs\node.exe" --import tsx --test ./tests/positionSyncService.test.ts`  
Expected: PASS.

---

### Task 4: Запуск HealthServer и Telegram Guard (`DISABLE_POLLING`) в `src/index.ts`

**Files:**
- Modify: `src/index.ts`
- Create/Modify: `tests/config.test.ts`

- [ ] **Step 1: Написать failing test для конфигурации `DISABLE_POLLING`**

В `tests/config.test.ts` проверить, что флаг `DISABLE_POLLING` корректно определяется из переменных окружения.

- [ ] **Step 2: Запустить тест и убедиться в результате**

Run: `& "C:\Program Files\nodejs\node.exe" --import tsx --test ./tests/config.test.ts`  
Expected: FAIL или отсутствие проверки.

- [ ] **Step 3: Обновить `src/index.ts`**

1. Импортировать `startHealthServer, stopHealthServer` из `./services/healthServer.js`.
2. Запустить `const healthServer = startHealthServer();` в начале `main()`.
3. Обернуть запуск поллинга ботов в проверку:
   ```typescript
   const disablePolling = process.env.DISABLE_POLLING === 'true';
   if (disablePolling) {
     console.log('⚠️ Telegram Polling отключен флагом DISABLE_POLLING=true (режим отладки/локальный).');
   } else {
     bot.startPolling();
     if (criticalBot.isConfigured()) {
       criticalBot.startPolling(async () => handleStatusCommand());
     }
   }
   ```
4. В обработчиках `SIGINT` и `SIGTERM` вызывать `await stopHealthServer(healthServer)`.

- [ ] **Step 4: Запустить тесты и проверить сборку**

Run: `& "C:\Program Files\nodejs\node.exe" --max-old-space-size=8192 ./node_modules/typescript/bin/tsc --noEmit`  
Expected: 0 ошибок компиляции.

---

### Task 5: Скрипты автоматизации в `package.json` и `.env.example`

**Files:**
- Modify: `package.json`
- Modify: `.env.example`

- [ ] **Step 1: Обновить скрипты в `package.json`**

Добавить команды:
- `"sync"`: `"git pull --rebase --autostash origin main"`
- `"deploy"`: `"npm run typecheck && npm test && git pull --rebase --autostash origin main && git push origin main"`
- Включить новые тесты `tests/healthServer.test.ts` и `tests/githubSyncService.test.ts` в список запуска скрипта `"test"`.

- [ ] **Step 2: Обновить `.env.example`**

Добавить описания переменных:
```bash
# Cloud Deployment & Healthcheck
PORT=8080
DISABLE_POLLING=false

# GitHub REST API Sync (для облачного воркера)
GITHUB_PAT=github_pat_xxxxxx
GITHUB_REPO=Swager2k1/Lighter
GITHUB_BRANCH=main
```

- [ ] **Step 3: Проверить запуск скрипта `npm test`**

Run: `& "C:\Program Files\nodejs\node.exe" --import tsx --test tests/healthServer.test.ts tests/githubSyncService.test.ts tests/botHandlers.test.ts`  
Expected: PASS.

---

### Task 6: Пошаговое руководство пользователя (`docs/CLOUD_DEPLOY_GUIDE.md`)

**Files:**
- Create: `docs/CLOUD_DEPLOY_GUIDE.md`

- [ ] **Step 1: Написать полное практическое руководство**

Включить разделы:
1. **Шаг 1. Создание GitHub Fine-grained PAT:**
   - Переход в GitHub Settings -> Developer Settings -> Personal access tokens -> Fine-grained tokens.
   - Выбор только репозитория `Swager2k1/Lighter`.
   - Назначение прав: `Repository permissions -> Contents: Read and write`.
   - Копирование сгенерированного токена.
2. **Шаг 2. Развертывание Web Service на Render.com (Бесплатно):**
   - Вход на render.com через GitHub.
   - Создание `New +` -> `Web Service`.
   - Подключение репозитория `Swager2k1/Lighter`.
   - Параметры:
     - Runtime: `Node`
     - Build Command: `npm install && npm run build`
     - Start Command: `npm start`
     - Instance Type: `Free`
3. **Шаг 3. Переменные окружения (Environment Variables) в Render:**
   - Таблица с точными названиями ключей (`TELEGRAM_BOT_TOKEN`, `CRITICAL_TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `GITHUB_PAT`, `PORT=8080`, `DISABLE_POLLING=false`).
4. **Шаг 4. Настройка UptimeRobot (Защита от засыпания):**
   - Бесплатная регистрация на uptimerobot.com.
   - Добавление HTTP монитора с URL сервиса Render `https://<app-name>.onrender.com/health`.
   - Интервал опроса: каждые 5 минут.
5. **Шаг 5. Повседневная работа (Cheat Sheet):**
   - Утро / включение света: вводишь `npm run sync` в терминале ПК — и получаешь все новые строки CSV и открытые связки.
   - Редактирование в Antigravity: пишем любые фичи, запускаем `npm run deploy` — код сам безопасно улетает на сервер.

- [ ] **Step 2: Проверить корректность ссылок и форматирования Markdown**

---

### Task 7: Финальная сквозная верификация и регрессионное тестирование

**Files:**
- All modified/created files

- [ ] **Step 1: Запустить полную проверку типов TypeScript**

Run: `& "C:\Program Files\nodejs\node.exe" --max-old-space-size=8192 ./node_modules/typescript/bin/tsc --noEmit`  
Expected: 0 ошибок.

- [ ] **Step 2: Запустить полный набор юнит-тестов проекта**

Run: `npm test`  
Expected: Все тесты проходят (PASS).

- [ ] **Step 3: Проверить статус Git репозитория**

Run: `git status`  
Expected: Чистая рабочая директория (или только запланированные новые файлы).
