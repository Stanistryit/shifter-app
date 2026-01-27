const tg = window.Telegram.WebApp;
if(tg) { tg.ready(); if(tg.platform && tg.platform!=='unknown') try{tg.expand()}catch(e){} }
function triggerHaptic() { if(tg?.HapticFeedback) tg.HapticFeedback.impactOccurred('light'); }

let currentUser = null; let globalShifts = []; let globalUsers = []; let globalTasks = []; let globalNotes = [];
let activeFilter = 'all'; const START_HOUR = 10; const TOTAL_HOURS = 10; let currentCalendarDate = new Date();
let selectedNoteDate = null; let currentNoteType = 'private';

// --- THEME ---
function initTheme() { if ((tg?.colorScheme === 'dark') || localStorage.theme === 'dark') { document.documentElement.classList.add('dark'); document.getElementById('themeIcon').innerText = '☀️'; if(tg?.setHeaderColor){tg.setHeaderColor('#1C1C1E'); tg.setBackgroundColor('#000000');} } else { document.documentElement.classList.remove('dark'); document.getElementById('themeIcon').innerText = '🌙'; if(tg?.setHeaderColor){tg.setHeaderColor('#FFFFFF'); tg.setBackgroundColor('#F2F2F7');} } }
function toggleTheme() { triggerHaptic(); const html = document.documentElement; if (html.classList.contains('dark')) { html.classList.remove('dark'); localStorage.theme = 'light'; document.getElementById('themeIcon').innerText = '🌙'; if(tg?.setHeaderColor){tg.setHeaderColor('#FFFFFF'); tg.setBackgroundColor('#F2F2F7');} } else { html.classList.add('dark'); localStorage.theme = 'dark'; document.getElementById('themeIcon').innerText = '☀️'; if(tg?.setHeaderColor){tg.setHeaderColor('#1C1C1E'); tg.setBackgroundColor('#000000');} } }
initTheme();

// --- TOASTS ---
function showToast(msg, type = 'success') {
    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        container.className = 'fixed top-4 left-1/2 transform -translate-x-1/2 z-[100] space-y-2 w-full max-w-xs pointer-events-none';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    const icon = type === 'success' ? '✅' : '⚠️';
    toast.className = `toast ${type}`; 
    toast.innerHTML = `<span>${icon}</span><span>${msg}</span>`;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    if(type === 'success' && tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
    if(type === 'error' && tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred('error');
    setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 400); }, 3000);
}

// --- AUTH ---
async function checkAuth() { 
    try { const res = await fetch('/api/me'); const data = await res.json(); if (data.loggedIn) { showApp(data.user); return; } } catch (e) {}
    if (!tg.initDataUnsafe?.user?.id) { document.getElementById('skeletonLoader').classList.add('hidden'); document.getElementById('loginScreen').classList.remove('hidden'); return; }
    try { const res = await fetch('/api/login-telegram', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ telegramId: tg.initDataUnsafe.user.id }) }); const data = await res.json(); if (data.success) showApp(data.user); else { document.getElementById('skeletonLoader').classList.add('hidden'); document.getElementById('loginScreen').classList.remove('hidden'); } } catch (e) { document.getElementById('skeletonLoader').classList.add('hidden'); document.getElementById('loginScreen').classList.remove('hidden'); }
}

async function login() { 
    triggerHaptic(); 
    const u = document.getElementById('loginUser').value; 
    const p = document.getElementById('loginPass').value; 
    try { 
        const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username:u, password:p }) }); 
        const data = await res.json(); 
        if (data.success) showApp(data.user); 
        else showToast(data.message || "Помилка входу", 'error'); 
    } catch (e) { showToast("Помилка з'єднання", 'error'); } 
}

async function logout() { triggerHaptic(); await fetch('/api/logout', { method: 'POST' }); window.location.reload(); }

