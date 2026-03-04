import { state } from './state.js';
import { renderTable } from './render.js';
import { postJson, fetchJson } from './api.js';
import { showToast, triggerHaptic } from './ui.js';

// --- INITIALIZATION ---

export function initEditor() {
    const gridContainer = document.getElementById('gridViewTable');
    if (gridContainer) {
        gridContainer.addEventListener('click', handleGridClick);
    }

    // Завантажуємо шаблони або ставимо дефолтні
    const savedTemplates = localStorage.getItem('shiftTemplates');
    if (savedTemplates) {
        try {
            state.shiftTemplates = JSON.parse(savedTemplates);
        } catch (e) {
            setDefaultTemplates();
        }
    } else {
        setDefaultTemplates();
    }
}

function setDefaultTemplates() {
    state.shiftTemplates = [
        { label: '10-22', start: '10:00', end: '22:00' },
        { label: '10-20', start: '10:00', end: '20:00' },
        { label: '10-18', start: '10:00', end: '18:00' },
        { label: '10-16', start: '10:00', end: '16:00' },
        { label: '12-20', start: '12:00', end: '20:00' },
        { label: '12-22', start: '12:00', end: '22:00' },
        { label: '16-22', start: '16:00', end: '22:00' }
    ];
    localStorage.setItem('shiftTemplates', JSON.stringify(state.shiftTemplates));
}

// --- TOGGLE MODES ---

export function toggleEditor() {
    triggerHaptic();
    state.isEditMode = !state.isEditMode;

    const tg = window.Telegram.WebApp;
    const isDesktop = window.innerWidth >= 1024;

    if (state.isEditMode) {
        renderToolbar(); // Create Toolbar if it doesn't exist

        const toolbar = document.getElementById('editorToolbar');
        const bottomTab = document.getElementById('mobileBottomNav');
        const pcSidebar = document.getElementById('pcEditorSidebar');
        const deskNav = document.getElementById('desktopNavMenu');

        if (isDesktop && pcSidebar && deskNav) {
            // Desk logic
            deskNav.classList.add('hidden');
            pcSidebar.classList.remove('hidden');
            pcSidebar.classList.add('flex');
            // hide mobile toolbar just in case
            if (toolbar) toolbar.classList.add('hidden', 'translate-y-full');

            // Re-render PC save button state
            updatePCSaveButton();
        } else {
            // Mobile logic
            if (toolbar) toolbar.classList.remove('hidden', 'translate-y-full');
            if (bottomTab) bottomTab.classList.add('translate-y-32', 'opacity-0'); // Slide down out of screen and fade out
        }

        showToast('✏️ Режим редактора: Оберіть інструмент', 'info');

        // Setup MainButton (Telegram)
        tg.MainButton.text = "ЗБЕРЕГТИ ЗМІНИ";
        tg.MainButton.color = "#3b82f6"; // bg-blue-500
        tg.MainButton.onClick(() => window.saveEditorChanges());

        // Only show if there are already pending changes
        const pendingCount = Object.keys(state.pendingChanges).length;
        if (pendingCount > 0) {
            tg.MainButton.text = `ЗБЕРЕГТИ ЗМІНИ (${pendingCount})`;
            tg.MainButton.show();
        } else {
            tg.MainButton.hide();
        }

        // Add keyboard events for PC
        window.addEventListener('keydown', handleEditorKeydown);

    } else {
        if (Object.keys(state.pendingChanges).length > 0) {
            if (!confirm('У вас є незбережені зміни. Вийти без збереження?')) {
                state.isEditMode = true;
                return;
            }
        }
        discardChanges();

        const toolbar = document.getElementById('editorToolbar');
        const bottomTab = document.getElementById('mobileBottomNav');
        const pcSidebar = document.getElementById('pcEditorSidebar');
        const deskNav = document.getElementById('desktopNavMenu');

        if (isDesktop && pcSidebar && deskNav) {
            deskNav.classList.remove('hidden');
            pcSidebar.classList.add('hidden');
            pcSidebar.classList.remove('flex');
        } else {
            if (toolbar) {
                toolbar.classList.add('translate-y-full');
                setTimeout(() => toolbar.classList.add('hidden'), 300);
            }
            if (bottomTab) bottomTab.classList.remove('translate-y-32', 'opacity-0');
        }

        tg.MainButton.hide();
        tg.MainButton.offClick(window.saveEditorChanges); // Cleanup
        window.removeEventListener('keydown', handleEditorKeydown);
    }

    renderTable();
}

