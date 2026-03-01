import { state } from './modules/state.js';
import { fetchJson, postJson } from './modules/api.js';
import {
    initTheme, toggleTheme, showToast, triggerHaptic, showAdminTab as uiShowAdminTab, formatText, updateFileName,
    openTaskDetailsModal, closeTaskDetailsModal, showContextMenu, activeContext,
    updateFabIcon, toggleHoursPin
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
    openStoreFilterModal, closeStoreFilterModal, renderStoreFilterList,
    openAvatarModal, closeAvatarModal, uploadAvatar, handleAvatarSelect, openChangePasswordModal, closeChangePasswordModal, submitChangePassword,
    openTransferModal, updateStoreDisplay,
    openStoreSettingsModal, saveStoreSettings, loadLogs
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
export async function loadComponent(elementId, filePath) {
    try {
        const response = await fetch(filePath);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const html = await response.text();
        const el = document.getElementById(elementId);
        if (el) {
            el.innerHTML = html;
        }
        return true;
    } catch (error) {
        console.error(`Failed to load ${filePath}:`, error);
        return false;
    }
}

async function initApp() {
    // Load shell components first
    await Promise.all([
        loadComponent('desktop-sidebar-container', 'components/shared/desktop-sidebar.html'),
        loadComponent('mobile-navbar-container', 'components/shared/mobile-navbar.html'),
        loadComponent('bottom-navbar-container', 'components/shared/bottom-nav.html'),
        loadComponent('modals-container', 'components/modals/all-modals.html'),

        loadComponent('dashboard-container', 'components/tabs/dashboard.html'),
        loadComponent('admin-container', 'components/tabs/admin.html'),
        loadComponent('list-container', 'components/tabs/list.html'),
        loadComponent('calendar-container', 'components/tabs/calendar.html'),
        loadComponent('grid-container', 'components/tabs/grid.html'),
        loadComponent('kpi-container', 'components/tabs/kpi.html'),
        loadComponent('profile-container', 'components/tabs/profile.html')
    ]);

    initTheme();
    checkAuth();
    initContextMenuListeners();
    initEditor();

    const savedMode = localStorage.getItem('shifter_viewMode') || 'list';
    setMode(savedMode);
}

initApp();

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
window.openStoreFilterModal = openStoreFilterModal;
window.closeStoreFilterModal = closeStoreFilterModal;
window.openAvatarModal = openAvatarModal;

window.sendQuickShiftUpdate = sendQuickShiftUpdate;
window.closeAvatarModal = closeAvatarModal;
window.handleAvatarSelect = handleAvatarSelect;
window.uploadAvatar = uploadAvatar;
window.loadKpiData = loadKpiData;
window.openChangePasswordModal = openChangePasswordModal;
window.closeChangePasswordModal = closeChangePasswordModal;
window.submitChangePassword = submitChangePassword;
window.toggleHoursPin = toggleHoursPin;

window.openNotesModal = openNotesModal;
window.closeNotesModal = closeNotesModal;
window.toggleNoteType = toggleNoteType;
window.saveNote = saveNote;
window.deleteNote = deleteNote;

window.checkEditorButtonVisibility = checkEditorButtonVisibility;

window.handleCalendarDayClick = (ds) => {
    triggerHaptic();
    openNotesModal(ds);
};

window.openTransferModal = openTransferModal;
window.openStoreSettingsModal = openStoreSettingsModal;

window.openTaskProxy = (id) => {
    const task = state.tasks.find(t => t._id === id);
    if (task) openTaskDetailsModal(task);
};
window.closeTaskDetailsModal = closeTaskDetailsModal;

window.contextMenuProxy = (e, type, id) => {
    showContextMenu(e, type, id);
};

window.changeStoreFilter = (storeId, storeName) => {
    triggerHaptic();
    state.selectedStoreFilter = storeId;
    localStorage.setItem('shifter_storeFilter', storeId);

    const label = document.getElementById('currentStoreFilterLabel');
    if (label) {
        label.innerText = storeId === 'all' ? '🌍 Всі магазини' : `🏪 ${storeName}`;
    }

    closeStoreFilterModal();
    loadKpiData().then(() => {
        const kpiDiv = document.getElementById('kpiViewContainer');
        const gridDiv = document.getElementById('gridViewContainer');

        if (kpiDiv && !kpiDiv.classList.contains('hidden')) renderKpi();
        if (gridDiv && !gridDiv.classList.contains('hidden')) renderTable();

        updateDashboard();
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
        const filtersContainer = document.getElementById('filtersContainer');

        if (!filtersContainer) return;

        if (!state.selectedStoreFilter) {
            state.selectedStoreFilter = state.currentUser.storeId || 'all';
        }

        const wrapper = document.createElement('button');
        wrapper.id = 'globalStoreFilterWrapper';
        wrapper.className = 'ios-card flex-1 px-3 py-2 flex flex-col items-start justify-center relative glass-panel active:scale-[0.98] transition-transform';
        wrapper.onclick = window.openStoreFilterModal;

        const currentStoreName = state.selectedStoreFilter === 'all' ? '🌍 Всі магазини' :
            (stores.find(s => s._id === state.selectedStoreFilter)?.name || '🏪 Обраний магазин');

        wrapper.innerHTML = `
            <span class="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-0.5 mt-0.5">Магазин (Admin)</span>
            <div class="flex items-center justify-between w-full">
                <span id="currentStoreFilterLabel" class="text-blue-500 font-bold text-sm truncate">${currentStoreName}</span>
                <span class="text-gray-300 text-[10px] ml-1 flex-shrink-0">▼</span>
            </div>
        `;

        filtersContainer.insertBefore(wrapper, filtersContainer.firstChild);
    } catch (e) {
        console.error("Failed to load stores for filter", e);
    }
}

function checkEditorButtonVisibility() {
    const inlineEditBtn = document.getElementById('inlineEditBtn');

    const isRrp = state.currentUser?.role === 'RRP';
    const kpiEnabled = state.currentUser?.store?.kpi_enabled !== false; // Default is true

    if (isRrp) {
        const btnCal = document.getElementById('tabModeCalendar');
        const btnKpi = document.getElementById('tabModeKpi');
        const deskBtnKpi = document.querySelector('.desk-nav-btn[data-mode="kpi"]');

        if (btnCal) btnCal.classList.add('hidden');
        if (btnKpi) {
            if (kpiEnabled) btnKpi.classList.remove('hidden');
            else btnKpi.classList.add('hidden');
        }
        if (deskBtnKpi) {
            if (kpiEnabled) deskBtnKpi.classList.remove('hidden');
            else deskBtnKpi.classList.add('hidden');
        }
    } else {
        const btnCal = document.getElementById('tabModeCalendar');
        const btnKpi = document.getElementById('tabModeKpi');
        const deskBtnKpi = document.querySelector('.desk-nav-btn[data-mode="kpi"]');

        if (btnCal) btnCal.classList.remove('hidden');

        if (btnKpi) {
            if (kpiEnabled) btnKpi.classList.remove('hidden');
            else btnKpi.classList.add('hidden');
        }
        if (deskBtnKpi) {
            if (kpiEnabled) deskBtnKpi.classList.remove('hidden');
            else deskBtnKpi.classList.add('hidden');
        }
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

    state.currentDate.setMonth(state.currentDate.getMonth() + d);

    const kpiContainer = document.getElementById('kpi-container');
    const gridContainer = document.getElementById('grid-container');
    const calContainer = document.getElementById('calendar-container');

    // Показуємо локальний стан завантаження для таблиці/календаря
    if (gridContainer && !gridContainer.classList.contains('hidden')) {
        const gridTable = document.getElementById('gridViewTable');
        if (gridTable) {
            gridTable.style.opacity = '0.5';
            gridTable.style.transition = 'opacity 0.2s';
        }
    } else if (calContainer && !calContainer.classList.contains('hidden')) {
        const calGrid = document.getElementById('calendarGrid');
        if (calGrid) {
            calGrid.style.opacity = '0.5';
            calGrid.style.transition = 'opacity 0.2s';
        }
    } else if (kpiContainer && !kpiContainer.classList.contains('hidden')) {
        const kpiList = document.getElementById('kpiList');
        if (kpiList) {
            kpiList.style.opacity = '0.5';
            kpiList.style.transition = 'opacity 0.2s';
        }
    }

    if ((kpiContainer && !kpiContainer.classList.contains('hidden')) ||
        (gridContainer && !gridContainer.classList.contains('hidden'))) {
        await loadKpiData();
    }

    if (kpiContainer && !kpiContainer.classList.contains('hidden')) {
        renderKpi();
    } else {
        renderAll(); // Відмальовує і таблицю, і календар
    }

    updateDashboard();

    // Відновлення вигляду кнопки закріплення годин
    const btnPin = document.getElementById('toggleHoursPinBtn');
    if (btnPin) {
        if (state.isHoursPinned) {
            btnPin.innerHTML = '<span>📌</span> Закріплено';
            btnPin.className = 'text-[10px] text-white bg-blue-500 px-2 py-1 rounded-lg font-bold flex items-center gap-1 active:scale-95 transition-transform shadow-md shadow-blue-500/30';
        } else {
            btnPin.innerHTML = '<span>📌</span> Закріпити години';
            btnPin.className = 'text-[10px] text-gray-500 bg-gray-100 dark:bg-[#2C2C2E] px-2 py-1 rounded-lg font-medium flex items-center gap-1 active:scale-95 transition-transform';
        }
    }

    // Знімаємо локальний стан завантаження
    setTimeout(() => {
        const gridTable = document.getElementById('gridViewTable');
        const calGrid = document.getElementById('calendarGrid');
        const kpiList = document.getElementById('kpiList');
        if (gridTable) gridTable.style.opacity = '1';
        if (calGrid) calGrid.style.opacity = '1';
        if (kpiList) kpiList.style.opacity = '1';
    }, 100);
}

function exportCurrentMonthPdf() {
    triggerHaptic();
    const currentMonth = String(state.currentDate.getMonth() + 1).padStart(2, '0');
    const currentYear = state.currentDate.getFullYear();
    window.location.href = `/api/admin/store/export-pdf?month=${currentMonth}&year=${currentYear}`;
}
// Expose function to global scope for HTML onclick
window.exportCurrentMonthPdf = exportCurrentMonthPdf;

async function setMode(m) {
    triggerHaptic();

    if (state.currentUser && state.currentUser.role === 'RRP') {
        if (m === 'calendar' || m === 'kpi') {
            m = 'list';
        }
    }

    localStorage.setItem('shifter_viewMode', m);

    const listDiv = document.getElementById('list-container');
    const calDiv = document.getElementById('calendar-container');
    const gridDiv = document.getElementById('grid-container');
    const kpiDiv = document.getElementById('kpi-container');
    const profileDiv = document.getElementById('profile-container');

    if (listDiv) listDiv.classList.add('hidden');
    if (calDiv) calDiv.classList.add('hidden');
    if (gridDiv) gridDiv.classList.add('hidden');
    if (kpiDiv) kpiDiv.classList.add('hidden');
    if (profileDiv) profileDiv.classList.add('hidden');

    const filtersContainer = document.getElementById('filtersContainer');

    if (m === 'kpi' || m === 'list' || m === 'grid') {
        if (filtersContainer) filtersContainer.classList.remove('hidden');
        if (filtersContainer) filtersContainer.classList.add('flex');
    } else {
        if (filtersContainer) filtersContainer.classList.add('hidden');
        if (filtersContainer) filtersContainer.classList.remove('flex');
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
            tab.el.classList.add('text-blue-600', 'dark:text-blue-400');
            tab.el.classList.remove('text-gray-400');
            if (iconSpan) {
                iconSpan.classList.remove('opacity-60', 'scale-100');
                iconSpan.classList.add('opacity-100', 'scale-110');
            }
            if (textSpan) {
                textSpan.classList.remove('text-gray-500', 'dark:text-gray-400');
                textSpan.classList.add('text-blue-600', 'dark:text-blue-400');
            }

            // Рухаємо індикатор (bubble)
            const indicator = document.getElementById('tabActiveIndicator');
            if (indicator && tab.el) {
                indicator.style.left = `${tab.el.offsetLeft}px`;
                indicator.style.width = `${tab.el.offsetWidth}px`;
            }
        } else {
            tab.el.classList.remove('text-blue-600', 'dark:text-blue-400');
            tab.el.classList.add('text-gray-400');
            if (iconSpan) {
                iconSpan.classList.add('opacity-60', 'scale-100');
                iconSpan.classList.remove('opacity-100', 'scale-110');
            }
            if (textSpan) {
                textSpan.classList.add('text-gray-500', 'dark:text-gray-400');
                textSpan.classList.remove('text-blue-600', 'dark:text-blue-400');
            }
        }
    });

    // Update Desktop Sidebar active states
    const deskBtns = document.querySelectorAll('.desk-nav-btn');
    deskBtns.forEach(btn => {
        const iconSpan = btn.querySelector('span:first-child');
        const textSpan = btn.querySelector('span:last-child');
        if (btn.dataset.mode === m) {
            btn.classList.add('bg-blue-50', 'dark:bg-blue-900/30');
            btn.classList.remove('hover:bg-gray-100', 'dark:hover:bg-gray-800');
            if (iconSpan) iconSpan.classList.remove('opacity-70');
            if (textSpan) { textSpan.classList.remove('text-gray-500'); textSpan.classList.add('text-blue-600', 'font-bold'); }
        } else {
            btn.classList.remove('bg-blue-50', 'dark:bg-blue-900/30');
            btn.classList.add('hover:bg-gray-100', 'dark:hover:bg-gray-800');
            if (iconSpan) iconSpan.classList.add('opacity-70');
            if (textSpan) { textSpan.classList.add('text-gray-500'); textSpan.classList.remove('text-blue-600', 'font-bold'); }
        }
    });

    if (m === 'list') {
        if (listDiv) listDiv.classList.remove('hidden');
    } else if (m === 'calendar') {
        if (calDiv) {
            calDiv.classList.remove('hidden');
            calDiv.classList.add('animate-slide-up');
        }
        renderCalendar();
    } else if (m === 'grid') {
        if (gridDiv) {
            gridDiv.classList.remove('hidden');
            gridDiv.classList.add('animate-slide-up');
        }
        await loadKpiData();
        renderTable();
    } else if (m === 'kpi') {
        if (kpiDiv) {
            kpiDiv.classList.remove('hidden');
            kpiDiv.classList.add('animate-slide-up');
        }
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
        if (state.currentUser && state.currentUser.avatar && pfImg) {
            pfImg.src = state.currentUser.avatar;
            pfImg.classList.remove('hidden');
            if (pfPlaceholder) pfPlaceholder.classList.add('hidden');
        } else {
            if (pfImg) pfImg.classList.add('hidden');
            if (pfPlaceholder) pfPlaceholder.classList.remove('hidden');
        }

        const btnChangeStore = document.getElementById('profileBtnChangeStore');
        const btnStoreSettings = document.getElementById('profileBtnStoreSettings');
        if (state.currentUser && state.currentUser.role !== 'Guest') {
            if (btnChangeStore) {
                btnChangeStore.classList.remove('hidden');
                btnChangeStore.classList.add('flex');
            }
        } else {
            if (btnChangeStore) {
                btnChangeStore.classList.add('hidden');
                btnChangeStore.classList.remove('flex');
            }
        }

        if (state.currentUser && (state.currentUser.role === 'SM' || state.currentUser.role === 'admin')) {
            if (btnStoreSettings) {
                btnStoreSettings.classList.remove('hidden');
                btnStoreSettings.classList.add('flex');
            }
        } else {
            if (btnStoreSettings) {
                btnStoreSettings.classList.add('hidden');
                btnStoreSettings.classList.remove('flex');
            }
        }
    }

    checkEditorButtonVisibility();
    updateDashboard();
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
    const btnEditTime = document.getElementById('ctxEditTime');
    if (btnEditTime) {
        btnEditTime.onclick = () => {
            const menu = document.getElementById('contextMenu');
            menu.classList.add('hidden');
            if (activeContext.type === 'shift') {
                const s = state.shifts.find(x => x._id === activeContext.id);
                if (s) {
                    // Pre-fill modal
                    document.getElementById('customShiftStart').value = s.start || '09:00';
                    document.getElementById('customShiftEnd').value = s.end || '18:00';

                    // We need a custom temp flag in state to know we are editing from context
                    state.contextEditShiftId = s._id;

                    const m = document.getElementById('customShiftModal');
                    m.classList.remove('hidden');
                    setTimeout(() => {
                        m.classList.remove('opacity-0');
                        m.querySelector('.ios-card').classList.remove('scale-95');
                    }, 10);
                }
            }
        };
    }

    const btnSick = document.getElementById('ctxSick');
    if (btnSick) {
        btnSick.onclick = async () => {
            document.getElementById('contextMenu').classList.add('hidden');
            if (activeContext.type === 'shift') {
                const s = state.shifts.find(x => x._id === activeContext.id);
                if (s && confirm(`Встановити лікарняний для ${s.name} на ${s.date}?`)) {
                    await sendQuickShiftUpdate(s, 'Лікарняний', '00:00', '00:00');
                }
            }
        };
    }

    const btnVacation = document.getElementById('ctxVacation');
    if (btnVacation) {
        btnVacation.onclick = async () => {
            document.getElementById('contextMenu').classList.add('hidden');
            if (activeContext.type === 'shift') {
                const s = state.shifts.find(x => x._id === activeContext.id);
                if (s && confirm(`Встановити відпустку для ${s.name} на ${s.date}?`)) {
                    await sendQuickShiftUpdate(s, 'Відпустка', '00:00', '00:00');
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

async function sendQuickShiftUpdate(shift, status, start, end) {
    const changes = {};
    changes[`${shift.date}_${shift.name}`] = {
        date: shift.date,
        name: shift.name,
        status: status,
        start: start,
        end: end
    };

    try {
        const res = await postJson('/api/shifts/save', { updates: Object.values(changes) });
        if (res.success) {
            triggerHaptic('success');
            showToast('✅ Змінено');
            state.shifts = await fetchJson('/api/shifts');
            renderAll();
        } else {
            showToast('❌ Помилка: ' + res.message, 'error');
        }
    } catch (e) {
        showToast('Помилка сервера', 'error');
    }
}

setInterval(updateStoreDisplay, 5000);
setTimeout(updateStoreDisplay, 1000);
setInterval(initGlobalAdminFilter, 1500);
setInterval(checkEditorButtonVisibility, 1000);

setTimeout(updateDashboard, 1500);

// Оновлення позиції індикатора табів при зміні розміру вікна
window.addEventListener('resize', () => {
    const m = localStorage.getItem('shifter_viewMode') || 'list';
    const tabId = m === 'kpi' ? 'tabModeKpi' : `tabMode${m.charAt(0).toUpperCase() + m.slice(1)}`;
    const tabEl = document.getElementById(tabId);
    const indicator = document.getElementById('tabActiveIndicator');
    if (indicator && tabEl) {
        indicator.style.left = `${tabEl.offsetLeft}px`;
        indicator.style.width = `${tabEl.offsetWidth}px`;
    }
});