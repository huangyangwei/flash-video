// vite 开发服务器插件：把开播监测引擎挂到 dev server 上（design D1 修订）。
// 端点 /__watch/api：
//   GET  -> 引擎状态快照（页面轮询刷新监测面板）
//   POST {action:'start', room, intervalSec} | {action:'stop'} | {action:'config', room, intervalSec}
// 不新增监听端口，只是给本就在跑的 dev server 加本地接口（无 CORS 问题：同源）。

import { createWatchEngine } from '../src/lib/watch-engine.js';

export function liveWatchPlugin() {
  const engine = createWatchEngine();

  function send(res, code, payload) {
    res.statusCode = code;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(payload));
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let raw = '';
      req.on('data', (c) => {
        raw += c;
        if (raw.length > 1024 * 64) reject(new Error('body too large'));
      });
      req.on('end', () => {
        try {
          resolve(raw ? JSON.parse(raw) : {});
        } catch {
          reject(new Error('invalid json'));
        }
      });
      req.on('error', reject);
    });
  }

  return {
    name: 'flash-video-live-watch',
    configureServer(server) {
      server.middlewares.use('/__watch/api', async (req, res) => {
        try {
          if (req.method === 'GET') {
            send(res, 200, engine.getStatus());
            return;
          }
          if (req.method === 'POST') {
            const body = await readBody(req);
            const intervalMs = Math.round(Number(body.intervalSec) * 1000);
            const interval = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : undefined;
            if (body.action === 'start') {
              const result = engine.start({
                room: body.room,
                intervalMs: interval ?? 15000,
                cookie: body.cookie,
              });
              if (!result.ok) {
                send(res, 400, { ok: false, error: `房间无法识别: ${result.reason}` });
                return;
              }
            } else if (body.action === 'stop') {
              engine.stop();
            } else if (body.action === 'config') {
              const result = engine.setConfig({
                room: body.room,
                intervalMs: interval,
                cookie: body.cookie,
              });
              if (!result.ok) {
                send(res, 400, { ok: false, error: `房间无法识别: ${result.reason}` });
                return;
              }
            } else {
              send(res, 400, { ok: false, error: `未知 action: ${body.action}` });
              return;
            }
            send(res, 200, { ok: true, ...engine.getStatus() });
            return;
          }
          send(res, 405, { ok: false, error: 'method not allowed' });
        } catch (err) {
          send(res, 400, { ok: false, error: err.message });
        }
      });
      server.config.logger.info('  ➜  live-watch: 开播监测已挂载 /__watch/api');
    },
  };
}
