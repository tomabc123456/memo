# 智能待办清单 · 项目规划与要点

> 本文档用于「快速回到现场」。打开新会话时只需读这一份，即可在 60 秒内重建上下文，进入迭代。
> 最近一次梳理：2026-05-01

---

## 一、项目快照

| 项目 | 内容 |
|---|---|
| 名称 | 智能待办清单（Chrome 扩展，MV3） |
| 当前版本 | 1.0.0 |
| 技术栈 | 原生 JS + Chrome Extension API（无任何前端框架、无构建依赖） |
| 规模 | popup.js 532 行 / background.js 100 行 / build_extension.py 746 行 |
| 持久化 | `chrome.storage.local` |
| 通知通道 | 本地系统通知 + Telegram Bot |
| 入口 | 点击工具栏图标 → `popup.html`（480 × 600） |

**一句话功能：** 一个支持 P0–P3 优先级、截止时间、提前一次提醒 + 间歇反复提醒、任务评论、Telegram 数据备份的浏览器待办插件。

---

## 二、目录与构建流程 ⚠️

```
memo/
├── build_extension.py      ← 真正的「源代码」：所有 JS/HTML/CSS 以字符串形式内嵌
├── todo-extension/         ← 构建产物（运行 build_extension.py 后会被全量覆盖）
│   ├── manifest.json
│   ├── popup.html
│   ├── popup.js            ← 主 UI 逻辑
│   ├── background.js       ← Service Worker
│   ├── style.css
│   └── icons/{16,48,128}.png
├── todo-extension.zip      ← 同步生成的可分发包
├── my_icons/               ← 用户自定义图标存放处（可选，缺失则自动生成纯色占位）
└── PROJECT_GUIDE.md        ← 本文档
```

### 🚨 最重要的一条规则

**修改 `todo-extension/` 里的文件不会持久化** —— 下一次跑 `build_extension.py` 会被覆盖。

**修改顺序：**

1. 编辑 `build_extension.py` 中对应文件的字符串（找到 `FILES["popup.js"] = """..."""` 这种位置）。
2. 也可以先在 `todo-extension/` 直接调，调好后 **必须把改动回贴到 `build_extension.py`**。
3. `python build_extension.py` 重新打包。
4. 在 `chrome://extensions/` 点扩展卡片右下角的 ↻ 重新加载。

> 后续若打算继续迭代，建议优先做的工程改造：把 `build_extension.py` 改成「拷贝 + 打包」而不是「内嵌字符串」，让 `todo-extension/` 成为唯一真源（详见 §10 迭代路线图）。

---

## 三、文件分工

| 文件 | 行数 | 职责 |
|---|---:|---|
| `manifest.json` | 15 | MV3 元信息：权限 `storage/alarms/notifications`，`host_permissions` 仅放行 `api.telegram.org` |
| `popup.html` | 12 | 仅一个 `<div id="app">` 容器 + 引入 popup.js |
| `style.css` | 15 | 锁定 480×600，全局字体/滚动条/输入控件基础样式 |
| `popup.js` | 532 | 全部 UI（列表 / 新建编辑 / 评论 / 设置 / 删除确认）+ 状态管理 + 渲染 + 备份/导入 |
| `background.js` | 100 | Service Worker：alarms 监听、双通道通知、迁移、消息接口 |
| `build_extension.py` | 746 | 一键写盘 + 打包 + 占位图标生成 |

---

## 四、数据模型

### 任务（task）

```js
{
  id: string,                  // 时间戳 + 4 位随机
  title: string,               // 必填
  description: string,
  priority: 'P0' | 'P1' | 'P2' | 'P3',
  deadline: string,            // datetime-local 格式，例如 '2026-05-01T19:30'
  reminderMinutes: number,     // 截止前一次提醒，REMINDER_OPTS 中选一项
  intervalEnabled: boolean,    // 是否开启间歇提醒
  intervalMinutes: number,     // INTERVAL_OPTS 中选一项
  completed: boolean,
  createdAt: string,           // ISO
  comments: Array<{ id, text, createdAt }>
}
```

### 设置（settings）

```js
{ botToken: string, chatId: string }
```

### 存储 key（`chrome.storage.local`）

- `tasks` — 任务数组
- `settings` — 设置对象
- 历史兼容：`todo_tasks` / `todo_settings`（旧 JSON 字符串）→ `migrateLegacy()` 自动迁移

