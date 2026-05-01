
// PC / P_ORDER / REMINDER_OPTS / INTERVAL_OPTS / fmtMin / fmtDT / timeLeft / cleanTelegramToken
// 已抽到 utils.js（popup.html 中先于 popup.js 加载）

function getDefaultDeadline() { const d=new Date(),p=n=>String(n).padStart(2,'0'); return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+'T19:30'; }

// ── DOM 工厂（自动补 px）──────────────────────────────
const PX_PROPS = new Set(['width','height','minWidth','minHeight','maxWidth','maxHeight','top','left','right','bottom','margin','marginTop','marginRight','marginBottom','marginLeft','padding','paddingTop','paddingRight','paddingBottom','paddingLeft','borderRadius','borderWidth','fontSize','lineHeight','letterSpacing','gap','rowGap','columnGap']);
function el(tag, props={}, ...children) {
  const e = document.createElement(tag);
  for (const [k,v] of Object.entries(props||{})) {
    if (v===null||v===undefined) continue;
    if (k==='style'&&typeof v==='object') {
      const fixed={};
      for (const [sk,sv] of Object.entries(v)) fixed[sk]=typeof sv==='number'&&PX_PROPS.has(sk)?sv+'px':sv;
      Object.assign(e.style, fixed);
    }
    else if (k.startsWith('on')&&typeof v==='function') e.addEventListener(k.slice(2).toLowerCase(),v);
    else if (k==='className') e.className=v;
    else if (k==='value') e.value=v;
    else if (k==='checked') e.checked=v;
    else e.setAttribute(k,v);
  }
  for (const c of children.flat()) {
    if(c==null||c===false) continue;
    e.appendChild(typeof c==='string'||typeof c==='number'?document.createTextNode(String(c)):c);
  }
  return e;
}
const btn = (text,onclick,style={}) => el('button',{onclick,style:{border:'none',borderRadius:8,padding:'8px 16px',fontWeight:600,cursor:'pointer',fontSize:13,...style}},text);
const inpStyle = { width:'100%',padding:'8px 12px',border:'1px solid #E2E8F0',borderRadius:8,fontSize:13.5,boxSizing:'border-box',background:'#fff' };
const inp = (type='text',value='',placeholder='',oninput) => { const e=el('input',{type,placeholder,style:inpStyle}); e.value=value||''; if(oninput)e.addEventListener('input',oninput); return e; };
const lbl = text => el('div',{style:{fontSize:13,fontWeight:600,color:'#475569',marginBottom:6}},text);

// ── 状态 ──────────────────────────────
let state = { tasks:[], settings:{botToken:'',chatId:''}, view:'list', editTask:null, commentTask:null, confirmDeleteId:null, filter:'active', sortBy:'priority' };

async function loadState() {
  const r = await chrome.storage.local.get(['tasks','settings']);
  state.tasks = Array.isArray(r.tasks)?r.tasks:[];
  state.settings = r.settings||{botToken:'',chatId:''};
}
async function saveTasks() {
  await chrome.storage.local.set({tasks:state.tasks});
  chrome.runtime.sendMessage({type:'REFRESH_ALARMS'}).catch(()=>{});
}
async function saveSettings() { await chrome.storage.local.set({settings:state.settings}); }

// ── 备份到 Telegram ──────────────────────────────
async function backupToTelegram() {
  const {botToken,chatId} = state.settings;
  if(!botToken||!chatId){alert('❌ 请先在设置中配置 Telegram');return;}
  const token = cleanTelegramToken(botToken);
  const data = {version:1,exportedAt:new Date().toISOString(),tasks:state.tasks,settings:state.settings};
  const ts = new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
  const filename = 'todo-backup-'+ts+'.json';
  const blob = new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const fd = new FormData();
  fd.append('chat_id',chatId);
  fd.append('document',blob,filename);
  fd.append('caption','📦 *待办清单备份*\n\n🕐 '+new Date().toLocaleString('zh-CN')+'\n📋 任务数：'+state.tasks.length+' 条\n✅ 已完成：'+state.tasks.filter(t=>t.completed).length+' 条\n⏳ 进行中：'+state.tasks.filter(t=>!t.completed).length+' 条');
  fd.append('parse_mode','Markdown');
  try {
    const r=await fetch('https://api.telegram.org/bot'+token+'/sendDocument',{method:'POST',body:fd});
    const d=await r.json();
    if(d.ok) alert('✅ 备份成功！\n文件名：'+filename);
    else alert('❌ 备份失败：'+(d.error_code||'')+' '+(d.description||''));
  } catch(e){alert('❌ 网络错误：'+e.message);}
}

