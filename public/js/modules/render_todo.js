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
    
    // Фільтруємо задачі
    let todoTasks = state.tasks.filter(t => t.type === 'todo');

    if (isManager) {
        adminView.classList.remove('hidden');
        
        const grouped = {};
        todoTasks.forEach(t => {
            if (!grouped[t.name]) grouped[t.name] = [];
            grouped[t.name].push(t);
        });

        if (Object.keys(grouped).length === 0) {
            adminView.innerHTML = '<div class="text-center text-gray-400 py-10">Тут поки пусто 🌵</div>';
            return;
        }

        for (const [user, tasks] of Object.entries(grouped)) {
            // Sort to put completed at the bottom
            tasks.sort((a,b) => (a.status === 'completed' ? 1 : 0) - (b.status === 'completed' ? 1 : 0));

            let userHtml = `
            <div class="ios-card p-4">
                <h3 class="font-bold text-lg mb-3 flex items-center gap-2">👤 ${user} <span class="bg-gray-200 dark:bg-gray-700 text-xs px-2 py-0.5 rounded-full">${tasks.length}</span></h3>
                <div class="space-y-2">
            `;
            
            tasks.forEach(t => {
                userHtml += buildTodoCard(t);
            });
            
            userHtml += `</div></div>`;
            adminView.insertAdjacentHTML('beforeend', userHtml);
        }
    } else {
        employeeView.classList.remove('hidden');
        const myTasks = todoTasks.filter(t => t.name === state.currentUser?.name);
        
        myTasks.sort((a,b) => (a.status === 'completed' ? 1 : 0) - (b.status === 'completed' ? 1 : 0));

        if (myTasks.length === 0) {
            employeeList.innerHTML = '<div class="text-center text-gray-400 py-10 bg-white/50 dark:bg-gray-800/50 rounded-xl">Немає активних задач 🎉</div>';
            return;
        }
        
        myTasks.forEach(t => {
            employeeList.insertAdjacentHTML('beforeend', buildTodoCard(t));
        });
    }
}

function buildTodoCard(t) {
    const isCompleted = t.status === 'completed';
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

    const deadInfo = t.deadline ? `<div class="text-xs ${isCompleted ? 'text-gray-400' : 'text-red-500 font-medium'} mt-1 flex items-center gap-1">⏳ Дедлайн: ${new Date(t.deadline).toLocaleString('uk-UA', {day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'})}</div>` : '';

    return `
    <div onclick="window.openTaskProxy('${t._id}')" class="relative overflow-hidden cursor-pointer bg-white dark:bg-[#2C2C2E] border ${isCompleted ? 'border-green-200 dark:border-green-900/30 opacity-70' : 'border-gray-100 dark:border-gray-800'} rounded-xl p-3 shadow-sm hover:shadow-md transition-all active:scale-[0.98]">
        ${isCompleted ? '<div class="absolute top-0 right-0 w-8 h-8 bg-green-500 rounded-bl-xl flex items-center justify-center text-white text-xs font-bold shadow-sm">✓</div>' : ''}
        <h4 class="font-bold text-gray-900 dark:text-white mb-1 ${isCompleted ? 'line-through text-gray-500' : ''} pr-6">${t.title}</h4>
        ${t.description ? `<p class="text-xs text-gray-500 line-clamp-2 mb-1">${t.description}</p>` : ''}
        ${subInfo}
        ${recurInfo}
        ${deadInfo}
    </div>
    `;
}
