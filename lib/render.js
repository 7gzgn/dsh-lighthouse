/**
 * dsh-lighthouse · render —— 把报告渲染成两种东西：给 agent 看的一段话，和给人看的一张卡片。
 *
 * 卡片是**单文件 HTML**：无外链、无脚本依赖、深色、数字大 —— 落盘后可以直接打开、截图发出去。
 *
 * @module dsh-lighthouse/render
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { hoursText } from './collect.js';

/** HTML 转义。 */
function esc(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** ISO 时间 → `MM-DD HH:mm`。 */
function shortTime(iso) {
  if (typeof iso !== 'string' || iso === '') return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 给 agent 的一段话。
 * @param {object} report collectAll 的结果
 * @returns {string} 文本
 */
export function renderText(report) {
  const lines = [];
  const s = report.summary;
  lines.push(`作品看板｜${shortTime(report.generatedAt)}｜${report.owner}`);
  lines.push(`  汇总：${s.works} 个作品 · 已发布 ${s.published} · 市场已收录 ${s.listed} · 总下载 ${s.totalDownloads} · 总 star ${s.totalStars} · 待合 PR ${s.openPrs}`);
  if (report.market.available === true) {
    lines.push(`  市场登记表：${report.market.count} 条（更新于 ${String(report.market.updated ?? '?')}）`);
  } else {
    lines.push(`  市场登记表：**读不到**（${report.market.reason ?? '未知原因'}）`);
  }
  if (report.upstream?.available === true) {
    lines.push(`  上游合并节奏：中位数 ${hoursText(report.upstream.medianHours)}（样本 ${report.upstream.samples} 个已合并 PR）`);
  } else {
    lines.push(`  上游合并节奏：**没算出来**（${report.upstream?.reason ?? '未知原因'}）`);
  }
  for (const item of report.works) {
    const { work, local, github, market, npm } = item;
    const bits = [];
    bits.push(local.available === true ? `本地 ${local.version ?? '?'} / ${local.files ?? '?'} 文件${local.hasSmoke ? ' / 有自测' : ''}` : `本地 **读不到**（${local.reason ?? '?'}）`);
    bits.push(github.exists === true ? `GitHub star ${github.stars} / 最后推送 ${shortTime(github.pushedAt)}` : (github.exists === false ? 'GitHub **没有仓库**' : `GitHub **读不到**（${github.reason ?? '?'}）`));
    if (market.listed === true) {
      bits.push(`市场 **已收录**（下载 ${market.downloads}${market.rankInCategory ? `，同类第 ${market.rankInCategory}/${market.categorySize}` : ''}）`);
    } else if (market.available === true) {
      bits.push('市场 **未收录**');
    } else {
      bits.push(`市场 **读不到**（${market.reason ?? '?'}）`);
    }
    if (npm?.published === true) bits.push(`npm 有包（${npm.version}）`);
    else if (npm?.available === true) bits.push('npm 没有');

    let prText = '';
    if (github.pr) {
      const waited = (Date.now() - Date.parse(github.pr.createdAt)) / 3600000;
      if (github.pr.mergedAt) prText = `／PR #${github.pr.number} **已合并**`;
      else if (github.pr.state === 'open') {
        const median = report.upstream?.available === true ? `（上游中位数 ${hoursText(report.upstream.medianHours)}）` : '';
        prText = `／PR #${github.pr.number} 待合并，已等 ${hoursText(waited)}${median}`;
      } else prText = `／PR #${github.pr.number} ${github.pr.state}`;
    } else {
      prText = '／**没有市场 PR**';
    }

    lines.push(`  · ${work.name}${work.category ? `（${work.category}）` : ''}`);
    lines.push(`      ${bits.join('｜')}${prText}`);
  }
  lines.push('  卡片：见 htmlPath（可直接打开/截图）');
  return lines.join('\n');
}

/** 一个状态点。 */
function dot(kind) {
  const color = { good: '#3fb950', warn: '#d29922', bad: '#f85149', idle: '#6e7681' }[kind] ?? '#6e7681';
  return `<span class="dot" style="background:${color}"></span>`;
}

/**
 * 给人看的卡片（单文件 HTML）。
 * @param {object} report collectAll 的结果
 * @returns {string} HTML
 */
export function renderHtml(report) {
  const s = report.summary;
  const median = report.upstream?.available === true ? `上游中位数 ${hoursText(report.upstream.medianHours)}` : '上游节奏未知';

  const cards = report.works.map((item) => {
    const { work, local, github, market, npm } = item;
    const listed = market.listed === true;
    const rows = [];

    rows.push(`<div class="row"><span class="k">本地</span><span class="v">${
      local.available === true
        ? `${esc(local.version ?? '?')} · ${local.files ?? '?'} 文件${local.hasSmoke ? ' · 有自测' : ''}`
        : `<span class="bad">读不到（${esc(local.reason ?? '')}）</span>`
    }</span></div>`);

    rows.push(`<div class="row"><span class="k">GitHub</span><span class="v">${
      github.exists === true
        ? `${dot(github.stars > 0 ? 'good' : 'idle')} star ${github.stars} · fork ${github.forks} · 最后推送 ${shortTime(github.pushedAt)}`
        : (github.exists === false ? '<span class="bad">仓库不存在</span>' : `<span class="bad">读不到（${esc(github.reason ?? '')}）</span>`)
    }</span></div>`);

    rows.push(`<div class="row"><span class="k">市场</span><span class="v">${
      listed
        ? `${dot('good')} 已收录 · 下载 <b>${market.downloads}</b>${market.rankInCategory ? ` · 同类 ${market.rankInCategory}/${market.categorySize}` : ''}`
        : (market.available === true ? `${dot('warn')} 还没收录` : `<span class="bad">读不到（${esc(market.reason ?? '')}）</span>`)
    }</span></div>`);

    let prHtml = `<div class="row"><span class="k">收录 PR</span><span class="v"><span class="bad">没有 PR</span></span></div>`;
    if (github.pr) {
      const waited = (Date.now() - Date.parse(github.pr.createdAt)) / 3600000;
      if (github.pr.mergedAt) {
        prHtml = `<div class="row"><span class="k">收录 PR</span><span class="v">${dot('good')} #${github.pr.number} 已合并</span></div>`;
      } else if (github.pr.state === 'open') {
        prHtml = `<div class="row"><span class="k">收录 PR</span><span class="v">${dot('warn')} #${github.pr.number} 待合并 · 已等 <b>${hoursText(waited)}</b><span class="muted">（${esc(median)}）</span></span></div>`;
      } else {
        prHtml = `<div class="row"><span class="k">收录 PR</span><span class="v">#${github.pr.number} ${esc(github.pr.state)}</span></div>`;
      }
    }
    rows.push(prHtml);

    if (npm?.published === true) {
      rows.push(`<div class="row"><span class="k">npm</span><span class="v">${dot('good')} 有包 ${esc(npm.version ?? '')}</span></div>`);
    }

    const head = listed ? 'listed' : (github.exists === true ? 'shipped' : 'local');
    const headText = listed ? '已上市场' : (github.exists === true ? '已发布 · 等收录' : '仅本地');

    return `<section class="card ${head}">
      <header>
        <h2>${esc(work.name)}</h2>
        <span class="badge">${esc(work.category ?? '—')}</span>
        <span class="state">${headText}</span>
      </header>
      ${rows.join('\n      ')}
    </section>`;
  }).join('\n    ');

  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>作品看板 · ${esc(report.owner)}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 32px; background: #0d1117; color: #e6edf3;
         font-family: "Segoe UI", "Microsoft YaHei", system-ui, sans-serif; }
  .wrap { max-width: 980px; margin: 0 auto; }
  h1 { font-size: 26px; margin: 0 0 4px; letter-spacing: .5px; }
  .sub { color: #8b949e; font-size: 13px; margin-bottom: 22px; }
  .tiles { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-bottom: 24px; }
  .tile { background: #161b22; border: 1px solid #21262d; border-radius: 12px; padding: 14px 16px; }
  .tile .n { font-size: 26px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .tile .l { color: #8b949e; font-size: 12px; margin-top: 2px; }
  .card { background: #161b22; border: 1px solid #21262d; border-left: 3px solid #6e7681;
          border-radius: 12px; padding: 16px 18px; margin-bottom: 14px; }
  .card.listed { border-left-color: #3fb950; }
  .card.shipped { border-left-color: #d29922; }
  .card header { display: flex; align-items: baseline; gap: 10px; margin-bottom: 10px; }
  .card h2 { font-size: 17px; margin: 0; font-family: ui-monospace, Consolas, monospace; }
  .badge { font-size: 11px; color: #8b949e; border: 1px solid #30363d; border-radius: 999px; padding: 1px 8px; }
  .state { margin-left: auto; font-size: 12px; color: #8b949e; }
  .row { display: flex; gap: 10px; padding: 3px 0; font-size: 13px; line-height: 1.7; }
  .k { color: #8b949e; width: 68px; flex: none; }
  .v { font-variant-numeric: tabular-nums; }
  .muted { color: #6e7681; }
  .bad { color: #f85149; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
  footer { color: #6e7681; font-size: 12px; margin-top: 20px; line-height: 1.8; }
</style>
</head>
<body>
  <div class="wrap">
    <h1>🚢 作品看板</h1>
    <div class="sub">${esc(report.owner)} · 生成于 ${esc(shortTime(report.generatedAt))} · 登记表 ${esc(report.market.available === true ? `${report.market.count} 条（${report.market.updated ?? '?'}）` : '读不到')}</div>

    <div class="tiles">
      <div class="tile"><div class="n">${s.works}</div><div class="l">作品</div></div>
      <div class="tile"><div class="n">${s.published}</div><div class="l">已发布</div></div>
      <div class="tile"><div class="n">${s.listed}</div><div class="l">市场已收录</div></div>
      <div class="tile"><div class="n">${s.totalDownloads}</div><div class="l">总下载</div></div>
      <div class="tile"><div class="n">${s.openPrs}</div><div class="l">待合 PR</div></div>
    </div>

    ${cards}

    <footer>
      上游 ${esc(report.upstream?.upstream ?? '?')}：${esc(median)}${report.upstream?.samples ? `（样本 ${report.upstream.samples}）` : ''}<br>
      「市场已收录」= 市场登记表里能查到这个名字；「待合并」= 收录 PR 还开着。数字来自 GitHub API 与本机市场接口，**不经模型生成**。
    </footer>
  </div>
</body>
</html>
`;
}

/**
 * 把报告落盘成卡片（可选同时落一份 JSON）。
 * @param {object} report 报告
 * @param {object} opts 选项 `{ dir, html, json, now }`
 * @returns {Promise<{htmlPath:string|null, jsonPath:string|null}>} 落盘结果
 */
export async function writeReport(report, { dir, html = true, json = false, now = Date.now() } = {}) {
  const target = dir ?? join(process.env.USERPROFILE ?? process.env.HOME ?? '.', '.dsh', 'lighthouse-reports');
  await mkdir(target, { recursive: true });
  const stamp = new Date(now).toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const out = { htmlPath: null, jsonPath: null };
  if (html) {
    out.htmlPath = join(target, `lighthouse-${stamp}.html`);
    await writeFile(out.htmlPath, renderHtml(report), 'utf8');
  }
  if (json) {
    out.jsonPath = join(target, `lighthouse-${stamp}.json`);
    await writeFile(out.jsonPath, JSON.stringify(report, null, 2), 'utf8');
  }
  return out;
}