// --- TOOLBAR UI (GRID 5x5) ---

function renderToolbar() {
    const isDesktop = window.innerWidth >= 1024;

    const activeStyle = "bg-blue-500 text-white shadow-md ring-2 ring-blue-300 dark:ring-blue-700 transform scale-105 z-10";
    const inactiveStyle = "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700";

    const isCustom = state.activeTool && state.activeTool.type === 'custom';
    const customLabel = isCustom && state.activeTool.start ? `${state.activeTool.start}` : 'Своя';
    const isEraser = state.activeTool && state.activeTool.type === 'eraser';
    const isVacation = state.activeTool && state.activeTool.type === 'vacation';
    const isSick = state.activeTool && state.activeTool.type === 'sick';

    if (isDesktop) {
        // --- Рендеримо бічну панель ПК ---
        const pcSidebar = document.getElementById('pcEditorSidebar');
        if (!pcSidebar) return;

        let pcHtml = `
            <div class="flex items-center justify-between mb-3">
                <h2 class="text-lg font-bold">✏️ Редактор</h2>
                <button onclick="window.toggleEditor()" class="p-1.5 bg-gray-100 dark:bg-gray-800 rounded-full hover:bg-gray-200 active:scale-95 transition-all text-xs">✕</button>
            </div>
        `;

        // Кнопка зберігання (відображення/приховування лінкується далі у коді)
        const pendingCount = Object.keys(state.pendingChanges || {}).length;
        const saveDisabled = pendingCount === 0 ? 'opacity-50 cursor-not-allowed scale-95' : 'hover:scale-105 hover:shadow-lg active:scale-95 shadow-blue-500/30';

        pcHtml += `
            <button id="pcEditorSaveBtn" onclick="window.saveEditorChanges()" 
                class="w-full py-2.5 bg-blue-500 text-white font-bold rounded-xl shadow-md transition-all duration-300 mb-3 flex flex-col items-center justify-center ${saveDisabled}">
                <span class="text-base mb-0.5">💾 Зберегти зміни</span>
                <span class="text-[10px] font-normal opacity-80" id="pcEditorSaveCount">${pendingCount > 0 ? 'У вас ' + pendingCount + ' незбережених змін' : 'Немає змін'}</span>
            </button>
        `;

        // Шаблони (Сітка)
        pcHtml += `
            <div class="mb-3">
                <div class="flex items-center justify-between mb-2">
                    <h3 class="text-xs font-bold text-gray-500">Շ Шаблони (1-9)</h3>
                    <button onclick="window.editorConfigTemplates()" class="text-blue-500 hover:text-blue-600 text-base">⚙️</button>
                </div>
                <div class="grid grid-cols-3 gap-1.5">
        `;

        state.shiftTemplates.forEach((tpl, idx) => {
            const isActive = state.activeTool && state.activeTool.label === tpl.label;
            const style = isActive ? activeStyle : inactiveStyle;
            pcHtml += `
                <button onclick="window.editorSelectTool('template', ${idx})" 
                    class="flex flex-col items-center justify-center p-2 rounded-lg text-xs font-bold transition-all active:scale-95 ${style}">
                    <span class="text-[9px] opacity-70 leading-none mb-0.5">${idx + 1}</span>
                    <span class="leading-tight">${tpl.label}</span>
                </button>
            `;
        });
        pcHtml += `</div></div>`;

        // Спеціальні Інструменти
        pcHtml += `
            <div class="mb-3">
                <h3 class="text-xs font-bold text-gray-500 mb-2">🛠 Спеціальні</h3>
                <div class="grid grid-cols-2 gap-1.5">
                    <button onclick="window.editorSelectTool('custom')" 
                        class="flex flex-col items-center justify-center py-2 px-1 rounded-lg text-xs font-bold transition-all active:scale-95 ${isCustom ? 'bg-purple-500 text-white ring-2 ring-purple-300' : 'bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-300'}">
                        <span>✨ ${customLabel}</span>
                    </button>
                    <button onclick="window.editorSelectTool('eraser')" 
                        class="flex flex-col items-center justify-center py-2 px-1 rounded-lg text-xs font-bold transition-all active:scale-95 ${isEraser ? 'bg-gray-500 text-white' : 'bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400'}">
                        <span>🧹 Гумка (E)</span>
                    </button>
                    <button onclick="window.editorSelectTool('vacation')" 
                        class="flex flex-col items-center justify-center py-2 px-1 rounded-lg text-xs font-bold transition-all active:scale-95 ${isVacation ? 'bg-green-500 text-white' : 'bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-300'}">
                        <span>🌴 Відпустка</span>
                    </button>
                    <button onclick="window.editorSelectTool('sick')" 
                        class="flex flex-col items-center justify-center py-2 px-1 rounded-lg text-xs font-bold transition-all active:scale-95 ${isSick ? 'bg-red-500 text-white' : 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-300'}">
                        <span>💊 Лікарняний</span>
                    </button>
                </div>
            </div>
        `;

        // Інструкція до кастомної зміни (одразу формається)
        let defaultS = "10:00"; let defaultE = "19:00";
        if (state.activeTool?.type === 'custom' && state.activeTool.start) {
            defaultS = state.activeTool.start; defaultE = state.activeTool.end;
        }

        pcHtml += `
            <div class="mt-auto bg-gray-50 dark:bg-[#2C2C2E] p-3 rounded-xl border border-gray-100 dark:border-gray-800">
                <h3 class="text-[10px] uppercase font-bold text-gray-500 mb-2 tracking-wide">Власний час</h3>
                <div class="flex items-center gap-1.5 mb-2">
                    <input type="time" id="pcCustomStart" class="w-full bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-700 rounded-lg p-1.5 text-xs outline-none" value="${defaultS}">
                    <span class="text-gray-400 text-xs">-</span>
                    <input type="time" id="pcCustomEnd" class="w-full bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-700 rounded-lg p-1.5 text-xs outline-none" value="${defaultE}">
                </div>
                <button onclick="window.applyPcCustomShift()" class="w-full py-1.5 bg-gradient-to-r from-purple-500 to-indigo-500 text-white text-xs font-bold text-center rounded-lg shadow-sm active:scale-95 transition-transform">
                    ✨ Обрати
                </button>
            </div>
        `;

        pcSidebar.innerHTML = pcHtml;

    } else {
        // --- Рендеримо мобільний Toolbar ---
        let toolbar = document.getElementById('editorToolbar');

        if (!toolbar) {
            toolbar = document.createElement('div');
            toolbar.id = 'editorToolbar';
            toolbar.className = "fixed bottom-0 left-0 right-0 bg-white dark:bg-[#1C1C1E] border-t border-gray-200 dark:border-gray-800 shadow-[0_-5px_20px_rgba(0,0,0,0.1)] z-50 transition-transform duration-300 transform translate-y-full hidden pb-safe rounded-t-2xl";
            document.body.appendChild(toolbar);
        }

        let toolsHtml = '';

        state.shiftTemplates.forEach((tpl, idx) => {
            const isActive = state.activeTool && state.activeTool.label === tpl.label;
            const style = isActive ? activeStyle : inactiveStyle;
            toolsHtml += `
                <button onclick="window.editorSelectTool('template', ${idx})" 
                    class="snap-start flex-shrink-0 flex flex-col items-center justify-center px-4 rounded-xl text-[11px] font-bold h-10 whitespace-nowrap transition-all active:scale-95 ${style}">
                    <span>${tpl.label}</span>
                </button>
            `;
        });

        toolsHtml += `
            <button onclick="window.editorSelectTool('custom')" 
                class="snap-start flex-shrink-0 flex flex-col items-center justify-center px-4 rounded-xl text-[11px] font-bold h-10 whitespace-nowrap transition-all active:scale-95 ${isCustom ? 'bg-purple-500 text-white ring-2 ring-purple-300' : 'bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-300'}">
                <span>✨ ${customLabel}</span>
            </button>
            <button onclick="window.editorSelectTool('vacation')" 
                class="snap-start flex-shrink-0 flex flex-col items-center justify-center px-4 rounded-xl text-[11px] font-bold h-10 whitespace-nowrap transition-all active:scale-95 ${isVacation ? 'bg-green-500 text-white' : 'bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-300'}">
                <span>🌴 Відп.</span>
            </button>
            <button onclick="window.editorSelectTool('sick')" 
                class="snap-start flex-shrink-0 flex flex-col items-center justify-center px-4 rounded-xl text-[11px] font-bold h-10 whitespace-nowrap transition-all active:scale-95 ${isSick ? 'bg-red-500 text-white' : 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-300'}">
                <span>💊 Лік.</span>
            </button>
            <button onclick="window.editorSelectTool('eraser')" 
                class="snap-start flex-shrink-0 flex flex-col items-center justify-center px-4 rounded-xl text-[11px] font-bold h-10 whitespace-nowrap transition-all active:scale-95 ${isEraser ? 'bg-gray-500 text-white' : 'bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400'}">
                <span>🧹 Гумка</span>
            </button>
        `;

        toolbar.innerHTML = `
            <div class="flex justify-between items-center px-4 py-3 border-b border-gray-100 dark:border-gray-800">
                <button onclick="window.editorConfigTemplates()" class="p-2 -ml-2 text-gray-400 hover:text-blue-500 active:scale-95 transition-transform"><span class="text-lg">⚙️</span></button>
                <div class="flex gap-2">
                    <button onclick="window.toggleEditor()" class="px-4 py-1.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg text-xs font-bold active:scale-95">Закрити редактор</button>
                </div>
            </div>
            <div class="flex overflow-x-auto gap-2 p-3 pb-safe scrollbar-hide snap-x relative z-10 w-full" style="scrollbar-width: none; -ms-overflow-style: none;">
                ${toolsHtml}
            </div>
        `;
    }
}

