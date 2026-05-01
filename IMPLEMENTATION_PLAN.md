# 智能待办清单 · v1.1 实施计划

> 配套阅读：[PROJECT_GUIDE.md](PROJECT_GUIDE.md)（背景 / 数据模型 / 已知风险 / 路线图）
> 制定日期：2026-05-01

---

## 总览

**版本目标 v1.1：** 抽离公共模块、落地 4 个最高投产比的产品改进、统一一项遗留风格债。共 6 个 todo，预计编码 + 测试约 2.5 小时。

**开发约定：** 不再维护打包脚本，直接修改 `todo-extension/` 下的源文件。Chrome 中通过 `chrome://extensions/` 加载已解压的扩展，每次改动后点 ↻ 重载即可。

**执行顺序原则：** 先抽地基（T1 公共模块），再做产品改进（T2-T5），最后扫尾（T6 风格统一）。

| # | 标题 | 类别 | 估时 |
|---|---|---|---|
| T1 | 抽 `utils.js` 公共模块 | 基础设施 | 20min |
| T2 | 表单支持「无截止时间」 | 产品 | 25min |
| T3 | 列表头新增「导出 JSON」按钮 | 产品 | 15min |
| T4 | 间歇提醒「逾期 24h 自动停」+ 计数器 | 产品 | 20min |
| T5 | 替换 `alert` / `confirm` 为应用内 toast + dialog | 产品 | 40min |
| T6 | 样式数值字符串 → 数字统一 | 风格债 | 30min |

**依赖关系：**
- T2-T5 互相独立
- T6 最后做（避免和其他改动产生大量冲突）

