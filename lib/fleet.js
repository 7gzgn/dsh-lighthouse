/**
 * dsh-lighthouse · fleet —— 舰队名册：灯塔照着这份名册看，不猜。
 *
 * 名册是**显式文件**（默认 `~/.dsh/lighthouse-fleet.json`），形状：
 * ```json
 * {
 *   "version": 1,
 *   "owner": "7gzgn",
 *   "upstream": { "owner": "awesome-dsh-plugin", "repo": "awesome-dsh-plugin", "branch": "main" },
 *   "works": [
 *     { "name": "dsh-slipway", "repo": "dsh-slipway", "category": "tools", "localDir": "D:\\dsh\\projects\\dsh-slipway" }
 *   ]
 * }
 * ```
 * 为什么不做"自动发现"：**目标必须被明确指认** —— 从目录名或包名前缀去猜
 * "哪些是你的作品"，猜错了就会把别人的仓库报进你的看板。
 *
 * @module dsh-lighthouse/fleet
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** 名册格式版本。 */
export const FLEET_VERSION = 1;

/** 默认名册路径。 */
export function defaultFleetPath() {
  const home = process.env.USERPROFILE ?? process.env.HOME ?? '';
  return join(home, '.dsh', 'lighthouse-fleet.json');
}

/** 去掉 BOM 并解析 JSON。 */
export function parseLoose(text) {
  return JSON.parse(String(text).replace(/^\uFEFF/, ''));
}

/**
 * 校验名册。**缺 owner 或缺 works 就是错**，不做补全。
 * @param {any} data 名册内容
 * @returns {{ok:boolean, errors:string[], fleet?:object}} 结论
 */
export function validateFleet(data) {
  const errors = [];
  if (data === null || typeof data !== 'object') {
    return { ok: false, errors: ['名册不是对象'] };
  }
  const owner = data.owner;
  if (typeof owner !== 'string' || owner.trim() === '') {
    errors.push('名册缺 owner（GitHub 账号）—— 不猜，必须显式写');
  }
  if (!Array.isArray(data.works) || data.works.length === 0) {
    errors.push('名册的 works 必须是非空数组');
  } else {
    data.works.forEach((work, index) => {
      if (work === null || typeof work !== 'object') {
        errors.push(`works[${index}] 不是对象`);
        return;
      }
      if (typeof work.name !== 'string' || work.name.trim() === '') errors.push(`works[${index}] 缺 name`);
      if (typeof work.repo !== 'string' || work.repo.trim() === '') errors.push(`works[${index}] 缺 repo`);
      if (work.localDir !== undefined && typeof work.localDir !== 'string') errors.push(`works[${index}] 的 localDir 必须是字符串`);
    });
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    errors: [],
    fleet: {
      version: typeof data.version === 'number' ? data.version : FLEET_VERSION,
      owner: owner.trim(),
      upstream: {
        owner: data.upstream?.owner ?? 'awesome-dsh-plugin',
        repo: data.upstream?.repo ?? 'awesome-dsh-plugin',
        branch: data.upstream?.branch ?? 'main',
      },
      works: data.works.map((work) => ({
        name: work.name.trim(),
        repo: work.repo.trim(),
        category: typeof work.category === 'string' ? work.category : null,
        localDir: typeof work.localDir === 'string' && work.localDir !== '' ? work.localDir : null,
      })),
    },
  };
}

/**
 * 读名册。
 * @param {string} file 路径
 * @param {object} [deps] 依赖（测试注入 readFileImpl）
 * @returns {Promise<{ok:boolean, errors:string[], fleet?:object, path:string}>} 结论
 */
export async function readFleet(file, deps = {}) {
  const read = deps.readFileImpl ?? readFile;
  let text;
  try {
    text = await read(file, 'utf8');
  } catch (err) {
    return { ok: false, errors: [`名册读不到（${file}）：${err instanceof Error ? err.message : String(err)}`], path: file };
  }
  let data;
  try {
    data = parseLoose(text);
  } catch (err) {
    return { ok: false, errors: [`名册不是合法 JSON：${err instanceof Error ? err.message : String(err)}`], path: file };
  }
  const checked = validateFleet(data);
  return { ...checked, path: file };
}

/**
 * 写名册（建目录、格式化、带尾换行）。
 * @param {string} file 路径
 * @param {object} fleet 名册
 * @param {object} [deps] 依赖
 * @returns {Promise<string>} 实际写入的路径
 */
export async function writeFleet(file, fleet, deps = {}) {
  const write = deps.writeFileImpl ?? writeFile;
  const mk = deps.mkdirImpl ?? mkdir;
  await mk(dirname(file), { recursive: true });
  await write(file, `${JSON.stringify({ version: FLEET_VERSION, ...fleet }, null, 2)}\n`, 'utf8');
  return file;
}
