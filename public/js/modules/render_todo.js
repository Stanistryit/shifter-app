import { state } from './state.js';

export function renderTodo() {
    const adminView = document.getElementById('todoAdminView');
    const employeeView = document.getElementById('todoEmployeeView');
    const employeeList = document.getElementById('todoEmployeeList');

    if (!adminView || !employeeView || !employeeList) return;

    adminView.innerHTML = '';
    employeeList.innerHTML = '';
    adminView.classList.add('hidden');
    employeeView.classList.add('hidden');

    const isManager = state.currentUser?.role === 'SM' || state.currentUser?.role === 'admin';
    const hideCompleted = document.getElementById('taskFilterHideCompleted')?.checked;
    
    // Всі задачі (прибираємо фільтр t.type === 'todo')
    let tasks = [...state.tasks];

    // Фільтр "Приховати виконані"
    if (hideCompleted) {
        tasks = tasks.filter(t => t.status !== 'completed');
    }

    if (isManager) {
        adminView.classList.remove('hidden');
        
        // Показуємо селект вибору співробітника для SM
        const empFilterContainer = document.getElementById('taskFilterEmployeeContainer');
        const empSelect = document.getElementById('taskFilterEmployee');
        if (empFilterContainer) empFilterContainer.classList.remove('hidden');
        
        // Populate select if empty (only 'all' exists)
        if (empSelect && empSelect.options.length <= 1) {
            const uniqueUsers = [...new Set(state.tasks.map(t => t.name))].filter(Boolean).sort();
            uniqueUsers.forEach(u => {
                const opt = document.createElement('option');
                opt.value = u;
                opt.textContent = u;
                empSelect.appendChild(opt);
            });
        }
        
        const selectedEmp = empSelect?.value || 'all';

        // Групування по співробітниках
        const grouped = {};
        tasks.forEach(t => {
            if (!t.name) return; // Пропускаємо задачі без виконавця
            if (selectedEmp !== 'all' && t.name !== selectedEmp) return;
            
            if (!grouped[t.name]) grouped[t.name] = [];
            grouped[t.name].push(t);
        });

        if (Object.keys(grouped).length === 0) {
            adminView.innerHTML = '<div class="text-center text-gray-400 py-10">Тут поки пусто 🌵</div>';
            return;
        }

        for (const [user, userTasks] of Object.entries(grouped)) {
            sortTasks(userTasks);

            let userHtml = `
            <div class="ios-card p-4">
                <h3 class="font-bold text-lg mb-3 flex items-center gap-2">👤 ${user} <span class="bg-gray-200 dark:bg-gray-700 text-xs px-2 py-0.5 rounded-full">${userTasks.length}</span></h3>
                <div class="space-y-2">
            `;
            
            userTasks.forEach(t => {
                userHtml += buildTodoCard(t);
            });
            
            userHtml += `</div></div>`;
            adminView.insertAdjacentHTML('beforeend', userHtml);
        }
    } else {
        employeeView.classList.remove('hidden');
        const empFilterContainer = document.getElementById('taskFilterEmployeeContainer');
        if (empFilterContainer) empFilterContainer.classList.add('hidden');

        const myTasks = tasks.filter(t => t.name === state.currentUser?.name);
        
        sortTasks(myTasks);

        if (myTasks.length === 0) {
            employeeList.innerHTML = '<div class="text-center text-gray-400 py-10 bg-white/50 dark:bg-gray-800/50 rounded-xl">Немає активних задач 🎉</div>';
            return;
        }
        
        myTasks.forEach(t => {
            employeeList.insertAdjacentHTML('beforeend', buildTodoCard(t));
        });
    }
}

function sortTasks(tasksList) {
    tasksList.sort((a, b) => {
        const aComp = a.status === 'completed';
        const bComp = b.status === 'completed';
        
        // 1. Невиконані вище
        if (aComp !== bComp) return aComp ? 1 : -1;
        
        // 2. Порівняння за дедлайном або датою/часом
        const getTaskTime = (t) => {
            if (t.type === 'timeline') {
                if (!t.date) return Infinity;
                const timeStr = t.start || '00:00';
                return new Date(`${t.date}T${timeStr}`).getTime();
            } else {
                return t.deadline ? new Date(t.deadline).getTime() : Infinity;
            }
        };

        const timeA = getTaskTime(a);
        const timeB = getTaskTime(b);

        return timeA - timeB; // Ближчі (менший час) вище
    });
}

function buildTodoCard(t) {
    const isCompleted = t.status === 'completed';
    const reqComp = t.requireCompletion !== false;
    let subInfo = '';
    if (t.subtasks && t.subtasks.length > 0) {
        const comp = t.subtasks.filter(s => s.completed).length;
        const total = t.subtasks.length;
        subInfo = `<div class="text-xs text-gray-500 mt-1 flex items-center gap-1">📋 Підзадачі: ${comp}/${total}</div>`;
    }

    const recurLabels = { weekly: 'Щотижня', monthly: 'Щомісяця', yearly: 'Щороку' };
    const recurInfo = (t.recurrence && t.recurrence !== 'none')
        ? `<div class="text-xs text-purple-500 font-medium mt-1 flex items-center gap-1">🔁 ${recurLabels[t.recurrence] || t.recurrence}</div>`
        : '';

    let timeInfo = '';
    if (t.type === 'timeline') {
        if (t.date) {
            const dateStr = t.date.split('-').reverse().join('.'); // DD.MM.YYYY
            const timeStr = (t.start && t.end) ? ` | ${t.start} - ${t.end}` : (t.start ? ` | ${t.start}` : '');
            timeInfo = `<div class="text-xs ${isCompleted && reqComp ? 'text-gray-400' : 'text-blue-500 font-medium'} mt-1 flex items-center gap-1">📅 ${dateStr}${timeStr}</div>`;
        }
    } else {
        timeInfo = t.deadline ? `<div class="text-xs ${isCompleted && reqComp ? 'text-gray-400' : 'text-red-500 font-medium'} mt-1 flex items-center gap-1">⏳ Дедлайн: ${new Date(t.deadline).toLocaleString('uk-UA', {year: 'numeric', day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'})}</div>` : '';
    }

    // Type indicator
    const typeIndicator = t.type === 'timeline' ? '🕒' : '📝';

    return `
    <div onclick="window.openTaskProxy('${t._id}')" class="relative overflow-hidden cursor-pointer bg-white dark:bg-[#2C2C2E] border ${isCompleted && reqComp ? 'border-green-200 dark:border-green-900/30 opacity-70' : 'border-gray-100 dark:border-gray-800'} rounded-xl p-3 shadow-sm hover:shadow-md transition-all active:scale-[0.98]">
        ${isCompleted && reqComp ? '<div class="absolute top-0 right-0 w-8 h-8 bg-green-500 rounded-bl-xl flex items-center justify-center text-white text-xs font-bold shadow-sm">✓</div>' : ''}
        <h4 class="font-bold text-gray-900 dark:text-white mb-1 ${isCompleted && reqComp ? 'line-through text-gray-500' : ''} pr-6"><span class="text-xs opacity-70 mr-1">${typeIndicator}</span>${t.title}</h4>
        ${t.description ? `<p class="text-xs text-gray-500 line-clamp-2 mb-1">${t.description}</p>` : ''}
        ${subInfo}
        ${recurInfo}
        ${timeInfo}
    </div>
    `;
}

// Proxy for UI elements to trigger re-render
window.renderTodoProxy = () => {
    if (window.triggerHaptic) window.triggerHaptic('light');
    renderTodo();
};
