import { state } from './modules/state.js';
import { fetchJson, postJson } from './modules/api.js';
// ДОДАНО: formatText, updateFileName
import { initTheme, toggleTheme, showToast, triggerHaptic, showAdminTab, formatText, updateFileName } from './modules/ui.js';
import { renderTimeline, renderCalendar } from './modules/render.js';

const tg = window.Telegram.WebApp;
if(tg) { tg.ready(); if(tg.platform && tg.platform!=='unknown') try{tg.expand()}catch(e){} }

// --- Ініціалізація ---
initTheme();
checkAuth();

// --- Робимо функції доступними для HTML (onclick) ---
window.toggleTheme = toggleTheme;
window.triggerHaptic = triggerHaptic;
window.showAdminTab = showAdminTab;
window.setMode = setMode;
window.toggleEditMode = toggleEditMode;
window.toggleShiftTimeInputs = toggleShiftTimeInputs;
window.toggleTaskTimeInputs = toggleTaskTimeInputs;
window.changeMonth = changeMonth;
window.toggleArchive = toggleArchive;

// ДОДАНО: Функції новин
window.formatText = formatText;
window.updateFileName = updateFileName;

// Actions
window.login = login;
window.logout = logout;
window.addShift = addShift;
window.clearDay = clearDay;
window.clearMonth = clearMonth;
window.delS = delS;
window.addTask = addTask;
window.deleteTask = deleteTask;
window.publishNews = publishNews;
window.bulkImport = bulkImport;
window.approveAllRequests = approveAllRequests;
window.handleRequest = handleRequest;
window.loadLogs = loadLogs;

// Modals
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

// --- AUTH LOGIC ---
async function checkAuth() {
    try {
        const data = await fetchJson('/api/me');
        if (data.loggedIn) { showApp(data.user); return; }
    } catch (e) {}

    if (!tg.initDataUnsafe?.user?.id) {
        document.getElementById('skeletonLoader').classList.add('hidden');
        document.getElementById('loginScreen').classList.remove('hidden');
        return;
    }
    
    // Telegram Login
    const data = await postJson('/api/login-telegram', { telegramId: tg.initDataUnsafe.user.id });
    if (data.success) showApp(data.user);
    else {
        document.getElementById('skeletonLoader').classList.add('hidden');
        document.getElementById('loginScreen').classList.remove('hidden');
    }
}

async function login() {
    triggerHaptic();
    const u = document.getElementById('loginUser').value;
    const p = document.getElementById('loginPass').value;
    const data = await postJson('/api/login', { username: u, password: p });
    if (data.success) showApp(data.user);
    else showToast(data.message || "Помилка входу", 'error');
}

async function logout() {
    await postJson('/api/logout');
    window.location.reload();
}

async function showApp(user) {
    state.currentUser = user;
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('skeletonLoader').classList.add('hidden');
    const app = document.getElementById('appScreen');
    app.classList.remove('hidden');
    setTimeout(() => app.classList.remove('opacity-0'), 50);

    const parts = user.name.split(' ');
    document.getElementById('userNameDisplay').innerText = `Привіт, ${parts.length > 1 ? parts[1] : parts[0]}`;
    if(user.avatar) {
        document.getElementById('userAvatarImg').src = user.avatar;
        document.getElementById('userAvatarImg').classList.remove('hidden');
        document.getElementById('userAvatarPlaceholder').classList.add('hidden');
    }

    if (['admin', 'SM', 'SSE', 'RRP'].includes(user.role)) {
        if(user.role !== 'RRP') document.getElementById('toggleEditWrapper').classList.remove('hidden');
        if (['SM', 'admin'].includes(user.role)) {
            document.getElementById('btnTabRequests').classList.remove('hidden');
            document.getElementById('btnTabRequests').classList.add('flex');
            loadRequests();
        }
        if (user.role === 'SM' || user.role === 'admin') {
            document.getElementById('noteTypeToggle').classList.remove('hidden');
            document.getElementById('noteTypeToggle').classList.add('flex');
        }
        showAdminTab('shifts');
    }
    
    await Promise.all([loadData()]);
    renderCurrentShifts();
}

// --- DATA & ACTIONS ---
async function loadData() {
    const [users, shifts, tasks, notes] = await Promise.all([
        fetchJson('/api/users'),
        fetchJson('/api/shifts'),
        fetchJson('/api/tasks'),
        fetchJson('/api/notes')
    ]);
    state.users = users.filter(u=>u.role!=='admin'&&u.role!=='RRP');
    state.shifts = shifts;
    state.tasks = tasks;
    state.notes = notes;
    
    // Fill Selects
    const s1 = document.getElementById('employeeSelect');
    const s2 = document.getElementById('taskEmployee');
    s1.innerHTML='<option disabled selected>Хто?</option>';
    s2.innerHTML='<option disabled selected>Кому?</option>';
    state.users.forEach(x => {
        s1.innerHTML+=`<option value="${x.name}">${x.name}</option>`;
        s2.innerHTML+=`<option value="${x.name}">${x.name}</option>`;
    });
}

