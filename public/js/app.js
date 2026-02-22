import { state } from './modules/state.js';
import { fetchJson, postJson } from './modules/api.js';
import {
    initTheme, toggleTheme, showToast, triggerHaptic, showAdminTab as uiShowAdminTab, formatText, updateFileName,
    openTaskDetailsModal, closeTaskDetailsModal, showContextMenu, activeContext,
    updateFabIcon
} from './modules/ui.js';
import { renderTimeline, renderCalendar, renderTable, renderAll, renderKpi } from './modules/render.js';
import { checkAuth, login, logout, requestPasswordReset, submitNewPassword } from './modules/auth.js';
import {
    delS,
    addTask, deleteTask, toggleTaskTimeInputs, publishNews,
    createStore, loadStores, deleteStore,
    renderSalaryMatrix, saveSalaryMatrixBtn, // 🔥 Імпортували нові функції
    toggleTaskExecution,
    openAddTaskModal, closeAddTaskModal,
    openAddNewsModal, closeAddNewsModal,
    openAddStoreModal, closeAddStoreModal
} from './modules/admin.js';
import { loadRequests, handleRequest, approveAllRequests } from './modules/requests.js';
import { openNotesModal, closeNotesModal, toggleNoteType, saveNote, deleteNote } from './modules/notes.js';
import {
    openFilterModal, closeFilterModal, applyFilter,
    openAvatarModal, closeAvatarModal, handleAvatarSelect, uploadAvatar,
    openChangePasswordModal, closeChangePasswordModal, submitChangePassword, loadLogs,
    openTransferModal, updateStoreDisplay,
    openStoreSettingsModal, saveStoreSettings
} from './modules/settings.js';

import {
    initEditor, toggleEditor, editorSelectTool,
    editorConfigTemplates, saveEditorChanges,
    closeCustomShiftModal, applyCustomShiftTime
} from './modules/editor.js';

import { updateDashboard } from './modules/dashboard.js';

const tg = window.Telegram.WebApp;
if (tg) { tg.ready(); if (tg.platform && tg.platform !== 'unknown') try { tg.expand() } catch (e) { } }

// --- INIT ---
initTheme();
checkAuth();
initContextMenuListeners();
initEditor();

const savedMode = localStorage.getItem('shifter_viewMode') || 'list';
setMode(savedMode);

// --- EXPOSE TO HTML (WINDOW) ---
window.toggleTheme = toggleTheme;
window.triggerHaptic = triggerHaptic;

window.showAdminTab = (t) => {
    uiShowAdminTab(t);
    if (t === 'kpi') {
        const now = new Date();
        const mStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const inp1 = document.getElementById('kpiMonthImport');
        const inp2 = document.getElementById('kpiMonthSettings');
        if (inp1 && !inp1.value) inp1.value = mStr;
        if (inp2 && !inp2.value) inp2.value = mStr;
    }
    if (t === 'global') {
        loadStores();
        renderSalaryMatrix(); // 🔥 Автоматично малюємо матрицю при відкритті вкладки
    }
};

window.toggleEditMode = toggleEditMode;

window.toggleEditor = toggleEditor;
window.editorSelectTool = editorSelectTool;
window.editorConfigTemplates = editorConfigTemplates;
window.saveEditorChanges = saveEditorChanges;
window.closeCustomShiftModal = closeCustomShiftModal;
window.applyCustomShiftTime = applyCustomShiftTime;

window.openStoreSettingsModal = openStoreSettingsModal;
window.saveStoreSettings = saveStoreSettings;

window.toggleArchive = toggleArchive;
window.setMode = setMode;
window.changeMonth = changeMonth;
window.scrollToTop = () => window.scrollTo({ top: 0, behavior: 'smooth' });

window.formatText = formatText;
window.updateFileName = updateFileName;

window.login = login;
window.logout = logout;
window.toggleAuthMode = toggleAuthMode;
window.registerUser = registerUser;
window.requestPasswordReset = requestPasswordReset;
window.submitNewPassword = submitNewPassword;

window.delS = delS;

window.addTask = addTask;
window.deleteTask = deleteTask;
window.toggleTaskTimeInputs = toggleTaskTimeInputs;
window.toggleTaskExecution = toggleTaskExecution;
window.openAddTaskModal = openAddTaskModal;
window.closeAddTaskModal = closeAddTaskModal;

window.publishNews = publishNews;
window.openAddNewsModal = openAddNewsModal;
window.closeAddNewsModal = closeAddNewsModal;
window.loadLogs = loadLogs;

