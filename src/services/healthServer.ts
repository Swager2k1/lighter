import http from 'node:http';

/**
 * Запуск минимального изолированного HTTP-сервера для healthcheck (Render.com + UptimeRobot).
 * Не раскрывает никаких логов, балансов или системных параметров.
 */
export function startHealthServer(port: number = Number(process.env.PORT) || 8080): http.Server {
  const server = http.createServer(async (req, res) => {
    const url = req.url || '';
    if (req.method === 'GET' && (url === '/' || url === '/health' || url.startsWith('/health?'))) {
      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      });
      res.end('OK');
      return;
    }

    if (req.method === 'GET' && (url === '/diag' || url.startsWith('/diag?'))) {
      const botToken = process.env.TELEGRAM_BOT_TOKEN || '';
      const critToken = process.env.CRITICAL_TELEGRAM_BOT_TOKEN || '';

      const diagData: Record<string, unknown> = {
        timestamp: new Date().toISOString(),
        uptimeSec: Math.round(process.uptime()),
        env: {
          hasBotToken: Boolean(botToken),
          botTokenLen: botToken.length,
          botTokenPrefix: botToken ? botToken.slice(0, 10) : '',
          hasCritToken: Boolean(critToken),
          critTokenLen: critToken.length,
          critTokenPrefix: critToken ? critToken.slice(0, 10) : '',
          chatId: process.env.TELEGRAM_CHAT_ID || '',
          disablePolling: process.env.DISABLE_POLLING,
        },
      };

      try {
        if (botToken) {
          const meRes = await fetch(`https://api.telegram.org/bot${botToken}/getMe`, { signal: AbortSignal.timeout(4000) })
            .then((r) => r.json())
            .catch((e) => ({ error: e.message }));

          const whRes = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`, { signal: AbortSignal.timeout(4000) })
            .then((r) => r.json())
            .catch((e) => ({ error: e.message }));

          let webhookDeleted = false;
          if (whRes && typeof whRes === 'object' && (whRes as any).result?.url) {
            await fetch(`https://api.telegram.org/bot${botToken}/deleteWebhook?drop_pending_updates=false`, { signal: AbortSignal.timeout(4000) })
              .catch(() => {});
            webhookDeleted = true;
          }

          const updatesTest = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates?limit=1&timeout=2`, { signal: AbortSignal.timeout(4000) })
            .then((r) => r.json())
            .catch((e) => ({ error: e.message }));

          diagData.telegramBot = {
            me: meRes,
            webhook: whRes,
            webhookDeleted,
            updatesTest,
          };
        }

        if (critToken) {
          const critMe = await fetch(`https://api.telegram.org/bot${critToken}/getMe`, { signal: AbortSignal.timeout(4000) })
            .then((r) => r.json())
            .catch((e) => ({ error: e.message }));
          diagData.criticalBot = { me: critMe };
        }
      } catch (err: any) {
        diagData.diagError = err?.message || String(err);
      }

      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      });
      res.end(JSON.stringify(diagData, null, 2));
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

/**
 * Остановка health-сервера.
 */
export function stopHealthServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

