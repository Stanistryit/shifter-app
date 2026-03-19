import { state } from './state.js';
import { fetchJson, postJson } from './api.js';
import { showToast, updateFileName } from './ui.js';
import { renderAll } from './render.js';

// --- SHIFTS (Залишено лише точкове видалення на випадок використання в List View) ---

export async function delS(id) {
    if (confirm("Видалити?")) {
        triggerHaptic('warning', 'notification');
        const d = await postJson('/api/delete-shift', { id });
        if (d.success) {
            triggerHaptic('heavy', 'impact');
            showToast("Видалено");
            state.shifts = await fetchJson('/api/shifts');
            renderAll();
        } else {
            triggerHaptic('error', 'notification');
            showToast("Помилка видалення", 'error');
        }
    }
}

// --- TASKS ---

let tempSubtasks = [];

export function toggleTaskTimeInputs() {
    const c = document.getElementById('taskFullDay').checked;
    document.getElementById('taskTimeInputs').className = c ? 'hidden' : 'flex gap-3';
}

export function toggleTaskTypeUI(type) {
    document.getElementById('taskTypeInput').value = type;
    
    const tLineBtn = document.getElementById('taskTypeTimelineBtn');
    const tTodoBtn = document.getElementById('taskTypeTodoBtn');
    const tLineFields = document.getElementById('taskTimelineFields');
    const tTodoFields = document.getElementById('taskTodoFields');

    if (type === 'timeline') {
        tLineBtn.className = "flex-1 py-1.5 text-sm font-bold bg-white dark:bg-[#2C2C2E] shadow-sm rounded-lg transition-all";
        tTodoBtn.className = "flex-1 py-1.5 text-sm font-bold text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 transition-all rounded-lg";
        tLineFields.classList.remove('hidden');
        tTodoFields.classList.add('hidden');
    } else {
        tTodoBtn.className = "flex-1 py-1.5 text-sm font-bold bg-white dark:bg-[#2C2C2E] shadow-sm rounded-lg transition-all";
        tLineBtn.className = "flex-1 py-1.5 text-sm font-bold text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 transition-all rounded-lg";
        tTodoFields.classList.remove('hidden');
        tLineFields.classList.add('hidden');
    }
}

export function addSubtaskToBuilder() {
    triggerHaptic();
    const input = document.getElementById('newSubtaskInput');
    const title = input.value.trim();
    if (!title) return;
    
    tempSubtasks.push({ title, completed: false });
    input.value = '';
    renderSubtasksBuilder();
}

export function removeSubtaskFromBuilder(index) {
    triggerHaptic();
    tempSubtasks.splice(index, 1);
    renderSubtasksBuilder();
}

function renderSubtasksBuilder() {
    const list = document.getElementById('subtasksBuilderList');
    if (!list) return;
    list.innerHTML = '';
    tempSubtasks.forEach((st, i) => {
        list.insertAdjacentHTML('beforeend', `
            <div class="flex items-center justify-between text-sm bg-gray-50 dark:bg-[#2C2C2E] p-2 rounded-lg">
                <span class="truncate pr-2">${st.title}</span>
                <button onclick="window.removeSubtaskFromBuilder(${i})" class="text-red-500 font-bold px-2 py-0.5 bg-red-100 dark:bg-red-900/30 rounded active:scale-95 transition-transform">✕</button>
            </div>
        `);
    });
}

export function openAddTaskModal() {
    triggerHaptic();
    document.getElementById('editTaskId').value = '';
    document.getElementById('addTaskModalTitle').innerText = '📌 Нова задача';
    document.getElementById('taskTitle').value = '';
    document.getElementById('taskDescription').value = '';
    document.getElementById('taskDeadline').value = '';
    
    Array.from(document.querySelectorAll('.task-reminder-cb')).forEach(cb => cb.checked = false);

    tempSubtasks = [];
    renderSubtasksBuilder();
    toggleTaskTypeUI('timeline');
    
    document.getElementById('taskFullDay').checked = false;
    toggleTaskTimeInputs();
    
    document.getElementById('addTaskModal').classList.remove('hidden');
}

