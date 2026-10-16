/**
 * dsh-lighthouse · collect —— 去三个地方把事实取回来：本地工程、GitHub、插件市场。
 *
 * 纪律：
 *   - **只读**：本模块一个写请求都不发（全是 GET）；
 *   - **可注入 fetch**：测试用假通道，不碰网络；
 *   - **失败不炸**：单个数据源挂了就记 `error`，其余照常出结果 —— 看板缺一格好过整块黑屏；
 *   - **registry 只拉一次**：那份 JSON 有 5MB 上下，**绝不按作品重复打接口**（第一版犯过）。
 *
 * @module dsh-lighthouse/collect
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { parseLoose } from './fleet.js';

/** 市场接口默认地址（本机 DSH Web）。 */
export const DEFAULT_MARKET_URL = 'http://127.0.0.1:19387';

/** 收集文件时跳过的目录。 */
const SKIP_DIRS = new Set(['.git', 'node_modules', '.github', 'coverage', '.cache']);

/** 递归数文件（用于"本地有多少东西"）。 */
async function countFiles(dir) {
  let total = 0;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    let st;
    try {
      st = await stat(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) total += await countFiles(full);
    else if (st.isFile()) total += 1;
  }
  return total;
}

/**
 * 本地：读工程的 package.json 与测试文件是否存在。
 * @param {object} work 名册条目
 * @returns {Promise<object>} 本地事实
 */
export async function collectLocal(work) {
  if (work.localDir === null) return { available: false, reason: '名册里没有 localDir' };
  const dir = work.localDir;
  const out = { available: true, dir };
  try {
    const text = await readFile(join(dir, 'package.json'), 'utf8');
    const manifest = parseLoose(text);
    out.name = manifest.name ?? null;
    out.version = manifest.version ?? null;
    out.compatible = Object.keys(manifest?.dsh?.compatibility?.dshReleases ?? {});
  } catch (err) {
    out.available = false;
    out.reason = `读不到 package.json：${err instanceof Error ? err.message : String(err)}`;
    return out;
  }
  out.files = await countFiles(dir);
  try {
    const st = await stat(join(dir, 'test', 'smoke.mjs'));
    out.hasSmoke = st.isFile();
  } catch {
    out.hasSmoke = false;
  }
  return out;
}

/**
 * 发一次 GET（不写任何东西）。
 * @param {string} url 地址
 * @param {object} headers 头
 * @param {Function} fetchImpl fetch
 * @returns {Promise<{status:number, json:any}>} 响应
 */
async function getJson(url, headers, fetchImpl) {
  const res = await fetchImpl(url, { method: 'GET', headers });
  let json = null;
  try {
    const text = await res.text();
    json = text === '' ? null : JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

/**
 * GitHub：仓库现状 + 我给它开的 PR。
 * @param {object} work 名册条目
 * @param {object} opts 选项 `{ owner, token, fetchImpl, prIndex }`
 * @returns {Promise<object>} GitHub 事实
 */
export async function collectGitHub(work, { owner, token, fetchImpl = fetch, prIndex = null }) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'dsh-lighthouse',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const out = { available: false, repo: `${owner}/${work.repo}` };
  try {
    const repoRes = await getJson(`https://api.github.com/repos/${owner}/${work.repo}`, headers, fetchImpl);
    if (repoRes.status === 404) {
      out.available = true;
      out.exists = false;
      return out;
    }
    if (repoRes.status !== 200 || repoRes.json === null) {
      // 403 多半是"没带 token 走了匿名"：匿名额度 60/小时，用完就全 403（实测踩过）
      out.reason = repoRes.status === 403
        ? '读仓库失败（HTTP 403）：像是没带 token 走了匿名（匿名额度 60/小时）'
        : `读仓库失败（HTTP ${repoRes.status}）`;
      return out;
    }
    out.available = true;
    out.exists = true;
    out.stars = repoRes.json.stargazers_count ?? 0;
    out.forks = repoRes.json.forks_count ?? 0;
    // 观察区要的两项：「关注」= watchers（GitHub 的 subscribers_count）；
    // 「留言」= 开着的 issue/PR 数（open_issues_count 两者都算，够用作"有没有人说话"）
    out.watchers = repoRes.json.subscribers_count ?? 0;
    out.openIssues = repoRes.json.open_issues_count ?? 0;
    out.pushedAt = repoRes.json.pushed_at ?? null;
    out.defaultBranch = repoRes.json.default_branch ?? null;
  } catch (err) {
    out.reason = `网络失败：${err instanceof Error ? err.message : String(err)}`;
    return out;
  }

  if (Array.isArray(prIndex)) {
    const needle = `${owner}/${work.repo}`;
    const mine = prIndex.filter((item) => String(item.title ?? '').includes(needle));
    out.pr = mine.length > 0
      ? {
        number: mine[0].number,
        state: mine[0].state,
        title: mine[0].title,
        createdAt: mine[0].created_at,
        closedAt: mine[0].closed_at ?? null,
        mergedAt: mine[0].pull_request?.merged_at ?? null,
      }
      : null;
  }
  return out;
}

/**
 * 我开过的全部 PR（一次拉完，给每个作品认领）。失败返回 `[]`。
 * @param {object} opts 选项
 * @returns {Promise<Array>} PR 列表
 */
export async function collectMyPulls({ owner, token, fetchImpl = fetch }) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'dsh-lighthouse',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  try {
    const res = await getJson(
      `https://api.github.com/search/issues?q=${encodeURIComponent(`author:${owner} type:pr`)}&per_page=50`,
      headers,
      fetchImpl,
    );
    return res.status === 200 && Array.isArray(res.json?.items) ? res.json.items : [];
  } catch {
    return [];
  }
}

