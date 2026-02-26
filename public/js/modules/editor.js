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

    const toolbar = document.getElementById('editorToolbar');
    const bottomTab = document.getElementById('bottomTabBar');
    const tg = window.Telegram.WebApp;

    if (state.isEditMode) {
        renderToolbar();
        toolbar.classList.remove('hidden', 'translate-y-full');
        if (bottomTab) bottomTab.classList.add('translate-y-24'); // Ховаємо нижче екрану
        showToast('✏️ Режим редактора: Оберіть інструмент', 'info');

        // Setup MainButton
        tg.MainButton.text = "ЗБЕРЕГТИ ЗМІНИ";
        tg.MainButton.color = "#3b82f6"; // bg-blue-500
        tg.MainButton.onClick(() => window.saveEditorChanges());

        // Only show if there are already pending changes
        if (Object.keys(state.pendingChanges).length > 0) {
            tg.MainButton.text = `ЗБЕРЕГТИ ЗМІНИ (${Object.keys(state.pendingChanges).length})`;
            tg.MainButton.show();
        } else {
            tg.MainButton.hide();
        }

    } else {
        if (Object.keys(state.pendingChanges).length > 0) {
            if (!confirm('У вас є незбережені зміни. Вийти без збереження?')) {
                state.isEditMode = true;
                return;
            }
        }
        discardChanges();
        toolbar.classList.add('translate-y-full');
        if (bottomTab) bottomTab.classList.remove('translate-y-24');
        setTimeout(() => toolbar.classList.add('hidden'), 300);
        tg.MainButton.hide();
        tg.MainButton.offClick(window.saveEditorChanges); // Cleanup
    }

    renderTable();
}

// --- TOOLBAR UI (GRID 5x5) ---

function renderToolbar() {
    let toolbar = document.getElementById('editorToolbar');

    if (!toolbar) {
        toolbar = document.createElement('div');
        toolbar.id = 'editorToolbar';
        // 🔥 Змінено стиль контейнера на фіксований внизу
        toolbar.className = "fixed bottom-0 left-0 right-0 bg-white dark:bg-[#1C1C1E] border-t border-gray-200 dark:border-gray-800 shadow-[0_-5px_20px_rgba(0,0,0,0.1)] z-50 transition-transform duration-300 transform translate-y-full hidden pb-safe rounded-t-2xl";
        document.body.appendChild(toolbar);
    }

    const activeStyle = "bg-blue-500 text-white shadow-md ring-2 ring-blue-300 dark:ring-blue-700 transform scale-105 z-10";
    const inactiveStyle = "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700";

    let toolsHtml = '';

    // 1. Шаблони
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

    // 2. Спеціальні інструменти
    const isCustom = state.activeTool && state.activeTool.type === 'custom';
    const customLabel = isCustom && state.activeTool.start ? `${state.activeTool.start}` : 'Своя';

    const isEraser = state.activeTool && state.activeTool.type === 'eraser';
    const isVacation = state.activeTool && state.activeTool.type === 'vacation';
    const isSick = state.activeTool && state.activeTool.type === 'sick';

    // Кнопка "Своя"
    toolsHtml += `
        <button onclick="window.editorSelectTool('custom')" 
            class="snap-start flex-shrink-0 flex flex-col items-center justify-center px-4 rounded-xl text-[11px] font-bold h-10 whitespace-nowrap transition-all active:scale-95 ${isCustom ? 'bg-purple-500 text-white ring-2 ring-purple-300' : 'bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-300'}">
            <span>✨ ${customLabel}</span>
        </button>
    `;

    // Кнопка "Відпустка"
    toolsHtml += `
        <button onclick="window.editorSelectTool('vacation')" 
            class="snap-start flex-shrink-0 flex flex-col items-center justify-center px-4 rounded-xl text-[11px] font-bold h-10 whitespace-nowrap transition-all active:scale-95 ${isVacation ? 'bg-green-500 text-white' : 'bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-300'}">
            <span>🌴 Відп.</span>
        </button>
    `;

    // Кнопка "Лікарняний"
    toolsHtml += `
        <button onclick="window.editorSelectTool('sick')" 
            class="snap-start flex-shrink-0 flex flex-col items-center justify-center px-4 rounded-xl text-[11px] font-bold h-10 whitespace-nowrap transition-all active:scale-95 ${isSick ? 'bg-red-500 text-white' : 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-300'}">
            <span>💊 Лік.</span>
        </button>
    `;

    // Кнопка "Гумка"
    toolsHtml += `
        <button onclick="window.editorSelectTool('eraser')" 
            class="snap-start flex-shrink-0 flex flex-col items-center justify-center px-4 rounded-xl text-[11px] font-bold h-10 whitespace-nowrap transition-all active:scale-95 ${isEraser ? 'bg-gray-500 text-white' : 'bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400'}">
            <span>🧹 Гумка</span>
        </button>
    `;

    // 🔥 Заголовок + Стрічка (Без кнопки Зберегти, бо тепер є MainButton)
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
    } else if (type === 'custom') {
        let defaultS = "10:00";
        let defaultE = "19:00";
        if (state.activeTool?.type === 'custom' && state.activeTool.start) {
            defaultS = state.activeTool.start;
            defaultE = state.activeTool.end;
        }

        const m = document.getElementById('customShiftModal');
        const content = m.querySelector('.ios-card');
        document.getElementById('customShiftStart').value = defaultS;
        document.getElementById('customShiftEnd').value = defaultE;

        m.classList.remove('hidden');
        setTimeout(() => {
            m.classList.remove('opacity-0');
            content.classList.remove('scale-95');
        }, 10);
        return; // Don't render toolbar yet, wait for apply
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

export function applyCustomShiftTime() {
    triggerHaptic();
    const s = document.getElementById('customShiftStart').value;
    const e = document.getElementById('customShiftEnd').value;

    if (s && e) {
        state.activeTool = { type: 'custom', start: s, end: e };
        renderToolbar();
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

    // Update MainButton visibility
    const tg = window.Telegram.WebApp;
    const count = Object.keys(state.pendingChanges).length;
    if (count > 0) {
        tg.MainButton.text = `ЗБЕРЕГТИ ЗМІНИ (${count})`;
        if (!tg.MainButton.isVisible) tg.MainButton.show();
    } else {
        if (tg.MainButton.isVisible) tg.MainButton.hide();
    }
    // renderToolbar(); // Можна не перемальовувати тулбар щоразу, це економить ресурси
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
            triggerHaptic('success');
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
            triggerHaptic('error');
            showToast('❌ Помилка: ' + res.message, 'error');
            tg.MainButton.hideProgress();
        }
    } catch (e) {
        triggerHaptic('error');
        showToast('❌ Помилка з\'єднання', 'error');
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