# dsh-lighthouse（灯塔）

**一屏看清你发出去的每个作品现在怎么样了。**

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
| 市场接口 | `GET <marketUrl>/dsh-market/registry`（**要同源头**，否则被拒） | 默认 `http://127.0.0.1:19387`；登记表**只拉一次** |
| npm registry | 包在不在 | 默认开，`--no-npm` / `includeNpm:false` 可关 |

PAT 依次找：`tokenFile` → 环境变量 `DSH_SLIPWAY_TOKEN_FILE` → `~/.dsh/.gh-token` → `D:\dsh\.gh-token`。

## 兼容性

- 运行时：**DSH 0.2.0-rc.2**（实测使用的版本）。
- `peerDependencies` 用显式范围；拿不到 `@deepseek-ai/dsh-tools` 时 `defineTool` 退化成恒等（CLI/测试照常）。
- 插件只注册工具与一段提示词，不挂任何前台服务、不轮询、不占资源（只在被调用时跑一次）。

## 自测

```powershell
node test/smoke.mjs    # 全假网络（GitHub/市场/npm 都是假的），不碰真宿主、不碰外网
```

## License

MIT