export function closeAddTaskModal() {
    triggerHaptic();
    document.getElementById('addTaskModal').classList.add('hidden');
}

export async function submitTaskModal() {
    const editId = document.getElementById('editTaskId').value;
    const type = document.getElementById('taskTypeInput').value;
    
    const title = document.getElementById('taskTitle').value.trim();
    const name = document.getElementById('taskEmployee').value;
    const description = document.getElementById('taskDescription').value.trim();
    const subtasks = tempSubtasks;

    if (!title || !name) {
        triggerHaptic('error', 'notification');
        return showToast("Введіть назву та оберіть співробітника", 'error');
    }

    let payload = { title, name, description, type, subtasks };

    if (type === 'timeline') {
        const date = document.getElementById('taskDate').value;
        const isFullDay = document.getElementById('taskFullDay').checked;
        const start = document.getElementById('taskStart').value;
        const end = document.getElementById('taskEnd').value;
        if (!date) return showToast("Оберіть дату", 'error');
        payload = { ...payload, date, isFullDay, start, end };
    } else {
        const deadline = document.getElementById('taskDeadline').value;
        if (!deadline) {
            triggerHaptic('error', 'notification');
            return showToast("Оберіть дедлайн", 'error');
        }
        
        const container = document.getElementById('taskRemindersContainer');
        const cbs = container.querySelectorAll('.task-reminder-cb:checked');
        const reminders = Array.from(cbs).map(cb => cb.value);

        const date = new Date().toISOString().split('T')[0];
        payload = { ...payload, date, deadline, reminders };
    }

    const btn = document.getElementById('btnSaveTaskModal');
    const oldText = btn.innerText;
    btn.innerText = '⏳ Збереження...';
    btn.disabled = true;

    try {
        if (editId) {
            payload.id = editId;
            const res = await postJson('/api/tasks/edit', payload);
            if (res.success) showToast("Збережено");
            else return showToast("Помилка", 'error');
        } else {
            const res = await postJson('/api/tasks', payload);
            if (res.success) showToast("Створено");
            else return showToast("Помилка", 'error');
        }

        triggerHaptic('success', 'notification');
        closeAddTaskModal();
        state.tasks = await fetchJson('/api/tasks');
        renderAll();
        
        if (state.currentMode === 'todo') {
            import('./render_todo.js').then(m => m.renderTodo());
        }
    } catch(e) {
        showToast("Помилка з'єднання", 'error');
    } finally {
        btn.innerText = oldText;
        btn.disabled = false;
    }
}


export async function deleteTask(id) {
    if (confirm("Видалити задачу?")) {
        triggerHaptic('warning', 'notification');
        const d = await postJson('/api/tasks/delete', { id });
        if (d.success) {
            triggerHaptic('heavy', 'impact');
            showToast("Задачу видалено");
            state.tasks = await fetchJson('/api/tasks');
            renderAll();
        } else {
            triggerHaptic('error', 'notification');
            showToast("Помилка", 'error');
        }
    }
}

export async function toggleTaskExecution(id) {
    triggerHaptic('light', 'impact');
    const d = await postJson('/api/tasks/toggle', { id });
    if (d.success) {
        // Оновлюємо локальний стейт
        const task = state.tasks.find(t => t._id === id);
        if (task) {
            if (d.status === 'completed') {
                triggerHaptic('success', 'notification');
            } else {
                triggerHaptic('light', 'impact');
            }
            task.status = d.status;
            renderAll();

            // Якщо модалка задачі відкрита - оновимо її теж
            const modal = document.getElementById('taskDetailsModal');
            if (modal && !modal.classList.contains('hidden')) {
                window.openTaskProxy(id);
            }
        }
    } else {
        triggerHaptic('error', 'notification');
        showToast("Помилка", 'error');
    }
}