function renderCurrentShifts() {
    renderTimeline();
    renderCalendar();
}

// --- CORE UI FUNCTIONS ---
function setMode(m) {
    triggerHaptic();
    document.getElementById('listViewContainer').className = m === 'list' ? '' : 'hidden';
    document.getElementById('calendarViewContainer').className = m === 'list' ? 'hidden' : 'ios-card p-4 animate-slide-up';
    const btnList = document.getElementById('btnModeList');
    const btnCal = document.getElementById('btnModeCalendar');
    if (m === 'list') {
        btnList.className = "flex-1 py-2 text-xs font-bold rounded-[10px] bg-white dark:bg-[#636366] shadow-sm text-black dark:text-white transition-all";
        btnCal.className = "flex-1 py-2 text-xs font-medium text-gray-500 transition-all";
    } else {
        btnList.className = "flex-1 py-2 text-xs font-medium text-gray-500 transition-all";
        btnCal.className = "flex-1 py-2 text-xs font-bold rounded-[10px] bg-white dark:bg-[#636366] shadow-sm text-black dark:text-white transition-all";
    }
    if (m === 'calendar') renderCalendar();
}

function toggleEditMode() { triggerHaptic(); document.getElementById('adminPanel').classList.toggle('hidden'); }
function toggleTaskTimeInputs() { const c = document.getElementById('taskFullDay').checked; document.getElementById('taskTimeInputs').className = c ? 'hidden' : 'flex gap-3'; }
function toggleShiftTimeInputs() { const c = document.getElementById('shiftVacation').checked; document.getElementById('shiftTimeInputs').className = c ? 'hidden' : 'flex gap-3'; }
function changeMonth(d) { triggerHaptic(); state.currentDate.setMonth(state.currentDate.getMonth() + d); renderCalendar(); }
function toggleArchive() { triggerHaptic(); document.getElementById('archiveContainer').classList.toggle('hidden'); }

// --- ADMIN ACTIONS ---
async function addShift() {
    const date = document.getElementById('shiftDate').value;
    const name = document.getElementById('employeeSelect').value;
    const isVacation = document.getElementById('shiftVacation').checked;
    let start, end;
    if (isVacation) { start = 'Відпустка'; end = 'Відпустка'; } 
    else { start = document.getElementById('startTime').value; end = document.getElementById('endTime').value; }
    
    if(!date || !name) return showToast("Заповніть всі дані", 'error');

    const d = await postJson('/api/shifts', { date, name, start, end });
    if(d.success) {
        if(d.pending) showToast("Запит відправлено (Pending)", 'success');
        else showToast("Зміну додано");
        state.shifts = await fetchJson('/api/shifts'); // reload
        renderCurrentShifts();
    } else {
        showToast(d.message || "Помилка", 'error');
    }
}

async function delS(id) {
    if(confirm("Видалити?")) {
        const d = await postJson('/api/delete-shift', { id });
        if(d.success) {
            showToast("Видалено");
            state.shifts = await fetchJson('/api/shifts');
            renderCurrentShifts();
        } else showToast("Помилка видалення", 'error');
    }
}

async function addTask() {
    const title = document.getElementById('taskTitle').value;
    const date = document.getElementById('taskDate').value;
    const name = document.getElementById('taskEmployee').value;
    const isFullDay = document.getElementById('taskFullDay').checked;
    const start = document.getElementById('taskStart').value;
    const end = document.getElementById('taskEnd').value;
    
    if(!title || !date || !name) return showToast("Заповніть дані", 'error');
    await postJson('/api/tasks', { title, date, name, isFullDay, start, end });
    showToast("Задачу призначено");
    state.tasks = await fetchJson('/api/tasks');
    renderCurrentShifts();
}

async function deleteTask(id) {
    if(confirm("Видалити задачу?")) {
        const d = await postJson('/api/tasks/delete', { id });
        if(d.success) {
            showToast("Задачу видалено");
            state.tasks = await fetchJson('/api/tasks');
            renderCurrentShifts();
        } else showToast("Помилка", 'error');
    }
}

async function clearDay() {
    const d = document.getElementById('shiftDate').value;
    if(d && confirm(`Clean ${d}?`)) {
        await postJson('/api/shifts/clear-day', { date: d });
        showToast("День очищено");
        state.shifts = await fetchJson('/api/shifts');
        renderCurrentShifts();
    }
}

