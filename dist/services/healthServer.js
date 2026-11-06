import http from 'node:http';
/**
 * Запуск минимального изолированного HTTP-сервера для healthcheck (Render.com + UptimeRobot).
 * Не раскрывает никаких логов, балансов или системных параметров.
 */
export function startHealthServer(port = Number(process.env.PORT) || 8080) {
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
/**
 * Остановка health-сервера.
 */
export function stopHealthServer(server) {
    return new Promise((resolve) => {
        server.close(() => resolve());
    });
}
