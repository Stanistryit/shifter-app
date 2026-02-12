import { state } from './state.js';
import { renderTable } from './render.js'; // Перерендерює таблицю (чернетки)
import { postJson, fetchJson } from './api.js';
import { showToast, triggerHaptic } from './ui.js';

// --- INITIALIZATION ---

export function initEditor() {
    // Делегування подій кліку по таблиці
    const gridContainer = document.getElementById('gridViewTable');
    if (gridContainer) {
        gridContainer.addEventListener('click', handleGridClick);
    }
    
    // Завантажуємо шаблони з пам'яті телефону (якщо є)
    const savedTemplates = localStorage.getItem('shiftTemplates');
    if (savedTemplates) {
        try { state.shiftTemplates = JSON.parse(savedTemplates); } catch(e){}
    }
}

// --- TOGGLE MODES ---

export function toggleEditor() {
    triggerHaptic();
    state.isEditMode = !state.isEditMode;
    
    const toolbar = document.getElementById('editorToolbar');
    const fab = document.getElementById('editorFab'); // Плаваюча кнопка (якщо ми її додамо)
    
    if (state.isEditMode) {
        // Вмикаємо
        renderToolbar();
        toolbar.classList.remove('hidden', 'translate-y-full');
        showToast('✏️ Режим редактора: Оберіть інструмент і малюйте', 'info');
    } else {
        // Вимикаємо
        if (Object.keys(state.pendingChanges).length > 0) {
            if(!confirm('У вас є незбережені зміни. Вийти без збереження?')) {
                state.isEditMode = true;
                return;
            }
        }
        discardChanges(); // Очистити чернетки
        toolbar.classList.add('translate-y-full');
        setTimeout(() => toolbar.classList.add('hidden'), 300);
    }
    
    renderTable(); // Оновити вигляд таблиці (прибрати/показати чернетки)
}

// --- TOOLBAR UI ---

function renderToolbar() {
    let toolbar = document.getElementById('editorToolbar');
    
    // Якщо тулбара ще немає в DOM - створюємо його
    if (!toolbar) {
        toolbar = document.createElement('div');
        toolbar.id = 'editorToolbar';
        toolbar.className = "fixed bottom-0 left-0 right-0 bg-white dark:bg-[#1C1C1E] border-t border-gray-200 dark:border-gray-800 shadow-[0_-5px_20px_rgba(0,0,0,0.1)] z-50 transition-transform duration-300 transform translate-y-full hidden pb-safe";
        document.body.appendChild(toolbar);
    }

    // Рендер кнопок
    const activeStyle = "bg-blue-500 text-white shadow-md transform scale-105 ring-2 ring-blue-300 dark:ring-blue-700";
    const inactiveStyle = "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700";
    
    let toolsHtml = '';
    
    // 1. Стандартні шаблони
    state.shiftTemplates.forEach((tpl, idx) => {
        const isActive = state.activeTool && state.activeTool.label === tpl.label;
        const style = isActive ? activeStyle : inactiveStyle;
        toolsHtml += `
            <button onclick="window.editorSelectTool('template', ${idx})" 
                class="flex flex-col items-center justify-center p-2 rounded-xl text-[10px] font-bold h-12 min-w-[50px] transition-all active:scale-95 ${style}">
                <span>${tpl.label}</span>
            </button>
        `;
    });

    // 2. Спец інструменти
    const isCustom = state.activeTool && state.activeTool.type === 'custom';
    const customLabel = isCustom && state.activeTool.start ? `${state.activeTool.start}-${state.activeTool.end}` : 'Своя';
    
    const isEraser = state.activeTool && state.activeTool.type === 'eraser';
    const isVacation = state.activeTool && state.activeTool.type === 'vacation';

    toolsHtml += `
        <div class="w-[1px] h-8 bg-gray-300 dark:bg-gray-700 mx-1"></div>
        
        <button onclick="window.editorSelectTool('custom')" 
            class="flex flex-col items-center justify-center p-2 rounded-xl text-[10px] font-bold h-12 min-w-[50px] transition-all active:scale-95 ${isCustom ? 'bg-purple-500 text-white ring-2 ring-purple-300' : 'bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-300'}">
            <span>✨ ${customLabel}</span>
        </button>

        <button onclick="window.editorSelectTool('vacation')" 
            class="flex flex-col items-center justify-center p-2 rounded-xl text-[10px] font-bold h-12 min-w-[50px] transition-all active:scale-95 ${isVacation ? 'bg-green-500 text-white' : 'bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-300'}">
            <span>🌴 Відп.</span>
        </button>

        <button onclick="window.editorSelectTool('eraser')" 
            class="flex flex-col items-center justify-center p-2 rounded-xl text-[10px] font-bold h-12 min-w-[50px] transition-all active:scale-95 ${isEraser ? 'bg-red-500 text-white' : 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-300'}">
            <span>🧹 Гумка</span>
        </button>
    `;

    toolbar.innerHTML = `
        <div class="flex justify-between items-center px-4 py-2 border-b border-gray-100 dark:border-gray-800">
            <span class="text-xs font-bold text-gray-500">✏️ Редактор змін</span>
            <div class="flex gap-2">
                <button onclick="window.editorConfigTemplates()" class="p-2 text-gray-400 hover:text-blue-500"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg></button>
                <button onclick="window.toggleEditor()" class="px-3 py-1 bg-gray-200 dark:bg-gray-700 rounded-lg text-xs font-bold">Скасувати</button>
                <button onclick="window.saveEditorChanges()" class="px-3 py-1 bg-blue-500 text-white rounded-lg text-xs font-bold shadow-lg shadow-blue-500/40">Зберегти (${Object.keys(state.pendingChanges).length})</button>
            </div>
        </div>
        <div class="flex overflow-x-auto gap-2 p-3 pb-safe no-scrollbar">
            ${toolsHtml}
        </div>
    `;
}