// Helpers
window.applyPcCustomShift = function () {
    triggerHaptic('light', 'impact');
    const s = document.getElementById('pcCustomStart').value;
    const e = document.getElementById('pcCustomEnd').value;
    if (s && e) {
        state.activeTool = { type: 'custom', start: s, end: e };
        renderToolbar();
    }
}

function updatePCSaveButton() {
    const isDesktop = window.innerWidth >= 1024;
    if (!isDesktop || !state.isEditMode) return;

    const pcSaveBtn = document.getElementById('pcEditorSaveBtn');
    const pcSaveCount = document.getElementById('pcEditorSaveCount');
    if (!pcSaveBtn || !pcSaveCount) return;

    const count = Object.keys(state.pendingChanges).length;
    if (count > 0) {
        pcSaveBtn.classList.remove('opacity-50', 'cursor-not-allowed', 'scale-95');
        pcSaveBtn.classList.add('hover:scale-105', 'hover:shadow-lg', 'active:scale-95', 'shadow-blue-500/30');
        pcSaveCount.innerText = `У вас ${count} незбережених змін`;
    } else {
        pcSaveBtn.classList.add('opacity-50', 'cursor-not-allowed', 'scale-95');
        pcSaveBtn.classList.remove('hover:scale-105', 'hover:shadow-lg', 'active:scale-95', 'shadow-blue-500/30');
        pcSaveCount.innerText = 'Немає змін';
    }
}