// ── 本地导出 JSON ──────────────────────────────
function exportLocal() {
  const data={version:1,exportedAt:new Date().toISOString(),tasks:state.tasks,settings:state.settings};
  const ts=new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
  const filename='todo-export-'+ts+'.json';
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
  const a=el('a',{href:url,download:filename});
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

// ── 导入数据（接收 File 对象）──────────────────────────────
async function importFile(file) {
  try {
    const data=JSON.parse(await file.text());
    let tasks=[],settings=null;
    if(Array.isArray(data)) tasks=data;
    else if(Array.isArray(data.tasks)){tasks=data.tasks;settings=data.settings;}
    else if(data.todo_tasks){tasks=typeof data.todo_tasks==='string'?JSON.parse(data.todo_tasks):data.todo_tasks;if(data.todo_settings)settings=typeof data.todo_settings==='string'?JSON.parse(data.todo_settings):data.todo_settings;}
    else throw new Error('文件格式不正确');
    const ok=confirm('导入 '+tasks.length+' 条任务\n\n确定 = 合并到现有数据\n取消 = 替换全部数据');
    tasks.forEach(t=>{if(!t.id)t.id=Date.now().toString()+Math.random().toString(36).slice(2,6);if(!t.priority)t.priority='P1';if(t.completed===undefined)t.completed=false;if(t.reminderMinutes===undefined)t.reminderMinutes=30;if(t.intervalEnabled===undefined)t.intervalEnabled=false;if(t.intervalMinutes===undefined)t.intervalMinutes=60;if(!Array.isArray(t.comments))t.comments=[];});
    if(ok){const existIds=new Set(state.tasks.map(t=>t.id));tasks.forEach(t=>{if(existIds.has(t.id))t.id=Date.now().toString()+Math.random().toString(36).slice(2,6);});state.tasks=[...tasks,...state.tasks];}
    else{if(!confirm('⚠️ 确认替换全部数据？现有 '+state.tasks.length+' 条将被覆盖'))return false;}
    state.tasks=ok?state.tasks:tasks;
    if(settings)state.settings={...state.settings,...settings};
    await saveTasks(); await saveSettings();
    alert('✅ 导入成功！共 '+state.tasks.length+' 条任务');
    return true;
  } catch(err){alert('❌ 导入失败：'+err.message); return false;}
}

// ── 渲染入口 ──────────────────────────────
function render() {
  const app=document.getElementById('app'); app.innerHTML='';
  const v=state.view;
  if(v==='list')     app.appendChild(renderList());
  else if(v==='add') app.appendChild(renderTaskForm(false));
  else if(v==='edit')app.appendChild(renderTaskForm(true));
  else if(v==='settings')app.appendChild(renderSettings());
  else if(v==='comments')app.appendChild(renderComments());
  else if(v==='confirm')app.appendChild(renderConfirm());
}

// ── 列表页 ──────────────────────────────
function renderList() {
  const active=state.tasks.filter(t=>!t.completed);
  const p0=active.filter(t=>t.priority==='P0').length;
  let filtered=state.tasks
    .filter(t=>state.filter==='all'?true:state.filter==='active'?!t.completed:t.completed)
    .sort((a,b)=>{
      if(state.sortBy==='priority'){if(P_ORDER[a.priority]!==P_ORDER[b.priority])return P_ORDER[a.priority]-P_ORDER[b.priority];if(a.deadline&&b.deadline)return new Date(a.deadline)-new Date(b.deadline);return a.deadline?-1:1;}
      if(!a.deadline&&!b.deadline)return P_ORDER[a.priority]-P_ORDER[b.priority];if(!a.deadline)return 1;if(!b.deadline)return -1;return new Date(a.deadline)-new Date(b.deadline);
    });

  const wrap=el('div',{style:{display:'flex',flexDirection:'column'}});

  // Header
  const hdr=el('div',{style:{background:'#fff',borderBottom:'1px solid #E2E8F0',padding:'12px 22px',display:'flex',alignItems:'center',justifyContent:'space-between',position:'sticky',top:0,zIndex:10}});
  hdr.appendChild(el('div',{},
    el('div',{style:{display:'flex',alignItems:'center',gap:10}},
      el('span',{style:{fontSize:18,fontWeight:800}},'📋 待办清单'),
      p0>0?el('span',{style:{background:'#FEF2F2',color:'#EF4444',border:'1px solid #FECACA',borderRadius:20,padding:'2px 9px',fontSize:11.5,fontWeight:700}},'P0×'+p0):null
    ),
    el('div',{style:{fontSize:12,color:'#94A3B8',marginTop:4}},active.length+' 项待完成 · 共 '+state.tasks.length+' 项')
  ));
  // 列表 header 导入按钮改为切换拖拽区域
  let showDropZone = false;
  const importBtn = btn('导入',()=>{
    showDropZone = !showDropZone;
    dropZone.style.display = showDropZone ? 'block' : 'none';
  },{background:'#F1F5F9',padding:'7px 10px',fontSize:13});

  hdr.appendChild(el('div',{style:{display:'flex',gap:6}},
    btn('备份',()=>backupToTelegram(),{background:'#F1F5F9',padding:'7px 10px',fontSize:13}),
    btn('导出',()=>exportLocal(),{background:'#F1F5F9',padding:'7px 10px',fontSize:13}),
    importBtn,
    btn('设置',()=>{state.view='settings';render();},{background:'#F1F5F9',padding:'7px 10px',fontSize:13}),
    btn('新建',()=>{state.editTask=null;state.view='add';render();},{background:'#3B82F6',color:'#fff',padding:'7px 13px',fontSize:13})
  ));
  wrap.appendChild(hdr);

  // 拖拽导入区域
  let selectedFile = null;
  const dropZone = el('div',{style:{display:'none',margin:'0 22px',marginTop:'12px',border:'2px dashed #E2E8F0',borderRadius:'10px',padding:'16px',background:'#F8FAFC'}});

  const dropHint = el('div',{style:{textAlign:'center',color:'#94A3B8',fontSize:'13px',padding:'12px 0',cursor:'pointer'}});
  dropHint.innerHTML = '📂 将 JSON 文件拖拽到此处';

  const fileNameEl = el('div',{style:{fontSize:'12px',color:'#3B82F6',marginTop:'8px',textAlign:'center',display:'none'}});

  // 隐藏的 file input
  const fileInput = el('input',{type:'file',accept:'.json,application/json',style:{display:'none'}});
  fileInput.addEventListener('change', e => {
    const f = e.target.files[0];
    if(!f) return;
    selectedFile = f;
    fileNameEl.textContent = '已选择：' + f.name;
    fileNameEl.style.display = 'block';
    confirmImportBtn.style.opacity = '1';
    confirmImportBtn.disabled = false;
  });

  dropHint.addEventListener('click', () => fileInput.click());

  // 拖拽事件
  dropZone.addEventListener('dragover', e => {
    e.preventDefault();
    dropZone.style.borderColor = '#3B82F6';
    dropZone.style.background = '#EFF6FF';
  });
  dropZone.addEventListener('dragleave', () => {
    dropZone.style.borderColor = '#E2E8F0';
    dropZone.style.background = '#F8FAFC';
  });
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.style.borderColor = '#E2E8F0';
    dropZone.style.background = '#F8FAFC';
    const f = e.dataTransfer.files[0];
    if(!f) return;
    selectedFile = f;
    fileNameEl.textContent = '已选择：' + f.name;
    fileNameEl.style.display = 'block';
    confirmImportBtn.style.opacity = '1';
    confirmImportBtn.disabled = false;
  });

  // 取消/导入按钮行
  const confirmImportBtn = btn('导入', async () => {
    if(!selectedFile) return;
    const ok = await importFile(selectedFile);
    if(ok) { showDropZone=false; render(); }
  },{background:'linear-gradient(135deg, #3B82F6, #2563EB)',color:'#fff',border:'none',borderRadius:'9px',padding:'8px 14px',fontWeight:700,fontSize:'13px',minWidth:'72px',opacity:'0.5'});
  confirmImportBtn.disabled = true;

  const cancelImportBtn = btn('取消', () => {
    showDropZone = false;
    selectedFile = null;
    dropZone.style.display = 'none';
    fileNameEl.style.display = 'none';
    fileNameEl.textContent = '';
    confirmImportBtn.style.opacity = '0.5';
    confirmImportBtn.disabled = true;
    fileInput.value = '';
  },{background:'#F1F5F9',color:'#64748B',padding:'8px 14px',fontSize:'13px',minWidth:'72px'});

  const dropBtnRow = el('div',{style:{display:'flex',justifyContent:'flex-end',gap:'8px',marginTop:'12px'}}, cancelImportBtn, confirmImportBtn);

  dropZone.appendChild(dropHint);
  dropZone.appendChild(fileNameEl);
  dropZone.appendChild(fileInput);
  dropZone.appendChild(dropBtnRow);
  wrap.appendChild(dropZone);
  const frow=el('div',{style:{background:'#fff',padding:'10px 22px',borderBottom:'1px solid #E2E8F0',display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}});
  [['active','进行中'],['all','全部'],['completed','已完成']].forEach(([k,v])=>{
    frow.appendChild(btn(v,()=>{state.filter=k;render();},{background:state.filter===k?'#EFF6FF':'transparent',color:state.filter===k?'#3B82F6':'#64748B',border:state.filter===k?'1px solid #BFDBFE':'1px solid transparent',padding:'5px 13px',fontSize:13,borderRadius:7}));
  });
  const sw=el('div',{style:{marginLeft:'auto',display:'flex',gap:5,alignItems:'center'}},
    el('span',{style:{fontSize:12,color:'#94A3B8'}},'排序'),
    ...['priority','deadline'].map(k=>btn(k==='priority'?'优先级':'截止',()=>{state.sortBy=k;render();},{background:state.sortBy===k?'#F0FDF4':'transparent',color:state.sortBy===k?'#22C55E':'#64748B',border:state.sortBy===k?'1px solid #BBF7D0':'1px solid transparent',padding:'5px 13px',fontSize:13,borderRadius:7}))
  );
  frow.appendChild(sw); wrap.appendChild(frow);

  // 优先级统计
  const ps=el('div',{style:{padding:'12px 22px 0',display:'flex',gap:8,flexWrap:'wrap'}});
  Object.entries(PC).forEach(([k,v])=>{
    const cnt=active.filter(t=>t.priority===k).length;
    ps.appendChild(el('span',{style:{background:v.bg,color:v.color,border:'1px solid '+v.border,borderRadius:7,padding:'5px 12px',fontSize:12.5,fontWeight:600}},k+'·'+v.text+'('+cnt+')'));
  });
  wrap.appendChild(ps);

  // 列表
  const list=el('div',{style:{padding:'12px 22px 24px',flex:1}});
  if(!filtered.length){
    list.appendChild(el('div',{style:{textAlign:'center',padding:'48px 0',color:'#CBD5E1'}},
      el('div',{style:{fontSize:42}},state.filter==='completed'?'🏆':'✨'),
      el('p',{style:{marginTop:10,fontSize:13}},state.filter==='completed'?'暂无已完成任务':'没有待办事项，点击「新建」添加吧！')
    ));
  } else { filtered.forEach(t=>list.appendChild(renderCard(t))); }
  wrap.appendChild(list);
  return wrap;
}

