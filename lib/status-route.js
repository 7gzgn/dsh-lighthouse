/**
 * dsh-lighthouse · status-route —— 给界面观察区供数据的一条**只读**接口。
 *
 * `GET /dsh-lighthouse/status` → `{ ok, report }`（就是 `collectAll` 的那份报告）。
 * 界面那一半（`client.js`）只负责画，不负责算 —— 所以同一个数字在面板、工具、卡片里是一致的。
 *
 * @module dsh-lighthouse/status-route
 */

import { collectAll } from './collect.js';
import { readFleet } from './fleet.js';

/** 观察区取数的路径。 */
export const STATUS_ROUTE = '/dsh-lighthouse/status';

/** 统一的 JSON 回包。 */
function send(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  response.end(body);
}

/** 本机匿名请求的缓存有效期 —— 免得谁都能借我的 PAT 反复去打 GitHub。 */
export const CACHE_TTL_MS = 60_000;

/**
 * 造一个请求处理器。
 * @param {object} options 选项
 * @param {string} options.fleetFile 名册路径
 * @param {string} [options.marketUrl] 市场接口根
 * @param {string|null|Function} [options.token] GitHub PAT（也接受函数：请求时才解析）
 * @param {Function} [options.collect] 采集实现（测试注入）
 * @param {Function} [options.readFleetImpl] 读名册实现（测试注入）
 * @param {Function} [options.now] 取时间（测试注入）
 * @param {number} [options.cacheTtlMs] 匿名来源的缓存时长
 * @returns {Function} `(request, response) => Promise<void>`
 */
export function createStatusHandler({
  fleetFile,
  marketUrl,
  token = null,
  collect = collectAll,
  readFleetImpl = readFleet,
  now = Date.now,
  cacheTtlMs = CACHE_TTL_MS,
} = {}) {
  let cache = null; // { at, payload }

  /** 从请求头里取来源（Origin 优先，其次 Referer；都没有就返回 null）。 */
  function sourceOf(request) {
    const origin = request?.headers?.origin;
    if (typeof origin === 'string' && origin !== '') return origin;
    const referer = request?.headers?.referer;
    if (typeof referer === 'string' && referer !== '') return referer;
    return null;
  }

  /**
   * 跨源来的请求一律拒掉。
   *
   * 背景（实测）：**宿主不为插件注册的路由做认证** —— `webServer.register` 没有 auth 选项，
   * 宿主根 `/` 要认证（401），插件路由却是裸的。所以准入只能自己加：
   *   · 带了来源头（界面 fetch 会带 Referer）→ 必须与市场接口同源，否则 403；
   *   · 没带来源头（curl / 本机脚本）→ 放行。这些信息本来就是公开的（仓库名、star 数），
   *     真要挡本机进程也挡不住（它直接读工程目录就行），装样子没意义。
   * 另加一层缓存兜底：界面来的请求**永远实时**（刷新按钮必须真的刷新），
   * 匿名来源的重复请求 60 秒内吃缓存。
   */
  function fromElsewhere(request) {
    const seen = sourceOf(request);
    if (seen === null) return false;
    try {
      return new URL(seen).origin !== new URL(marketUrl).origin;
    } catch {
      return true; // 来源头读不懂：当作别处来的
    }
  }

  /** 这次请求是不是界面（同源）来的。 */
  function fromUi(request) {
    const seen = sourceOf(request);
    if (seen === null) return false;
    try {
      return new URL(seen).origin === new URL(marketUrl).origin;
    } catch {
      return false;
    }
  }

  return async function handleStatus(request, response) {
    const method = String(request?.method ?? 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
      send(response, 405, { ok: false, error: 'method-not-allowed' });
      return;
    }
    if (fromElsewhere(request)) {
      send(response, 403, { ok: false, error: 'cross-origin-denied' });
      return;
    }
    if (fromUi(request) !== true && cache !== null && now() - cache.at < cacheTtlMs) {
      send(response, 200, cache.payload);
      return;
    }
    try {
      const read = await readFleetImpl(fleetFile);
      if (read.ok !== true) {
        send(response, 200, { ok: false, errors: read.errors, fleetPath: fleetFile });
        return;
      }
      // token 允许传函数：注册路由时它还没被解析，第一次请求时再拿
      // （省得为了它把 apply 变成异步 —— 插件加载不该等网络）
      const resolvedToken = typeof token === 'function' ? await token() : token;
      // 观察区不查 npm（省一次外网往返），其余与工具走同一条采集路径
      const report = await collect(read.fleet, { token: resolvedToken, marketUrl, includeNpm: false, now: now() });
      const payload = { ok: true, report };
      cache = { at: now(), payload };
      send(response, 200, payload);
    } catch (err) {
      send(response, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  };
}