async function showApp(user) {
    currentUser = user;
    document.getElementById('loginScreen').classList.add('hidden'); document.getElementById('skeletonLoader').classList.add('hidden');
    const app = document.getElementById('appScreen'); app.classList.remove('hidden'); setTimeout(() => app.classList.remove('opacity-0'), 50);
    const parts = user.name.split(' '); document.getElementById('userNameDisplay').innerText = `Привіт, ${parts.length > 1 ? parts[1] : parts[0]}`; 
    if(user.avatar) { document.getElementById('userAvatarImg').src = user.avatar; document.getElementById('userAvatarImg').classList.remove('hidden'); document.getElementById('userAvatarPlaceholder').classList.add('hidden'); }
    
    if (['admin', 'SM', 'SSE', 'RRP'].includes(user.role)) { 
        if(user.role !== 'RRP') document.getElementById('toggleEditWrapper').classList.remove('hidden'); 
        if (['SM', 'admin'].includes(user.role)) { 
            document.getElementById('tabRequestsBtn').classList.remove('hidden'); 
            loadRequests(); 
        } 
        if (user.role === 'SM' || user.role === 'admin') { 
            document.getElementById('noteTypeToggle').classList.remove('hidden'); 
            document.getElementById('noteTypeToggle').classList.add('flex'); 
        } 
    }
    await Promise.all([loadEmployeeList(), loadShifts(), loadTasks(), loadNotes()]); renderCurrentShifts();
}

function renderCurrentShifts() { 
    renderTimeline(globalShifts, null); 
    renderCalendar(); 
}

