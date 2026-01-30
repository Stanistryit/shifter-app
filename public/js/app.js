import { state } from './modules/state.js';
import { 
    initTheme, toggleTheme, showToast, triggerHaptic, showAdminTab, formatText, updateFileName,
    openTaskDetailsModal, closeTaskDetailsModal, showContextMenu, activeContext 
} from './modules/ui.js';
import { renderTimeline, renderCalendar, renderTable, renderAll } from './modules/render.js';
import { checkAuth, login, logout } from './modules/auth.js';
import { 
    addShift, delS, clearDay, clearMonth, toggleShiftTimeInputs, 
    addTask, deleteTask, toggleTaskTimeInputs, bulkImport, publishNews 
} from './modules/admin.js';
import { loadRequests, handleRequest, approveAllRequests } from './modules/requests.js';
import { openNotesModal, closeNotesModal, toggleNoteType, saveNote, deleteNote } from './modules/notes.js';
import { 
    openFilterModal, closeFilterModal, applyFilter, 
    openAvatarModal, closeAvatarModal, handleAvatarSelect, uploadAvatar, 
    openChangePasswordModal, closeChangePasswordModal, submitChangePassword, loadLogs 
} from './modules/settings.js';

const tg = window.Telegram.WebApp;
if(tg) { tg.ready(); if(tg.platform && tg.platform!=='unknown') try{tg.expand()}catch(e){} }

// --- INIT ---
initTheme();
checkAuth();
initContextMenuListeners();

<<<<<<< HEAD
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
=======
// --- EXPOSE TO HTML (WINDOW) ---

// UI & Theme
window.toggleTheme = toggleTheme;
window.triggerHaptic = triggerHaptic;
window.showAdminTab = showAdminTab;
window.toggleEditMode = toggleEditMode;
window.toggleArchive = toggleArchive;
window.setMode = setMode;
window.changeMonth = changeMonth;
window.scrollToTop = () => window.scrollTo({ top: 0, behavior: 'smooth' });

// News
window.formatText = formatText;
window.updateFileName = updateFileName;
>>>>>>> 6c2a0924cb627dcbcda641229860c4afc2804259

// Auth
window.login = login;
window.logout = logout;

// Admin Actions (Shifts)
window.addShift = addShift;
window.delS = delS;
window.clearDay = clearDay;
window.clearMonth = clearMonth;
window.toggleShiftTimeInputs = toggleShiftTimeInputs;

// Admin Actions (Tasks)
window.addTask = addTask;
window.deleteTask = deleteTask;
window.toggleTaskTimeInputs = toggleTaskTimeInputs;

// Admin Actions (Other)
window.bulkImport = bulkImport;
window.publishNews = publishNews;
window.loadLogs = loadLogs;

// Requests
window.approveAllRequests = approveAllRequests;
window.handleRequest = handleRequest;

// Settings & Modals
window.openFilterModal = openFilterModal;
window.closeFilterModal = closeFilterModal;
window.applyFilter = applyFilter;
window.openAvatarModal = openAvatarModal;
window.closeAvatarModal = closeAvatarModal;
window.handleAvatarSelect = handleAvatarSelect;
window.uploadAvatar = uploadAvatar;
window.openChangePasswordModal = openChangePasswordModal;
window.closeChangePasswordModal = closeChangePasswordModal;
window.submitChangePassword = submitChangePassword;

// Notes
window.openNotesModal = openNotesModal;
window.closeNotesModal = closeNotesModal;
window.toggleNoteType = toggleNoteType;
window.saveNote = saveNote;
window.deleteNote = deleteNote;

// Task Modal Proxy
window.openTaskProxy = (id) => {
    const task = state.tasks.find(t => t._id === id);
    if(task) openTaskDetailsModal(task);
};
window.closeTaskDetailsModal = closeTaskDetailsModal;

// Context Menu Proxy
window.contextMenuProxy = (e, type, id) => {
    showContextMenu(e, type, id);
};

// --- GLOBAL UI LOGIC ---

function toggleEditMode() { 
    triggerHaptic(); 
    document.getElementById('adminPanel').classList.toggle('hidden'); 
}

function toggleArchive() { 
    triggerHaptic(); 
    document.getElementById('archiveContainer').classList.toggle('hidden'); 
}

function changeMonth(d) { 
    triggerHaptic(); 
    state.currentDate.setMonth(state.currentDate.getMonth() + d); 
    renderAll(); 
}

