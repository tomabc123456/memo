// 智能待办清单 · 公共模块
// 同时被 popup.js（<script>）与 background.js（importScripts）使用
// 注意：此文件运行在两个独立作用域，禁止访问 DOM 或 chrome.storage

// ── 优先级常量 ──────────────────────────────
const PC = {
  P0: { color:'#EF4444', bg:'#FEF2F2', border:'#FECACA', text:'紧急' },
  P1: { color:'#F97316', bg:'#FFF7ED', border:'#FED7AA', text:'高优先' },
  P2: { color:'#3B82F6', bg:'#EFF6FF', border:'#BFDBFE', text:'中优先' },
  P3: { color:'#6B7280', bg:'#F9FAFB', border:'#E5E7EB', text:'低优先' },
};
const P_ORDER = { P0:0, P1:1, P2:2, P3:3 };

// ── 任务类型 ──────────────────────────────
const TASK_TYPES = ['任务', '研发', '钱包', '风控', '安全', '三方服务', '云账号', '个人', '其他'];

// 提醒/间歇时间候选（分钟）
const REMINDER_OPTS = [10, 15, 30, 60, 120, 360, 1440, 2880, 4320];
const INTERVAL_OPTS = [15, 30, 60, 120, 240, 1440, 2880];

// ── 时间格式化 ──────────────────────────────
function fmtMin(m) {
  if (m < 60) return m + ' 分钟';
  if (m < 1440) return (m / 60) + ' 小时';
  return (m / 1440) + ' 天';
}

function fmtDT(dt) {
  if (!dt) return '';
  return new Date(dt).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  });
}

// 返回 { text, expired?, urgent? }，无 deadline 返回 null
function timeLeft(deadline) {
  if (!deadline) return null;
  const diff = new Date(deadline) - new Date();
  if (diff < 0) return { expired: true, text: '已逾期' };
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h >= 48) return { text: Math.floor(h / 24) + '天后' };
  if (h >= 24) return { text: '明天' };
  if (h > 0)   return { text: h + '时' + m + '分后', urgent: h < 3 };
  return { text: m + '分钟后', urgent: true };
}

// ── Telegram token 清洗 ──────────────────────────────
// 去 'bot' 前缀、把长破折号 (–/—) 替换成 ASCII '-'
function cleanTelegramToken(s) {
  return String(s || '').trim().replace(/^bot/i, '').replace(/[–—]/g, '-');
}