// ── 任务卡片 ──────────────────────────────
function renderCard(task) {
  const p=PC[task.priority]||PC.P1, tl=timeLeft(task.deadline), cc=(task.comments&&task.comments.length)||0;

  const card=el('div',{style:{background:'#fff',borderRadius:12,marginBottom:8,padding:'10px 16px',border:'1px solid '+(task.completed?'#E2E8F0':p.border),borderLeft:'4px solid '+(task.completed?'#CBD5E1':p.color),opacity:task.completed?0.55:1,display:'flex',alignItems:'flex-start',gap:14}});

  // 左侧
  const leftZone=el('div',{style:{flex:1,minWidth:0,display:'flex',alignItems:'flex-start'}});
  const cb=el('input',{type:'checkbox',style:{margin:0,marginTop:3,marginRight:14,width:16,height:16,cursor:'pointer',accentColor:p.color,flexShrink:0}});
  cb.checked=!!task.completed;
  cb.addEventListener('change',async()=>{task.completed=cb.checked;await saveTasks();render();});
  leftZone.appendChild(cb);

  // 内容
  const content=el('div',{style:{flex:1,minWidth:0,display:'flex',flexDirection:'column',gap:'6px'}});

  // 标题行
  const titleRow=el('div',{style:{display:'flex',alignItems:'center',gap:'10px',flexWrap:'wrap'}});
  titleRow.appendChild(el('span',{style:{background:p.bg,color:p.color,border:'1px solid '+p.border,borderRadius:'5px',padding:'2px 9px',fontSize:'11.5px',fontWeight:800,lineHeight:'1.5',flexShrink:0}},task.priority));
  titleRow.appendChild(el('span',{style:{fontWeight:600,color:task.completed?'#94A3B8':'#1E293B',textDecoration:task.completed?'line-through':'none',fontSize:'14.5px',lineHeight:'1.5'}},task.title));
  content.appendChild(titleRow);

  if(task.description) content.appendChild(el('p',{style:{fontSize:'12.5px',color:'#94A3B8',lineHeight:'1.5',margin:0}},task.description));

  if(task.deadline||task.reminderMinutes||task.intervalEnabled){
    const infoRow=el('div',{style:{display:'flex',flexWrap:'nowrap',alignItems:'center',gap:'10px',fontSize:'12px',overflow:'hidden'}});
    if(task.deadline){
      const color=tl?.expired?'#EF4444':tl?.urgent?'#F97316':'#94A3B8';
      infoRow.appendChild(el('span',{style:{display:'inline-flex',alignItems:'center',gap:'4px',color,fontWeight:tl?.expired||tl?.urgent?600:400,flexShrink:0}},
        el('span',{},'📅'),el('span',{},fmtDT(task.deadline)+(tl?' · '+tl.text:''))
      ));
    }
    if(task.reminderMinutes) infoRow.appendChild(el('span',{style:{display:'inline-flex',alignItems:'center',gap:'4px',color:'#B0B8C6',flexShrink:0}},el('span',{},'⏰'),el('span',{},'提前 '+fmtMin(task.reminderMinutes))));
    if(task.intervalEnabled) infoRow.appendChild(el('span',{style:{display:'inline-flex',alignItems:'center',gap:'4px',color:'#94A3B8',background:'#F8F9FB',border:'1px solid #E8EBF0',borderRadius:'5px',padding:'2px 8px',flexShrink:0}},el('span',{},'🔁'),el('span',{},'每 '+fmtMin(task.intervalMinutes))));
    content.appendChild(infoRow);
  }

  leftZone.appendChild(content);
  card.appendChild(leftZone);

  // 右侧操作
  const actions=el('div',{style:{display:'flex',gap:6,flexShrink:0,alignItems:'center'}});
  const mkBtn=(icon,title,onclick,color)=>{
    const b=btn(icon,onclick,{background:'none',border:'1px solid #E2E8F0',borderRadius:7,padding:'5px 9px',fontSize:13,color:color||'#64748B'});
    b.title=title;
    b.addEventListener('mouseenter',()=>{b.style.background='#F1F5F9';});
    b.addEventListener('mouseleave',()=>{b.style.background='none';});
    return b;
  };
  actions.appendChild(mkBtn(cc>0?'💬'+cc:'💬','评论',()=>{state.commentTask=task;state.view='comments';render();},cc>0?'#3B82F6':'#64748B'));
  actions.appendChild(mkBtn('✏️','编辑',()=>{state.editTask=task;state.view='edit';render();}));
  actions.appendChild(mkBtn('🗑️','删除',()=>{state.confirmDeleteId=task.id;state.view='confirm';render();}));
  card.appendChild(actions);
  return card;
}