// --- ACTIONS ---

window.editorSelectTool = (type, index) => {
    triggerHaptic();
    
    if (type === 'template') {
        state.activeTool = { type: 'template', ...state.shiftTemplates[index] };
    } else if (type === 'vacation') {
        state.activeTool = { type: 'vacation', start: 'Відпустка', end: 'Відпустка' };
    } else if (type === 'eraser') {
        state.activeTool = { type: 'eraser', start: 'DELETE', end: 'DELETE' };
    } else if (type === 'custom') {
        // Якщо час вже заданий, просто вибираємо його. Якщо ні (або клік повторний) - питаємо.
        if (state.activeTool?.type === 'custom' && state.activeTool.start) {
            const newTime = prompt("Введіть час зміни (напр. 10:00-15:30):", `${state.activeTool.start}-${state.activeTool.end}`);
            if (newTime && newTime.includes('-')) {
                 const [s, e] = newTime.split('-').map(x => x.trim());
                 state.activeTool = { type: 'custom', start: s, end: e };
            }
        } else {
            // Перший вибір - просимо ввести
             const newTime = prompt("Введіть час для своєї зміни (напр. 09:00-14:00):", "09:00-14:00");
             if (newTime && newTime.includes('-')) {
                 const [s, e] = newTime.split('-').map(x => x.trim());
                 state.activeTool = { type: 'custom', start: s, end: e };
             } else {
                 return; // Скасував
             }
        }
    }
    
    renderToolbar();
};

function handleGridClick(e) {
    if (!state.isEditMode) return;

    // Шукаємо клітинку
    const cell = e.target.closest('td');
    if (!cell) return;

    // Отримуємо дані з атрибутів (які ми додали в render_table.js)
    const date = cell.getAttribute('data-date');
    const name = cell.getAttribute('data-name');

    if (!date || !name) return; // Це не клітинка зміни

    if (!state.activeTool) {
        showToast('👆 Спочатку оберіть інструмент знизу', 'info');
        return;
    }

    triggerHaptic();

    // Записуємо в чернетку
    const key = `${date}_${name}`;
    
    // Якщо клікаємо тим же інструментом по вже зміненій клітинці - скасовуємо зміну (toggle)
    if (state.pendingChanges[key] && 
        state.pendingChanges[key].start === state.activeTool.start && 
        state.pendingChanges[key].end === state.activeTool.end) {
        delete state.pendingChanges[key];
    } else {
        // Записуємо нову зміну
        state.pendingChanges[key] = {
            date: date,
            name: name,
            start: state.activeTool.start,
            end: state.activeTool.end
        };
    }

    renderTable(); // Перемальовуємо, щоб показати жовті клітинки
    renderToolbar(); // Оновлюємо лічильник на кнопці "Зберегти"
}

// --- SAVING ---

window.saveEditorChanges = async () => {
    const changes = Object.values(state.pendingChanges);
    if (changes.length === 0) {
        window.toggleEditor();
        return;
    }

    const btn = document.querySelector('#editorToolbar button[onclick="window.saveEditorChanges()"]');
    const oldText = btn.innerText;
    btn.innerText = '⏳';
    
    try {
        const res = await postJson('/api/shifts/save', { updates: changes });
        if (res.success) {
            showToast(`✅ Збережено ${changes.length} змін`);
            state.pendingChanges = {}; // Очищаємо чернетку
            
            // Оновлюємо локальні дані
            // (В ідеалі - перезавантажити з сервера, але для швидкості можна і локально патчити)
            // Давай краще перезавантажимо для надійності
            const shifts = await fetchJson('/api/shifts');
            state.shifts = shifts;
            
            window.toggleEditor(); // Виходимо з режиму
            renderTable(); // Фінальний рендер
        } else {
            showToast('❌ Помилка: ' + res.message, 'error');
            btn.innerText = oldText;
        }
    } catch (e) {
        showToast('❌ Помилка з\'єднання', 'error');
        btn.innerText = oldText;
    }
};

function discardChanges() {
    state.pendingChanges = {};
    renderTable();
}

// --- SETTINGS (Templates) ---

window.editorConfigTemplates = () => {
    // Простий промпт для редагування JSON шаблонів (поки що)
    // У версії 2.0 можна зробити гарну модалку
    const currentJSON = JSON.stringify(state.shiftTemplates, null, 2);
    // Для простоти, просто покажемо повідомлення, що функція в розробці, або дамо скинути
    if(confirm("Скинути шаблони до стандартних?")) {
        localStorage.removeItem('shiftTemplates');
        state.shiftTemplates = [
            { label: '10-22', start: '10:00', end: '22:00' },
            { label: '10-20', start: '10:00', end: '20:00' },
            { label: '10-18', start: '10:00', end: '18:00' },
            { label: '10-16', start: '10:00', end: '16:00' },
            { label: '12-20', start: '12:00', end: '20:00' },
            { label: '16-22', start: '16:00', end: '22:00' }
        ];
        renderToolbar();
    }
};