async function clearMonth() {
    const d = document.getElementById('shiftDate').value;
    if(!d) return showToast("Оберіть дату", 'error');
    if(confirm(`⚠️ ВИДАЛИТИ ВЕСЬ ГРАФІК за ${d.substring(0,7)}?`)) {
        await postJson('/api/shifts/clear-month', { month: d.substring(0,7) });
        state.shifts = await fetchJson('/api/shifts');
        renderCurrentShifts();
        showToast("Місяць очищено");
    }
}

async function loadRequests() {
    const requests = await fetchJson('/api/requests');
    const c = document.getElementById('requestsList');
    c.innerHTML = '';
    if(!requests.length || requests.length === 0) { c.innerHTML = '<p class="text-gray-400 text-xs text-center">Пусто</p>'; return; }
    requests.forEach(q => {
        c.innerHTML += `<div class="bg-gray-50 dark:bg-gray-700 p-2 rounded text-xs flex justify-between"><span>${q.type}: ${q.createdBy}</span><div class="flex gap-2"><button onclick="handleRequest('${q._id}','approve')" class="text-green-600">✅</button><button onclick="handleRequest('${q._id}','reject')" class="text-red-600">❌</button></div></div>`;
    });
}

async function handleRequest(id, action) {
    await postJson('/api/requests/action', { id, action });
    showToast(action==='approve'?"Схвалено":"Відхилено");
    loadRequests();
    // reload data in case something changed
    loadData().then(renderCurrentShifts);
}

async function approveAllRequests() {
    if(confirm("Схвалити все?")) {
        await postJson('/api/requests/approve-all', {});
        showToast("Всі схвалено");
        loadRequests();
        loadData().then(renderCurrentShifts);
    }
}

async function loadLogs() {
    const logs = await fetchJson('/api/logs');
    const c = document.getElementById('logsList');
    c.innerHTML = '';
    logs.forEach(l => {
        const date = new Date(l.timestamp).toLocaleString('uk-UA');
        c.innerHTML += `<div class="bg-gray-50 dark:bg-gray-800 p-2 rounded border-l-2 border-gray-400"><div class="font-bold text-[10px] text-gray-400">${date}</div><div><b>${l.performer}</b>: ${l.action} (${l.details})</div></div>`;
    });
}

// --- NEWS, FILTER & AVATAR & NOTES & PASSWORDS ---

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
        // Тут ми викликаємо updateFileName, тому важливо, щоб вона була в window або імпортована
        if (res.ok) { showToast("✅ Опубліковано!"); document.getElementById('newsText').value = ''; document.getElementById('newsFile').value = ''; updateFileName(); } 
        else showToast("Помилка публікації", 'error');
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
        const d = await postJson('/api/shifts/bulk', { shifts });
        if(d.success) { document.getElementById('importData').value = ''; state.shifts = await fetchJson('/api/shifts'); renderCurrentShifts(); showToast("Імпорт успішний"); } 
        else showToast("Помилка імпорту", 'error');
    }
}

// Filter
function openFilterModal() { triggerHaptic(); document.getElementById('filterModal').classList.remove('hidden'); renderFilterList(); }
function closeFilterModal() { document.getElementById('filterModal').classList.add('hidden'); }
function renderFilterList() { 
    let html = `<button onclick="applyFilter('all')" class="w-full text-left p-3 rounded-xl flex justify-between items-center ${state.filter==='all' ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-500 font-bold' : 'hover:bg-gray-50 dark:hover:bg-[#2C2C2E]'}"><span class="font-medium">Всі співробітники</span>${state.filter==='all' ? '<span>✓</span>' : ''}</button>`; 
    state.users.forEach(u => { const isSelected = state.filter === u.name; html += `<button onclick="applyFilter('${u.name}')" class="w-full text-left p-3 rounded-xl flex justify-between items-center ${isSelected ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-500 font-bold' : 'hover:bg-gray-50 dark:hover:bg-[#2C2C2E]'}"><span class="font-medium">${u.name}</span>${isSelected ? '<span>✓</span>' : ''}</button>`; }); 
    document.getElementById('filterList').innerHTML = html; 
}
function applyFilter(val) { triggerHaptic(); state.filter = val; document.getElementById('currentFilterLabel').innerText = val === 'all' ? 'Всі співробітники' : val.split(' ')[1] || val; closeFilterModal(); renderCurrentShifts(); }