window.createStore = createStore;
window.loadStores = loadStores;
window.deleteStore = deleteStore;
window.openAddStoreModal = openAddStoreModal;
window.closeAddStoreModal = closeAddStoreModal;

// 🔥 Робимо доступними для HTML
window.renderSalaryMatrix = renderSalaryMatrix;
window.saveSalaryMatrixBtn = saveSalaryMatrixBtn;

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
window.loadKpiData = loadKpiData;
window.openChangePasswordModal = openChangePasswordModal;
window.closeChangePasswordModal = closeChangePasswordModal;
window.submitChangePassword = submitChangePassword;

window.openNotesModal = openNotesModal;
window.closeNotesModal = closeNotesModal;
window.toggleNoteType = toggleNoteType;
window.saveNote = saveNote;
window.deleteNote = deleteNote;

window.openTransferModal = openTransferModal;

window.openTaskProxy = (id) => {
    const task = state.tasks.find(t => t._id === id);
    if (task) openTaskDetailsModal(task);
};
window.closeTaskDetailsModal = closeTaskDetailsModal;

window.contextMenuProxy = (e, type, id) => {
    showContextMenu(e, type, id);
};

window.changeStoreFilter = (storeId) => {
    triggerHaptic();
    state.selectedStoreFilter = storeId;
    localStorage.setItem('shifter_storeFilter', storeId);

    document.getElementById('skeletonLoader').classList.remove('hidden');

    loadKpiData().then(() => {
        const kpiDiv = document.getElementById('kpiViewContainer');
        const gridDiv = document.getElementById('gridViewContainer');

        if (kpiDiv && !kpiDiv.classList.contains('hidden')) renderKpi();
        if (gridDiv && !gridDiv.classList.contains('hidden')) renderTable();

        updateDashboard();

        setTimeout(() => document.getElementById('skeletonLoader').classList.add('hidden'), 300);
    });

    renderAll();
};

// --- LOGIC ---

async function initGlobalAdminFilter() {
    if (!state.currentUser || state.currentUser.role !== 'admin') return;
    if (document.getElementById('globalStoreFilterWrapper')) return;

    try {
        const stores = await fetchJson('/api/stores');
        state.stores = stores;
        const container = document.querySelector('.container');
        const filterBtn = document.querySelector('button[onclick="openFilterModal()"]');

        if (!container || !filterBtn) return;

        if (!state.selectedStoreFilter) {
            state.selectedStoreFilter = state.currentUser.storeId || 'all';
        }

        const wrapper = document.createElement('div');
        wrapper.id = 'globalStoreFilterWrapper';
        wrapper.className = 'ios-card w-full px-4 py-4 mb-4 flex justify-between items-center glass-panel active:scale-[0.98] transition-transform animate-slide-up';

        let optionsHtml = `<option value="all" ${state.selectedStoreFilter === 'all' ? 'selected' : ''}>🌍 Всі магазини</option>`;
        stores.forEach(s => {
            const isSelected = state.selectedStoreFilter === s._id ? 'selected' : '';
            optionsHtml += `<option value="${s._id}" ${isSelected}>🏪 ${s.name}</option>`;
        });

        wrapper.innerHTML = `
            <span class="text-sm font-semibold text-gray-500">Магазин (Admin)</span>
            <div class="flex items-center gap-2">
                <select onchange="changeStoreFilter(this.value)" dir="rtl" class="bg-transparent font-bold text-sm text-blue-500 outline-none appearance-none cursor-pointer">
                    ${optionsHtml}
                </select>
                <span class="text-gray-300 text-xs pointer-events-none">▼</span>
            </div>
        `;

        container.insertBefore(wrapper, filterBtn);
    } catch (e) {
        console.error("Failed to load stores for filter", e);
    }
}

function checkEditorButtonVisibility() {
    const inlineEditBtn = document.getElementById('inlineEditBtn');

    if (state.currentUser && state.currentUser.role === 'RRP') {
        const btnCal = document.getElementById('tabModeCalendar');
        const btnKpi = document.getElementById('tabModeKpi');
        if (btnCal) btnCal.classList.add('hidden');
        if (btnKpi) btnKpi.classList.add('hidden');
    } else {
        const btnCal = document.getElementById('tabModeCalendar');
        const btnKpi = document.getElementById('tabModeKpi');
        if (btnCal) btnCal.classList.remove('hidden');
        if (btnKpi) btnKpi.classList.remove('hidden');
    }

    const isGridMode = localStorage.getItem('shifter_viewMode') === 'grid';

    if (inlineEditBtn && state.currentUser) {
        if (['admin', 'SM', 'SSE'].includes(state.currentUser.role) && isGridMode) {
            inlineEditBtn.classList.remove('hidden');
        } else {
            inlineEditBtn.classList.add('hidden');
        }
    }
}