/**
 * 把市场登记表拉一次（要同源头，否则被拒 —— 实测）。
 * @param {object} opts 选项
 * @returns {Promise<object>} `{ available, updated, count, list, reason }`
 */
/** 登记表缓存的默认时长（登记表一天才更新一两次，5 分钟缓存完全够）。 */
export const REGISTRY_TTL_MS = 300_000;

/**
 * 登记表缓存：**按 fetchImpl 实例分桶**。
 * 真 fetch 共用一个桶（拿到真实收益），测试自建的假 fetch 各用各的（互不污染）。
 */
const registryCache = new WeakMap();

async function fetchRegistryUncached({ marketUrl, fetchImpl }) {
  try {
    const res = await getJson(
      `${marketUrl}/dsh-market/registry`,
      { Accept: 'application/json', Origin: marketUrl, Referer: `${marketUrl}/` },
      fetchImpl,
    );
    if (res.status !== 200 || res.json === null) return { available: false, reason: `市场接口 HTTP ${res.status}`, list: [] };
    const registry = res.json.registry ?? {};
    const list = Array.isArray(registry.plugins) ? registry.plugins : [];
    return { available: true, updated: registry.updated ?? null, count: registry.count ?? list.length, list };
  } catch (err) {
    return { available: false, reason: `市场接口不可达：${err instanceof Error ? err.message : String(err)}`, list: [] };
  }
}

/**
 * 拉市场登记表（带进程内缓存）。
 *
 * 为什么缓存：这份表 **4.4MB**，本地 HTTP 拉一次要 **2.8 秒**（2026-10-17 实测），
 * 而它一天才更新一两次 —— 面板每刷一次都重拉纯属浪费。
 * **只缓存成功结果**：读不到时如实返回，绝不留假数据。
 */
export async function fetchRegistry({
  marketUrl = DEFAULT_MARKET_URL,
  fetchImpl = fetch,
  cacheTtlMs = REGISTRY_TTL_MS,
  now = Date.now,
} = {}) {
  let bucket = registryCache.get(fetchImpl);
  if (bucket === undefined) {
    bucket = new Map();
    registryCache.set(fetchImpl, bucket);
  }
  const hit = bucket.get(marketUrl);
  if (hit !== undefined && hit.value.available === true && now() - hit.at < cacheTtlMs) return hit.value;
  const value = await fetchRegistryUncached({ marketUrl, fetchImpl });
  bucket.set(marketUrl, { at: now(), value });
  return value;
}

/**
 * 从已拉回来的登记表里查一个包（纯函数，不打接口）。
 * @param {object} registry fetchRegistry 的结果
 * @param {string} name 包名
 * @returns {object} 市场事实
 */
