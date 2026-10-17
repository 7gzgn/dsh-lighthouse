# dsh-lighthouse（灯塔）

**一屏看清你发出去的每个作品现在怎么样了 —— 而且能点开看。**

## 界面观察区（v0.2 新增）

DSH 侧栏多一个**灯塔图标**，点开就是一块观察面板 —— 每个作品一张卡：

| 看什么 | 怎么显示 |
| --- | --- |
| 发布了没有 | ✅ 已发布 ／ ❌ 仓库不存在 ／ ❌ 读不到 |
| 市场收录 | ✅ 已收录（带下载量）／ ⏳ 收录中 ／ ❌ 读不到 |
| 收录 PR | ✅ 已合并 ／ ⏳ 等 N 小时（天）／ —— 没有 |
| 星 · 关注 · 留言 | ⭐ / 👁 / 💬 三个数字（GitHub stars / watchers / open issues） |
| 本地与推送 | 本地版本 · 文件数 · 最后推送时间 |

右上角一个「刷新」，打开面板时自动拉一次；数据来自 host 那条只读接口 `/dsh-lighthouse/status` ——
同一个数字在**面板、工具、卡片**里必然一致（走的是同一条采集路径）。

本地拿的是什么版本、GitHub 有没有动静、**市场收没收录、被下载多少次**、给收录 PR 等了多久（对比上游中位数）——
全部来自 API，**一个数字都不经模型生成**，读不到就写"读不到"。

> 名字的来由：船下水之后就看不见了。灯塔是岸上那盏灯 ——
> 专门盯着"我的作品现在在哪一步、有没有人上船"。

---

## 它回答什么问题

- 我发出去的东西，**市场收了吗**？（"未收录" vs "已收录"）
- 有没有人用？**下载多少、在同类里排第几**？
- 收录 PR 等了多久？——**和上游的中位数比，算不算久**？
- 本地那份和线上那份，是同一条船吗？（版本、最后推送时间）
- npm 上有没有？（默认查，可关）

## 作品多了怎么办（v0.2.5）

≤ 12 个作品时是一作品一张卡（信息最全）。**超过 12 个自动切紧凑视图**：

- 文本回执：一行一个作品（`名字｜v版本｜star｜市场｜PR 等待`），不再每个占两行；
- HTML 卡片：换成**一张排序表格**（作品 / 分类 / 版本 / GitHub / 市场 / 收录 PR），汇总条与表头**滚动吸顶**，
  不用滑到底再回来对表头；
- **排序按"要不要人管"**：①需要处理（仓库读不到 / 没有 PR / 市场读不到）②等收录（等得久的在前）③已收录。
  50 个作品时，你第一眼看到的就是那几个有问题的，而不是按名册顺序从上翻。

> 表格是纯静态 HTML（内联样式，无脚本），所以不能搜索/过滤 —— 需要筛选就走名册（`lighthouse_fleet`）把范围缩到一组。

## 只读承诺

- **全部是 GET 请求**：不动仓库、不开 PR、不写任何远端。
- **不编数字**：任何一个数据源读不到，就标 `读不到（原因）`，不会用估算值糊过去。
- **名册显式**：灯塔照着名册看，**不自动发现**作品 —— 从目录名或包名前缀去猜"哪些是你的作品"，
  猜错了会把别人的仓库报进你的看板。

## 名册（fleet）

默认路径 `~/.dsh/lighthouse-fleet.json`：

```json
{
  "version": 1,
  "owner": "7gzgn",
  "upstream": { "owner": "awesome-dsh-plugin", "repo": "awesome-dsh-plugin", "branch": "main" },
  "works": [
    {
      "name": "dsh-slipway",
      "repo": "dsh-slipway",
      "category": "tools",
      "localDir": "D:\\dsh\\projects\\dsh-slipway"
    }
  ]
}
```

- `owner` 与 `works` **必填**（缺了直接报错，不猜）。
- `localDir` 可省：省了就只看线上那一半。
- 用工具或命令写它：

```
lighthouse_fleet action=init owner=7gzgn works='[{"name":"dsh-slipway","repo":"dsh-slipway","category":"tools","localDir":"D:\\dsh\\projects\\dsh-slipway"}]'
dsh-lighthouse init --owner 7gzgn --works '[…]'
```

## 安装

市场收录后在 DSH 里搜 `dsh-lighthouse` 安装。手动安装：

```powershell
New-Item -ItemType Junction -Path "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-lighthouse" -Target "D:\dsh\projects\dsh-lighthouse"
# profile 的 package.json：dependencies 加 "dsh-lighthouse": "link:D:/dsh/projects/dsh-lighthouse"
# 并把 "dsh-lighthouse" 加进 dsh.profile.bundles（漏了不加载）→ 重启 DSH
```

## 用法

### 工具

```
lighthouse_report  [fleetFile] [html] [includeNpm] [marketUrl] [reportDir]
lighthouse_fleet   action=show|init …
```

`lighthouse_report` 返回一段汇总文本，并把一张**单文件 HTML 卡片**落到
`~/.dsh/lighthouse-reports/lighthouse-<时间戳>.html` —— 无外链、无脚本依赖，可直接打开或截图。

### 命令

```powershell
dsh-lighthouse report [--fleet <路径>] [--dir <卡片目录>] [--no-npm] [--no-html] [--json]
dsh-lighthouse fleet  [--fleet <路径>]
```

## 数据从哪来

| 来源 | 取什么 | 备注 |
| --- | --- | --- |
| 本地工程 | `package.json` 的版本、文件数、有没有 `test/smoke.mjs` | 只读文件 |
| GitHub API | 仓库是否存在、star/fork、最后推送、**我开的收录 PR 状态** | 需要 PAT（`repo` scope）时更全 |
| 市场接口 | `GET <marketUrl>/dsh-market/registry`（**要同源头**，否则被拒） | **默认取宿主 web 服务的 origin**（`ctx.get('webServer').getOrigin()`，比如 `http://127.0.0.1:56497`）；登记表只拉一次、进程内缓存 5 分钟 |
| npm registry | 包在不在 | 默认开，`--no-npm` / `includeNpm:false` 可关 |

> **市场地址为什么不能再写死端口**：登记表路由挂在宿主自己的 web 服务上，端口每次启动都可能变；
> 写死 `19387` 的后果不是报错，而是报告里一片 **0 收录 / 0 下载** —— 看起来像"没人用"，
> 其实是"没读到"。v0.2.4 起：默认向 `webServer.getOrigin()` 要地址；**读不到时整行不报数**，
> 并明确写"市场数据读不到（不显示 0，免得被当成没人用）"。

PAT 依次找：`tokenFile` → 环境变量 `DSH_SLIPWAY_TOKEN_FILE` → `~/.dsh/.gh-token` → `D:\dsh\.gh-token`。

## 它还会替你盯一件事

**哪些收录 PR 已经等了超过上游中位数**。报告里单独一行点名（`#编号（等了多久）`），
没有超的也明说"都还在正常等待区间" —— 这样"要不要去催"不用自己算。

## 兼容性

- 运行时：**DSH 0.2.1-rc.2**（实测使用的版本）。
- `peerDependencies` 用显式范围；拿不到 `@deepseek-ai/dsh-tools` 时 `defineTool` 退化成恒等（CLI/测试照常）。
- 插件只注册工具与一段提示词，不挂任何前台服务、不轮询、不占资源（只在被调用时跑一次）。

## 自测

```powershell
node test/smoke.mjs    # 全假网络（GitHub/市场/npm 都是假的），不碰真宿主、不碰外网
```

## License

MIT