// ── 新建/编辑任务（新版 UI）──────────────────────────────
function renderTaskForm(isEdit) {
  const orig=isEdit?state.editTask:null;
  let f=orig?{...orig}:{title:'',description:'',priority:'P1',deadline:getDefaultDeadline(),reminderMinutes:30,intervalEnabled:false,intervalMinutes:60,comments:[]};

  const wrap=el('div',{style:{display:'flex',flexDirection:'column'}});
  wrap.appendChild(el('div',{style:{background:'#fff',borderBottom:'1px solid #E2E8F0',padding:'12px 22px',display:'flex',alignItems:'center',gap:10,position:'sticky',top:0,zIndex:10}},
    btn('返回',()=>{state.view='list';render();},{background:'#F1F5F9',padding:'6px 11px',color:'#64748B'}),
    el('span',{style:{fontSize:15,fontWeight:700}},isEdit?'✏️ 编辑任务':'➕ 新建任务')
  ));

  const form=el('div',{style:{padding:'12px 22px 16px',display:'flex',flexDirection:'column',gap:10}});

  const groupCard={background:'#F8FAFC',borderRadius:'10px',padding:'10px 12px',border:'1px solid #EEF2F6'};
  const sectionLabel={fontSize:'11px',fontWeight:700,color:'#94A3B8',letterSpacing:'0.5px',textTransform:'uppercase',marginBottom:'8px',display:'block'};
  const inpModern={width:'100%',padding:'8px 12px',border:'1px solid #E2E8F0',borderRadius:'8px',fontSize:'13.5px',outline:'none',boxSizing:'border-box',fontFamily:'inherit',background:'#fff'};

  // 标题 + 备注
  const titleInp=el('input',{type:'text',placeholder:'任务标题...',style:{width:'100%',padding:'8px 0',border:'none',borderBottom:'2px solid #E2E8F0',outline:'none',fontSize:'17px',fontWeight:600,fontFamily:'inherit',color:'#1E293B',boxSizing:'border-box',background:'transparent'}});
  titleInp.value=f.title;
  titleInp.addEventListener('input',()=>f.title=titleInp.value);
  const descInp=el('textarea',{placeholder:'添加备注或描述（可选）...',style:{width:'100%',padding:'6px 0',border:'none',outline:'none',fontSize:'13px',color:'#64748B',resize:'vertical',minHeight:'28px',fontFamily:'inherit',marginTop:'4px',background:'transparent'}});
  descInp.value=f.description||'';
  descInp.addEventListener('input',()=>f.description=descInp.value);
  form.appendChild(el('div',{},titleInp,descInp));

  // 优先级 + 截止时间卡片
  const pcCard=el('div',{style:groupCard});
  pcCard.appendChild(el('span',{style:sectionLabel},'📌 优先级'));
  const prow=el('div',{style:{display:'flex',gap:'5px',marginBottom:'12px'}});
  const pBtns={};
  Object.entries(PC).forEach(([k,v])=>{
    const active=f.priority===k;
    const b=el('button',{style:{flex:1,padding:'6px 4px',borderRadius:'7px',border:'1.5px solid '+(active?v.color:'transparent'),background:active?'#fff':'transparent',color:active?v.color:'#94A3B8',fontWeight:600,cursor:'pointer',fontSize:'12.5px',display:'flex',alignItems:'center',justifyContent:'center',gap:'5px',boxShadow:active?'0 1px 3px '+v.color+'33':'none',fontFamily:'inherit'}});
    b.appendChild(el('span',{style:{width:'6px',height:'6px',borderRadius:'50%',background:v.color,display:'inline-block',flexShrink:0}}));
    b.appendChild(el('span',{style:{fontWeight:700}},k));
    b.appendChild(el('span',{style:{fontSize:'10.5px',opacity:0.85}},v.text));
    b.addEventListener('click',()=>{
      f.priority=k;
      Object.entries(pBtns).forEach(([pk,pb])=>{
        const pv=PC[pk],sel=pk===k;
        pb.style.border='1.5px solid '+(sel?pv.color:'transparent');
        pb.style.background=sel?'#fff':'transparent';
        pb.style.color=sel?pv.color:'#94A3B8';
        pb.style.boxShadow=sel?'0 1px 3px '+pv.color+'33':'none';
      });
    });
    pBtns[k]=b; prow.appendChild(b);
  });
  pcCard.appendChild(prow);
  pcCard.appendChild(el('span',{style:sectionLabel},'📅 截止时间'));
  const dlInp=el('input',{type:'datetime-local',style:{...inpModern,flex:1}});
  dlInp.value=f.deadline||'';
  dlInp.addEventListener('change',()=>f.deadline=dlInp.value);
  const clearDlBtn=btn('清空',()=>{dlInp.value='';f.deadline='';},
    {background:'transparent',color:'#94A3B8',border:'1px solid #E2E8F0',borderRadius:8,padding:'8px 12px',fontSize:12,fontWeight:500,flexShrink:0});
  pcCard.appendChild(el('div',{style:{display:'flex',gap:6,alignItems:'stretch'}},dlInp,clearDlBtn));
  form.appendChild(pcCard);

  // 提醒设置卡片
  const remCard=el('div',{style:groupCard});
  remCard.appendChild(el('span',{style:sectionLabel},'🔔 提醒设置'));

  const remRow=el('div',{style:{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'8px'}});
  remRow.appendChild(el('span',{style:{fontSize:'13px',color:'#475569'}},'截止前首次提醒'));
  const remSel=el('select',{style:{padding:'5px 8px',border:'1px solid #E2E8F0',borderRadius:'6px',fontSize:'12.5px',background:'#fff',outline:'none',fontFamily:'inherit',cursor:'pointer'}});
  REMINDER_OPTS.forEach(m=>{const o=el('option',{value:m},'提前 '+fmtMin(m));if(m===f.reminderMinutes)o.selected=true;remSel.appendChild(o);});
  remSel.addEventListener('change',()=>f.reminderMinutes=Number(remSel.value));
  remRow.appendChild(remSel); remCard.appendChild(remRow);

  const ivRow=el('div',{style:{display:'flex',alignItems:'center',justifyContent:'space-between'}});
  ivRow.appendChild(el('div',{},el('span',{style:{fontSize:'13px',color:'#475569'}},'间歇性提醒'),el('span',{style:{fontSize:'11px',color:'#94A3B8',marginLeft:'6px'}},'反复提醒直到完成')));
  const tTrack=el('div',{style:{width:'36px',height:'20px',borderRadius:'10px',background:f.intervalEnabled?'#3B82F6':'#CBD5E1',position:'relative',cursor:'pointer',flexShrink:0,transition:'background 0.2s'}});
  const tThumb=el('div',{style:{position:'absolute',top:'2px',left:f.intervalEnabled?'18px':'2px',width:'16px',height:'16px',borderRadius:'50%',background:'#fff',boxShadow:'0 1px 3px rgba(0,0,0,0.2)',transition:'left 0.2s'}});
  tTrack.appendChild(tThumb); ivRow.appendChild(tTrack); remCard.appendChild(ivRow);

  const ivBody=el('div',{style:{marginTop:'10px',paddingTop:'10px',borderTop:'1px dashed #E2E8F0',display:f.intervalEnabled?'block':'none'}});
  ivBody.appendChild(el('div',{style:{fontSize:'12px',color:'#64748B',marginBottom:'6px'}},'每隔多久提醒一次'));
  const ivBtnWrap=el('div',{style:{display:'flex',gap:'5px',flexWrap:'wrap'}});
  const ivBtns={};
  INTERVAL_OPTS.forEach(m=>{
    const active=m===f.intervalMinutes;
    const b=btn(fmtMin(m),()=>{
      f.intervalMinutes=m;
      Object.entries(ivBtns).forEach(([k,v])=>{const sel=Number(k)===m;v.style.border='1px solid '+(sel?'#3B82F6':'#E2E8F0');v.style.background=sel?'#3B82F6':'#fff';v.style.color=sel?'#fff':'#64748B';});
    },{padding:'4px 11px',borderRadius:'14px',fontSize:'11.5px',fontWeight:600,border:'1px solid '+(active?'#3B82F6':'#E2E8F0'),background:active?'#3B82F6':'#fff',color:active?'#fff':'#64748B'});
    ivBtns[m]=b; ivBtnWrap.appendChild(b);
  });
  ivBody.appendChild(ivBtnWrap); remCard.appendChild(ivBody);
  tTrack.addEventListener('click',()=>{
    f.intervalEnabled=!f.intervalEnabled;
    tTrack.style.background=f.intervalEnabled?'#3B82F6':'#CBD5E1';
    tThumb.style.left=f.intervalEnabled?'18px':'2px';
    ivBody.style.display=f.intervalEnabled?'block':'none';
  });
  form.appendChild(remCard);

  // 操作按钮
  form.appendChild(el('div',{style:{display:'flex',gap:'8px',justifyContent:'flex-end',paddingTop:'4px'}},
    btn('取消',()=>{state.view='list';render();},{background:'#F1F5F9',color:'#64748B',padding:'8px 14px',fontSize:'13.5px',minWidth:'72px'}),
    btn('保存',async()=>{
      if(!f.title.trim())return alert('请输入任务标题');
      if(isEdit){Object.assign(orig,f);}
      else{state.tasks.unshift({...f,id:Date.now().toString()+Math.random().toString(36).slice(2,6),completed:false,createdAt:new Date().toISOString(),comments:[]});}
      await saveTasks(); state.view='list'; render();
    },{background:'linear-gradient(135deg, #3B82F6, #2563EB)',color:'#fff',border:'none',borderRadius:'9px',padding:'8px 24px',fontWeight:700,fontSize:'13.5px',boxShadow:'0 4px 12px rgba(59,130,246,0.3)',minWidth:'72px'})
  ));

  wrap.appendChild(form);
  return wrap;
}

