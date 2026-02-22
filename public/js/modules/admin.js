import { state } from './state.js';
import { fetchJson, postJson } from './api.js';
import { showToast, updateFileName } from './ui.js';
import { renderAll } from './render.js';

// --- SHIFTS (Залишено лише точкове видалення на випадок використання в List View) ---

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

// --- TASKS ---

export function toggleTaskTimeInputs() {
    const c = document.getElementById('taskFullDay').checked;
    document.getElementById('taskTimeInputs').className = c ? 'hidden' : 'flex gap-3';
}

export function openAddTaskModal() {
    triggerHaptic();
    document.getElementById('addTaskModal').classList.remove('hidden');
}

export function closeAddTaskModal() {
    triggerHaptic();
    document.getElementById('addTaskModal').classList.add('hidden');
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

    closeAddTaskModal();

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

export async function toggleTaskExecution(id) {
    triggerHaptic();
    const d = await postJson('/api/tasks/toggle', { id });
    if (d.success) {
        // Оновлюємо локальний стейт
        const task = state.tasks.find(t => t._id === id);
        if (task) {
            task.status = d.status;
            renderAll();

            // Якщо модалка задачі відкрита - оновимо її теж
            const modal = document.getElementById('taskDetailsModal');
            if (modal && !modal.classList.contains('hidden')) {
                window.openTaskProxy(id);
            }
        }
    } else {
        showToast("Помилка", 'error');
    }
}

// --- NEWS ---

export function openAddNewsModal() {
    triggerHaptic();
    document.getElementById('addNewsModal').classList.remove('hidden');
}

export function closeAddNewsModal() {
    triggerHaptic();
    document.getElementById('addNewsModal').classList.add('hidden');
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
            closeAddNewsModal();
        } else showToast("Помилка публікації", 'error');
    } catch (e) {
        showToast("Помилка мережі", 'error');
    } finally {
        btn.innerText = "Опублікувати";
        btn.disabled = false;
    }
}

// --- GLOBAL ADMIN (STORES & SALARY) ---

export function openAddStoreModal() {
    triggerHaptic();
    document.getElementById('addStoreModal').classList.remove('hidden');
}

export function closeAddStoreModal() {
    triggerHaptic();
    document.getElementById('addStoreModal').classList.add('hidden');
}

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
        closeAddStoreModal();
        loadStores();
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
    if (!confirm("Видалити цей магазин?")) return;
    const res = await postJson('/api/admin/stores/delete', { id });
    if (res.success) {
        showToast("Видалено");
        loadStores();
    } else {
        showToast(res.message, 'error');
    }
}

// 🔥 ВІДМАЛЬОВКА ТА ЗБЕРЕЖЕННЯ ЗАРПЛАТНОЇ МАТРИЦІ
export async function renderSalaryMatrix() {
    const container = document.getElementById('salaryMatrixContainer');
    const storeType = document.getElementById('salaryStoreType').value;
    if (!container) return;

    container.innerHTML = '<div class="text-center text-gray-400 text-xs py-2">Завантаження...</div>';

    try {
        const matrixData = await fetchJson('/api/admin/salary-matrix');
        container.innerHTML = '';

        // 🔥 ВИПРАВЛЕНО: Правильні наскрізні грейди для кожної посади + прибрали RRP
        const matrixStructure = [
            { pos: 'SM', grades: [7, 8, 9] },
            { pos: 'SSE', grades: [5, 6] },
            { pos: 'SE', grades: [2, 3, 4] }
        ];

        matrixStructure.forEach(group => {
            const groupDiv = document.createElement('div');
            groupDiv.className = 'mb-3 bg-gray-50 dark:bg-[#1C1C1E] p-3 rounded-lg border border-gray-200 dark:border-gray-600';
            groupDiv.innerHTML = `<div class="font-bold text-sm mb-2 text-indigo-500">${group.pos}</div>`;

            group.grades.forEach(grade => {
                const existing = matrixData.find(m => m.storeType === storeType && m.position === group.pos && m.grade === grade);
                const rateValue = existing ? existing.rate : 0;

                const row = document.createElement('div');
                row.className = 'flex items-center justify-between mb-2 last:mb-0';
                row.innerHTML = `
                    <span class="text-xs font-medium text-gray-500 w-16">Grade ${grade}</span>
                    <div class="relative flex-1 ml-2">
                        <input type="number" data-pos="${group.pos}" data-grade="${grade}" value="${rateValue}" class="salary-rate-input ios-input w-full text-right pr-6 h-8 text-sm font-bold" placeholder="0">
                        <span class="absolute right-2 top-1.5 text-xs text-gray-400">₴</span>
                    </div>
                `;
                groupDiv.appendChild(row);
            });
            container.appendChild(groupDiv);
        });

    } catch (e) {
        container.innerHTML = '<div class="text-center text-red-400 text-xs">Помилка завантаження</div>';
    }
}

export async function saveSalaryMatrixBtn() {
    const storeType = document.getElementById('salaryStoreType').value;
    const inputs = document.querySelectorAll('.salary-rate-input');
    const matrix = [];

    inputs.forEach(inp => {
        const position = inp.getAttribute('data-pos');
        const grade = parseInt(inp.getAttribute('data-grade'));
        const rate = parseFloat(inp.value) || 0;

        matrix.push({ storeType, position, grade, rate });
    });

    const btn = document.querySelector('button[onclick="saveSalaryMatrixBtn()"]');
    const origText = btn.innerText;
    btn.innerText = '⏳ Збереження...';
    btn.disabled = true;

    try {
        const res = await postJson('/api/admin/salary-matrix', { matrix });
        if (res.success) {
            showToast("Ставки успішно збережено! ✅");
        } else {
            showToast(res.message || "Помилка збереження", 'error');
        }
    } catch (e) {
        showToast("Помилка мережі", 'error');
    } finally {
        btn.innerText = origText;
        btn.disabled = false;
    }
}