// --- RENDERING ---
function renderTimeline(shifts, filterUser) {
    const main = document.getElementById('scheduleView'); main.innerHTML = '';
    const archive = document.getElementById('archiveContainer'); archive.innerHTML = '';
    const dates = [...new Set([...shifts.map(s => s.date), ...globalNotes.map(n => n.date)])].sort();
    const today = new Date().toISOString().split('T')[0]; if (!dates.includes(today)) dates.push(today); dates.sort();
    let pastDaysCount = 0;
    let usersToShow = (activeFilter === 'all') ? globalUsers : globalUsers.filter(u => u.name === activeFilter);

    // Calc monthly hours
    const currentMonthPrefix = today.substring(0, 7);
    const userHours = {};
    usersToShow.forEach(u => {
        let h = 0;
        shifts.filter(s => s.name === u.name && s.date.startsWith(currentMonthPrefix) && s.start !== 'Відпустка').forEach(s => {
            const [h1, m1] = s.start.split(':').map(Number);
            const [h2, m2] = s.end.split(':').map(Number);
            h += (h2 + m2/60) - (h1 + m1/60);
        });
        userHours[u.name] = h.toFixed(0);
    });

    dates.forEach((dateStr, index) => {
        const isPast = dateStr < today; const isToday = dateStr === today;
        const dObj = new Date(dateStr); const dName = dObj.toLocaleDateString('uk-UA', { weekday: 'long', day: 'numeric', month: 'long' });
        const animClass = isPast ? '' : `animate-slide-up stagger-${(index % 5) + 1}`;
        const block = document.createElement('div');
        block.className = `ios-card p-4 ${animClass}`;
        if(isToday) block.classList.add('ring-2', 'ring-blue-500', 'shadow-lg', 'shadow-blue-500/20');

        let html = `<div class="mb-3 border-b border-gray-100 dark:border-gray-800 pb-2 flex justify-between items-center cursor-pointer active:opacity-60" onclick="triggerHaptic(); openNotesModal('${dateStr}')"><h3 class="font-bold text-lg capitalize ${isToday?'text-blue-500':'text-black dark:text-white'}">${dName}</h3><div class="text-blue-500 text-xs font-bold px-2 py-1 bg-blue-50 dark:bg-blue-900/30 rounded-lg">📝 Нотатки</div></div>`;
        const dayNotes = globalNotes.filter(n => n.date === dateStr);
        if (dayNotes.length > 0) { html += `<div class="mb-3 space-y-1.5">`; dayNotes.forEach(n => { const style = n.type === 'public' ? 'bg-blue-50 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200 border-l-2 border-blue-500' : 'bg-yellow-50 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200 border-l-2 border-yellow-500'; const icon = n.type === 'public' ? '📢' : '🔒'; html += `<div class="text-[11px] p-2 rounded-r-md ${style} flex items-start gap-1"><span>${icon}</span> <span><b>${n.author}:</b> ${n.text}</span></div>`; }); html += `</div>`; }
        html += `<div class="space-y-4">`;

        usersToShow.forEach(user => {
            const shift = shifts.find(s => s.date === dateStr && s.name === user.name);
            const userTasks = globalTasks.filter(t => t.date === dateStr && t.name === user.name);
            const parts = user.name.split(' '); const shortName = parts.length > 1 ? parts[1] : parts[0];
            const hoursBadges = ` <span class="text-[9px] text-gray-400 font-normal">(${userHours[user.name]} год.)</span>`;
            
            let avatarHtml = `<div class="w-5 h-5 rounded-full bg-gray-200 flex items-center justify-center text-[10px] overflow-hidden mr-2 border border-gray-300 dark:border-gray-600">👤</div>`;
            if(user.avatar) avatarHtml = `<div class="w-5 h-5 rounded-full overflow-hidden mr-2 border border-gray-300 dark:border-gray-600"><img src="${user.avatar}" class="w-full h-full object-cover"></div>`;

            if (shift) {
                const isMe = shift.name === currentUser.name;
                const delShift = (['admin','SM','SSE'].includes(currentUser.role) && currentUser.role !== 'RRP') ? `<button onclick="delS('${shift.date}','${shift.name}')" class="ml-auto text-gray-300 hover:text-red-500 p-1">✕</button>` : '';

                if (shift.start === 'Відпустка') {
                    html += `<div><div class="flex items-center text-xs mb-1 font-medium ${isMe?'text-teal-600 font-bold':'text-gray-900 dark:text-gray-200'}">${avatarHtml} <span>${shortName}</span> ${hoursBadges} <span class="ml-2 text-teal-500 font-mono">Відпустка</span> ${delShift}</div><div class="timeline-track"><div class="shift-segment vacation-segment">ВІДПУСТКА 🌴</div></div></div>`;
                } else {
                    const [sH, sM] = shift.start.split(':').map(Number); const [eH, eM] = shift.end.split(':').map(Number); 
                    const startDecimal = sH + sM/60; const endDecimal = eH + eM/60;   
                    let left = ((startDecimal - START_HOUR) / TOTAL_HOURS) * 100; let width = ((endDecimal - startDecimal) / TOTAL_HOURS) * 100; if(left < 0) { width += left; left = 0; } if(left + width > 100) width = 100 - left;
                    
                    let tasksHtml = '';
                    let badges = ''; 
                    
                    userTasks.forEach(task => { 
                        if(task.isFullDay) {
                            badges += `<span class="ml-2 text-[10px] text-purple-600 font-bold border border-purple-200 bg-purple-50 px-1 rounded">★ ${task.title}</span>`; 
                        } else { 
                            const [tS_h, tS_m] = task.start.split(':').map(Number); const [tE_h, tE_m] = task.end.split(':').map(Number); 
                            const tStartD = tS_h + tS_m/60; const tEndD = tE_h + tE_m/60; 
                            let tLeft = ((tStartD - START_HOUR) / TOTAL_HOURS) * 100; let tWidth = ((tEndD - tStartD) / TOTAL_HOURS) * 100; 
                            const canDelTask = (['admin','SM','SSE'].includes(currentUser.role) && currentUser.role !== 'RRP');
                            const delAction = canDelTask ? `onclick="deleteTask('${task._id}'); event.stopPropagation();"` : '';
                            tasksHtml += `<div class="task-segment" style="left:${tLeft}%; width:${tWidth}%;" ${delAction}>${task.title}</div>`; 
                        } 
                    });
                    
                    html += `<div><div class="flex items-center text-xs mb-1 font-medium ${isMe?'text-blue-600 font-bold':'text-gray-900 dark:text-gray-200'}">${avatarHtml} <span>${shortName}</span> ${hoursBadges} <span class="ml-2 text-gray-400 font-mono">${shift.start}-${shift.end}</span> ${badges} ${delShift}</div><div class="timeline-track shadow-inner"><div class="timeline-grid-overlay">${Array(10).fill('<div class="timeline-line"></div>').join('')}</div><div class="shift-segment ${isMe?'my-shift':''}" style="left:${left}%; width:${width}%"></div>${tasksHtml}</div></div>`;
                }
            } else if (userTasks.length > 0) { 
                let tasksHtml = ''; userTasks.forEach(task => { if(!task.isFullDay) { const [tS_h, tS_m] = task.start.split(':').map(Number); const [tE_h, tE_m] = task.end.split(':').map(Number); const tStartD = tS_h + tS_m/60; const tEndD = tE_h + tE_m/60; let tLeft = ((tStartD - START_HOUR) / TOTAL_HOURS) * 100; let tWidth = ((tEndD - tStartD) / TOTAL_HOURS) * 100; const canDelTask = (['admin','SM','SSE'].includes(currentUser.role) && currentUser.role !== 'RRP'); const delAction = canDelTask ? `onclick="deleteTask('${task._id}'); event.stopPropagation();"` : ''; tasksHtml += `<div class="task-segment" style="left:${tLeft}%; width:${tWidth}%;" ${delAction}>${task.title}</div>`; } });
                html += `<div class="opacity-80"><div class="flex items-center text-xs mb-1 text-gray-500">${avatarHtml} <span>${shortName}</span> ${hoursBadges} <span class="ml-2 text-orange-500 font-bold">Тільки задача</span></div><div class="timeline-track"><div class="timeline-grid-overlay">${Array(10).fill('<div class="timeline-line"></div>').join('')}</div>${tasksHtml}</div></div>`; 
            } else { html += `<div class="opacity-40"><div class="flex items-center justify-between text-xs mb-1 text-gray-400"><div>${avatarHtml} <span>${shortName}</span> ${hoursBadges}</div> <span>Вихідний</span></div><div class="h-[1px] bg-gray-200 dark:bg-gray-800 rounded w-full mt-3 mb-4"></div></div>`; }
        });
        html += `</div>`; block.innerHTML = html; if(isPast) { archive.appendChild(block); pastDaysCount++; } else { main.appendChild(block); } if(isToday) setTimeout(()=>block.scrollIntoView({behavior:'smooth',block:'center'}),600);
    });
    const arcBtn = document.getElementById('archiveToggleBtn'); const arcCnt = document.getElementById('archiveCount');
    if(pastDaysCount > 0) { arcBtn.classList.remove('hidden'); arcCnt.innerText = pastDaysCount; } else { arcBtn.classList.add('hidden'); }
}