function toggleEditMode() {
    triggerHaptic();
    const panel = document.getElementById('adminPanel');
    panel.classList.toggle('hidden');
    updateFabIcon(!panel.classList.contains('hidden'));
}

function toggleArchive() {
    triggerHaptic();
    document.getElementById('archiveContainer').classList.toggle('hidden');
}

async function changeMonth(d) {
    triggerHaptic();

    document.getElementById('skeletonLoader').classList.remove('hidden');

    state.currentDate.setMonth(state.currentDate.getMonth() + d);

    const kpiContainer = document.getElementById('kpiViewContainer');
    const gridContainer = document.getElementById('gridViewContainer');

    if ((kpiContainer && !kpiContainer.classList.contains('hidden')) ||
        (gridContainer && !gridContainer.classList.contains('hidden'))) {
        await loadKpiData();
    }

    if (kpiContainer && !kpiContainer.classList.contains('hidden')) {
        renderKpi();
    } else {
        renderAll();
    }

    updateDashboard();

    setTimeout(() => document.getElementById('skeletonLoader').classList.add('hidden'), 300);
}

async function setMode(m) {
    triggerHaptic();

    if (state.currentUser && state.currentUser.role === 'RRP') {
        if (m === 'calendar' || m === 'kpi') {
            m = 'list';
        }
    }

    localStorage.setItem('shifter_viewMode', m);

    const listDiv = document.getElementById('listViewContainer');
    const calDiv = document.getElementById('calendarViewContainer');
    const gridDiv = document.getElementById('gridViewContainer');
    const kpiDiv = document.getElementById('kpiViewContainer');
    const profileDiv = document.getElementById('profileViewContainer');

    if (m === 'grid' || m === 'kpi' || m === 'calendar') {
        document.getElementById('skeletonLoader').classList.remove('hidden');
    }

    listDiv.classList.add('hidden');
    calDiv.classList.add('hidden');
    gridDiv.classList.add('hidden');
    kpiDiv.classList.add('hidden');
    if (profileDiv) profileDiv.classList.add('hidden');

    const filterBtn = document.querySelector('button[onclick="openFilterModal()"]');
    const globalFilterWrapper = document.getElementById('globalStoreFilterWrapper');

    if (filterBtn) {
        if (m === 'list') {
            filterBtn.classList.remove('hidden');
            filterBtn.classList.add('flex');
            if (globalFilterWrapper) globalFilterWrapper.classList.remove('hidden');
        } else {
            filterBtn.classList.add('hidden');
            filterBtn.classList.remove('flex');
            if (globalFilterWrapper) globalFilterWrapper.classList.add('hidden');
        }
    }

    const tabList = document.getElementById('tabModeList');
    const tabCal = document.getElementById('tabModeCalendar');
    const tabGrid = document.getElementById('tabModeGrid');
    const tabKpi = document.getElementById('tabModeKpi');
    const tabProfile = document.getElementById('tabModeProfile');

    const tabs = [
        { id: 'list', el: tabList },
        { id: 'calendar', el: tabCal },
        { id: 'grid', el: tabGrid },
        { id: 'kpi', el: tabKpi },
        { id: 'profile', el: tabProfile }
    ];

    tabs.forEach(tab => {
        if (!tab.el) return;
        const iconSpan = tab.el.querySelector('span:first-child');
        const textSpan = tab.el.querySelector('span:last-child');

        if (tab.id === m) {
            tab.el.classList.add('text-blue-500');
            tab.el.classList.remove('text-gray-400');
            if (iconSpan) iconSpan.classList.remove('opacity-50');
            if (textSpan) { textSpan.classList.remove('text-gray-500'); textSpan.classList.add('text-blue-500'); }
        } else {
            tab.el.classList.remove('text-blue-500');
            tab.el.classList.add('text-gray-400');
            if (iconSpan) iconSpan.classList.add('opacity-50');
            if (textSpan) { textSpan.classList.add('text-gray-500'); textSpan.classList.remove('text-blue-500'); }
        }
    });

    if (m === 'list') {
        listDiv.classList.remove('hidden');
    } else if (m === 'calendar') {
        calDiv.classList.remove('hidden');
        calDiv.classList.add('animate-slide-up');
        renderCalendar();
    } else if (m === 'grid') {
        gridDiv.classList.remove('hidden');
        gridDiv.classList.add('animate-slide-up');
        await loadKpiData();
        renderTable();
    } else if (m === 'kpi') {
        kpiDiv.classList.remove('hidden');
        kpiDiv.classList.add('animate-slide-up');
        await loadKpiData();
        renderKpi();
    } else if (m === 'profile') {
        if (profileDiv) profileDiv.classList.remove('hidden');

        const pfName = document.getElementById('profileNameDisplay');
        const pfRole = document.getElementById('profileRoleDisplay');
        if (pfName) pfName.innerText = state.currentUser ? state.currentUser.name : 'Гість';
        if (pfRole) pfRole.innerText = state.currentUser ? state.currentUser.role : '';

        const pfImg = document.getElementById('profileAvatarImg');
        const pfPlaceholder = document.getElementById('profileAvatarPlaceholder');
        if (state.currentUser && state.currentUser.avatarId && pfImg) {
            pfImg.src = `/api/avatar/${state.currentUser.avatarId}?t=${new Date().getTime()}`;
            pfImg.classList.remove('hidden');
            if (pfPlaceholder) pfPlaceholder.classList.add('hidden');
        } else {
            if (pfImg) pfImg.classList.add('hidden');
            if (pfPlaceholder) pfPlaceholder.classList.remove('hidden');
        }
    }

    checkEditorButtonVisibility();
    updateDashboard();

    setTimeout(() => document.getElementById('skeletonLoader').classList.add('hidden'), 300);
}