// ── 评论页 ──────────────────────────────
function renderComments() {
  const task=state.tasks.find(t=>t.id===state.commentTask?.id)||state.commentTask;
  const p=PC[task.priority]||PC.P1;
  const wrap=el('div',{style:{display:'flex',flexDirection:'column',height:'600px'}});

  // 评论页 Header 返回按钮
  wrap.appendChild(el('div',{style:{background:'#fff',borderBottom:'1px solid #E2E8F0',padding:'12px 16px',display:'flex',alignItems:'center',gap:'10px',position:'sticky',top:'0px',zIndex:'10',flexShrink:0}},
    btn('返回',()=>{state.view='list';render();},{background:'#F1F5F9',padding:'5px 10px',color:'#64748B',flexShrink:0}),
    el('span',{style:{background:p.bg,color:p.color,border:'1px solid '+p.border,borderRadius:'5px',padding:'2px 8px',fontSize:'11px',fontWeight:800,flexShrink:0}},task.priority),
    el('span',{style:{fontSize:'14px',fontWeight:600,color:'#1E293B',flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}},task.title),
    task.deadline?el('span',{style:{fontSize:'12px',color:'#64748B',flexShrink:0,whiteSpace:'nowrap'}},'📅 '+fmtDT(task.deadline)):null
  ));

  // 评论列表
  const list=el('div',{style:{flex:1,overflowY:'auto',padding:'14px 22px',display:'flex',flexDirection:'column',gap:'10px'}});
  const cs=task.comments||[];
  if(!cs.length){
    list.appendChild(el('div',{style:{textAlign:'center',padding:'40px 0',color:'#CBD5E1'}},
      el('div',{style:{fontSize:'34px'}},'💬'),
      el('p',{style:{fontSize:'12px',marginTop:'7px'}},'暂无评论，写下第一条吧')
    ));
  } else {
    cs.forEach(c=>{
      list.appendChild(el('div',{style:{background:'#F8FAFC',border:'1px solid #E2E8F0',borderRadius:'8px',padding:'10px 14px'}},
        el('p',{style:{fontSize:'13px',color:'#334155',lineHeight:'1.5',whiteSpace:'pre-wrap',margin:0}},c.text),
        el('p',{style:{fontSize:'10.5px',color:'#94A3B8',marginTop:'6px'}},new Date(c.createdAt).toLocaleString('zh-CN'))
      ));
    });
  }
  wrap.appendChild(list);

  // 输入框 + 发送
  const footer=el('div',{style:{padding:'12px 22px',borderTop:'1px solid #E2E8F0',background:'#fff',flexShrink:0}});
  const ta=el('textarea',{placeholder:'写下备注或进展... (Ctrl+Enter 发送)',style:{...inpStyle,height:'64px',resize:'none',marginBottom:'8px'}});
  const sb=btn('发送',async()=>{
    if(!ta.value.trim())return;
    if(!task.comments)task.comments=[];
    task.comments.push({id:Date.now().toString(),text:ta.value.trim(),createdAt:new Date().toISOString()});
    await saveTasks(); render();
  },{background:'linear-gradient(135deg, #3B82F6, #2563EB)',color:'#fff',border:'none',borderRadius:'9px',padding:'8px 24px',fontWeight:700,fontSize:'13.5px',boxShadow:'0 4px 12px rgba(59,130,246,0.3)',minWidth:'72px'});
  ta.addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey))sb.click();});
  const btnRow=el('div',{style:{display:'flex',gap:'8px',justifyContent:'flex-end'}},
    btn('返回',()=>{state.view='list';render();},{background:'#F1F5F9',color:'#64748B',padding:'8px 14px',fontSize:'13.5px',minWidth:'72px'}),
    sb
  );
  footer.appendChild(ta);
  footer.appendChild(btnRow);
  wrap.appendChild(footer);
  return wrap;
}