function renderCalendar() { 
    const g = document.getElementById('calendarGrid'); 
    g.innerHTML=''; 
    const t = document.getElementById('calendarTitle'); 
    const y = currentCalendarDate.getFullYear(); 
    const m = currentCalendarDate.getMonth(); 
    t.innerText = new Date(y, m).toLocaleDateString('uk-UA', { month: 'long', year: 'numeric' }); 
    const fd = new Date(y, m, 1).getDay() || 7; 
    const ld = new Date(y, m + 1, 0).getDate(); 
    const today = new Date().toISOString().split('T')[0];

    for(let i = 1; i < fd; i++) { g.innerHTML += `<div class="calendar-day opacity-0 pointer-events-none"></div>`; }

    for(let d = 1; d <= ld; d++){ 
        const ds = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`; 
        const shift = globalShifts.find(s => s.date === ds && s.name === currentUser.name); 
        const tasks = globalTasks.filter(t => t.date === ds && t.name === currentUser.name); 
        let dayClass = '';
        let content = `<span class="font-bold mb-1">${d}</span>`; 
        if (shift) { 
            if (shift.start === 'Відпустка') { dayClass = 'vacation-day'; content += `<div class="work-badge">🌴</div>`; } 
            else { dayClass = 'my-work-day'; content += `<div class="work-badge">${shift.start}-${shift.end}</div>`; } 
        } 
        if(tasks.length > 0) { content += `<div class="absolute top-1 right-1 w-1.5 h-1.5 bg-purple-500 rounded-full"></div>`; }
        if (ds === today) dayClass += ' today'; 
        g.innerHTML += `<div class="calendar-day ${dayClass}" onclick="triggerHaptic(); openNotesModal('${ds}')">${content}</div>`; 
    } 
}

// --- DATA LOADERS ---
async function loadEmployeeList() { const r=await fetch('/api/users'); if(r.ok){const d=await r.json(); globalUsers=d.filter(u=>u.role!=='admin'&&u.role!=='RRP'); const s1=document.getElementById('employeeSelect'); const s2=document.getElementById('taskEmployee'); s1.innerHTML='<option disabled selected>Хто?</option>'; s2.innerHTML='<option disabled selected>Кому?</option>'; globalUsers.forEach(x=>{s1.innerHTML+=`<option value="${x.name}">${x.name}</option>`; s2.innerHTML+=`<option value="${x.name}">${x.name}</option>`;}); } }
async function loadShifts() { const r = await fetch('/api/shifts'); if(r.ok) globalShifts = await r.json(); }
async function loadTasks() { const r = await fetch('/api/tasks'); if(r.ok) globalTasks = await r.json(); }
async function loadNotes() { const r = await fetch('/api/notes'); if(r.ok) globalNotes = await r.json(); }
async function loadRequests(){ const r=await fetch('/api/requests'); const d=await r.json(); const c=document.getElementById('requestsList'); c.innerHTML=''; if(!d.length){c.innerHTML='<p class="text-gray-400 text-xs text-center">Пусто</p>';return;} d.forEach(q=>{c.innerHTML+=`<div class="bg-gray-50 dark:bg-gray-700 p-2 rounded text-xs flex justify-between"><span>${q.type}: ${q.createdBy}</span><div class="flex gap-2"><button onclick="handleRequest('${q._id}','approve')" class="text-green-600">✅</button><button onclick="handleRequest('${q._id}','reject')" class="text-red-600">❌</button></div></div>`}); }
async function loadLogs() { const r = await fetch('/api/logs'); const logs = await r.json(); const c = document.getElementById('logsList'); c.innerHTML = ''; logs.forEach(l => { const date = new Date(l.timestamp).toLocaleString('uk-UA'); c.innerHTML += `<div class="bg-gray-50 dark:bg-gray-800 p-2 rounded border-l-2 border-gray-400"><div class="font-bold text-[10px] text-gray-400">${date}</div><div><b>${l.performer}</b>: ${l.action} (${l.details})</div></div>`; }); }

// --- UI INTERACTIONS ---
document.querySelectorAll('button').forEach(b => b.addEventListener('click', () => triggerHaptic()));

function setMode(m){ triggerHaptic(); document.getElementById('listViewContainer').className = m === 'list' ? '' : 'hidden'; document.getElementById('calendarViewContainer').className = m === 'list' ? 'hidden' : 'ios-card p-4 animate-slide-up'; const btnList = document.getElementById('btnModeList'); const btnCal = document.getElementById('btnModeCalendar'); if (m === 'list') { btnList.className = "flex-1 py-2 text-xs font-bold rounded-[10px] bg-white dark:bg-[#636366] shadow-sm text-black dark:text-white transition-all"; btnCal.className = "flex-1 py-2 text-xs font-medium text-gray-500 transition-all"; } else { btnList.className = "flex-1 py-2 text-xs font-medium text-gray-500 transition-all"; btnCal.className = "flex-1 py-2 text-xs font-bold rounded-[10px] bg-white dark:bg-[#636366] shadow-sm text-black dark:text-white transition-all"; } if(m === 'calendar') renderCalendar(); }
function toggleEditMode(){ triggerHaptic(); document.getElementById('adminPanel').classList.toggle('hidden'); }
function toggleTaskTimeInputs(){ const c=document.getElementById('taskFullDay').checked;document.getElementById('taskTimeInputs').className=c?'hidden':'flex gap-3'; }
function toggleShiftTimeInputs(){ const c=document.getElementById('shiftVacation').checked;document.getElementById('shiftTimeInputs').className=c?'hidden':'flex gap-3'; }
function showAdminTab(t){ triggerHaptic(); ['shifts','tasks','requests','import','news','logs'].forEach(x=>document.getElementById('adminTab'+x.charAt(0).toUpperCase()+x.slice(1)).classList.add('hidden'));document.getElementById('adminTab'+t.charAt(0).toUpperCase()+t.slice(1)).classList.remove('hidden');if(t==='requests')loadRequests(); if(t==='logs')loadLogs(); }

function openFilterModal() { triggerHaptic(); document.getElementById('filterModal').classList.remove('hidden'); renderFilterList(); }
function renderFilterList() { let html = `<button onclick="applyFilter('all')" class="w-full text-left p-3 rounded-xl flex justify-between items-center ${activeFilter==='all' ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-500 font-bold' : 'hover:bg-gray-50 dark:hover:bg-[#2C2C2E]'}"><span class="font-medium">Всі співробітники</span>${activeFilter==='all' ? '<span>✓</span>' : ''}</button>`; globalUsers.forEach(u => { const isSelected = activeFilter === u.name; html += `<button onclick="applyFilter('${u.name}')" class="w-full text-left p-3 rounded-xl flex justify-between items-center ${isSelected ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-500 font-bold' : 'hover:bg-gray-50 dark:hover:bg-[#2C2C2E]'}"><span class="font-medium">${u.name}</span>${isSelected ? '<span>✓</span>' : ''}</button>`; }); document.getElementById('filterList').innerHTML = html; }
function closeFilterModal() { document.getElementById('filterModal').classList.add('hidden'); }
function applyFilter(val) { triggerHaptic(); activeFilter = val; document.getElementById('currentFilterLabel').innerText = val === 'all' ? 'Всі співробітники' : val.split(' ')[1] || val; closeFilterModal(); renderCurrentShifts(); }

// --- ACTIONS ---
async function clearMonth() {
    const d = document.getElementById('shiftDate').value;
    if(!d) return showToast("Оберіть дату", 'error');
    const month = d.substring(0, 7); 
    if(confirm(`⚠️ ВИДАЛИТИ ВЕСЬ ГРАФІК за ${month}? Це незворотно.`)) {
        await fetch('/api/shifts/clear-month', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ month })
        });
        await loadShifts(); renderCurrentShifts();
        showToast("Місяць очищено");
    }
}

async function addShift() { 
    const date=document.getElementById('shiftDate').value; const name=document.getElementById('employeeSelect').value; 
    const isVacation = document.getElementById('shiftVacation').checked; 
    let start, end; if (isVacation) { start = 'Відпустка'; end = 'Відпустка'; } else { start=document.getElementById('startTime').value; end=document.getElementById('endTime').value; } 
    if(!date||!name)return showToast("Заповніть всі дані", 'error'); 
    
    const r=await fetch('/api/shifts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({date,name,start,end})}); 
    const d=await r.json(); 
    if(d.pending) showToast("Запит відправлено (Pending)", 'success');
    else showToast("Зміну додано");
    
    loadShifts().then(renderCurrentShifts); 
}

async function addTask() { 
    const title=document.getElementById('taskTitle').value; const date=document.getElementById('taskDate').value; const name=document.getElementById('taskEmployee').value; const isFullDay=document.getElementById('taskFullDay').checked; const start=document.getElementById('taskStart').value; const end=document.getElementById('taskEnd').value; 
    if(!title||!date||!name)return showToast("Заповніть дані", 'error'); 
    await fetch('/api/tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title,date,name,isFullDay,start,end})}); 
    showToast("Задачу призначено");
    loadTasks().then(renderCurrentShifts); 
}

async function publishNews() { 
    const text = document.getElementById('newsText').value; 
    const files = document.getElementById('newsFile').files; 
    if (!text && files.length === 0) return showToast("Введіть текст або файл", 'error'); 
    
    const formData = new FormData(); formData.append('text', text); 
    for (let i = 0; i < files.length; i++) { formData.append('media', files[i]); }
    
    const btn = document.querySelector('#adminTabNews button:last-child'); 
    btn.innerText = "⏳ Публікую..."; btn.disabled = true; 
    
    try { 
        const res = await fetch('/api/news/publish', { method: 'POST', body: formData }); 
        if (res.ok) { 
            showToast("✅ Опубліковано!"); 
            document.getElementById('newsText').value = ''; 
            document.getElementById('newsFile').value = ''; 
            updateFileName(); 
        } else { showToast("Помилка публікації", 'error'); } 
    } catch (e) { showToast("Помилка мережі", 'error'); } 
    finally { btn.innerText = "Опублікувати"; btn.disabled = false; } 
}

async function bulkImport() { 
    const raw = document.getElementById('importData').value; 
    if(!raw) return showToast("Пусте поле", 'error'); 
    const rows = raw.trim().split('\n'); const shifts = []; 
    rows.forEach(row => { 
        const parts = row.trim().split(/[\t, ]+/); if (parts.length < 3) return; 
        const date = parts[0]; const lastEl = parts[parts.length - 1].toLowerCase();
        if(lastEl.includes('відпустка') || lastEl.includes('vacation')) { const name = parts.slice(1, parts.length - 1).join(' '); shifts.push({ date, name, start: 'Відпустка', end: 'Відпустка' }); } 
        else if(parts.length >= 4) { const start = parts[parts.length - 2]; const end = parts[parts.length - 1]; const name = parts.slice(1, parts.length - 2).join(' '); shifts.push({ date, name, start, end }); } 
    }); 
    if(!shifts.length) return showToast("Не розпізнано", 'error'); 
    if(confirm(`Завантажити ${shifts.length} змін?`)) { 
        const res = await fetch('/api/shifts/bulk', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ shifts }) }); 
        if(res.ok) { document.getElementById('importData').value = ''; await loadShifts(); renderCurrentShifts(); showToast("Імпорт успішний"); } else { showToast("Помилка імпорту", 'error'); } 
    } 
}

async function delS(d,n){ if(confirm("Видалити?")) { await fetch('/api/delete-shift',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({date:d,name:n})}); showToast("Видалено"); await loadShifts(); renderCurrentShifts(); } }
async function deleteTask(id){ if(confirm("Видалити задачу?")) { await fetch('/api/tasks/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})}); showToast("Задачу видалено"); await loadTasks(); renderCurrentShifts(); } }
async function handleRequest(id, action) { await fetch('/api/requests/action', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,action})}); showToast(action==='approve'?"Схвалено":"Відхилено"); loadRequests(); }
async function approveAllRequests() { if(confirm("Схвалити все?")) { await fetch('/api/requests/approve-all', {method:'POST'}); showToast("Всі схвалено"); loadRequests(); } }

function clearDay(){const d=document.getElementById('shiftDate').value; if(d&&confirm(`Clean ${d}?`)){ fetch('/api/shifts/clear-day',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({date:d})}).then(()=>{ showToast("День очищено"); loadShifts().then(renderCurrentShifts) }); }}
function toggleArchive(){ triggerHaptic(); document.getElementById('archiveContainer').classList.toggle('hidden'); }
function changeMonth(d){triggerHaptic(); currentCalendarDate.setMonth(currentCalendarDate.getMonth()+d);renderCalendar();}
function formatText(type) { const field = document.getElementById('newsText'); const start = field.selectionStart; const end = field.selectionEnd; const text = field.value; const selectedText = text.substring(start, end); let before = '', after = ''; if (type === 'bold') { before = '<b>'; after = '</b>'; } else if (type === 'italic') { before = '<i>'; after = '</i>'; } else if (type === 'link') { const url = prompt("URL:", "https://"); if (!url) return; before = `<a href="${url}">`; after = '</a>'; } const content = selectedText || (type === 'link' ? 'посилання' : 'текст'); field.value = text.substring(0, start) + before + content + after + text.substring(end); field.focus(); }
function updateFileName() { const input = document.getElementById('newsFile'); const count = input.files.length; const label = document.getElementById('fileName'); if (count > 0) { label.innerText = count === 1 ? input.files[0].name : `Обрано ${count} файлів`; } else { label.innerText = "Оберіть файли (можна декілька)"; } }

// Notes / Modals
function openAvatarModal() { triggerHaptic(); document.getElementById('avatarModal').classList.remove('hidden'); }
function closeAvatarModal() { document.getElementById('avatarModal').classList.add('hidden'); }
function handleAvatarSelect(input) { if (input.files && input.files[0]) { const reader = new FileReader(); reader.onload = function(e) { const img = document.getElementById('avatarPreview'); img.src = e.target.result; img.classList.remove('hidden'); document.getElementById('avatarPlaceholder').classList.add('hidden'); document.getElementById('avatarActions').classList.remove('hidden'); }; reader.readAsDataURL(input.files[0]); } }
function uploadAvatar() { const imgElement = document.getElementById('avatarPreview'); const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d'); const size = 200; canvas.width = size; canvas.height = size; const img = new Image(); img.onload = function() { const minSide = Math.min(img.width, img.height); const sx = (img.width - minSide) / 2; const sy = (img.height - minSide) / 2; ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size); const dataUrl = canvas.toDataURL('image/jpeg', 0.7); fetch('/api/user/avatar', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ avatar: dataUrl }) }).then(res => res.json()).then(data => { if(data.success) { document.getElementById('userAvatarImg').src = dataUrl; document.getElementById('userAvatarImg').classList.remove('hidden'); document.getElementById('userAvatarPlaceholder').classList.add('hidden'); closeAvatarModal(); showToast("Аватар оновлено"); } else { showToast("Помилка", 'error'); } }); }; img.src = imgElement.src; }

function openNotesModal(dateStr) { triggerHaptic(); selectedNoteDate = dateStr; document.getElementById('notesModalTitle').innerText = `Нотатки (${dateStr})`; document.getElementById('notesModal').classList.remove('hidden'); renderNotesList(); }
function closeNotesModal() { document.getElementById('notesModal').classList.add('hidden'); }
function renderNotesList() { const list = document.getElementById('notesList'); list.innerHTML = ''; const dayNotes = globalNotes.filter(n => n.date === selectedNoteDate); if (dayNotes.length === 0) list.innerHTML = '<p class="text-xs text-gray-400 text-center py-4">Немає нотаток</p>'; dayNotes.forEach(n => { const isPublic = n.type === 'public'; const style = isPublic ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200' : 'bg-yellow-50 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200'; const icon = isPublic ? '📢' : '🔒'; const canDelete = (n.author === currentUser.name) || ((currentUser.role === 'SM' || currentUser.role === 'admin') && isPublic); const deleteBtn = canDelete ? `<button onclick="deleteNote('${n._id}')" class="text-red-500 ml-2 font-bold px-2">×</button>` : ''; list.innerHTML += `<div class="note-item ${style} p-2 rounded-lg flex justify-between items-center mb-1"><div class="flex-1 text-xs"><span class="mr-1">${icon}</span> <span class="font-bold mr-1">${n.author}:</span> ${n.text}</div>${deleteBtn}</div>`; }); }
function toggleNoteType() { triggerHaptic(); if (currentNoteType === 'private') { currentNoteType = 'public'; document.getElementById('noteTypeIcon').innerText = '📢'; document.getElementById('noteTypeLabel').innerText = 'Всім'; } else { currentNoteType = 'private'; document.getElementById('noteTypeIcon').innerText = '🔒'; document.getElementById('noteTypeLabel').innerText = 'Особиста'; } }
async function saveNote() { const text = document.getElementById('newNoteText').value; if(!text) return; await fetch('/api/notes', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ date: selectedNoteDate, text, type: currentNoteType }) }); document.getElementById('newNoteText').value = ''; await loadNotes(); renderNotesList(); renderCurrentShifts(); showToast("Нотатку додано"); }
async function deleteNote(id) { if(!confirm('Видалити?')) return; await fetch('/api/notes/delete', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ id }) }); await loadNotes(); renderNotesList(); renderCurrentShifts(); showToast("Видалено"); }

// --- PASSWORD CHANGE (NEW) ---
function openChangePasswordModal() {
    closeAvatarModal();
    document.getElementById('changePasswordModal').classList.remove('hidden');
}

function closeChangePasswordModal() {
    document.getElementById('changePasswordModal').classList.add('hidden');
    document.getElementById('oldPassword').value = '';
    document.getElementById('newPassword').value = '';
}

async function submitChangePassword() {
    const oldP = document.getElementById('oldPassword').value;
    const newP = document.getElementById('newPassword').value;
    
    if(!oldP || !newP) return showToast("Заповніть всі поля", 'error');
    if(newP.length < 3) return showToast("Пароль закороткий", 'error');

    try {
        const res = await fetch('/api/user/change-password', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ oldPassword: oldP, newPassword: newP })
        });
        const data = await res.json();
        
        if(data.success) {
            showToast("Пароль змінено! ✅");
            closeChangePasswordModal();
        } else {
            showToast(data.message || "Помилка", 'error');
        }
    } catch(e) {
        showToast("Помилка мережі", 'error');
    }
}

checkAuth();