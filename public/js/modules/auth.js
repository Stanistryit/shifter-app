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
    } catch (e) { }

    // Перевіряємо, чи є в URL параметр '?reset=TOKEN'
    const params = new URLSearchParams(window.location.search);
    const resetToken = params.get('reset');
    const resetUserId = params.get('user');

    if (resetToken && resetUserId) {
        document.getElementById('skeletonLoader').classList.add('hidden');
        document.getElementById('loginScreen').classList.remove('hidden');

        // Ховаємо логін, показуємо скидання
        document.getElementById('loginContainer').classList.add('hidden');
        document.getElementById('registerContainer').classList.add('hidden');
        document.getElementById('forgotPasswordContainer').classList.add('hidden');

        document.getElementById('resetPasswordContainer').classList.remove('hidden');
        document.getElementById('resetToken').value = resetToken;
        document.getElementById('resetUserId').value = resetUserId;
        return;
    }

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

    // Передаємо telegramId, якщо ми знаходимось в середині Telegram WebApp
    const tId = window.Telegram?.WebApp?.initDataUnsafe?.user?.id || null;

    const data = await postJson('/api/login', { username: u, password: p, telegramId: tId });
    if (data.success) showApp(data.user);
    else showToast(data.message || "Помилка входу", 'error');
}

export async function logout() {
    await postJson('/api/logout');
    // Очищаємо можливі параметри з URL (щоб не відкривався reset)
    window.location.href = window.location.pathname;
}

export async function requestPasswordReset() {
    triggerHaptic();
    const u = document.getElementById('forgotUsername').value.trim();
    if (!u) return showToast('Введіть логін', 'error');

    const btn = document.querySelector('#forgotPasswordContainer button');
    const origText = btn.innerText;
    btn.innerText = 'Відправка...';
    btn.disabled = true;

    try {
        const data = await postJson('/api/forgot-password', { username: u });
        if (data.success) {
            showToast('Інструкції відправлено в Telegram! 🔐', 'info');
            // Переходимо назад на логін
            document.getElementById('forgotUsername').value = '';
            setTimeout(() => window.toggleAuthMode('login'), 2000);
        } else {
            showToast(data.message || "Помилка", 'error');
        }
    } catch (e) {
        showToast("Помилка з'єднання", 'error');
    } finally {
        btn.innerText = origText;
        btn.disabled = false;
    }
}

export async function submitNewPassword() {
    triggerHaptic();
    const token = document.getElementById('resetToken').value;
    const userId = document.getElementById('resetUserId').value;
    const p1 = document.getElementById('resetNewPassword').value;
    const p2 = document.getElementById('resetConfirmPassword').value;

    if (!p1 || p1.length < 4) return showToast('Пароль має бути від 4 символів', 'error');
    if (p1 !== p2) return showToast('Паролі не співпадають', 'error');

    const btn = document.querySelector('#resetPasswordContainer button');
    const origText = btn.innerText;
    btn.innerText = 'Збереження...';
    btn.disabled = true;

    try {
        const data = await postJson('/api/reset-password', { token, userId, newPassword: p1 });
        if (data.success) {
            showToast('✅ Пароль змінено! Тепер ви можете увійти.', 'info');
            document.getElementById('resetNewPassword').value = '';
            document.getElementById('resetConfirmPassword').value = '';

            // Очищаємо URL і йдемо на логін
            setTimeout(() => {
                window.location.href = window.location.pathname;
            }, 2000);
        } else {
            showToast(data.message || "Помилка при збереженні", 'error');
        }
    } catch (e) {
        showToast("Помилка з'єднання", 'error');
    } finally {
        btn.innerText = origText;
        btn.disabled = false;
    }
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

    if (user.avatar) {
        document.getElementById('userAvatarImg').src = user.avatar;
        document.getElementById('userAvatarImg').classList.remove('hidden');
        document.getElementById('userAvatarPlaceholder').classList.add('hidden');
    }

    // Ролі та адмінські кнопки
    if (['admin', 'SM', 'SSE', 'RRP'].includes(user.role)) {
        if (user.role !== 'RRP') {
            document.getElementById('toggleEditWrapper').classList.remove('hidden');
        }

        if (['SM', 'admin'].includes(user.role)) {
            const btnRequests = document.getElementById('btnTabRequests');
            if (btnRequests) {
                btnRequests.classList.remove('hidden');
                btnRequests.classList.add('flex');
            }
            // Завантажуємо запити
            if (window.loadRequests) window.loadRequests();
        }

        // Кнопка Глобал тільки для Admin
        if (user.role === 'admin') {
            const btnGlobal = document.getElementById('btnTabGlobal');
            if (btnGlobal) {
                btnGlobal.classList.remove('hidden');
                btnGlobal.classList.add('flex');
            }
        }

        if (user.role === 'SM' || user.role === 'admin') {
            document.getElementById('noteTypeToggle').classList.remove('hidden');
            document.getElementById('noteTypeToggle').classList.add('flex');
        }

        // 🔥 ВИПРАВЛЕНО: Прибрали автоматичне відкриття вкладки shifts, щоб показувало Bento-меню
    }

    // Завантаження всіх даних
    await loadData();

    // Перший рендер графіку
    renderAll();

    // Оновлюємо поточну вкладку, щоб підтягнулись права та інтерфейс
    if (window.setMode) {
        const currentMode = localStorage.getItem('shifter_viewMode') || 'calendar';
        window.setMode(currentMode);
    }
}

export async function loadData() {
    const [users, shifts, tasks, notes] = await Promise.all([
        fetchJson('/api/users'),
        fetchJson('/api/shifts'),
        fetchJson('/api/tasks'),
        fetchJson('/api/notes')
    ]);

    state.users = users.filter(u => u.role !== 'RRP');

    state.shifts = shifts;
    state.tasks = tasks;
    state.notes = notes;

    if (window.loadKpiData) await window.loadKpiData(); // FETCH KPI DATA FOR DASHBOARD NORM

    // 🔥 ВИПРАВЛЕНО: Залишили тільки список для Задач (s2)
    const s2 = document.getElementById('taskEmployee');

    if (s2) {
        const s2Val = s2.value;
        s2.innerHTML = '<option disabled selected>Кому?</option><option value="all">📢 Всім</option>';

        state.users.forEach(x => {
            s2.innerHTML += `<option value="${x.name}">${x.name}</option>`;
        });

        if (s2Val && s2Val !== 'Кому?') s2.value = s2Val;
    }
}