function handleEditorKeydown(e) {
    // Ignore updates if typing in an input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    // ЗБЕРЕГТИ: Ctrl + S або Cmd + S
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault(); // Зупиняємо стандартне збереження сторінки браузером
        if (Object.keys(state.pendingChanges).length > 0) {
            window.saveEditorChanges();
        }
        return;
    }

    // ШАБЛОНИ: Цифри 1-9
    if (e.key >= '1' && e.key <= '9') {
        const index = parseInt(e.key) - 1;
        if (index < state.shiftTemplates.length) {
            window.editorSelectTool('template', index);
        }
    }
    // ГУМКА: E (англійська) або У (українська)
    else if (e.code === 'KeyE' || ['e', 'е', 'у', 'y'].includes(e.key.toLowerCase())) {
        window.editorSelectTool('eraser');
    }
}

// --- ACTIONS ---

export function editorSelectTool(type, index) {
    triggerHaptic();

    if (type === 'template') {
        state.activeTool = { type: 'template', ...state.shiftTemplates[index] };
    } else if (type === 'vacation') {
        state.activeTool = { type: 'vacation', start: 'Відпустка', end: 'Відпустка' };
    } else if (type === 'sick') {
        state.activeTool = { type: 'sick', start: 'Лікарняний', end: 'Лікарняний' };
    } else if (type === 'eraser') {
        state.activeTool = { type: 'eraser', start: 'DELETE', end: 'DELETE' };
    }

    const isDesktop = window.innerWidth >= 1024;
    if (type === 'custom' && !isDesktop) {
        let defaultS = "10:00";
        let defaultE = "19:00";
        // On desktop custom is selected immediately, but on mobile we show a modal
        if (state.activeTool?.type === 'custom' && state.activeTool.start) {
            defaultS = state.activeTool.start;
            defaultE = state.activeTool.end;
        }

        const m = document.getElementById('customShiftModal');
        if (m) {
            const content = m.querySelector('.ios-card');
            if (document.getElementById('customShiftStart')) document.getElementById('customShiftStart').value = defaultS;
            if (document.getElementById('customShiftEnd')) document.getElementById('customShiftEnd').value = defaultE;

            m.classList.remove('hidden');
            setTimeout(() => {
                m.classList.remove('opacity-0');
                if (content) content.classList.remove('scale-95');
            }, 10);
            return; // Don't render toolbar yet, wait for apply
        }
    } else if (type === 'custom' && isDesktop) {
        let s = document.getElementById('pcCustomStart')?.value || "10:00";
        let e = document.getElementById('pcCustomEnd')?.value || "19:00";
        state.activeTool = { type: 'custom', start: s, end: e };
    }

    renderToolbar();
};