// ── 设置页 ──────────────────────────────
function renderSettings() {
  let f={...state.settings};
  const wrap=el('div');
  wrap.appendChild(el('div',{style:{background:'#fff',borderBottom:'1px solid #E2E8F0',padding:'12px 22px',display:'flex',alignItems:'center',gap:10}},
    btn('返回',()=>{state.view='list';render();},{background:'#F1F5F9',padding:'6px 11px',color:'#64748B'}),
    el('span',{style:{fontSize:15,fontWeight:700}},'⚙️ 通知设置')
  ));
  const form=el('div',{style:{padding:'14px 22px 18px',display:'flex',flexDirection:'column',gap:14}});
  const tipBox = el('div',{style:{background:'#FFF7ED',border:'1px solid #FED7AA',borderRadius:'10px',padding:'12px',fontSize:'12px',color:'#92400E',lineHeight:'1.8'}});
  tipBox.innerHTML = '📖 <b>配置 Telegram：</b><br>1. 搜索 <b>@BotFather</b> 发送 /newbot 创建机器人<br>2. 复制 Bot Token<br>3. 向机器人发任意消息<br>4. 浏览器访问 api.telegram.org/bot【Token】/getUpdates 获取 chat.id';
  form.appendChild(tipBox);
  form.appendChild(lbl('Bot Token'));
  const ti=inp('text',f.botToken,'1234567890:ABCdef...',()=>f.botToken=ti.value); form.appendChild(ti);
  form.appendChild(lbl('Chat ID'));
  const ci=inp('text',f.chatId,'123456789',()=>f.chatId=ci.value); form.appendChild(ci);
  const re=el('div',{style:{display:'none',padding:9,borderRadius:8,fontSize:12,fontWeight:500}}); form.appendChild(re);
  form.appendChild(el('div',{style:{display:'flex',gap:9,justifyContent:'space-between',flexWrap:'wrap',marginTop:4}},
    btn('测试',async()=>{
      const token=cleanTelegramToken(f.botToken),chatId=String(f.chatId||'').trim();
      ti.value=token; ci.value=chatId; f.botToken=token; f.chatId=chatId;
      try{const r=await fetch('https://api.telegram.org/bot'+token+'/sendMessage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:chatId,text:'✅ 智能待办清单测试通知成功！🎉'})});const d=await r.json();re.style.display='block';re.style.background=d.ok?'#F0FDF4':'#FEF2F2';re.style.color=d.ok?'#15803D':'#DC2626';re.textContent=d.ok?'✅ 发送成功！请查看 Telegram':'❌ '+(d.error_code||'')+' '+(d.description||'');}catch(e){re.style.display='block';re.style.background='#FEF2F2';re.style.color='#DC2626';re.textContent='❌ 网络错误：'+e.message;}
    },{background:'#F1F5F9',color:'#64748B'}),
    el('div',{style:{display:'flex',gap:9}},
      btn('取消',()=>{state.view='list';render();},{background:'#F1F5F9',color:'#64748B'}),
      btn('保存',async()=>{state.settings=f;await saveSettings();state.view='list';render();},{background:'#3B82F6',color:'#fff'})
    )
  ));
  wrap.appendChild(form); return wrap;
}

// ── 删除确认 ──────────────────────────────
function renderConfirm() {
  const task=state.tasks.find(t=>t.id===state.confirmDeleteId);
  const wrap=el('div',{style:{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',minHeight:'600px',padding:'24px',textAlign:'center'}});
  wrap.appendChild(el('div',{style:{fontSize:'48px',marginBottom:'14px'}},'🗑️'));
  const msg=el('p',{style:{fontSize:'14px',color:'#334155',lineHeight:'1.7',marginBottom:'22px'}});
  msg.innerHTML='确定要删除<br>「'+(task?.title||'')+'」吗？<br>此操作无法撤销。';
  wrap.appendChild(msg);
  wrap.appendChild(el('div',{style:{display:'flex',gap:'12px'}},
    btn('取消',()=>{state.view='list';render();},{background:'#F1F5F9',color:'#64748B',minWidth:'90px',padding:'10px 20px'}),
    btn('确认',async()=>{
      const id=state.confirmDeleteId;
      ['reminder','expired','interval'].forEach(t=>chrome.alarms.clear(id+'|'+t));
      state.tasks=state.tasks.filter(t=>t.id!==id);
      await saveTasks(); state.view='list'; render();
    },{background:'#FEF2F2',color:'#EF4444',border:'1px solid #FECACA',minWidth:'90px',padding:'10px 20px'})
  ));
  return wrap;
}

// ── 启动 ──────────────────────────────
document.addEventListener('DOMContentLoaded', async()=>{ await loadState(); render(); });
