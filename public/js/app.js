import { state } from './modules/state.js';
import { fetchJson, postJson } from './modules/api.js';
import { 
    initTheme, toggleTheme, showToast, triggerHaptic, showAdminTab as uiShowAdminTab, formatText, updateFileName,
    openTaskDetailsModal, closeTaskDetailsModal, showContextMenu, activeContext 
} from './modules/ui.js';
import { renderTimeline, renderCalendar, renderTable, renderAll, renderKpi } from './modules/render.js';
import { checkAuth, login, logout } from './modules/auth.js';
import { 
    addShift, delS, clearDay, clearMonth, toggleShiftTimeInputs, 
    addTask, deleteTask, toggleTaskTimeInputs, bulkImport, publishNews,
    createStore, loadStores, deleteStore 
} from './modules/admin.js';
import { loadRequests, handleRequest, approveAllRequests } from './modules/requests.js';
import { openNotesModal, closeNotesModal, toggleNoteType, saveNote, deleteNote } from './modules/notes.js';
import { 
    openFilterModal, closeFilterModal, applyFilter, 
    openAvatarModal, closeAvatarModal, handleAvatarSelect, uploadAvatar, 
    openChangePasswordModal, closeChangePasswordModal, submitChangePassword, loadLogs,
    openTransferModal, updateStoreDisplay // 🔥 НОВІ ІМПОРТИ
} from './modules/settings.js';

const tg = window.Telegram.WebApp;
if(tg) { tg.ready(); if(tg.platform && tg.platform!=='unknown') try{tg.expand()}catch(e){} }

// --- INIT ---
initTheme();
checkAuth();
initContextMenuListeners();

// --- EXPOSE TO HTML (WINDOW) ---
window.toggleTheme = toggleTheme;
window.triggerHaptic = triggerHaptic;

window.showAdminTab = (t) => {
    uiShowAdminTab(t);
    // Логіка для KPI
    if (t === 'kpi') {
        const now = new Date();
        const mStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const inp1 = document.getElementById('kpiMonthImport');
        const inp2 = document.getElementById('kpiMonthSettings');
        if(inp1 && !inp1.value) inp1.value = mStr;
        if(inp2 && !inp2.value) inp2.value = mStr;
    }
    // 🔥 Логіка для Global Admin
    if (t === 'global') {
        loadStores();
    }
};

window.toggleEditMode = toggleEditMode;
window.toggleArchive = toggleArchive;
window.setMode = setMode;
window.changeMonth = changeMonth;
window.scrollToTop = () => window.scrollTo({ top: 0, behavior: 'smooth' });

window.formatText = formatText;
window.updateFileName = updateFileName;

window.login = login;
window.logout = logout;
// Реєстрація
window.toggleAuthMode = toggleAuthMode;
window.registerUser = registerUser;

window.addShift = addShift;
window.delS = delS;
window.clearDay = clearDay;
window.clearMonth = clearMonth;
window.toggleShiftTimeInputs = toggleShiftTimeInputs;

window.addTask = addTask;
window.deleteTask = deleteTask;
window.toggleTaskTimeInputs = toggleTaskTimeInputs;

window.bulkImport = bulkImport;
window.publishNews = publishNews;
window.loadLogs = loadLogs;

// 🔥 НОВІ ФУНКЦІЇ В WINDOW
window.createStore = createStore;
window.loadStores = loadStores;
window.deleteStore = deleteStore;

window.importKpi = importKpi;
window.saveKpiSettings = saveKpiSettings;

window.approveAllRequests = approveAllRequests;
window.handleRequest = handleRequest;

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

window.openNotesModal = openNotesModal;
window.closeNotesModal = closeNotesModal;
window.toggleNoteType = toggleNoteType;
window.saveNote = saveNote;
window.deleteNote = deleteNote;

// 🔥 НОВІ ЕКСПОРТИ ТРАНСФЕРУ
window.openTransferModal = openTransferModal;

window.openTaskProxy = (id) => {
    const task = state.tasks.find(t => t._id === id);
    if(task) openTaskDetailsModal(task);
};
window.closeTaskDetailsModal = closeTaskDetailsModal;

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

