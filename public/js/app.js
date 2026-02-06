import { state } from './modules/state.js';
import { fetchJson, postJson } from './modules/api.js';
import { 
    initTheme, toggleTheme, showToast, triggerHaptic, showAdminTab as uiShowAdminTab, formatText, updateFileName,
    openTaskDetailsModal, closeTaskDetailsModal, showContextMenu, activeContext 
} from './modules/ui.js';
// ДОДАНО: renderKpi
import { renderTimeline, renderCalendar, renderTable, renderAll, renderKpi } from './modules/render.js';
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

// --- EXPOSE TO HTML (WINDOW) ---

// UI & Theme
window.toggleTheme = toggleTheme;
window.triggerHaptic = triggerHaptic;

// WRAPPER: Підставляємо місяць при відкритті вкладки KPI
window.showAdminTab = (t) => {
    uiShowAdminTab(t);
    if (t === 'kpi') {
        const now = new Date();
        const mStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const inp1 = document.getElementById('kpiMonthImport');
        const inp2 = document.getElementById('kpiMonthSettings');
        if(inp1 && !inp1.value) inp1.value = mStr;
        if(inp2 && !inp2.value) inp2.value = mStr;
    }
};

window.toggleEditMode = toggleEditMode;
window.toggleArchive = toggleArchive;
window.setMode = setMode;
window.changeMonth = changeMonth;
window.scrollToTop = () => window.scrollTo({ top: 0, behavior: 'smooth' });

// News
window.formatText = formatText;
window.updateFileName = updateFileName;

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

// KPI Actions
window.importKpi = importKpi;
window.saveKpiSettings = saveKpiSettings; // НОВЕ

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

// ОНОВЛЕНО: Додано логіку для KPI
async function changeMonth(d) { 
    triggerHaptic(); 
    state.currentDate.setMonth(state.currentDate.getMonth() + d); 
    
    // Якщо ми в режимі KPI, треба оновити дані KPI
    const kpiContainer = document.getElementById('kpiViewContainer');
    if (kpiContainer && !kpiContainer.classList.contains('hidden')) {
        await loadKpiData();
        renderKpi();
    } else {
        renderAll(); 
    }
}

// ОНОВЛЕНО: Додано режим 'kpi'
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
    
    // УПРАВЛІННЯ КНОПКОЮ ФІЛЬТРУ
    const filterBtn = document.querySelector('button[onclick="openFilterModal()"]');
    if (filterBtn) {
        if (m === 'list') {
            filterBtn.classList.remove('hidden');
            filterBtn.classList.add('flex'); // Відновлюємо flex, якщо він був
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

// ОНОВЛЕНО: Імпорт KPI з вибором місяця
async function importKpi() {
    const text = document.getElementById('kpiImportData').value;
    const month = document.getElementById('kpiMonthImport').value;

    if(!text) return showToast('Вставте текст таблиці', 'error');
    if(!month) return showToast('Оберіть місяць', 'error');

    const res = await postJson('/api/kpi/import', { text, month });
    if(res.success) {
        showToast(`Імпортовано: ${res.count} записів`);
        document.getElementById('kpiImportData').value = '';
        
        // Оновлюємо, якщо ми дивимось на цей же місяць
        const y = state.currentDate.getFullYear();
        const m = String(state.currentDate.getMonth() + 1).padStart(2, '0');
        if (`${y}-${m}` === month) {
            await loadKpiData();
            renderKpi();
        }
    } else {
        showToast('Помилка імпорту', 'error');
    }
}

// НОВЕ: Збереження норми годин
async function saveKpiSettings() {
    const month = document.getElementById('kpiMonthSettings').value;
    const normHours = document.getElementById('kpiNormHours').value;

    if(!month || !normHours) return showToast('Заповніть всі поля', 'error');

    const res = await postJson('/api/kpi/settings', { month, normHours });
    if(res.success) {
        showToast('Норму збережено ✅');
        
        // Оновлюємо, якщо ми дивимось на цей же місяць
        const y = state.currentDate.getFullYear();
        const m = String(state.currentDate.getMonth() + 1).padStart(2, '0');
        if (`${y}-${m}` === month) {
            await loadKpiData();
            renderKpi();
        }
    } else {
        showToast('Помилка збереження', 'error');
    }
}

// Завантаження даних KPI
async function loadKpiData() {
    const y = state.currentDate.getFullYear();
    const m = String(state.currentDate.getMonth() + 1).padStart(2, '0');
    const month = `${y}-${m}`;
    // Тепер це повертає { kpi: [], settings: {}, hours: {} }
    state.kpiData = await fetchJson(`/api/kpi?month=${month}`);
}

// Scroll to Top Listener
window.addEventListener('scroll', () => {
    const btn = document.getElementById('backToTopBtn');
    if (btn) {
        if (window.scrollY > 300) btn.classList.remove('hidden', 'opacity-0');
        else btn.classList.add('opacity-0');
    }
});

// --- CONTEXT MENU LISTENERS ---
function initContextMenuListeners() {
    // Edit Shift
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
                    
                    if (s.start === 'Відпустка') {
                        document.getElementById('shiftVacation').checked = true;
                    } else {
                        document.getElementById('shiftVacation').checked = false;
                        document.getElementById('startTime').value = s.start;
                        document.getElementById('endTime').value = s.end;
                    }
                    toggleShiftTimeInputs();
                    
                    document.getElementById('adminPanel').classList.remove('hidden');
                    // Використовуємо обгортку window.showAdminTab
                    window.showAdminTab('shifts');
                    showToast('Дані заповнено. Відредагуйте та натисніть "Додати"', 'info');
                    
                    document.getElementById('adminPanel').scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }
        };
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