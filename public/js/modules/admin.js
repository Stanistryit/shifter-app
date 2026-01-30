import { state } from './state.js';
import { fetchJson, postJson } from './api.js';
import { showToast, updateFileName } from './ui.js';
import { renderAll } from './render.js';

// --- SHIFTS ---

export function toggleShiftTimeInputs() {
    const c = document.getElementById('shiftVacation').checked;
    document.getElementById('shiftTimeInputs').className = c ? 'hidden' : 'flex gap-3';
}

export async function addShift() {
    const date = document.getElementById('shiftDate').value;
    const name = document.getElementById('employeeSelect').value;
    const isVacation = document.getElementById('shiftVacation').checked;
    let start, end;

    if (isVacation) {
        start = 'Відпустка';
        end = 'Відпустка';
    } else {
        start = document.getElementById('startTime').value;
        end = document.getElementById('endTime').value;
    }

    if (!date || !name) return showToast("Заповніть всі дані", 'error');

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
    const description = document.getElementById('taskDescription').value; // НОВЕ: Опис
    const isFullDay = document.getElementById('taskFullDay').checked;
    const start = document.getElementById('taskStart').value;
    const end = document.getElementById('taskEnd').value;

    if (!title || !date || !name) return showToast("Заповніть дані", 'error');
    
    // Передаємо description на сервер
    await postJson('/api/tasks', { title, date, name, description, isFullDay, start, end });
    
    showToast("Задачу призначено");
    
    // Очищуємо поля для зручності
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
    
    if (!text && files.length === 0) return showToast("Введіть текст або файл", 'error');
    
    const formData = new FormData();
    formData.append('text', text);
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
            updateFileName();
        } else showToast("Помилка публікації", 'error');
    } catch (e) {
        showToast("Помилка мережі", 'error');
    } finally {
        btn.innerText = "Опублікувати";
        btn.disabled = false;
    }
}