export function closeCustomShiftModal() {
    triggerHaptic();
    const m = document.getElementById('customShiftModal');
    const content = m.querySelector('.ios-card');
    m.classList.add('opacity-0');
    content.classList.add('scale-95');
    setTimeout(() => m.classList.add('hidden'), 300);
}

export async function applyCustomShiftTime() {
    triggerHaptic('light', 'impact');
    const s = document.getElementById('customShiftStart').value;
    const e = document.getElementById('customShiftEnd').value;

    if (s && e) {
        if (state.contextEditShiftId) {
            // Edit triggered from context menu (quick action)
            const shift = state.shifts.find(x => x._id === state.contextEditShiftId);
            if (shift) {
                // Ensure sendQuickShiftUpdate is reachable from window 
                // since it's defined in app.js. Adding it to window in app.js or calling via window.
                if (window.sendQuickShiftUpdate) {
                    await window.sendQuickShiftUpdate(shift, shift.status || '', s, e);
                }
            }
            state.contextEditShiftId = null; // reset
        } else {
            // Standard assignment tool behavior
            state.activeTool = { type: 'custom', start: s, end: e };
            renderToolbar();
        }
    }
    closeCustomShiftModal();
}

function handleGridClick(e) {
    if (!state.isEditMode) return;

    const cell = e.target.closest('td');
    if (!cell) return;

    const date = cell.getAttribute('data-date');
    const name = cell.getAttribute('data-name');

    if (!date || !name) return;

    if (!state.activeTool) {
        showToast('👆 Спочатку оберіть інструмент знизу', 'info');
        return;
    }

    triggerHaptic();

    const key = `${date}_${name}`;

    // Якщо клікаємо тим самим інструментом по тій самій зміні - скасовуємо (toggle)
    if (state.pendingChanges[key] &&
        state.pendingChanges[key].start === state.activeTool.start &&
        state.pendingChanges[key].end === state.activeTool.end) {
        delete state.pendingChanges[key];
    } else {
        state.pendingChanges[key] = {
            date: date,
            name: name,
            start: state.activeTool.start,
            end: state.activeTool.end
        };
    }

    renderTable();

    // Update MainButton visibility (Mobile) & Native Save Button (PC)
    const count = Object.keys(state.pendingChanges).length;
    const tg = window.Telegram.WebApp;
    if (count > 0) {
        tg.MainButton.text = `ЗБЕРЕГТИ ЗМІНИ (${count})`;
        if (!tg.MainButton.isVisible) tg.MainButton.show();
    } else {
        if (tg.MainButton.isVisible) tg.MainButton.hide();
    }

    // Update PC native button save state
    updatePCSaveButton();
}

// --- SAVING ---

export async function saveEditorChanges() {
    const changes = Object.values(state.pendingChanges);
    if (changes.length === 0) {
        window.toggleEditor();
        return;
    }

    const tg = window.Telegram.WebApp;
    tg.MainButton.showProgress(); // Telegram loading indicator

    try {
        const res = await postJson('/api/shifts/save', { updates: changes });
        if (res.success) {
            triggerHaptic('success', 'notification');
            if (res.isRequest) {
                showToast(`📩 Відправлено ${res.count} змін на підтвердження SM`, 'info');
            } else {
                showToast(`✅ Збережено ${changes.length} змін`);
            }

            state.pendingChanges = {};
            const shifts = await fetchJson('/api/shifts');
            state.shifts = shifts;

            window.toggleEditor(); // this hides button and cleans up
            renderTable();
        } else {
            triggerHaptic('error', 'notification');
            showToast('❌ Помилка: ' + res.message, 'error');
            tg.MainButton.hideProgress();
        }
    } catch (e) {
        triggerHaptic('error', 'notification');
        showToast('Помилка з\'єднання. Спробуйте ще раз.', 'error');
        tg.MainButton.hideProgress();
    }
};

