
function fmtMin(m) {
  if (m < 60) return m + ' 分钟';
  if (m < 1440) return (m/60) + ' 小时';
  return (m/1440) + ' 天';
}
function fmtDT(dt) {
  if (!dt) return '';
  return new Date(dt).toLocaleString('zh-CN', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
}
function timeLeftText(deadline) {
  if (!deadline) return '';
  const diff = new Date(deadline) - new Date();
  if (diff < 0) return '已逾期';
  const h = Math.floor(diff/3600000), m = Math.floor((diff%3600000)/60000);
  if (h >= 24) return Math.floor(h/24) + '天后';
  if (h > 0) return h + '时' + m + '分后';
  return m + '分钟后';
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  const { name } = alarm;
  const r = await chrome.storage.local.get(['tasks', 'settings']);
  const tasks = r.tasks || [], settings = r.settings || {};
  const [taskId, type] = name.split('|');
  const task = tasks.find(t => t.id === taskId);
  if (!task || task.completed) return;

  let body = '';
  if (type === 'reminder') body = '⏰ 还有 ' + fmtMin(task.reminderMinutes) + ' 截止';
  else if (type === 'expired') body = '🚨 任务已逾期！';
  else if (type === 'interval') {
    body = '🔁 间歇提醒 · 距截止 ' + (timeLeftText(task.deadline) || '尚未完成');
    chrome.alarms.create(taskId + '|interval', { delayInMinutes: task.intervalMinutes });
  }
  const title = '[' + task.priority + '] ' + task.title;

  chrome.notifications.create(name + '_' + Date.now(), {
    type: 'basic', iconUrl: 'icons/icon128.png', title,
    message: body + (task.deadline ? '\n📅 ' + fmtDT(task.deadline) : ''), priority: 2
  });

  if (settings.botToken && settings.chatId) {
    const token = String(settings.botToken).trim().replace(/^bot/i,'').replace(/[\u2013\u2014]/g,'-');
    fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ chat_id: settings.chatId, text: '🔔 *待办提醒*\n\n[' + task.priority + '] *' + task.title + '*\n' + body + (task.deadline ? '\n📅 截止：' + fmtDT(task.deadline) : ''), parse_mode:'Markdown' })
    }).catch(e => console.warn('Telegram失败:', e));
  }
});

function registerAlarms(task) {
  if (task.completed || !task.deadline) return;
  const dl = new Date(task.deadline).getTime(), now = Date.now();
  const ra = dl - (task.reminderMinutes || 30) * 60000;
  if (ra > now) chrome.alarms.create(task.id + '|reminder', { when: ra });
  if (dl > now) chrome.alarms.create(task.id + '|expired', { when: dl });
  if (task.intervalEnabled) {
    const startAt = Math.max(ra > now ? ra : now + (task.intervalMinutes||60)*60000, now + 60000);
    chrome.alarms.create(task.id + '|interval', { when: startAt });
  }
}

async function refreshAllAlarms() {
  await chrome.alarms.clearAll();
  const r = await chrome.storage.local.get(['tasks']);
  (r.tasks || []).forEach(registerAlarms);
}

async function migrateLegacy() {
  const r = await chrome.storage.local.get(null);
  if (typeof r.todo_tasks === 'string' && !Array.isArray(r.tasks)) {
    try { await chrome.storage.local.set({ tasks: JSON.parse(r.todo_tasks) }); } catch {}
  }
  if (typeof r.todo_settings === 'string' && !r.settings) {
    try { await chrome.storage.local.set({ settings: JSON.parse(r.todo_settings) }); } catch {}
  }
  const r2 = await chrome.storage.local.get(['tasks','settings']);
  if (!r2.tasks) await chrome.storage.local.set({ tasks: [] });
  if (!r2.settings) await chrome.storage.local.set({ settings: { botToken:'', chatId:'' } });
  const tasks = (await chrome.storage.local.get(['tasks'])).tasks || [];
  let changed = false;
  tasks.forEach(t => {
    if (!t.id) { t.id = Date.now().toString()+Math.random().toString(36).slice(2,6); changed=true; }
    if (!t.priority) { t.priority='P1'; changed=true; }
    if (t.completed===undefined) { t.completed=false; changed=true; }
    if (t.reminderMinutes===undefined) { t.reminderMinutes=30; changed=true; }
    if (t.intervalEnabled===undefined) { t.intervalEnabled=false; changed=true; }
    if (t.intervalMinutes===undefined) { t.intervalMinutes=60; changed=true; }
    if (!Array.isArray(t.comments)) { t.comments=[]; changed=true; }
  });
  if (changed) await chrome.storage.local.set({ tasks });
}

chrome.runtime.onInstalled.addListener(async () => { await migrateLegacy(); await refreshAllAlarms(); });
chrome.runtime.onStartup.addListener(async () => { await migrateLegacy(); await refreshAllAlarms(); });
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'REFRESH_ALARMS') { refreshAllAlarms().then(() => sendResponse({ok:true})); return true; }
});
migrateLegacy();