export async function toggleSubtask(taskId, subtaskId) {
    triggerHaptic();
    const res = await postJson('/api/tasks/toggle', { 
        id: taskId,
        subtaskId: subtaskId 
    });
    
    if (res.success) {
        const task = state.tasks.find(t => t._id === taskId);
        if (task) {
            const st = task.subtasks.find(x => x._id === subtaskId);
            if (st) st.completed = res.subtaskStatus;
            
            if (res.taskStatus) {
                task.status = res.taskStatus;
                // Update the button inside modal if it's open
                const btnToggle = document.getElementById('btnToggleTaskStatus');
                if (btnToggle) {
                    if (task.status === 'completed') {
                        btnToggle.innerHTML = '⏳ Повернути в роботу';
                        btnToggle.className = 'w-full py-3 text-white font-bold bg-orange-500 rounded-xl active:scale-95 transition-transform mb-2 shadow-sm shadow-orange-500/30';
                    } else {
                        btnToggle.innerHTML = '✅ Відмітити як виконану';
                        btnToggle.className = 'w-full py-3 text-white font-bold bg-green-500 rounded-xl active:scale-95 transition-transform mb-2 shadow-sm shadow-green-500/30';
                    }
                }
            }
            
            renderAll();
            if (state.currentMode === 'todo') {
                import('./render_todo.js').then(m => m.renderTodo());
            }
            
            const subTitle = st ? (st.completed ? 'Відмічено!' : 'Знято!') : '';
            triggerHaptic('success', 'notification');
        }
    } else {
        triggerHaptic('error', 'notification');
        showToast("Помилка", 'error');
    }
}

export async function forceRemindTask(taskId, btn, origText) {
    triggerHaptic();
    const res = await postJson('/api/tasks/force-remind', { id: taskId });
    if (res.success) {
        showToast("Нагадування відправлено ✅");
        triggerHaptic('success', 'notification');
    } else {
        showToast("Помилка відправки", 'error');
        triggerHaptic('error', 'notification');
    }
    btn.innerHTML = origText;
}

export function openEditTaskModal(task) {
    triggerHaptic();
    document.getElementById('editTaskId').value = task._id;
    document.getElementById('addTaskModalTitle').innerText = '✏️ Редагування задачі';
    document.getElementById('taskTitle').value = task.title || '';
    document.getElementById('taskDescription').value = task.description || '';
    document.getElementById('taskEmployee').value = task.name || '';
    
    toggleTaskTypeUI(task.type || 'timeline');
    
    if (task.type === 'timeline' || !task.type) {
        document.getElementById('taskDate').value = task.date || '';
        document.getElementById('taskFullDay').checked = task.isFullDay || false;
        document.getElementById('taskStart').value = task.start || '10:00';
        document.getElementById('taskEnd').value = task.end || '18:00';
        toggleTaskTimeInputs();
    } else {
        document.getElementById('taskDeadline').value = task.deadline ? new Date(task.deadline).toISOString().slice(0, 16) : '';
        Array.from(document.querySelectorAll('.task-reminder-cb')).forEach(cb => {
             cb.checked = (task.reminders && task.reminders.includes(cb.value));
        });
    }

    tempSubtasks = task.subtasks ? JSON.parse(JSON.stringify(task.subtasks)) : [];
    renderSubtasksBuilder();

    document.getElementById('addTaskModal').classList.remove('hidden');
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

    const btn = document.querySelector('#addNewsModal button[onclick="publishNews()"]');
    if (btn) {
        btn.innerText = "⏳ Публікую...";
        btn.disabled = true;
    }

    try {
        const res = await fetch('/api/news/publish', { method: 'POST', body: formData });
        const data = await res.json();
        if (res.ok && data.success) {
            showToast("✅ Опубліковано!");
            document.getElementById('newsText').value = '';
            document.getElementById('newsFile').value = '';
            document.getElementById('newsRequestRead').checked = true;
            updateFileName();
            closeAddNewsModal();
        } else {
            // Показуємо реальне повідомлення про помилку з сервера
            showToast(data.message || "Помилка публікації", 'error');
            console.error("News publish error:", data.message);
        }
    } catch (e) {
        showToast("Помилка мережі", 'error');
        console.error("News publish network error:", e);
    } finally {
        if (btn) {
            btn.innerText = "Опублікувати";
            btn.disabled = false;
        }
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