async function changeMonth(d) { 
    triggerHaptic(); 
    state.currentDate.setMonth(state.currentDate.getMonth() + d); 
    
    const kpiContainer = document.getElementById('kpiViewContainer');
    if (kpiContainer && !kpiContainer.classList.contains('hidden')) {
        await loadKpiData();
        renderKpi();
    } else {
        renderAll(); 
    }
}

function setMode(m) {
    triggerHaptic();
    const listDiv = document.getElementById('listViewContainer');
    const calDiv = document.getElementById('calendarViewContainer');
    const gridDiv = document.getElementById('gridViewContainer');
    const kpiDiv = document.getElementById('kpiViewContainer'); 
    
    listDiv.classList.add('hidden');
    calDiv.classList.add('hidden');
    gridDiv.classList.add('hidden');
    kpiDiv.classList.add('hidden');
    
    const filterBtn = document.querySelector('button[onclick="openFilterModal()"]');
    if (filterBtn) {
        if (m === 'list') {
            filterBtn.classList.remove('hidden');
            filterBtn.classList.add('flex');
        } else {
            filterBtn.classList.add('hidden');
            filterBtn.classList.remove('flex');
        }
    }
    
    const btnList = document.getElementById('btnModeList');
    const btnCal = document.getElementById('btnModeCalendar');
    const btnGrid = document.getElementById('btnModeGrid');
    const btnKpi = document.getElementById('btnModeKpi');
    
    const inactiveClass = "flex-1 py-2 text-xs font-medium text-gray-500 transition-all whitespace-nowrap px-2";
    const activeClass = "flex-1 py-2 text-xs font-bold rounded-[10px] bg-white dark:bg-[#636366] shadow-sm text-black dark:text-white transition-all whitespace-nowrap px-2";
    
    btnList.className = inactiveClass;
    btnCal.className = inactiveClass;
    btnGrid.className = inactiveClass;
    btnKpi.className = inactiveClass;
    
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
    } else if (m === 'kpi') {
        kpiDiv.classList.remove('hidden');
        kpiDiv.classList.add('animate-slide-up');
        btnKpi.className = activeClass;
        loadKpiData().then(() => renderKpi());
    }
}

// --- REGISTRATION LOGIC ---

async function toggleAuthMode(mode) {
    const loginContainer = document.getElementById('loginContainer');
    const registerContainer = document.getElementById('registerContainer');
    
    if (mode === 'register') {
        loginContainer.classList.add('hidden');
        registerContainer.classList.remove('hidden');
        
        // Завантаження магазинів
        const storeSelect = document.getElementById('regStore');
        if (storeSelect.options.length <= 1) { 
            try {
                // Тут URL правильний (/api/stores), бо на бекенді ми прибрали дубль
                const stores = await fetchJson('/api/stores');
                storeSelect.innerHTML = '<option value="" disabled selected>Оберіть магазин</option>';
                stores.forEach(s => {
                    storeSelect.innerHTML += `<option value="${s.code}">${s.name}</option>`;
                });
            } catch (e) {
                showToast('Помилка завантаження магазинів', 'error');
                storeSelect.innerHTML = '<option value="" disabled>Помилка</option>';
            }
        }
    } else {
        registerContainer.classList.add('hidden');
        loginContainer.classList.remove('hidden');
    }
}

async function registerUser() {
    const fullName = document.getElementById('regFullName').value.trim();
    const username = document.getElementById('regLogin').value.trim();
    const pass = document.getElementById('regPass').value;
    const passConfirm = document.getElementById('regPassConfirm').value;
    const phone = document.getElementById('regPhone').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const storeCode = document.getElementById('regStore').value;

    if (!fullName || !username || !pass || !storeCode) {
        return showToast('Заповніть обов’язкові поля (ПІП, Логін, Пароль, Магазин)', 'error');
    }
    if (pass !== passConfirm) {
        return showToast('Паролі не співпадають', 'error');
    }

    const btn = document.querySelector('#registerContainer button');
    const originalText = btn.innerText;
    btn.innerText = '⏳ Реєстрація...';
    btn.disabled = true;

    try {
        const res = await postJson('/api/register', { fullName, username, password: pass, phone, email, storeCode });
        
        if (res.success) {
            showToast('✅ Заявку надіслано! Очікуйте підтвердження SM.', 'info');
            document.getElementById('regPass').value = '';
            document.getElementById('regPassConfirm').value = '';
            toggleAuthMode('login');
        } else {
            showToast('❌ ' + res.message, 'error');
        }
    } catch (e) {
        showToast('❌ Помилка з\'єднання', 'error');
    } finally {
        btn.innerText = originalText;
        btn.disabled = false;
    }
}

