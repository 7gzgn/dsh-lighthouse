#!/usr/bin/env node
/**
 * dsh-lighthouse · CLI —— 不开会话也能看板。
 *
 *   dsh-lighthouse report [--fleet <路径>] [--dir <卡片目录>] [--no-npm] [--no-html] [--json]
 *   dsh-lighthouse fleet  [--fleet <路径>]
 *   dsh-lighthouse init   --owner <账号> --works <JSON 数组> [--fleet <路径>]
 *
 * 退出码：0 成功；1 名册读不到或有问题；2 用法错误。
 *
 * @module dsh-lighthouse/bin
 */

import { defaultFleetPath, readFleet, validateFleet, writeFleet } from '../lib/fleet.js';
import { defaultMarketUrl, defaultReportDir, runReport } from '../lib/index.js';
import { LIGHTHOUSE_GUIDANCE } from '../lib/index.js';

/** 极简参数解析。 */
function parseArgv(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else { out[key] = next; i += 1; }
    } else {
      out._.push(token);
    }
  }
  return out;
}

const USAGE = `dsh-lighthouse —— 作品看板

用法：
  dsh-lighthouse report [--fleet <名册路径>] [--dir <卡片目录>] [--no-npm] [--no-html] [--json]
  dsh-lighthouse fleet  [--fleet <名册路径>]
  dsh-lighthouse init   --owner <GitHub 账号> --works '<JSON 数组>' [--fleet <名册路径>]

名册默认：${defaultFleetPath()}
卡片默认目录：${defaultReportDir()}
市场接口默认：${defaultMarketUrl()}

${LIGHTHOUSE_GUIDANCE}
`;

async function main() {
  const argv = parseArgv(process.argv.slice(2));
  const cmd = argv._[0] ?? 'report';
  const fleetPath = argv.fleet ?? defaultFleetPath();

  if (cmd === 'help' || argv.help === true) {
    console.log(USAGE);
    return 0;
  }

  if (cmd === 'fleet') {
    const read = await readFleet(fleetPath);
    console.log(`名册：${fleetPath}`);
    if (read.ok !== true) {
      for (const e of read.errors) console.log(`  ❌ ${e}`);
      return 1;
    }
    console.log(`  owner：${read.fleet.owner}`);
    console.log(`  上游：${read.fleet.upstream.owner}/${read.fleet.upstream.repo}@${read.fleet.upstream.branch}`);
    console.log(`  作品（${read.fleet.works.length}）：`);
    for (const work of read.fleet.works) {
      console.log(`    · ${work.name}${work.category ? `（${work.category}）` : ''}${work.localDir ? ` ← ${work.localDir}` : ''}`);
    }
    return 0;
  }

  if (cmd === 'init') {
    let works;
    try {
      works = JSON.parse(String(argv.works ?? ''));
    } catch {
      console.error('❌ --works 不是合法 JSON 数组');
      return 2;
    }
    const checked = validateFleet({ owner: argv.owner, upstream: { owner: argv['upstream-owner'], repo: argv['upstream-repo'] }, works });
    if (checked.ok !== true) {
      console.error(`❌ ${checked.errors.join('；')}`);
      return 2;
    }
    const written = await writeFleet(fleetPath, checked.fleet);
    console.log(`✅ 名册已写入：${written}（${checked.fleet.works.length} 个作品）`);
    return 0;
  }

  if (cmd === 'report') {
    const result = await runReport({
      fleetFile: fleetPath,
      reportDir: argv.dir,
      includeNpm: argv['no-npm'] !== true,
      html: argv['no-html'] !== true,
      json: argv.json === true,
    });
    if (result.ok !== true) {
      for (const e of result.errors) console.error(`❌ ${e}`);
      return 1;
    }
    const s = result.report.summary;
    console.log(`📡 作品看板｜${result.report.generatedAt}`);
    console.log(`  作品 ${s.works} · 已发布 ${s.published} · 已收录 ${s.listed} · 总下载 ${s.totalDownloads} · 待合 PR ${s.openPrs}`);
    for (const item of result.report.works) {
      const { work, local, github, market } = item;
      const bits = [];
      bits.push(local.available === true ? `本地 ${local.version ?? '?'}` : '本地 读不到');
      bits.push(github.exists === true ? `star ${github.stars}` : 'GitHub 无/读不到');
      bits.push(market.listed === true ? `市场已收录（${market.downloads} 下载）` : (market.available === true ? '市场未收录' : '市场读不到'));
      if (github.pr) bits.push(`PR #${github.pr.number} ${github.pr.mergedAt ? '已合并' : github.pr.state}`);
      console.log(`  · ${work.name}：${bits.join('｜')}`);
    }
    if (result.htmlPath) console.log(`\n卡片：${result.htmlPath}`);
    if (result.jsonPath) console.log(`JSON：${result.jsonPath}`);
    return 0;
  }

  console.error(`未知子命令：${cmd}\n\n${USAGE}`);
  return 2;
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((err) => {
    console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
