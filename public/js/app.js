import { state } from './modules/state.js';
import { fetchJson, postJson } from './modules/api.js';
import { 
    initTheme, toggleTheme, showToast, triggerHaptic, showAdminTab, formatText, updateFileName,
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
window.showAdminTab = showAdminTab;
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
// ДОДАНО: Експорт функції імпорту
window.importKpi = importKpi;

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
    const kpiDiv = document.getElementById('kpiViewContainer'); // НОВЕ
    
    listDiv.classList.add('hidden');
    calDiv.classList.add('hidden');
    gridDiv.classList.add('hidden');
    kpiDiv.classList.add('hidden');
    
    const btnList = document.getElementById('btnModeList');
    const btnCal = document.getElementById('btnModeCalendar');
    const btnGrid = document.getElementById('btnModeGrid');
    const btnKpi = document.getElementById('btnModeKpi'); // НОВЕ
    
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
    } else if (m === 'kpi') { // НОВИЙ РЕЖИМ
        kpiDiv.classList.remove('hidden');
        kpiDiv.classList.add('animate-slide-up');
        btnKpi.className = activeClass;
        loadKpiData().then(() => renderKpi());
    }
}

// НОВЕ: Логіка імпорту KPI
async function importKpi() {
    const text = document.getElementById('kpiImportData').value;
    if(!text) return showToast('Вставте текст таблиці', 'error');

    // Формуємо місяць YYYY-MM з поточної дати календаря
    const y = state.currentDate.getFullYear();
    const m = String(state.currentDate.getMonth() + 1).padStart(2, '0');
    const month = `${y}-${m}`;

    const res = await postJson('/api/kpi/import', { text, month });
    if(res.success) {
        showToast(`Імпортовано: ${res.count} записів`);
        document.getElementById('kpiImportData').value = '';
        // Оновлюємо відображення, якщо ми на вкладці KPI
        await loadKpiData();
        renderKpi();
    } else {
        showToast('Помилка імпорту', 'error');
    }
}

// НОВЕ: Завантаження даних KPI
async function loadKpiData() {
    const y = state.currentDate.getFullYear();
    const m = String(state.currentDate.getMonth() + 1).padStart(2, '0');
    const month = `${y}-${m}`;
    state.kpi = await fetchJson(`/api/kpi?month=${month}`);
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
                    showAdminTab('shifts');
                    showToast('Дані заповнено. Відредагуйте та натисніть "Додати"', 'info');
                    
                    // Плавний скрол до форми
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