### 优先级常量与候选项

```js
PC = { P0:紧急(红), P1:高优先(橙), P2:中优先(蓝), P3:低优先(灰) }
P_ORDER = { P0:0, P1:1, P2:2, P3:3 }
REMINDER_OPTS = [10, 15, 30, 60, 120, 360, 1440, 2880, 4320]      // 分钟
INTERVAL_OPTS = [15, 30, 60, 120, 240, 1440, 2880]
```

---

## 五、功能模块梳理（popup.js）

popup.js 内部用注释分区。一个全局 `state.view` 决定渲染哪个页面。

### 1. 列表页 `renderList()`

- **Header**：📋 标题 + P0 红色徽章 + 进度统计 + 备份/导入/设置/新建按钮
- **导入区**：点击「导入」按钮切换显隐；支持点击选择 + 拖拽 JSON 文件；二次确认「合并 / 替换」
- **筛选 + 排序**：进行中 / 全部 / 已完成；按优先级 / 按截止
- **优先级统计条**：4 个 chip 显示进行中各优先级数量
- **任务卡片**：checkbox + 优先级标签 + 标题（完成态删除线）+ 描述 + 信息行（📅 截止 + 倒计时 / ⏰ 提醒 / 🔁 间歇）+ 操作按钮（💬 评论 / ✏️ 编辑 / 🗑️ 删除）

### 2. 新建/编辑 `renderTaskForm(isEdit)`

- 标题（无边框大字）+ 描述 textarea
- 「📌 优先级 + 📅 截止时间」组合卡：4 按钮 + datetime-local
- 「🔔 提醒设置」组合卡：首次提醒下拉 + 间歇提醒开关 + 间隔时间 chip 组
- 底部：取消 / 保存（保存时自动 trim 标题、写 storage、触发 `REFRESH_ALARMS`）

### 3. 评论页 `renderComments()`

- 顶部任务摘要（带返回）
- 中间评论列表（空态 / 时间倒序展示）
- 底部输入框 + 发送（Ctrl/⌘ + Enter 快捷发送）

### 4. 设置页 `renderSettings()`

- 配置说明卡（@BotFather → token → getUpdates → chatId）
- Bot Token / Chat ID 输入
- 测试按钮（实测发一条消息，自动清洗 `bot` 前缀和长破折号）
- 保存 / 取消

### 5. 删除确认页 `renderConfirm()`

- 全屏二次确认（避免误删）

### 备份与导入

- **备份到 Telegram**：以 `application/json` Blob 上传 `sendDocument`，文件名 `todo-backup-YYYY-MM-DD-HH-mm-ss.json`，Markdown caption 含统计
- **导入**：兼容 3 种格式（数组 / `{tasks, settings}` / 历史的 `{todo_tasks, todo_settings}`），合并模式下检测 id 冲突自动改 id

---

## 六、Service Worker（background.js）

### Alarms 三类型

| name 模式 | 含义 | 触发后行为 |
|---|---|---|
| `<taskId>\|reminder` | 截止前 N 分钟一次性提醒 | 弹通知 + Telegram |
| `<taskId>\|expired` | 截止时刻 | 弹「🚨 已逾期」通知 + Telegram |
| `<taskId>\|interval` | 间歇提醒 | 弹通知，**自我递归创建下一次**（持续到任务完成） |

> alarm `name` 用 `|` 拼接，监听里 `name.split('|')` 拆开。

### 通知双通道

1. `chrome.notifications.create()` — 系统级通知，图标用 `icons/icon128.png`
2. 若 `settings.botToken && chatId` → POST 到 `api.telegram.org/bot<token>/sendMessage`，Markdown 排版

token 清洗在多处复用：去 `bot` 前缀、把 `–`/`—`（U+2013/U+2014）替换成 ASCII `-`、`trim()`。

### 生命周期

- `onInstalled` / `onStartup` → `migrateLegacy()` + `refreshAllAlarms()`（清空再全量重建）
- 收到 popup 的 `REFRESH_ALARMS` 消息 → 重建
- 删除任务前会单独 `chrome.alarms.clear('<id>|reminder' / 'expired' / 'interval')`

### 重要前提

Service Worker **30 秒后会被回收**，所以一切定时都走 `chrome.alarms`，**禁止用 `setInterval`**。

---

## 七、状态管理与渲染机制