function setMode(m) {
    triggerHaptic();
    
    const listDiv = document.getElementById('listViewContainer');
    const calDiv = document.getElementById('calendarViewContainer');
    const gridDiv = document.getElementById('gridViewContainer');
    
    listDiv.classList.add('hidden');
    calDiv.classList.add('hidden');
    gridDiv.classList.add('hidden');
    
    const btnList = document.getElementById('btnModeList');
    const btnCal = document.getElementById('btnModeCalendar');
    const btnGrid = document.getElementById('btnModeGrid');
    
    const inactiveClass = "flex-1 py-2 text-xs font-medium text-gray-500 transition-all whitespace-nowrap px-2";
    const activeClass = "flex-1 py-2 text-xs font-bold rounded-[10px] bg-white dark:bg-[#636366] shadow-sm text-black dark:text-white transition-all whitespace-nowrap px-2";
    
    btnList.className = inactiveClass;
    btnCal.className = inactiveClass;
    btnGrid.className = inactiveClass;
    
    if (m === 'list') {
        listDiv.classList.remove('hidden');
        btnList.className = activeClass;
    } else if (m === 'calendar') {
        calDiv.classList.remove('hidden');
        calDiv.classList.add('animate-slide-up');
        btnCal.className = activeClass;
        renderCalendar();
    } else if (m === 'grid') {
        gridDiv.classList.remove('hidden');
        gridDiv.classList.add('animate-slide-up');
        btnGrid.className = activeClass;
        renderTable();
    }
}

<<<<<<< HEAD
// --- HELPER FUNCTION (WAS MISSING) ---
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
=======
// Scroll to Top Listener
window.addEventListener('scroll', () => {
    const btn = document.getElementById('backToTopBtn');
    if (btn) {
        if (window.scrollY > 300) btn.classList.remove('hidden', 'opacity-0');
        else btn.classList.add('opacity-0');
    }
});
>>>>>>> 6c2a0924cb627dcbcda641229860c4afc2804259

// --- CONTEXT MENU LISTENERS ---
function initContextMenuListeners() {
    // Edit Shift
    const btnEdit = document.getElementById('ctxEdit');
    if (btnEdit) {
        btnEdit.onclick = () => {
            const menu = document.getElementById('contextMenu');
            menu.classList.add('hidden');
            
<<<<<<< HEAD
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
=======
            if (activeContext.type === 'shift') {
                const s = state.shifts.find(x => x._id === activeContext.id);
                if (s) {
                    document.getElementById('shiftDate').value = s.date;
                    document.getElementById('employeeSelect').value = s.name;
>>>>>>> 6c2a0924cb627dcbcda641229860c4afc2804259
                    
                    if (s.start === 'Відпустка') {
                        document.getElementById('shiftVacation').checked = true;
                    } else {
                        document.getElementById('shiftVacation').checked = false;
                        document.getElementById('startTime').value = s.start;
                        document.getElementById('endTime').value = s.end;
                    }
                    toggleShiftTimeInputs();
                    
                    document.getElementById('adminPanel').classList.remove('hidden');
                    showAdminTab('shifts');
                    showToast('Дані заповнено. Відредагуйте та натисніть "Додати"', 'info');
                    
                    // Плавний скрол до форми
                    document.getElementById('adminPanel').scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
<<<<<<< HEAD
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
=======
            }
        };
>>>>>>> 6c2a0924cb627dcbcda641229860c4afc2804259
    }

    // Copy Info
    const btnCopy = document.getElementById('ctxCopy');
    if (btnCopy) {
        btnCopy.onclick = () => {
            document.getElementById('contextMenu').classList.add('hidden');
            if (activeContext.type === 'shift') {
                const s = state.shifts.find(x => x._id === activeContext.id);
                if (s) {
                    const txt = `${s.date} | ${s.name} | ${s.start} - ${s.end}`;
                    navigator.clipboard.writeText(txt).then(() => showToast('Скопійовано 📋'));
                }
            }
        };
    }

    // Delete Shift
    const btnDelete = document.getElementById('ctxDelete');
    if (btnDelete) {
        btnDelete.onclick = () => {
            document.getElementById('contextMenu').classList.add('hidden');
            if (activeContext.type === 'shift') {
                delS(activeContext.id);
            }
        };
    }
}