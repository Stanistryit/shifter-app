import { state } from './state.js';
import { fetchJson, postJson } from './api.js';
import { showToast, updateFileName } from './ui.js';
import { renderAll } from './render.js';

// --- SHIFTS ---

export function toggleShiftTimeInputs() {
    const isVacation = document.getElementById('shiftVacation').checked;
    const isSick = document.getElementById('shiftSick').checked;
    
    // Якщо увімкнено будь-який спец. статус — ховаємо час
    document.getElementById('shiftTimeInputs').className = (isVacation || isSick) ? 'hidden' : 'flex gap-3';
}

export async function addShift() {
    const date = document.getElementById('shiftDate').value;
    const name = document.getElementById('employeeSelect').value;
    const isVacation = document.getElementById('shiftVacation').checked;
    const isSick = document.getElementById('shiftSick').checked;
    let start, end;

    if (isVacation) {
        start = 'Відпустка';
        end = 'Відпустка';
    } else if (isSick) {
        start = 'Лікарняний';
        end = 'Лікарняний';
    } else {
        start = document.getElementById('startTime').value;
        end = document.getElementById('endTime').value;
    }

    if (!date || !name) return showToast("Заповніть всі дані", 'error');

    // Якщо раптом обрано обидва чекбокси, пріоритет у Відпустки (код вище це враховує),
    // але краще вручну скинути інший, щоб не плутати.
    if (isVacation && isSick) {
        document.getElementById('shiftSick').checked = false;
    }

    const d = await postJson('/api/shifts', { date, name, start, end });
    if (d.success) {
        if (d.pending) showToast("Запит відправлено (Pending)", 'success');
        else showToast("Зміну додано");
        
        // Оновлюємо стейт
        state.shifts = await fetchJson('/api/shifts');
        renderAll();
    } else {
        showToast(d.message || "Помилка", 'error');
    }
}

export async function delS(id) {
    if (confirm("Видалити?")) {
        const d = await postJson('/api/delete-shift', { id });
        if (d.success) {
            showToast("Видалено");
            state.shifts = await fetchJson('/api/shifts');
            renderAll();
        } else showToast("Помилка видалення", 'error');
    }
}

export async function clearDay() {
    const d = document.getElementById('shiftDate').value;
    if (d && confirm(`Clean ${d}?`)) {
        await postJson('/api/shifts/clear-day', { date: d });
        showToast("День очищено");
        state.shifts = await fetchJson('/api/shifts');
        renderAll();
    }
}

export async function clearMonth() {
    const d = document.getElementById('shiftDate').value;
    if (!d) return showToast("Оберіть дату", 'error');
    if (confirm(`⚠️ ВИДАЛИТИ ВЕСЬ ГРАФІК за ${d.substring(0, 7)}?`)) {
        await postJson('/api/shifts/clear-month', { month: d.substring(0, 7) });
        state.shifts = await fetchJson('/api/shifts');
        renderAll();
        showToast("Місяць очищено");
    }
}

// --- TASKS ---

export function toggleTaskTimeInputs() {
    const c = document.getElementById('taskFullDay').checked;
    document.getElementById('taskTimeInputs').className = c ? 'hidden' : 'flex gap-3';
}

export async function addTask() {
    const title = document.getElementById('taskTitle').value;
    const date = document.getElementById('taskDate').value;
    const name = document.getElementById('taskEmployee').value;
    const description = document.getElementById('taskDescription').value; 
    const isFullDay = document.getElementById('taskFullDay').checked;
    const start = document.getElementById('taskStart').value;
    const end = document.getElementById('taskEnd').value;

    if (!title || !date || !name) return showToast("Заповніть дані", 'error');
    
    await postJson('/api/tasks', { title, date, name, description, isFullDay, start, end });
    
    showToast("Задачу призначено");
    
    document.getElementById('taskTitle').value = '';
    document.getElementById('taskDescription').value = '';

    state.tasks = await fetchJson('/api/tasks');
    renderAll();
}

export async function deleteTask(id) {
    if (confirm("Видалити задачу?")) {
        const d = await postJson('/api/tasks/delete', { id });
        if (d.success) {
            showToast("Задачу видалено");
            state.tasks = await fetchJson('/api/tasks');
            renderAll();
        } else showToast("Помилка", 'error');
    }
}

// --- IMPORT & NEWS ---