```js
state = {
  tasks, settings,
  view: 'list' | 'add' | 'edit' | 'settings' | 'comments' | 'confirm',
  editTask, commentTask, confirmDeleteId,
  filter: 'active' | 'all' | 'completed',
  sortBy: 'priority' | 'deadline'
}
```

**渲染策略：** `render()` 全量重绘 `#app`。每次状态变更后调用 `render()`，简单直接但对于大量任务可能轻微卡顿（暂未观察到瓶颈）。

**写入流程：**
```
state mutate → saveTasks() → chrome.storage.local.set
             → chrome.runtime.sendMessage({type:'REFRESH_ALARMS'})
             → render()
```

---

## 八、关键约束（写代码前必读）

来自 `chrome-extension` skill 的实战规则，**当前代码部分遵守，部分待统一**：

| 规则 | 当前情况 |
|---|---|
| popup 锁 480×600，html 和 body 都设宽 | ✅ 已遵守 |
| 所有定时走 `chrome.alarms` | ✅ 已遵守 |
| 统一 `chrome.storage.local` | ✅ 已遵守 |
| 富文本一律 `innerHTML` | ✅ tipBox / msg / dropHint 已用 |
| 样式数值用数字（让 `el()` 自动补 px） | ✅ 已统一（v1.1 / T6）：单值用数字（如 `borderRadius:10`、`padding:16`），多值简写保留字符串（如 `padding:'12px 22px'`） |
| flex 关键间距用 `marginRight` 而非 `gap` | ⚠️ 大量使用 `gap`，目前未见明显问题，但 `flexWrap` 场景需警惕 |

### DOM 工厂 `el()` 速记

```js
el(tag, props={}, ...children)
// props.style 是对象时会自动给 PX_PROPS 中的属性补 'px'
// 'on*' 属性自动绑定为事件监听
// className / value / checked 走属性赋值；其他走 setAttribute
```

辅助：`btn(text, onclick, style)`、`inp(type, value, placeholder, oninput)`、`lbl(text)`。

---

## 九、已知风险 / 技术债

按严重度排序：

1. **样式字符串与数字混用** —— 见 §8。当前不会出 bug，但偶尔会让人误以为「数字写法不被支持」而到处补 `'px'`，长期会越来越乱。
2. **构建流程双源** —— `build_extension.py` 内嵌字符串与 `todo-extension/` 实际文件可能漂移。一次 build 即覆盖。建议改为「目录即源」。
3. **`alert` / `confirm` 系统弹窗** —— 体验差，且导入流程的 `confirm → confirm` 双重确认反人类。建议替换为应用内 toast / dialog。
4. **没有本地导出 JSON** —— 备份只走 Telegram。用户没配 Telegram 时无法导出。
5. **逾期未完成任务的间歇提醒不会自动停** —— 只要 `task.completed === false` 就会一直递归创建 alarm。可能造成"骚扰"。建议增加「最大次数」或「逾期 N 小时后自动停」。
6. **任务列表全量 render** —— 任务多到 100+ 时可能感到卡顿。可考虑虚拟列表或局部 patch。
7. **Telegram token 清洗散落** —— `popup.js` 与 `background.js` 各写一次。建议抽 `cleanToken()` 共享函数（但 Service Worker 与 popup 不共享作用域，需要写在公共 JS 文件里 `<script>` 引入）。
8. **缺乏空 deadline 支持** —— 表单默认填当天 19:30，没有「无截止时间」的选项。任务卡片其实兼容了空值，但表单不暴露。
9. **没有撤销删除** —— 删除即彻底消失（仅 confirm 二次确认）。
10. **没有搜索 / 标签 / 分组** —— 任务一多就难管理。
11. **图标占位** —— 如果没在 `my_icons/` 放图，build 出来是纯黄色方块。

---

## 十、迭代路线图

### 🟢 短期（每条 1–3 个 todo，半小时内可完成）

| # | 改动 | 价值 | 优先级 |
|---|---|---|---|
| S1 | 表单支持「无截止时间」选项（清空 deadline） | 完整覆盖 task 数据模型 | 高 |
| S2 | 增加本地「导出 JSON」按钮（Blob + a.download） | 解耦对 Telegram 的依赖 | 高 |
| S3 | `alert` / `confirm` 替换为应用内 toast + 自定义 dialog | 体感提升明显 | 中 |
| S4 | 把 `borderRadius:'10px'` 等字符串统一改成数字 | 一致性 / 防未来踩坑 | 低 |
| S5 | 间歇提醒增加「逾期 24 小时后自动停」 | 防骚扰 | 中 |
| S6 | 提取 `cleanToken()` 公共函数到 `utils.js` | 减少重复 | 低 |

