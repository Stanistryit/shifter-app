import { fetchJson, postJson } from './api.js';
import { showToast } from './ui.js';
import { loadData } from './auth.js';
import { renderAll } from './render.js';

export async function loadRequests() {
    // Перевіряємо, чи існує контейнер (щоб не було помилок, якщо юзер не адмін)
    const c = document.getElementById('requestsList');
    if (!c) return;

    const requests = await fetchJson('/api/requests');
    c.innerHTML = '';
    
    if (!requests.length || requests.length === 0) {
        c.innerHTML = '<p class="text-gray-400 text-xs text-center">Пусто</p>';
        return;
    }

    requests.forEach(q => {
        c.innerHTML += `
            <div class="bg-gray-50 dark:bg-gray-700 p-2 rounded text-xs flex justify-between items-center">
                <span><b>${q.type}:</b> ${q.createdBy}</span>
                <div class="flex gap-2">
                    <button onclick="window.handleRequest('${q._id}','approve')" class="text-green-600 hover:bg-green-100 dark:hover:bg-green-900/30 p-1 rounded transition-colors">✅</button>
                    <button onclick="window.handleRequest('${q._id}','reject')" class="text-red-600 hover:bg-red-100 dark:hover:bg-red-900/30 p-1 rounded transition-colors">❌</button>
                </div>
            </div>`;
    });
}

export async function handleRequest(id, action) {
    const res = await postJson('/api/requests/action', { id, action });
    
    if (res.success) {
        showToast(action === 'approve' ? "Схвалено" : "Відхилено");
        
        // Оновлюємо список запитів
        loadRequests();
        
        // Оновлюємо основні дані (зміни/задачі), бо вони могли змінитись
        await loadData();
        renderAll();
    } else {
        showToast("Помилка обробки", 'error');
    }
}

export async function approveAllRequests() {
    if (confirm("Схвалити всі запити?")) {
        const res = await postJson('/api/requests/approve-all', {});
        
        if (res.success) {
            showToast("Всі схвалено");
            loadRequests();
            await loadData();
            renderAll();
        } else {
            showToast("Помилка", 'error');
        }
    }
}