export async function bulkImport() {
    const raw = document.getElementById('importData').value;
    if (!raw) return showToast("Пусте поле", 'error');
    
    const rows = raw.trim().split('\n');
    const shifts = [];
    
    rows.forEach(row => {
        const parts = row.trim().split(/[\t, ]+/);
        if (parts.length < 3) return;
        
        const date = parts[0];
        const lastEl = parts[parts.length - 1].toLowerCase();
        
        if (lastEl.includes('відпустка') || lastEl.includes('vacation')) {
            const name = parts.slice(1, parts.length - 1).join(' ');
            shifts.push({ date, name, start: 'Відпустка', end: 'Відпустка' });
        } else if (lastEl.includes('лікарняний') || lastEl.includes('sick')) { // Додано імпорт лікарняних
            const name = parts.slice(1, parts.length - 1).join(' ');
            shifts.push({ date, name, start: 'Лікарняний', end: 'Лікарняний' });
        } else if (parts.length >= 4) {
            const start = parts[parts.length - 2];
            const end = parts[parts.length - 1];
            const name = parts.slice(1, parts.length - 2).join(' ');
            shifts.push({ date, name, start, end });
        }
    });

    if (!shifts.length) return showToast("Не розпізнано", 'error');

    if (confirm(`Завантажити ${shifts.length} змін?`)) {
        const d = await postJson('/api/shifts/bulk', { shifts });
        if (d.success) {
            document.getElementById('importData').value = '';
            state.shifts = await fetchJson('/api/shifts');
            renderAll();
            showToast("Імпорт успішний");
        } else showToast("Помилка імпорту", 'error');
    }
}

export async function publishNews() {
    const text = document.getElementById('newsText').value;
    const files = document.getElementById('newsFile').files;
    const requestRead = document.getElementById('newsRequestRead').checked;
    
    if (!text && files.length === 0) return showToast("Введіть текст або файл", 'error');
    
    const formData = new FormData();
    formData.append('text', text);
    formData.append('requestRead', requestRead);

    for (let i = 0; i < files.length; i++) {
        formData.append('media', files[i]);
    }
    
    const btn = document.querySelector('#adminTabNews button:last-child');
    btn.innerText = "⏳ Публікую...";
    btn.disabled = true;
    
    try {
        const res = await fetch('/api/news/publish', { method: 'POST', body: formData });
        if (res.ok) {
            showToast("✅ Опубліковано!");
            document.getElementById('newsText').value = '';
            document.getElementById('newsFile').value = '';
            document.getElementById('newsRequestRead').checked = true;
            updateFileName();
        } else showToast("Помилка публікації", 'error');
    } catch (e) {
        showToast("Помилка мережі", 'error');
    } finally {
        btn.innerText = "Опублікувати";
        btn.disabled = false;
    }
}

// --- GLOBAL ADMIN (STORES) ---

export async function createStore() {
    const name = document.getElementById('newStoreName').value.trim();
    const code = document.getElementById('newStoreCode').value.trim();
    const type = document.getElementById('newStoreType').value;

    if (!name || !code) return showToast("Заповніть назву та код", 'error');

    const res = await postJson('/api/admin/stores/create', { name, code, type });
    if (res.success) {
        showToast("Магазин створено ✅");
        document.getElementById('newStoreName').value = '';
        document.getElementById('newStoreCode').value = '';
        loadStores(); // Оновити список
    } else {
        showToast(res.message || "Помилка", 'error');
    }
}

export async function loadStores() {
    const list = document.getElementById('storesList');
    if (!list) return;

    list.innerHTML = '<div class="text-center text-gray-400">Завантаження...</div>';

    try {
        const stores = await fetchJson('/api/admin/stores');
        list.innerHTML = '';

        if (!stores.length) {
            list.innerHTML = '<div class="text-center text-gray-400">Немає магазинів</div>';
            return;
        }

        stores.forEach(s => {
            const item = document.createElement('div');
            item.className = "flex justify-between items-center bg-gray-50 dark:bg-black/20 p-2 rounded-lg border border-gray-200 dark:border-gray-700";
            item.innerHTML = `
                <div>
                    <div class="font-bold text-sm">${s.name}</div>
                    <div class="text-[10px] text-gray-500">${s.code} <span class="bg-blue-100 text-blue-800 px-1 rounded">${s.type}</span></div>
                </div>
                <button onclick=\"deleteStore('${s._id}')\" class=\"text-red-500 text-lg hover:scale-110 transition-transform\">🗑</button>
            `;
            list.appendChild(item);
        });
    } catch (e) {
        list.innerHTML = '<div class="text-center text-red-400">Помилка завантаження</div>';
    }
}

export async function deleteStore(id) {
    if(!confirm("Видалити цей магазин?")) return;
    const res = await postJson('/api/admin/stores/delete', { id });
    if(res.success) {
        showToast("Видалено");
        loadStores();
    } else {
        showToast(res.message, 'error');
    }
}