### 🟡 中期（需要 brainstorm + 拆分多 todo）

| # | 改动 | 备注 |
|---|---|---|
| M1 | 任务搜索（标题 + 描述 + 评论） | 顶部加个搜索框 + 防抖 |
| M2 | 标签 / 分类（多选 chip） | 涉及数据模型扩展，需迁移 |
| M3 | 拖拽排序（同优先级内手动调序） | 需要新增 `order` 字段 |
| M4 | 子任务 / 检查项 | 数据模型大改 |
| M5 | 重复任务（每天 / 每周） | 需要在 SW 中新增「完成时自动生成下次」逻辑 |
| M6 | 批量操作（多选 + 批量完成 / 删除 / 改优先级） | UI 加选择模式 |
| M7 | 通知 action 按钮（标记完成 / 延后 30 分钟） | 用 `chrome.notifications.create({ buttons })` |

### 🔵 长期（架构级）

| # | 改动 | 备注 |
|---|---|---|
| L1 | 把 `build_extension.py` 改成「目录拷贝 + 打包」 | `todo-extension/` 成为唯一真源 |
| L2 | 暗黑模式 + 主题切换 | CSS 变量重构 |
| L3 | 国际化（中 / 英） | 抽 `i18n.json` |
| L4 | 拆分 popup.js 为多个模块 | `<script type="module">` 或按视图拆 |
| L5 | 云同步（Google Drive / Dropbox） | 需 OAuth，大工程 |
| L6 | 自动化测试（jest + jsdom） | 至少覆盖纯函数 `timeLeft` / `fmtMin` / 排序 |

---

## 十一、调试 Tips

| 场景 | DevTools 入口 |
|---|---|
| popup 调试 | 右键扩展图标 → 检查弹出内容 |
| Service Worker 调试 | `chrome://extensions/` → 卡片上「Service Worker」蓝字链接 |
| storage / alarms 查看 | 上面任一 DevTools → Application → Storage / 或 console 输入 `chrome.alarms.getAll(console.log)` |

### 常见问题速查

| 症状 | 怀疑点 |
|---|---|
| 提醒不响 | `chrome://extensions/` 看 SW 是否被禁；`chrome.alarms.getAll()` 看 alarm 是否注册；系统通知权限 |
| Telegram 没收到 | token 是否带了 `bot` 前缀；chatId 是否字符串数字；`getUpdates` 返回是否正常 |
| 改了代码没生效 | 是否改到了 `todo-extension/` 但忘记同步回 `build_extension.py`；扩展是否点了 ↻ 重载 |
| 弹窗布局错乱 | 检查是不是混用了字符串/数字样式；检查是不是漏了 `flex-shrink:0` 导致挤压 |
| 数据丢失 | `chrome.storage.local.get(null, console.log)` 全量看一眼；之前是不是误点过「替换」导入 |

---

## 十二、60 秒回忆指南

> 适合下次 Claude（或你自己）打开本项目时第一时间扫一遍。

1. **这是什么**：MV3 Chrome 扩展，一个本地 + Telegram 双通道的待办清单。
2. **代码在哪**：`build_extension.py` 是源（内嵌字符串），`todo-extension/` 是产物，**改产物会被下次 build 覆盖**。
3. **改完怎么生效**：编辑 `build_extension.py` → `python build_extension.py` → `chrome://extensions/` 点 ↻。
4. **核心数据**：`chrome.storage.local` 的 `tasks` 数组与 `settings` 对象。
5. **核心机制**：popup.js 全量 render；Service Worker 用 `chrome.alarms` 三类型（reminder / expired / interval）；保存任务后发 `REFRESH_ALARMS` 消息让 SW 全量重建 alarm。
6. **写代码前提醒自己**：popup 480×600；样式数值优先用数字让 `el()` 补 px；flex 间距警惕 `gap` + `flexWrap`；富文本用 `innerHTML`；不要 `setInterval`。
7. **下一步最值得做**：见 §10 短期表，**S1（无截止时间）+ S2（本地导出）** 投产比最高。

---

_本文档随项目迭代更新；每次完成一个 todo 后回到这里更新「§10 路线图」与「§九 技术债」即可。_