async function toggleAuthMode(mode) {
    const loginContainer = document.getElementById('loginContainer');
    const registerContainer = document.getElementById('registerContainer');
    const forgotContainer = document.getElementById('forgotPasswordContainer');
    const resetContainer = document.getElementById('resetPasswordContainer');

    // Ховаємо всі
    loginContainer.classList.add('hidden');
    registerContainer.classList.add('hidden');
    forgotContainer.classList.add('hidden');
    resetContainer.classList.add('hidden');

    if (mode === 'register') {
        registerContainer.classList.remove('hidden');

        const storeSelect = document.getElementById('regStore');
        if (storeSelect.options.length <= 1) {
            try {
                const stores = await fetchJson('/api/stores');
                state.stores = stores;
                storeSelect.innerHTML = '<option value="" disabled selected>Оберіть магазин</option>';
                stores.forEach(s => {
                    storeSelect.innerHTML += `<option value="${s.code}">${s.name}</option>`;
                });
            } catch (e) {
                showToast('Помилка завантаження магазинів', 'error');
                storeSelect.innerHTML = '<option value="" disabled>Помилка</option>';
            }
        }
    } else if (mode === 'forgot') {
        forgotContainer.classList.remove('hidden');
    } else if (mode === 'reset') {
        resetContainer.classList.remove('hidden');
    } else {
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
    if (!text) return showToast('Вставте текст таблиці', 'error');
    if (!month) return showToast('Оберіть місяць', 'error');
    const res = await postJson('/api/kpi/import', { text, month });
    if (res.success) {
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
    if (!month || !normHours) return showToast('Заповніть всі поля', 'error');
    const res = await postJson('/api/kpi/settings', { month, normHours });
    if (res.success) {
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

    let query = `?month=${month}`;
    if (state.selectedStoreFilter && state.selectedStoreFilter !== 'all') {
        query += `&storeId=${state.selectedStoreFilter}`;
    }

    state.kpiData = await fetchJson(`/api/kpi${query}`);
}

window.addEventListener('scroll', () => {
    const btn = document.getElementById('backToTopBtn');
    if (btn) {
        if (window.scrollY > 300) btn.classList.remove('hidden', 'opacity-0');
        else btn.classList.add('opacity-0');
    }
});

function initContextMenuListeners() {
    // 🔥 Оновлено логіку редагування, щоб не ламалось
    const btnEdit = document.getElementById('ctxEdit');
    if (btnEdit) {
        btnEdit.onclick = () => {
            const menu = document.getElementById('contextMenu');
            menu.classList.add('hidden');
            showToast('Редагування тепер доступне лише через Режим "Таблиця" 📊', 'info');
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

setInterval(updateStoreDisplay, 5000);
setTimeout(updateStoreDisplay, 1000);
setInterval(initGlobalAdminFilter, 1500);
setInterval(checkEditorButtonVisibility, 1000);

setTimeout(updateDashboard, 1500);