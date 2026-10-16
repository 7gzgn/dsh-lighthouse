/**
 * dsh-lighthouse —— 宿主入口。
 *
 * 一句话：**一屏看清你发出去的每个作品现在怎么样了** —— 本地拿什么版本、GitHub 有没有动静、
 * 市场收没收录、被下载多少次、还给收录 PR 等了多久（对比上游中位数）。
 *
 * 它只读：不发任何写请求，不动你的仓库，也不生成任何"看起来像"的数字 —— 要么来自 API，要么标"读不到"。
 *
 * @module dsh-lighthouse
 */

import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { collectAll } from './collect.js';
import { STATUS_ROUTE, createStatusHandler } from './status-route.js';
import { defaultFleetPath, readFleet, validateFleet, writeFleet } from './fleet.js';
import { renderText, writeReport } from './render.js';

/** 插件身份。 */
export const name = 'dsh-lighthouse';

/** 需要宿主提供的服务（拿不到就退化，不报错）。 */
export const inject = ['tools', 'systemPrompt'];

const SECTION_ORDER = 207;
const TOOL_TIMEOUT_MS = 180000;

/** 面向模型的公告（常驻那一段）。 */
export const LIGHTHOUSE_GUIDANCE = [
  '本机已安装 **dsh-lighthouse（灯塔）**：`lighthouse_report` 一屏汇总每个作品的现状（本地版本/文件数、GitHub star 与最后推送、市场**是否已收录/下载量/同类排名**、收录 PR 等了多久对比上游中位数），并落一张**可直接截图**的 HTML 卡片。',
  '它**只读**：所有请求都是 GET；读不到就标"读不到"，绝不编数字。',
  '名册（照谁看）是一份**显式文件**，默认 `~/.dsh/lighthouse-fleet.json`；`lighthouse_fleet` 可以 show/init 它 —— **名册不自动发现**（不许从目录名猜哪些是你的作品）。',
  '典型用法：想知道"我们的插件上市场了吗 / 有人装吗"→ 调 `lighthouse_report`；卡片路径会随结果返回，可直接给用户看。',
].join('\n');

/** 动态取 defineTool：宿主里有就用真的，单测/CLI 场景退化成恒等。 */
let defineTool = (def) => def;
try {
  const mod = await import('@deepseek-ai/dsh-tools');
  if (mod && typeof mod.defineTool === 'function') defineTool = mod.defineTool;
} catch {
  /* 宿主外运行 */
}

/**
 * 找 PAT（跟滑道同一套顺序）。
 * @param {string} [explicit] 显式路径
 * @returns {Promise<string|null>} token
 */
export async function resolveToken(explicit) {
  const candidates = [];
  if (typeof explicit === 'string' && explicit !== '') candidates.push(explicit);
  if (typeof process.env.DSH_SLIPWAY_TOKEN_FILE === 'string' && process.env.DSH_SLIPWAY_TOKEN_FILE !== '') {
    candidates.push(process.env.DSH_SLIPWAY_TOKEN_FILE);
  }
  candidates.push(join(homedir(), '.dsh', '.gh-token'));
  candidates.push('D:\\dsh\\.gh-token');
  for (const file of candidates) {
    try {
      const text = await readFile(file, 'utf8');
      const token = text.trim();
      if (token !== '') return token;
    } catch {
      /* 换下一个 */
    }
  }
  return null;
}

/** 默认市场地址。 */
export function defaultMarketUrl() {
  return process.env.DSH_WEB_URL ?? 'http://127.0.0.1:19387';
}

/** 默认卡片目录。 */
export function defaultReportDir() {
  return join(homedir(), '.dsh', 'lighthouse-reports');
}

/**
 * 跑一次报告（工具与 CLI 共用）。
 * @param {object} input 参数
 * @returns {Promise<object>} `{ ok, report, htmlPath, jsonPath, errors }`
 */
export async function runReport(input = {}) {
  const fleetPath = input.fleetFile ?? defaultFleetPath();
  const read = await readFleet(fleetPath);
  if (read.ok !== true) return { ok: false, errors: read.errors, fleetPath };

  const token = await resolveToken(input.tokenFile);
  const report = await collectAll(read.fleet, {
    token,
    marketUrl: input.marketUrl ?? defaultMarketUrl(),
    includeNpm: input.includeNpm !== false,
  });
  report.tokenFound = token !== null;

  let paths = { htmlPath: null, jsonPath: null };
  if (input.writeFiles !== false) {
    paths = await writeReport(report, {
      dir: input.reportDir ?? defaultReportDir(),
      html: input.html !== false,
      json: input.json === true,
    });
  }
  return { ok: true, report, ...paths, fleetPath };
}

