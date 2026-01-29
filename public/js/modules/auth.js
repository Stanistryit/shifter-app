import { state } from './state.js';
import { fetchJson, postJson } from './api.js';
import { showToast, triggerHaptic, showAdminTab } from './ui.js';
import { renderAll } from './render.js';

const tg = window.Telegram.WebApp;

export async function checkAuth() {
    try {
        const data = await fetchJson('/api/me');
        if (data.loggedIn) { 
            showApp(data.user); 
            return; 
        }
    } catch (e) {}

    // Якщо це Telegram WebApp
    if (!tg.initDataUnsafe?.user?.id) {
        document.getElementById('skeletonLoader').classList.add('hidden');
        document.getElementById('loginScreen').classList.remove('hidden');
        return;
    }
    
    // Автоматичний логін через Telegram ID
    const data = await postJson('/api/login-telegram', { telegramId: tg.initDataUnsafe.user.id });
    if (data.success) {
        showApp(data.user);
    } else {
        document.getElementById('skeletonLoader').classList.add('hidden');
        document.getElementById('loginScreen').classList.remove('hidden');
    }
}

export async function login() {
    triggerHaptic();
    const u = document.getElementById('loginUser').value;
    const p = document.getElementById('loginPass').value;
    const data = await postJson('/api/login', { username: u, password: p });
    if (data.success) showApp(data.user);
    else showToast(data.message || "Помилка входу", 'error');
}

export async function logout() {
    await postJson('/api/logout');
    window.location.reload();
}

// Внутрішня функція ініціалізації інтерфейсу після входу
async function showApp(user) {
    state.currentUser = user;
    
    // Ховаємо логін, показуємо додаток
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('skeletonLoader').classList.add('hidden');
    const app = document.getElementById('appScreen');
    app.classList.remove('hidden');
    
    // Анімація появи
    setTimeout(() => app.classList.remove('opacity-0'), 50);

    // Відображення імені та аватарки
    const parts = user.name.split(' ');
    document.getElementById('userNameDisplay').innerText = `Привіт, ${parts.length > 1 ? parts[1] : parts[0]}`;
    
    if(user.avatar) {
        document.getElementById('userAvatarImg').src = user.avatar;
        document.getElementById('userAvatarImg').classList.remove('hidden');
        document.getElementById('userAvatarPlaceholder').classList.add('hidden');
    }

    // Ролі та адмінські кнопки
    if (['admin', 'SM', 'SSE', 'RRP'].includes(user.role)) {
        if(user.role !== 'RRP') {
            document.getElementById('toggleEditWrapper').classList.remove('hidden');
        }
        
        if (['SM', 'admin'].includes(user.role)) {
            document.getElementById('btnTabRequests').classList.remove('hidden');
            document.getElementById('btnTabRequests').classList.add('flex');
            
            // Завантажуємо запити (якщо модуль requests.js вже підключений)
            if (window.loadRequests) window.loadRequests();
        }
        
        if (user.role === 'SM' || user.role === 'admin') {
            document.getElementById('noteTypeToggle').classList.remove('hidden');
            document.getElementById('noteTypeToggle').classList.add('flex');
        }
        
        showAdminTab('shifts');
    }
    
    // Завантаження всіх даних
    await loadData();
    
    // Перший рендер графіку
    renderAll();
}

// Експортуємо loadData, щоб інші модулі могли оновлювати дані (наприклад, після імпорту)
export async function loadData() {
    const [users, shifts, tasks, notes] = await Promise.all([
        fetchJson('/api/users'),
        fetchJson('/api/shifts'),
        fetchJson('/api/tasks'),
        fetchJson('/api/notes')
    ]);

    // Фільтруємо системних юзерів
    state.users = users.filter(u => u.role !== 'admin' && u.role !== 'RRP');
    state.shifts = shifts;
    state.tasks = tasks;
    state.notes = notes;
    
    // Оновлюємо випадаючі списки в адмінці
    const s1 = document.getElementById('employeeSelect');
    const s2 = document.getElementById('taskEmployee');
    
    // Зберігаємо поточний вибір, якщо він був
    const s1Val = s1.value;
    const s2Val = s2.value;

    s1.innerHTML = '<option disabled selected>Хто?</option>';
    s2.innerHTML = '<option disabled selected>Кому?</option><option value="all">📢 Всім</option>';
    
    state.users.forEach(x => {
        s1.innerHTML += `<option value="${x.name}">${x.name}</option>`;
        s2.innerHTML += `<option value="${x.name}">${x.name}</option>`;
    });

    // Відновлюємо вибір (якщо це можливо)
    if (s1Val && s1Val !== 'Хто?') s1.value = s1Val;
    if (s2Val && s2Val !== 'Кому?') s2.value = s2Val;
}