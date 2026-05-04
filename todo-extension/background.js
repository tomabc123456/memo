importScripts('utils.js');

// fmtMin / fmtDT / timeLeft / cleanTelegramToken 已抽到 utils.js

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
    task.intervalCount = (task.intervalCount || 0) + 1;
    body = '🔁 间歇提醒 · 距截止 ' + (timeLeft(task.deadline)?.text || '尚未完成');
    await chrome.storage.local.set({ tasks });
    const overdueMs = task.deadline ? Date.now() - new Date(task.deadline).getTime() : -1;
    const stopByOverdue = overdueMs > 24 * 3600 * 1000;
    const stopByCount = task.intervalCount >= 20;
    if (!stopByOverdue && !stopByCount) {
      chrome.alarms.create(taskId + '|interval', { delayInMinutes: task.intervalMinutes });
    }
  }
  const title = '[' + task.priority + '] ' + task.title;

  chrome.notifications.create(name + '_' + Date.now(), {
    type: 'basic', iconUrl: 'icons/icon128.png', title,
    message: body + (task.deadline ? '\n📅 ' + fmtDT(task.deadline) : ''), priority: 2
  });

  if (settings.botToken && settings.chatId) {
    const token = cleanTelegramToken(settings.botToken);
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
    if (now - dl > 24 * 3600 * 1000) return;  // 逾期超 24h 不再注册
    const startAt = Math.max(ra > now ? ra : now + (task.intervalMinutes||60)*60000, now + 60000);
    chrome.alarms.create(task.id + '|interval', { when: startAt });
  }
}

async function refreshAllAlarms() {
  await chrome.alarms.clearAll();
  const r = await chrome.storage.local.get(['tasks']);
  const tasks = r.tasks || [];
  // 全量重建时重置所有任务的 interval 计数
  let changed = false;
  tasks.forEach(t => { if (t.intervalCount) { t.intervalCount = 0; changed = true; } });
  if (changed) await chrome.storage.local.set({ tasks });
  tasks.forEach(registerAlarms);
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
    if (!t.taskType) { t.taskType='任务'; changed=true; }
    if (!t.createdAt) { t.createdAt='2026-05-01T00:00:00.000Z'; changed=true; }
  });
  if (changed) await chrome.storage.local.set({ tasks });
}

chrome.runtime.onInstalled.addListener(async () => { await migrateLegacy(); await refreshAllAlarms(); });
chrome.runtime.onStartup.addListener(async () => { await migrateLegacy(); await refreshAllAlarms(); });
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'REFRESH_ALARMS') { refreshAllAlarms().then(() => sendResponse({ok:true})); return true; }
});
migrateLegacy();