async function importKpi() {
    const text = document.getElementById('kpiImportData').value;
    const month = document.getElementById('kpiMonthImport').value;
    if(!text) return showToast('Вставте текст таблиці', 'error');
    if(!month) return showToast('Оберіть місяць', 'error');
    const res = await postJson('/api/kpi/import', { text, month });
    if(res.success) {
        showToast(`Імпортовано: ${res.count} записів`);
        document.getElementById('kpiImportData').value = '';
        const y = state.currentDate.getFullYear();
        const m = String(state.currentDate.getMonth() + 1).padStart(2, '0');
        if (`${y}-${m}` === month) { await loadKpiData(); renderKpi(); }
    } else { showToast('Помилка імпорту', 'error'); }
}

async function saveKpiSettings() {
    const month = document.getElementById('kpiMonthSettings').value;
    const normHours = document.getElementById('kpiNormHours').value;
    if(!month || !normHours) return showToast('Заповніть всі поля', 'error');
    const res = await postJson('/api/kpi/settings', { month, normHours });
    if(res.success) {
        showToast('Норму збережено ✅');
        const y = state.currentDate.getFullYear();
        const m = String(state.currentDate.getMonth() + 1).padStart(2, '0');
        if (`${y}-${m}` === month) { await loadKpiData(); renderKpi(); }
    } else { showToast('Помилка збереження', 'error'); }
}

async function loadKpiData() {
    const y = state.currentDate.getFullYear();
    const m = String(state.currentDate.getMonth() + 1).padStart(2, '0');
    const month = `${y}-${m}`;
    state.kpiData = await fetchJson(`/api/kpi?month=${month}`);
}

window.addEventListener('scroll', () => {
    const btn = document.getElementById('backToTopBtn');
    if (btn) {
        if (window.scrollY > 300) btn.classList.remove('hidden', 'opacity-0');
        else btn.classList.add('opacity-0');
    }
});

function initContextMenuListeners() {
    const btnEdit = document.getElementById('ctxEdit');
    if (btnEdit) {
        btnEdit.onclick = () => {
            const menu = document.getElementById('contextMenu');
            menu.classList.add('hidden');
            if (activeContext.type === 'shift') {
                const s = state.shifts.find(x => x._id === activeContext.id);
                if (s) {
                    document.getElementById('shiftDate').value = s.date;
                    document.getElementById('employeeSelect').value = s.name;
                    if (s.start === 'Відпустка') { document.getElementById('shiftVacation').checked = true; } 
                    else { document.getElementById('shiftVacation').checked = false; document.getElementById('startTime').value = s.start; document.getElementById('endTime').value = s.end; }
                    toggleShiftTimeInputs();
                    document.getElementById('adminPanel').classList.remove('hidden');
                    window.showAdminTab('shifts');
                    showToast('Дані заповнено. Відредагуйте та натисніть "Додати"', 'info');
                    document.getElementById('adminPanel').scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }
        };
    }
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
    const btnDelete = document.getElementById('ctxDelete');
    if (btnDelete) {
        btnDelete.onclick = () => {
            document.getElementById('contextMenu').classList.add('hidden');
            if (activeContext.type === 'shift') { delS(activeContext.id); }
        };
    }
}

// 🔥 ОНОВЛЮЄМО НАЗВУ МАГАЗИНУ ПРИ СТАРТІ
setInterval(updateStoreDisplay, 5000); // Оновлюємо кожні 5 сек (або можна 1 раз при loadData)
setTimeout(updateStoreDisplay, 1000); // І один раз через секунду після старту