function discardChanges() {
    state.pendingChanges = {};
    renderTable();
}

// --- 🔥 TEMPLATE MANAGER (MODAL) ---

export function editorConfigTemplates() {
    // Створюємо HTML для списку шаблонів
    let listHtml = '';
    state.shiftTemplates.forEach((t, i) => {
        listHtml += `
            <div class="flex items-center justify-between bg-gray-50 dark:bg-gray-800 p-2 rounded-lg mb-2">
                <div class="text-sm font-bold">${t.label}</div>
                <div class="text-[10px] text-gray-400 font-mono ml-2">${t.start}-${t.end}</div>
                <button onclick="window.removeTemplate(${i})" class="ml-auto w-6 h-6 flex items-center justify-center text-red-500 bg-red-100 dark:bg-red-900/30 rounded-full hover:scale-110 transition-transform">✕</button>
            </div>
        `;
    });

    const modalHtml = `
    <div id="templateManagerModal" class="fixed inset-0 z-[70] flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-black/60 backdrop-blur-md" onclick="document.getElementById('templateManagerModal').remove()"></div>
        <div class="glass-modal rounded-2xl w-full max-w-sm p-5 relative z-10 animate-slide-up">
            <h3 class="font-bold text-lg mb-4 flex justify-between items-center">
                <span>🎨 Шаблони</span>
                <button onclick="window.resetTemplates()" class="text-xs text-blue-500 font-medium">🔄 Скинути</button>
            </h3>
            
            <div class="max-h-48 overflow-y-auto mb-4 pr-1" id="templateList">
                ${listHtml.length ? listHtml : '<div class="text-center text-gray-400 text-xs py-4">Список порожній</div>'}
            </div>

            <div class="border-t border-gray-100 dark:border-gray-800 pt-4">
                <div class="text-xs font-bold text-gray-500 mb-2">Додати новий:</div>
                <div class="flex gap-2 mb-2">
                    <input type="time" id="newTplStart" class="ios-input p-1 text-center text-sm" value="10:00">
                    <span class="self-center">-</span>
                    <input type="time" id="newTplEnd" class="ios-input p-1 text-center text-sm" value="22:00">
                </div>
                <button onclick="window.addTemplate()" class="btn-primary bg-green-500 shadow-green-500/30 text-sm py-2">➕ Додати</button>
            </div>
            
            <button onclick="document.getElementById('templateManagerModal').remove()" class="w-full mt-4 py-3 text-gray-500 font-medium text-sm hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors">Закрити</button>
        </div>
    </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

// Функції менеджера (експортуємо в window, щоб працювали з HTML)
window.removeTemplate = function (index) {
    if (confirm('Видалити цей шаблон?')) {
        state.shiftTemplates.splice(index, 1);
        localStorage.setItem('shiftTemplates', JSON.stringify(state.shiftTemplates));
        document.getElementById('templateManagerModal').remove();
        editorConfigTemplates(); // Перевідкриваємо модалку
        renderToolbar(); // Оновлюємо тулбар
    }
};

window.addTemplate = function () {
    const start = document.getElementById('newTplStart').value;
    const end = document.getElementById('newTplEnd').value;

    if (!start || !end) return showToast('Введіть час', 'error');

    // Формуємо коротку назву (наприклад "10-22")
    const h1 = start.split(':')[0];
    const h2 = end.split(':')[0];
    const label = `${parseInt(h1)}-${parseInt(h2)}`;

    state.shiftTemplates.push({ label, start, end });
    localStorage.setItem('shiftTemplates', JSON.stringify(state.shiftTemplates));

    document.getElementById('templateManagerModal').remove();
    editorConfigTemplates();
    renderToolbar();
    showToast('Шаблон додано');
};

window.resetTemplates = function () {
    if (confirm('Відновити стандартні шаблони?')) {
        setDefaultTemplates();
        document.getElementById('templateManagerModal').remove();
        editorConfigTemplates();
        renderToolbar();
        showToast('Відновлено');
    }
};

window.editorSelectTool = editorSelectTool;
window.editorConfigTemplates = editorConfigTemplates;
window.saveEditorChanges = saveEditorChanges;
window.toggleEditor = toggleEditor;