// Avatar & Password
function openAvatarModal() { triggerHaptic(); document.getElementById('avatarModal').classList.remove('hidden'); }
function closeAvatarModal() { document.getElementById('avatarModal').classList.add('hidden'); }
function handleAvatarSelect(input) { if (input.files && input.files[0]) { const reader = new FileReader(); reader.onload = function(e) { const img = document.getElementById('avatarPreview'); img.src = e.target.result; img.classList.remove('hidden'); document.getElementById('avatarPlaceholder').classList.add('hidden'); document.getElementById('avatarActions').classList.remove('hidden'); }; reader.readAsDataURL(input.files[0]); } }
function uploadAvatar() { const imgElement = document.getElementById('avatarPreview'); const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d'); const size = 200; canvas.width = size; canvas.height = size; const img = new Image(); img.onload = function() { const minSide = Math.min(img.width, img.height); const sx = (img.width - minSide) / 2; const sy = (img.height - minSide) / 2; ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size); const dataUrl = canvas.toDataURL('image/jpeg', 0.7); postJson('/api/user/avatar', { avatar: dataUrl }).then(data => { if(data.success) { document.getElementById('userAvatarImg').src = dataUrl; document.getElementById('userAvatarImg').classList.remove('hidden'); document.getElementById('userAvatarPlaceholder').classList.add('hidden'); closeAvatarModal(); showToast("Аватар оновлено"); } else { showToast("Помилка", 'error'); } }); }; img.src = imgElement.src; }

function openChangePasswordModal() { closeAvatarModal(); document.getElementById('changePasswordModal').classList.remove('hidden'); }
function closeChangePasswordModal() { document.getElementById('changePasswordModal').classList.add('hidden'); document.getElementById('oldPassword').value = ''; document.getElementById('newPassword').value = ''; document.getElementById('confirmPassword').value = ''; }
async function submitChangePassword() {
    const oldP = document.getElementById('oldPassword').value; const newP = document.getElementById('newPassword').value; const confirmP = document.getElementById('confirmPassword').value;
    if(!oldP || !newP || !confirmP) return showToast("Заповніть всі поля", 'error');
    if(newP !== confirmP) return showToast("Нові паролі не співпадають", 'error');
    if(newP.length < 3) return showToast("Пароль закороткий", 'error');
    const d = await postJson('/api/user/change-password', { oldPassword: oldP, newPassword: newP });
    if(d.success) { showToast("Пароль змінено! ✅"); closeChangePasswordModal(); } else showToast(d.message || "Помилка", 'error');
}

// Notes
function openNotesModal(dateStr) { triggerHaptic(); state.selectedNoteDate = dateStr; document.getElementById('notesModalTitle').innerText = `Нотатки (${dateStr})`; document.getElementById('notesModal').classList.remove('hidden'); renderNotesList(); }
function closeNotesModal() { document.getElementById('notesModal').classList.add('hidden'); }
function renderNotesList() { const list = document.getElementById('notesList'); list.innerHTML = ''; const dayNotes = state.notes.filter(n => n.date === state.selectedNoteDate); if (dayNotes.length === 0) list.innerHTML = '<p class="text-xs text-gray-400 text-center py-4">Немає нотаток</p>'; dayNotes.forEach(n => { const isPublic = n.type === 'public'; const style = isPublic ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200' : 'bg-yellow-50 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200'; const icon = isPublic ? '📢' : '🔒'; const canDelete = (n.author === state.currentUser.name) || ((state.currentUser.role === 'SM' || state.currentUser.role === 'admin') && isPublic); const deleteBtn = canDelete ? `<button onclick="deleteNote('${n._id}')" class="text-red-500 ml-2 font-bold px-2">×</button>` : ''; list.innerHTML += `<div class="note-item ${style} p-2 rounded-lg flex justify-between items-center mb-1"><div class="flex-1 text-xs"><span class="mr-1">${icon}</span> <span class="font-bold mr-1">${n.author}:</span> ${n.text}</div>${deleteBtn}</div>`; }); }
function toggleNoteType() { triggerHaptic(); if (state.noteType === 'private') { state.noteType = 'public'; document.getElementById('noteTypeIcon').innerText = '📢'; document.getElementById('noteTypeLabel').innerText = 'Всім'; } else { state.noteType = 'private'; document.getElementById('noteTypeIcon').innerText = '🔒'; document.getElementById('noteTypeLabel').innerText = 'Особиста'; } }
async function saveNote() { const text = document.getElementById('newNoteText').value; if(!text) return; await postJson('/api/notes', { date: state.selectedNoteDate, text, type: state.noteType }); document.getElementById('newNoteText').value = ''; state.notes = await fetchJson('/api/notes'); renderNotesList(); renderCurrentShifts(); showToast("Нотатку додано"); }
async function deleteNote(id) { if(!confirm('Видалити?')) return; await postJson('/api/notes/delete', { id }); state.notes = await fetchJson('/api/notes'); renderNotesList(); renderCurrentShifts(); showToast("Видалено"); }