/**
 * 挂载插件。
 * @param {import('@deepseek-ai/cordis').Context} ctx 宿主上下文
 * @param {object} [config] 插件配置
 */
export function apply(ctx, config) {
  const cfg = config ?? {};
  if (cfg.enabled === false) return;
  const disposers = [];

  if (ctx.tools !== undefined && typeof ctx.tools.register === 'function') {
    disposers.push(ctx.tools.register(defineTool({
      name: 'lighthouse_report',
      description: [
        '一屏看清每个作品的现状：本地（版本/文件数/有无自测）、GitHub（star/fork/最后推送）、市场（**是否已收录、下载量、同类排名**）、收录 PR（等了多少 vs 上游中位数），并落一张可截图的 HTML 卡片。',
        '**只读**：全部是 GET 请求；某个数据源读不到就标"读不到"，不会编数字。',
        '名册（要看守哪些作品）来自 `~/.dsh/lighthouse-fleet.json`，可用 fleetFile 指到别处。',
      ].join('\n'),
      timeoutMs: TOOL_TIMEOUT_MS,
      parameters: {
        fleetFile: { type: 'string', description: '名册文件路径（默认 ~/.dsh/lighthouse-fleet.json）' },
        reportDir: { type: 'string', description: '卡片落盘目录（默认 ~/.dsh/lighthouse-reports）' },
        html: { type: 'boolean', description: '是否落 HTML 卡片（默认 true）' },
        includeNpm: { type: 'boolean', description: '是否顺手查 npm（默认 true）' },
        marketUrl: { type: 'string', description: `市场接口根地址（默认 ${defaultMarketUrl()}）` },
        tokenFile: { type: 'string', description: 'PAT 文件路径（不填则按 env / ~/.dsh / D:\\dsh 依次找）' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', required: true },
            data: { type: 'json' },
            error: { type: 'string' },
          },
        },
        render: (_args, value) => {
          if (value.ok === false && value.data === undefined) {
            return [{ type: 'text', text: `lighthouse_report 失败：${String(value.error ?? '未知错误')}` }];
          }
          const d = value.data ?? {};
          if (d.ok === false) {
            return [{ type: 'text', text: `lighthouse_report 失败：\n  ${(d.errors ?? []).join('\n  ')}\n  （名册：${d.fleetPath ?? '?'}）` }];
          }
          const lines = [renderText(d.report)];
          if (d.htmlPath) lines.push(`  卡片已落盘：${d.htmlPath}`);
          if (d.report?.tokenFound === false) lines.push('  ⚠️ 没找到 PAT：GitHub 部分可能只有公开信息或读不到');
          return [{ type: 'text', text: lines.join('\n') }];
        },
      },
      async execute(args) {
        try {
          const data = await runReport({
            fleetFile: args?.fleetFile ?? cfg.fleetFile,
            reportDir: args?.reportDir ?? cfg.reportDir,
            html: args?.html,
            includeNpm: args?.includeNpm,
            marketUrl: args?.marketUrl ?? cfg.marketUrl,
            tokenFile: args?.tokenFile ?? cfg.tokenFile,
          });
          // **不能**写 `error: undefined`：宿主用 lossless-JSON 校验返回对象，
          // JSON.stringify 会悄悄丢掉 undefined，校验器不会 —— 会被判 "invalid output"。
          const out = { ok: data.ok === true, data };
          if (out.ok !== true) out.error = String((data.errors ?? [])[0] ?? '未完成');
          return out;
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    })));

    disposers.push(ctx.tools.register(defineTool({
      name: 'lighthouse_fleet',
      description: [
        '看/写灯塔的**名册**（它照着名册看，不自动发现作品）。',
        "action='show'：显示名册路径与它看守的作品。",
        "action='init'：用显式给的 owner 与 works 建名册 —— works 是 JSON 数组字符串，每条形如 {\\\"name\\\":\\\"dsh-slipway\\\",\\\"repo\\\":\\\"dsh-slipway\\\",\\\"category\\\":\\\"tools\\\",\\\"localDir\\\":\\\"D:\\\\dsh\\\\projects\\\\dsh-slipway\\\"}；**必须显式给，不猜**。",
      ].join('\n'),
      timeoutMs: 30000,
      parameters: {
        action: { type: 'string', description: 'show | init' },
        fleetFile: { type: 'string', description: '名册文件路径（默认 ~/.dsh/lighthouse-fleet.json）' },
        owner: { type: 'string', description: 'init 用：GitHub 账号' },
        works: { type: 'string', description: 'init 用：works 的 JSON 数组字符串' },
        upstreamOwner: { type: 'string', description: 'init 用：上游收录仓库 owner（默认 awesome-dsh-plugin）' },
        upstreamRepo: { type: 'string', description: 'init 用：上游收录仓库名（默认 awesome-dsh-plugin）' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', required: true },
            data: { type: 'json' },
            error: { type: 'string' },
          },
        },
        render: (_args, value) => {
          if (value.ok !== true) return [{ type: 'text', text: `lighthouse_fleet 失败：${String(value.error ?? '未知错误')}` }];
          const d = value.data ?? {};
          if (d.action === 'init') {
            return [{ type: 'text', text: `名册已写入：${d.fleetPath}\n  · owner：${d.owner}\n  · 看守 ${d.count} 个作品：${(d.names ?? []).join(', ')}` }];
          }
          return [{
            type: 'text',
            text: `名册：${d.fleetPath}\n  · owner：${d.owner ?? '(缺)'}\n  · ${d.count} 个作品：${(d.names ?? []).join(', ')}\n  · 上游：${d.upstream ?? '?'}${d.error ? `\n  · 读名册出错：${d.error}` : ''}`,
          }];
        },
      },
      async execute(args) {
        const a = args ?? {};
        const action = String(a.action ?? 'show').toLowerCase();
        const fleetPath = a.fleetFile ?? cfg.fleetFile ?? defaultFleetPath();
        try {
          if (action === 'init') {
            let works;
            try {
              works = JSON.parse(String(a.works ?? ''));
            } catch {
              return { ok: false, error: 'works 不是合法 JSON 数组字符串' };
            }
            const checked = validateFleet({
              owner: a.owner,
              upstream: { owner: a.upstreamOwner, repo: a.upstreamRepo },
              works,
            });
            if (checked.ok !== true) return { ok: false, error: checked.errors.join('；') };
            await writeFleet(fleetPath, checked.fleet);
            return {
              ok: true,
              data: { action: 'init', fleetPath, owner: checked.fleet.owner, count: checked.fleet.works.length, names: checked.fleet.works.map((w) => w.name) },
            };
          }
          const read = await readFleet(fleetPath);
          const fleet = read.fleet;
          return {
            ok: true,
            data: {
              action: 'show',
              fleetPath,
              owner: fleet?.owner ?? null,
              count: fleet?.works?.length ?? 0,
              names: (fleet?.works ?? []).map((w) => w.name),
              upstream: fleet ? `${fleet.upstream.owner}/${fleet.upstream.repo}@${fleet.upstream.branch}` : null,
              error: read.ok === true ? null : read.errors.join('；'),
            },
          };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    })));
  }

  // —— 界面「作品观察区」的数据口：GET /dsh-lighthouse/status（只读，与工具同一条采集路径）
  //
  // 必须用 `ctx.inject([...], host => ...)` 等 webServer 就位再注册（官方插件也是这么写的）。
  // 实测教训：写成 `ctx.get('webServer')` 时，apply 那一刻服务还没挂上 → 拿到 undefined →
  // 整段被跳过 → 界面读数据 404，而插件其它能力一切正常 —— "只少一块"最难查。
  try {
    if (typeof ctx.inject === 'function') {
      ctx.inject(['webServer'], (host) => {
        host.effect(() => host.webServer.register({
          kind: 'exact',
          path: STATUS_ROUTE,
          handler: createStatusHandler({
            fleetFile: cfg.fleetFile ?? defaultFleetPath(),
            marketUrl: cfg.marketUrl ?? defaultMarketUrl(),
            // 延迟解析：注册路由时还没有 token，第一次请求时再拿
            token: () => resolveToken(cfg.tokenFile).then((found) => found.token),
          }),
        }, 'dsh-lighthouse: status route'));
      });
    }
  } catch {
    /* 没有 web server 的表面（例如纯 CLI）：观察区缺席，其它能力不受影响 */
  }

  if (cfg.announceToAgent !== false && ctx.systemPrompt !== undefined
    && typeof ctx.systemPrompt.section === 'function') {
    disposers.push(ctx.systemPrompt.section({
      name: 'plugin:lighthouse',
      order: SECTION_ORDER,
      text: LIGHTHOUSE_GUIDANCE,
    }));
  }

  if (typeof ctx.effect === 'function' && disposers.length > 0) {
    ctx.effect(() => () => {
      for (const dispose of disposers) {
        try {
          if (typeof dispose === 'function') dispose();
        } catch {
          /* 卸载失败不阻断其它清理 */
        }
      }
    }, 'dsh-lighthouse: teardown');
  }
}

/** 供 CLI 复用的写文件工具（保证 CLI 与工具用同一套名册格式）。 */
export { writeFile };