**约束（写代码前必读）：** 详见 [PROJECT_GUIDE §8 关键约束](PROJECT_GUIDE.md#八关键约束写代码前必读)。重点：popup 480×600；样式数值用数字让 `el()` 补 px；间距用 `marginRight` 而非 `gap` + `flexWrap`；富文本用 `innerHTML`；不用 `setInterval`。

---

## 前置准备（顺手做，不占 todo 编号）

仓库初始化时漏了 `.gitignore`，导致 `.DS_Store` 一类系统文件可能误入提交。第一次推 T1 之前补一份最小 `.gitignore`：

```
.DS_Store
.vscode/
.idea/
*.zip
```

`todo-extension.zip` 是历史构建产物，已不再维护。建议：

```bash
git rm --cached todo-extension.zip
rm todo-extension.zip   # 可选：物理删除本地文件
```

这两步可以和 T1 的 commit 合并，也可以单独一笔「补齐 gitignore，移除历史构建产物」。

---

## T1 · 抽 utils.js 公共模块

**动机**
`fmtMin`、`fmtDT`、`timeLeftText` / `timeLeft`、Telegram token 清洗逻辑在 `popup.js` 与 `background.js` 各写了一次。后者改了前者忘改是潜在 bug 源。

**改动范围**

| 文件 | 操作 | 说明 |
|---|---|---|
| `todo-extension/utils.js` | **新建** | 收纳 `fmtMin`、`fmtDT`、`timeLeft`、`cleanTelegramToken`、`PC`、`P_ORDER`、`REMINDER_OPTS`、`INTERVAL_OPTS` |
| `todo-extension/popup.html` | 改 | 在 `popup.js` **之前**加 `<script src="utils.js"></script>` |
| `todo-extension/popup.js` | 改 | 删除已抽走的函数与常量定义 |
| `todo-extension/background.js` | 改 | 顶部加 `importScripts('utils.js');`，删除已抽走的函数 |

**`utils.js` 内容草案**

```js
// 优先级常量
const PC = { /* 同 popup.js 现状 */ };
const P_ORDER = { P0:0, P1:1, P2:2, P3:3 };
const REMINDER_OPTS = [10,15,30,60,120,360,1440,2880,4320];
const INTERVAL_OPTS = [15,30,60,120,240,1440,2880];

// 时间格式化
function fmtMin(m) { return m<60?m+' 分钟':m<1440?(m/60)+' 小时':(m/1440)+' 天'; }
function fmtDT(dt) { /* 同现状 */ }
function timeLeft(deadline) { /* 同 popup.js 现状，统一返回结构 */ }

// Telegram token 清洗
function cleanTelegramToken(s) {
  return String(s||'').trim().replace(/^bot/i,'').replace(/[–—]/g,'-');
}
```

**是否提取公共组件：** 是 —— 这就是公共组件。

**风险点**
- Service Worker 的 `importScripts` 是**同步**调用，必须在文件顶部第一行（在 `chrome.alarms.onAlarm.addListener` 之前）。
- popup 与 SW 共享同一份 utils.js，但运行在两个独立作用域。改 utils.js 的纯函数没问题，但**不要在 utils.js 里碰 DOM 或 storage**（SW 没 DOM）。

**验收标准**
- [ ] 列表 / 编辑 / 评论 / 设置四个页面渲染如旧
- [ ] 提醒（reminder/expired/interval）触发后通知文案如旧
- [ ] Telegram 测试按钮可用，token 带 `bot` 前缀和长破折号时仍能被清洗
- [ ] `popup.js` / `background.js` 不再有重复的 `fmtMin` / `fmtDT` 定义

**Commit**
```
抽取 utils.js 公共模块：合并 popup 与 SW 的重复函数和常量
```

---

## T2 · 表单支持「无截止时间」

**动机**
卡片渲染早就支持 `task.deadline` 为空（`if(task.deadline)` 判断），SW 注册 alarm 也有 `if (!task.deadline) return` 兜底。**只差表单暴露这个能力**。当前 `getDefaultDeadline()` 强制塞当天 19:30，用户没法清空。

**改动范围**

| 文件 | 位置 | 改动 |
|---|---|---|
| `popup.js` | `renderTaskForm` 中的截止时间区 | datetime-local 旁加一个文字按钮「无截止时间」，点击清空 input 并把 `f.deadline = ''` |
| `popup.js` | 保存逻辑 | `f.deadline` 为空字符串时直接通过（不需要校验） |
| `popup.js` | `getDefaultDeadline` | 仅新建任务用作初始默认值；编辑已有任务（`isEdit && !orig.deadline`）时不应被强制覆盖 |

**关键代码片段**

```js
// 在 dlInp 后追加
const clearDl = btn('清空', () => { dlInp.value = ''; f.deadline = ''; },
  { background:'transparent', color:'#94A3B8', padding:'4px 10px', fontSize:12 });
// 用容器把 dlInp 和 clearDl 横排
```

**是否提取公共组件：** 否（单点改动）。

**风险点**
- 编辑已有"无截止时间"任务再保存时，避免被默认值悄悄塞回。需要 `f = orig?{...orig}:{...默认}`，这个分支已经做对了，注意不要回归。
- 列表排序按"截止"模式时，无 deadline 的任务排在末尾（现状已正确）。

**验收标准**
- [ ] 新建任务时点「清空」→ datetime-local 变空 → 保存后卡片不显示日期行
- [ ] 编辑该任务再保存，仍保持无截止时间
- [ ] 该任务不会触发 reminder/expired/interval（看 `chrome.alarms.getAll(console.log)`）

**Commit**
```
新建/编辑表单支持清空截止时间
```

---

## T3 · 列表头新增「导出 JSON」按钮

**动机**
当前备份只走 Telegram，没配 token 的用户没法导出。本地 `Blob + a.download` 一次下载即可。

**改动范围**

| 文件 | 位置 | 改动 |
|---|---|---|
| `popup.js` | 新增 `exportLocal()` | 生成 JSON Blob → 触发 `<a download>` |
| `popup.js` | `renderList` 头部按钮组 | 在「备份」（Telegram）按钮旁加「导出」按钮 |

**关键代码片段**

```js
function exportLocal() {
  const data = { version:1, exportedAt:new Date().toISOString(),
                 tasks:state.tasks, settings:state.settings };
  const ts = new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
  const url = URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],
                                            {type:'application/json'}));
  const a = el('a', { href:url, download:'todo-export-'+ts+'.json' });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
```

**是否提取公共组件：** 否（与 `backupToTelegram` 共享数据格式生成可考虑抽 `buildExportData()`，**但只两处不抽**，等到第三处再抽）。

**风险点**
- 头部按钮已经 4 个（备份/导入/设置/新建），加第 5 个可能挤窄。考虑把「备份」和「导出」合成一个下拉菜单 → **不做**，先 5 按钮直接挤；如果视觉真的崩再优化（YAGNI）。

**验收标准**
- [ ] 点「导出」直接弹下载，文件名 `todo-export-YYYY-MM-DD-HH-mm-ss.json`
- [ ] 下载的 JSON 用「导入」按钮能完整还原（合并/替换两种模式都验证）
- [ ] 头部按钮排列不破

**Commit**
```
列表头新增本地导出 JSON 按钮
```

---

## T4 · 间歇提醒「逾期 24h 自动停」+ 计数器

**动机**
当前 interval 分支只判断 `task.completed`，没逾期会一直反复发提醒，是潜在的"骚扰"源。加两个止血开关：(a) 逾期 24 小时后不再续；(b) 单任务最多 20 次（防极端情况下连续报警）。

**改动范围**

| 文件 | 位置 | 改动 |
|---|---|---|
| `background.js` | `onAlarm` 监听器 interval 分支 | 添加双重停止条件 |
| `popup.js` | 任务保存时（重置计数器） | 任务从 completed=true 改回 false 时，清掉 `intervalCount`；deadline 改动后同样 |

**数据模型增量** — 任务对象新增字段：

```js
intervalCount?: number   // 已发送过的 interval 通知次数，默认 0
```

**关键代码片段**（`background.js`）

```js
else if (type === 'interval') {
  task.intervalCount = (task.intervalCount || 0) + 1;
  const overdueMs = Date.now() - new Date(task.deadline).getTime();
  const stopByOverdue = overdueMs > 24 * 3600 * 1000;
  const stopByCount   = task.intervalCount >= 20;
  if (!stopByOverdue && !stopByCount) {
    chrome.alarms.create(taskId + '|interval', { delayInMinutes: task.intervalMinutes });
  }
  // 持久化计数器更新
  await chrome.storage.local.set({ tasks });
  body = '🔁 间歇提醒 · 距截止 ' + (timeLeft(task.deadline)?.text || '尚未完成');
}
```

**是否提取公共组件：** 否。

**风险点**
- `onAlarm` 是异步处理，必须在 `chrome.storage.local.set` 后再继续，避免并发写丢失计数。
- 阈值 24 小时和 20 次是**经验值**，不暴露给用户配置（YAGNI）。

**验收标准**
- [ ] 设置一个 5 分钟后截止 + 间隔 1 分钟 + 启用间歇的任务，逾期后 24 小时内仍会触发，超过停止
- [ ] 调试中可注入 `intervalCount: 19` 验证下一次到 20 后停止
- [ ] 把任务标完成 → 重新打开 → 计数器归零（`intervalCount` 字段清掉）

**Commit**
```
间歇提醒添加逾期 24h 与最大 20 次双重停止条件
```

---

## T5 · 替换 alert / confirm 为应用内 toast + dialog

**动机**
当前 6 处 `alert()` + 3 处 `confirm()`：导入失败、备份成功/失败、保存校验等。系统弹窗体感差，且导入流程的 `confirm → confirm` 双层让人懵。改成应用内 UI 一次性解决。

**改动范围**

| 文件 | 位置 | 改动 |
|---|---|---|
| `popup.js` | 顶部新增 `showToast(msg, type)` 和 `showDialog({title, body, confirmText, cancelText})` | toast 用单例 div 浮在右上角 3 秒；dialog 返回 Promise<boolean> |
| `popup.js` | 全局检索替换所有 `alert(` 和 `confirm(` | 异步流程改 `await showDialog(...)` |

**关键代码片段**

```js
// Toast: 单例浮层
let toastTimer;
function showToast(msg, type='info') {
  let t = document.getElementById('__toast');
  if (!t) { t = el('div', { id:'__toast',
    style:{ position:'fixed', top:14, right:14, padding:'10px 16px',
            borderRadius:9, fontSize:13, fontWeight:600, zIndex:9999,
            boxShadow:'0 4px 12px rgba(0,0,0,0.15)' }});
    document.body.appendChild(t);
  }
  const palette = { info:['#EFF6FF','#1D4ED8'], ok:['#F0FDF4','#15803D'],
                    err:['#FEF2F2','#DC2626'] }[type] || ['#F1F5F9','#334155'];
  t.style.background = palette[0]; t.style.color = palette[1];
  t.textContent = msg;
  t.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.style.display='none', 3000);
}

// Dialog: 返回 Promise<boolean>
function showDialog({ title='确认', body='', confirmText='确认', cancelText='取消', danger=false }) {
  return new Promise(resolve => {
    const mask = el('div', { style:{ position:'fixed', inset:0,
      background:'rgba(0,0,0,0.4)', zIndex:9998, display:'flex',
      alignItems:'center', justifyContent:'center' }});
    const box = el('div', { style:{ background:'#fff', borderRadius:12,
      padding:'18px 22px', minWidth:280, maxWidth:380 }});
    const titleEl = el('div', { style:{ fontSize:15, fontWeight:700, marginBottom:10 }}, title);
    const bodyEl = el('div', { style:{ fontSize:13, color:'#475569', lineHeight:1.6, marginBottom:16 }});
    bodyEl.innerHTML = body;
    const close = ok => { document.body.removeChild(mask); resolve(ok); };
    const row = el('div', { style:{ display:'flex', justifyContent:'flex-end', gap:8 }},
      btn(cancelText, () => close(false), { background:'#F1F5F9', color:'#64748B' }),
      btn(confirmText, () => close(true),
        danger ? { background:'#FEF2F2', color:'#EF4444', border:'1px solid #FECACA' }
               : { background:'#3B82F6', color:'#fff' })
    );
    box.append(titleEl, bodyEl, row);
    mask.appendChild(box);
    document.body.appendChild(mask);
  });
}
```

**调用点替换映射**

| 原调用 | 替换 |
|---|---|
| `alert('❌ 请先在设置中配置 Telegram')` | `showToast('请先在设置中配置 Telegram','err')` |
| `alert('✅ 备份成功！...')` | `showToast('备份成功','ok')` |
| `alert('❌ 备份失败：...')` | `showToast('备份失败：'+desc,'err')` |
| `alert('请输入任务标题')` | `showToast('请输入任务标题','err')` |
| `confirm('导入 N 条任务\n\n确定 = 合并...')` | `await showDialog({title:'导入', body:'共 N 条任务<br>选择导入方式', confirmText:'合并', cancelText:'替换'})` ⚠ |
| `confirm('⚠️ 确认替换全部数据？')` | `await showDialog({title:'确认替换', body:'...', danger:true})` |

⚠ 注意：原本"合并/替换"是用 confirm 布尔来表达，现在 dialog 也是布尔。维持原语义即可（confirm=true 走合并，false 走替换 + 二次 dialog）。或者改成三按钮 dialog（合并/替换/取消）— **作为这个 todo 内的优化项**。

**是否提取公共组件：** 是 —— `showToast` 和 `showDialog` 是公共组件。

**风险点**
- `confirm` 是同步阻塞，`showDialog` 是 Promise。所有调用点要改成 `async/await`。漏掉一处会导致逻辑乱序。
- 替换完后必须**全文搜索 `alert(` 和 `confirm(`** 确保 0 残留。

**验收标准**
- [ ] 全文 `grep -n "alert(\|confirm("` 0 命中
- [ ] toast 在右上角浮 3 秒后自动消失，期间可叠加（后来居上）
- [ ] dialog 蒙层挡住下方点击；按 Esc 关闭（可选）
- [ ] 导入流程：合并 / 替换 / 取消三态都正确

**Commit**
```
替换 alert/confirm 为应用内 toast 与 dialog 公共组件
```

---

## T6 · 样式数值字符串 → 数字统一

**动机**
`el()` 工厂的 `PX_PROPS` 已经支持自动补 px，但代码里仍大量出现 `borderRadius:'10px'`、`padding:'12px'` 这种字符串混用。容易让人误以为"必须写 px 字符串"，长期累积越来越乱。

**改动范围**

只动 `popup.js`。机械替换 `PX_PROPS` 集合内的属性值：

```
'14px' → 14   '12px' → 12   '8px'  → 8   '6px'  → 6
'10px' → 10   '11px' → 11   ...
```

**`PX_PROPS` 完整清单**（来自 popup.js 第 27 行）

```js
'width','height','minWidth','minHeight','maxWidth','maxHeight',
'top','left','right','bottom',
'margin','marginTop','marginRight','marginBottom','marginLeft',
'padding','paddingTop','paddingRight','paddingBottom','paddingLeft',
'borderRadius','borderWidth','fontSize','lineHeight','letterSpacing',
'gap','rowGap','columnGap'
```

**例外：不要改的**
- 多值简写：如 `padding:'12px 22px'`、`margin:'0 22px'` 等 → **保留字符串**（PX_PROPS 单值规则不适用）
- 非 px 值：`opacity:'0.5'`、`fontWeight:600`、`background:'#fff'` 等 → 不动

**是否提取公共组件：** 否（机械重构）。

**风险点**
- 替换不彻底导致部分属性失效（数字 + 字符串混用时，取决于哪个后赋值）。**逐文件 diff review** 是必须的。
- `el()` 内部是 `typeof sv === 'number' && PX_PROPS.has(sk)` 才补 px，多值字符串不会被误处理 → 安全。

**验收标准**
- [ ] 全文 `grep -nE "['\"][0-9]+px['\"]" popup.js` 仅剩多值简写
- [ ] 视觉自查每个页面（列表 / 新建 / 编辑 / 评论 / 设置 / 删除确认）排版与改动前一致
- [ ] [PROJECT_GUIDE §8](PROJECT_GUIDE.md#八关键约束写代码前必读) 标记"已统一"

**Commit**
```
统一 popup.js 样式数值为数字，移除冗余 px 字符串
```

---

## 整体验证

每个 todo 完成后单独验证（见各自验收标准）。**全部完成后**做一次端到端回归：

1. **数据完整性**：从空状态新建任务 → 编辑 → 加评论 → 标完成 → 删除，每步刷新 popup 检查持久化
2. **提醒链路**：建一个 2 分钟后到期 + 间歇 1 分钟 + 启用间歇的任务，等前后 30 分钟，确认本地通知与 Telegram 都收到
3. **导入导出**：导出 → 全删 → 替换导入 → 数据回来；再导入一次走合并模式
4. **Telegram 测试**：设置页测试按钮，token 带 `bot` 前缀和长破折号都能清洗
5. **加载验证**：`chrome://extensions/` 点 ↻ 重载扩展，所有页面渲染与交互正常

---

## 不在本次范围（留给 v1.2+）

为防止 scope creep，明确不做以下事项（来自 [PROJECT_GUIDE §10 中期/长期](PROJECT_GUIDE.md#十迭代路线图)）：

- 任务搜索 / 标签 / 分组（M1–M2）
- 拖拽排序（M3）
- 子任务（M4）
- 重复任务（M5）
- 批量操作（M6）
- 通知 action 按钮（M7）
- 暗黑模式 / 国际化 / 云同步（L2–L5）
- 自动化测试（L6）

---

## 进度记录

> 每完成一项，把 `[ ]` 改成 `[x]`，并在右侧填 commit hash。

- [ ] T1 抽 utils.js 公共模块 — `_______`
- [ ] T2 表单支持无截止时间 — `_______`
- [ ] T3 列表头新增导出 JSON — `_______`
- [ ] T4 间歇提醒双重停止条件 — `_______`
- [ ] T5 替换 alert/confirm 为应用内组件 — `_______`
- [ ] T6 样式数值统一为数字 — `_______`