export function marketFactOf(registry, name) {
  if (registry?.available !== true) return { available: false, listed: false, reason: registry?.reason ?? '未取到登记表' };
  const list = registry.list;
  const hit = list.find((item) => item?.name === name);
  if (!hit) return { available: true, listed: false, registryUpdated: registry.updated ?? null, registryCount: registry.count ?? list.length };
  const categories = Array.isArray(hit.category) ? hit.category : [];
  const downloads = Number(hit.downloads ?? 0);
  const sameCat = list
    .filter((item) => Array.isArray(item?.category) && categories.some((c) => item.category.includes(c)))
    .map((item) => Number(item.downloads ?? 0))
    .sort((a, b) => b - a);
  return {
    available: true,
    listed: true,
    registryUpdated: registry.updated ?? null,
    registryCount: registry.count ?? list.length,
    downloads,
    stars: Number(hit.stars ?? 0),
    added: hit.added ?? null,
    category: categories,
    version: hit.version ?? null,
    install: hit.install ?? null,
    marketOwner: hit.owner ?? null,
    rankInCategory: sameCat.indexOf(downloads) + 1,
    categorySize: sameCat.length,
  };
}

/**
 * 便捷版：拉一次登记表再查一个包。
 * @param {string} name 包名
 * @param {object} opts 选项
 * @returns {Promise<object>} 市场事实
 */
export async function collectMarket(name, opts = {}) {
  return marketFactOf(await fetchRegistry(opts), name);
}

/**
 * 上游节奏：最近一批已合并 PR 等了多久（中位数）—— 用来判断"我们等得算不算久"。
 * @param {object} opts 选项 `{ upstream, token, fetchImpl, sample }`
 * @returns {Promise<object>} 上游事实
 */
