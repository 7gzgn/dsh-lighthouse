/**
 * dsh-lighthouse · 客户端半 —— 「作品观察区」。
 *
 * 一句话：**给用户一个点开就能看的窗口** —— 每个作品现在怎么样了：
 * 发布了没有（✅ / ⏳ / ❌）、多少星、多少人关注、有没有人留言、收录 PR 排到哪。
 *
 * 它只画，不算：数据全来自 host 半的只读接口 `GET /dsh-lighthouse/status`
 * （同一个数字在面板、工具、卡片里必须一致）。
 *
 * 座位：
 *   · `sidebar.panellist` —— 侧栏那个图标（组件收到 `{ size, active }`）；
 *   · `main`（keyed = 本插件 id）—— 点图标后中间出现的那一屏。
 *   两者的 id 必须一致 —— 侧栏就是靠这个 id 找到要切到哪个 main 面板的。
 *
 * 形态：Plain ModuleLoader bundle（无构建步骤），与官方插件的客户端半同构。
 */
window.__ModuleLoader__.load({ id: "dsh-lighthouse", factory: (require) => {
  var module = { exports: {} }
  var exports = module.exports
  Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" })

  const react = require("react")
  const h = react.createElement
  const { useCallback, useEffect, useState } = react

  const name = "dsh-lighthouse"
  const inject = ["slots"]
  const PANEL_ID = "dsh-lighthouse"
  const ROUTE = "/dsh-lighthouse/status"

  /* ------------------------------------------------------------ 小工具 */

  /** 一次性注入样式，重复 apply 不叠加。 */
  function installStyles() {
    const id = "dsh-lighthouse-styles"
    if (document.getElementById(id)) return
    const node = document.createElement("style")
    node.id = id
    node.textContent = `
.lh-root { padding: 18px 22px 40px; max-width: 900px; margin: 0 auto; color: inherit; }
.lh-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.lh-title { font-size: 18px; font-weight: 650; margin: 0; }
.lh-sub { font-size: 12px; opacity: .62; }
.lh-btn { margin-left: auto; font-size: 12px; padding: 4px 10px; border-radius: 7px; cursor: pointer;
  border: 1px solid rgba(128,128,128,.35); background: rgba(128,128,128,.08); color: inherit; }
.lh-btn:hover { background: rgba(128,128,128,.16); }
.lh-btn:disabled { opacity: .5; cursor: default; }
.lh-tiles { display: flex; gap: 10px; flex-wrap: wrap; margin: 14px 0 18px; }
.lh-tile { flex: 1 1 96px; min-width: 96px; border: 1px solid rgba(128,128,128,.22); border-radius: 10px; padding: 9px 12px; }
.lh-tile b { display: block; font-size: 19px; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1.25; }
.lh-tile span { font-size: 11px; opacity: .62; }
.lh-card { border: 1px solid rgba(128,128,128,.22); border-left-width: 3px; border-radius: 10px;
  padding: 11px 14px; margin-bottom: 10px; }
.lh-card.ok { border-left-color: #3fb950; }
.lh-card.wait { border-left-color: #d29922; }
.lh-card.bad { border-left-color: #f85149; }
.lh-row { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.lh-name { font-size: 13.5px; font-weight: 650; font-family: ui-monospace, Consolas, monospace; }
.lh-tag { font-size: 10.5px; opacity: .58; border: 1px solid rgba(128,128,128,.3); border-radius: 999px; padding: 0 7px; }
.lh-line { font-size: 12.5px; margin-top: 4px; display: flex; gap: 12px; flex-wrap: wrap; }
.lh-k { opacity: .58; }
.lh-num { font-variant-numeric: tabular-nums; font-weight: 600; }
.lh-state { font-size: 12px; }
.lh-dim { opacity: .55; }
.lh-err { color: #f85149; font-size: 12.5px; margin: 8px 0; }
.lh-empty { opacity: .6; font-size: 13px; padding: 24px 0; text-align: center; }
`
    document.head.appendChild(node)
  }

  /** 小时 → 人话。 */
  function hoursText(hours) {
    if (!Number.isFinite(hours)) return "?"
    if (hours < 1) return Math.round(hours * 60) + " 分钟"
    if (hours < 48) return hours.toFixed(1) + " 小时"
    return (hours / 24).toFixed(1) + " 天"
  }

  /** ISO 时间 → MM-DD HH:mm。 */
  function shortTime(iso) {
    if (typeof iso !== "string" || iso === "") return "—"
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return "—"
    const p = (n) => String(n).padStart(2, "0")
    return p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes())
  }

  /* --------------------------------------------------------------- 取数 */

  /**
   * 拉一次状态。只读接口，失败就把原因原样显示出来（不编数字）。
   */
  function useStatus() {
    const [state, setState] = useState({ loading: true, report: null, error: null, at: 0 })
    const load = useCallback(function () {
      setState(function (prev) { return { ...prev, loading: true } })
      fetch(ROUTE, { credentials: "same-origin", cache: "no-store" })
        .then(function (res) { return res.json() })
        .then(function (json) {
          if (json && json.ok === true) {
            setState({ loading: false, report: json.report, error: null, at: Date.now() })
          } else {
            const why = (json && json.errors ? json.errors.join("；") : (json && json.error) || "读不到")
            setState({ loading: false, report: null, error: why, at: Date.now() })
          }
        })
        .catch(function (err) {
          setState({ loading: false, report: null, error: String((err && err.message) || err), at: Date.now() })
        })
    }, [])
    useEffect(function () { load() }, [load])
    return { ...state, reload: load }
  }

  /* --------------------------------------------------------------- 组件 */

  /** 侧栏图标：一座灯塔。 */
  function PanelIcon() {
    return h("svg", {
      width: 16, height: 16, viewBox: "0 0 16 16", fill: "currentColor", "aria-hidden": "true",
    },
      h("path", { d: "M7.1 1.2h1.8v1.5l1.1.6.7 2.9H5.3l.7-2.9 1.1-.6V1.2z" }),
      h("path", { d: "M1.6 4.3 4 5.5l-.5 1.1L1 5.5l.6-1.2zm12.8 0 .6 1.2-2.5 1.1-.5-1.1 2.4-1.2z" }),
      h("path", { d: "M5.1 7.4h5.8l1.3 7.4H3.8l1.3-7.4z" }),
      h("path", { d: "M6.2 9.2h3.6v1.1H6.2V9.2z", fill: "rgba(0,0,0,.35)" })
    )
  }

  /** 一个数字格。 */
  function Tile(props) {
    return h("div", { className: "lh-tile" },
      h("b", null, String(props.value)),
      h("span", null, props.label)
    )
  }

  /**
   * 一个作品一张卡。**状态用图标说话**：
   * 已发布 ✅；收录/PR 还在路上 ⏳；读不到 ❌（并写出原因）。
   */
  function WorkCard(props) {
    const item = props.item
    const work = item.work || {}
    const local = item.local || {}
    const gh = item.github || {}
    const market = item.market || {}
    const released = gh.exists === true
    const listed = market.listed === true
    const pr = gh.pr
    const cls = listed ? "lh-card ok" : (released ? "lh-card wait" : "lh-card bad")

    const stateLine = []
    stateLine.push(h("span", { key: "rel", className: "lh-state" },
      released ? "✅ 已发布" : (gh.exists === false ? "❌ 仓库不存在" : "❌ 读不到仓库")))
    stateLine.push(h("span", { key: "mk", className: "lh-state" },
      listed
        ? "✅ 市场已收录" + (market.downloads !== undefined ? "（下载 " + market.downloads + "）" : "")
        : (market.available === true ? "⏳ 收录中" : "❌ 市场读不到")))
    if (pr) {
      const waited = (Date.now() - Date.parse(pr.createdAt)) / 3600000
      stateLine.push(h("span", { key: "pr", className: "lh-state" },
        pr.mergedAt
          ? "✅ PR #" + pr.number + " 已合并"
          : (pr.state === "open" ? "⏳ PR #" + pr.number + " 等 " + hoursText(waited) : "· PR #" + pr.number + " " + pr.state)))
    } else {
      stateLine.push(h("span", { key: "nopr", className: "lh-state lh-dim" }, "· 没有收录 PR"))
    }

    return h("div", { className: cls },
      h("div", { className: "lh-row" },
        h("span", { className: "lh-name" }, work.name || "?"),
        work.category ? h("span", { className: "lh-tag" }, work.category) : null,
        h("span", { className: "lh-sub", style: { marginLeft: "auto" } },
          "本地 " + (local.available === true ? (local.version || "?") + " · " + (local.files || 0) + " 文件" : "读不到"))
      ),
      h("div", { className: "lh-line" },
        h("span", null, h("span", { className: "lh-k" }, "⭐ 星 "), h("span", { className: "lh-num" }, String(gh.stars || 0))),
        h("span", null, h("span", { className: "lh-k" }, "👁 关注 "), h("span", { className: "lh-num" }, String(gh.watchers || 0))),
        h("span", null, h("span", { className: "lh-k" }, "💬 留言 "), h("span", { className: "lh-num" }, String(gh.openIssues || 0))),
        h("span", null, h("span", { className: "lh-k" }, "最后推送 "), h("span", null, shortTime(gh.pushedAt)))
      ),
      h("div", { className: "lh-line" }, stateLine)
    )
  }

  /** 观察区主体。 */
  function WatchPanel() {
    const { loading, report, error, at, reload } = useStatus()
    const s = (report && report.summary) || null

    const body = []
    if (error !== null) {
      body.push(h("div", { className: "lh-err", key: "err" }, "读不到：" + error))
    }
    if (s !== null) {
      body.push(h("div", { className: "lh-tiles", key: "tiles" },
        h(Tile, { key: "w", value: s.works, label: "作品" }),
        h(Tile, { key: "p", value: s.published, label: "已发布" }),
        h(Tile, { key: "l", value: s.listed, label: "市场已收录" }),
        h(Tile, { key: "d", value: s.totalDownloads, label: "总下载" }),
        h(Tile, { key: "pr", value: s.openPrs, label: "待合 PR" })
      ))
      const list = Array.isArray(report.works) ? report.works : []
      for (const item of list) body.push(h(WorkCard, { key: item.work && item.work.name, item }))
      if (list.length === 0) body.push(h("div", { className: "lh-empty", key: "empty" }, "名册里还没有作品"))
    }
    if (report === null && error === null && loading === true) {
      body.push(h("div", { className: "lh-empty", key: "loading" }, "读取中…"))
    }

    return h("div", { className: "lh-root" },
      h("div", { className: "lh-head" },
        h("h1", { className: "lh-title" }, "🚢 作品观察区"),
        h("span", { className: "lh-sub" },
          at ? "更新于 " + shortTime(new Date(at).toISOString())
             : (report && report.generatedAt ? "数据 " + shortTime(report.generatedAt) : "")),
        h("button", { className: "lh-btn", onClick: reload, disabled: loading === true, type: "button" },
          loading === true ? "刷新中…" : "刷新")
      ),
      h("div", { className: "lh-sub", style: { marginTop: "6px" } },
        report && report.market
          ? "市场登记表：" + (report.market.available === true
            ? (report.market.count || "?") + " 条（更新于 " + (report.market.updated || "?") + "）"
            : "读不到（" + (report.market.reason || "?") + "）")
          : "全部数字来自 GitHub API 与本机市场接口，不经模型生成。"),
      body
    )
  }

  /* --------------------------------------------------------------- 挂载 */

  function apply(ctx) {
    installStyles()
    // 侧栏图标：id 就是 main 面板的 key，两者必须一致
    ctx.slots.inject("sidebar.panellist", function () {
      return ctx.slots.register({
        name: "sidebar.panellist",
        id: PANEL_ID,
        order: 60,
        label: function () { return "作品观察区" },
      }, PanelIcon)
    })
    // 中间那一屏
    ctx.slots.inject("main", function () {
      return ctx.slots.register({ name: "main", key: PANEL_ID }, WatchPanel)
    })
  }

  exports.name = name
  exports.inject = inject
  exports.apply = apply
  return module.exports
}})