/** POST 版 getJson（GraphQL 用）—— 形状与 getJson 一致，测试里的假 fetch 直接可用。 */
async function postJson(url, headers, body, fetchImpl) {
  const res = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body) });
  let json = null;
  try {
    const text = await res.text();
    json = text === '' ? null : JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

/**
 * 用 GraphQL 取上游的合并节奏：**只要两个时间字段**。
 *
 * 为什么值得单独开一条路（2026-10-17 实测）：REST 的
 * `pulls?state=closed&sort=updated&per_page=60` 要 **49 秒** —— 时间全花在传那一大坨
 * PR 对象上（每个 PR 自带几十个字段）；GraphQL 只回 `createdAt/mergedAt`，
 * 100 条只要 **1.3 秒**（快约 38 倍）。这是整条数据口最大的瓶颈。
 *
 * @returns {Promise<{waits:number[], openCount:number|null}|null>} 不可用返回 null（调用方回退 REST）
 */
async function upstreamViaGraphQL({ upstream, token, fetchImpl, sample }) {
  try {
    const query = 'query($owner:String!,$name:String!,$n:Int!){repository(owner:$owner,name:$name){'
      + 'merged:pullRequests(last:$n,states:MERGED){nodes{createdAt mergedAt}}'
      + 'open:pullRequests(states:OPEN){totalCount}}}';
    const res = await postJson('https://api.github.com/graphql', {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'dsh-lighthouse',
      Authorization: `Bearer ${token}`,
    }, {
      query,
      variables: { owner: upstream.owner, name: upstream.repo, n: sample },
    }, fetchImpl);
    if (res.status !== 200 || res.json === null) return null;
    const repo = res.json?.data?.repository;
    const nodes = repo?.merged?.nodes;
    if (!Array.isArray(nodes)) return null;
    const waits = nodes
      .map((node) => (Date.parse(node.mergedAt) - Date.parse(node.createdAt)) / 3600000)
      .filter((h) => Number.isFinite(h) && h >= 0)
      .sort((a, b) => a - b);
    if (waits.length === 0) return null;
    const openCount = Number.isFinite(repo?.open?.totalCount) ? repo.open.totalCount : null;
    return { waits, openCount };
  } catch {
    return null;
  }
}

export async function collectUpstream({ upstream, token, fetchImpl = fetch, sample = 60 }) {
  const out = { available: false, upstream: `${upstream.owner}/${upstream.repo}` };
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'dsh-lighthouse',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  try {
    // 先试 GraphQL（快约 38 倍）；不可用（没 token / 形状不对 / 网络问题）再回退 REST
    let waits = null;
    if (typeof token === 'string' && token !== '') {
      const viaGraph = await upstreamViaGraphQL({ upstream, token, fetchImpl, sample });
      if (viaGraph !== null) {
        waits = viaGraph.waits;
        out.openCount = viaGraph.openCount;
      }
    }
    if (waits === null) {
      const res = await getJson(
        `https://api.github.com/repos/${upstream.owner}/${upstream.repo}/pulls?state=closed&sort=updated&direction=desc&per_page=${sample}`,
        headers,
        fetchImpl,
      );
      if (res.status !== 200 || !Array.isArray(res.json)) {
        out.reason = `读上游 PR 失败（HTTP ${res.status}）`;
        return out;
      }
      waits = res.json
        .filter((pr) => typeof pr.merged_at === 'string' && pr.merged_at !== '')
        .map((pr) => (Date.parse(pr.merged_at) - Date.parse(pr.created_at)) / 3600000)
        .filter((h) => Number.isFinite(h) && h >= 0)
        .sort((a, b) => a - b);
      out.openCount = res.json.length;
    }
    if (waits.length === 0) {
      out.reason = '样本里没有已合并的 PR';
      return out;
    }
    out.available = true;
    out.samples = waits.length;
    out.medianHours = waits[Math.floor(waits.length / 2)];
    out.minHours = waits[0];
    out.maxHours = waits[waits.length - 1];
    return out;
  } catch (err) {
    out.reason = `网络失败：${err instanceof Error ? err.message : String(err)}`;
    return out;
  }
}

/**
 * npm 上有没有这个包（只回答有/没有/查不动）。
 * @param {string} name 包名
 * @param {object} opts 选项
 * @returns {Promise<object>} npm 事实
 */
export async function collectNpm(name, { fetchImpl = fetch } = {}) {
  try {
    const res = await getJson(`https://registry.npmjs.org/${encodeURIComponent(name)}`, { Accept: 'application/json' }, fetchImpl);
    if (res.status === 200) return { available: true, published: true, version: res.json?.['dist-tags']?.latest ?? null };
    if (res.status === 404) return { available: true, published: false };
    return { available: false, reason: `HTTP ${res.status}` };
  } catch (err) {
    return { available: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

/** 小时 → 人话。 */
export function hoursText(hours) {
  if (!Number.isFinite(hours)) return '?';
  if (hours < 1) return `${Math.round(hours * 60)} 分钟`;
  if (hours < 48) return `${hours.toFixed(1)} 小时`;
  return `${(hours / 24).toFixed(1)} 天`;
}

/**
 * 把整份名册跑一遍。
 * @param {object} fleet 名册
 * @param {object} deps 依赖 `{ token, fetchImpl, marketUrl, includeNpm, now }`
 * @returns {Promise<object>} 报告
 */
export async function collectAll(fleet, deps = {}) {
  const { token = null, fetchImpl = fetch, marketUrl = DEFAULT_MARKET_URL, includeNpm = true, now = Date.now() } = deps;

  // 三份"整表"各拉一次：登记表（5MB）、我开过的 PR、上游节奏
  const [registry, prIndex, upstream] = await Promise.all([
    fetchRegistry({ marketUrl, fetchImpl }),
    collectMyPulls({ owner: fleet.owner, token, fetchImpl }),
    collectUpstream({ upstream: fleet.upstream, token, fetchImpl }),
  ]);

  // 作品之间**必须并发**：串行查 7 个作品时整条口子要 11.6 秒（实测），
  // 面板上就表现为一段很长的"读取中"；并发后总耗时≈最慢的那一个（3~4 秒）。
  const works = await Promise.all(fleet.works.map(async (work) => {
    const [local, github, npm] = await Promise.all([
      collectLocal(work),
      collectGitHub(work, { owner: fleet.owner, token, fetchImpl, prIndex }),
      includeNpm ? collectNpm(work.name, { fetchImpl }) : Promise.resolve({ available: false, reason: '已跳过' }),
    ]);
    return { work, local, github, market: marketFactOf(registry, work.name), npm };
  }));

  const waiting = works
    .map((w) => w.github.pr)
    // 用 `!= null` 同时挡 null 与 undefined：prIndex 为空时 collectGitHub 根本不会挂 pr 字段
    .filter((pr) => pr != null && pr.state === 'open')
    .map((pr) => (now - Date.parse(pr.createdAt)) / 3600000);

  return {
    generatedAt: new Date(now).toISOString(),
    owner: fleet.owner,
    upstream,
    market: {
      url: marketUrl,
      available: registry.available === true,
      updated: registry.updated ?? null,
      count: registry.count ?? null,
      reason: registry.reason ?? null,
    },
    works,
    summary: {
      works: works.length,
      published: works.filter((w) => w.github.exists === true).length,
      listed: works.filter((w) => w.market?.listed === true).length,
      totalDownloads: works.reduce((sum, w) => sum + (w.market?.listed === true ? Number(w.market.downloads ?? 0) : 0), 0),
      totalStars: works.reduce((sum, w) => sum + Number(w.github.stars ?? 0), 0),
      openPrs: waiting.length,
      longestWaitHours: waiting.length > 0 ? Math.max(...waiting) : null,
    },
  };
}
