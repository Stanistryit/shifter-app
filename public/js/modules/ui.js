const tg = window.Telegram.WebApp;

export function initTheme() {
    const storedTheme = localStorage.getItem('theme');
    let isDark = false;

    if (storedTheme) {
        isDark = storedTheme === 'dark';
    } else {
        isDark = (tg?.colorScheme === 'dark');
    }

    applyTheme(isDark);

    // Слухаємо зміни теми від Telegram WebApp
    if (tg) {
        tg.onEvent('themeChanged', () => {
            // Якщо користувач не обрав тему вручну, синхронізуємось з Telegram
            if (!localStorage.getItem('theme')) {
                applyTheme(tg.colorScheme === 'dark');
            }
        });
    }
}

function applyTheme(isDark) {
    if (isDark) {
        document.documentElement.classList.add('dark');
        const icon = document.getElementById('themeIcon');
        if (icon) icon.innerText = '☀️';
        if (tg?.setHeaderColor) { tg.setHeaderColor('#1C1C1E'); tg.setBackgroundColor('#000000'); }
    } else {
        document.documentElement.classList.remove('dark');
        const icon = document.getElementById('themeIcon');
        if (icon) icon.innerText = '🌙';
        if (tg?.setHeaderColor) { tg.setHeaderColor('#FFFFFF'); tg.setBackgroundColor('#F2F2F7'); }
    }
}

import { state } from './state.js';
import { renderTable } from './render_table.js';

export function toggleHoursPin() {
    if (window.triggerHaptic) window.triggerHaptic();
    state.isHoursPinned = !state.isHoursPinned;
    localStorage.setItem('shifter_hoursPinned', state.isHoursPinned ? '1' : '0');

    // Update button styling depending on state
    const btn = document.getElementById('toggleHoursPinBtn');
    if (btn) {
        if (state.isHoursPinned) {
            btn.innerHTML = '<span>📌</span> Закріплено';
            btn.className = 'text-[10px] text-white bg-blue-500 px-2 py-1 rounded-lg font-bold flex items-center gap-1 active:scale-95 transition-transform shadow-md shadow-blue-500/30';
        } else {
            btn.innerHTML = '<span>📌</span> Закріпити години';
            btn.className = 'text-[10px] text-gray-500 bg-gray-100 dark:bg-[#2C2C2E] px-2 py-1 rounded-lg font-medium flex items-center gap-1 active:scale-95 transition-transform';
        }
    }

    renderTable(); // Re-render table with new sticky classes
}

export function toggleTheme() {
    if (window.triggerHaptic) window.triggerHaptic();
    const html = document.documentElement;
    const isDark = html.classList.contains('dark');

    // Якщо зараз темна - робимо світлу
    if (isDark) {
        localStorage.setItem('theme', 'light');
        applyTheme(false);
    } else {
        localStorage.setItem('theme', 'dark');
        applyTheme(true);
    }
}

export function showToast(msg, type = 'success') {
    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        container.className = 'fixed top-4 left-1/2 transform -translate-x-1/2 z-[100] space-y-2 w-full max-w-xs pointer-events-none';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    const icon = type === 'success' ? '✅' : (type === 'error' ? '⚠️' : 'ℹ️');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span>${icon}</span><span>${msg}</span>`;
    container.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('show'));
    if (type !== 'info' && window.triggerHaptic) window.triggerHaptic();

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 400);
    }, 3000);
}

export function triggerHaptic() {
    if (tg?.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
}

export function showAdminTab(t) {
    if (window.triggerHaptic) window.triggerHaptic();

    // Ховаємо головне меню з красивими кнопками
    const adminMenu = document.getElementById('adminMenu');
    if (adminMenu) adminMenu.classList.add('hidden');

    // Ховаємо всі можливі вкладки
    const tabs = ['shifts', 'tasks', 'requests', 'import', 'news', 'logs', 'kpi', 'global'];
    tabs.forEach(x => {
        const contentId = 'adminTab' + x.charAt(0).toUpperCase() + x.slice(1);
        const content = document.getElementById(contentId);
        if (content) content.classList.add('hidden');
    });

    // Показуємо вибрану вкладку
    const activeContentId = 'adminTab' + t.charAt(0).toUpperCase() + t.slice(1);
    const activeContent = document.getElementById(activeContentId);
    if (activeContent) activeContent.classList.remove('hidden');
}

// --- НОВІ ФУНКЦІЇ ДЛЯ НОВИН ---

export function formatText(type) {
    const field = document.getElementById('newsText');
    if (!field) return;

    const start = field.selectionStart;
    const end = field.selectionEnd;
    const text = field.value;
    const selectedText = text.substring(start, end);
    let before = '', after = '';

    if (type === 'bold') { before = '<b>'; after = '</b>'; }
    else if (type === 'italic') { before = '<i>'; after = '</i>'; }
    else if (type === 'link') {
        const url = prompt("URL:", "https://");
        if (!url) return;
        before = `<a href="${url}">`; after = '</a>';
    }

    const content = selectedText || (type === 'link' ? 'посилання' : 'текст');
    field.value = text.substring(0, start) + before + content + after + text.substring(end);
    field.focus();
}

export function updateFileName() {
    const input = document.getElementById('newsFile');
    const count = input.files.length;
    const label = document.getElementById('fileName');
    if (count > 0) {
        label.innerText = count === 1 ? input.files[0].name : `Обрано ${count} файлів`;
    } else {
        label.innerText = "Оберіть файли (можна декілька)";
    }
}

// --- ЗАДАЧІ (MODAL) ---

export function openTaskDetailsModal(task) {
    if (window.triggerHaptic) window.triggerHaptic();
    document.getElementById('taskModalTitle').innerText = task.title;
    document.getElementById('taskModalDate').innerText = task.date;
    document.getElementById('taskModalTime').innerText = task.isFullDay ? 'Весь день' : `${task.start} - ${task.end}`;
    document.getElementById('taskModalUser').innerText = task.name;

    const descWrapper = document.getElementById('taskModalDescriptionWrapper');
    const descText = document.getElementById('taskModalDescription');

    if (task.description && task.description.trim() !== "") {
        const linkedText = task.description.replace(
            /(https?:\/\/[^\s]+)/g,
            '<a href="$1" target="_blank" class="text-blue-500 underline break-all">$1</a>'
        );
        descText.innerHTML = linkedText;
        descWrapper.classList.remove('hidden');
    } else {
        descWrapper.classList.add('hidden');
        descText.innerHTML = '';
    }

    const btnToggle = document.getElementById('btnToggleTaskStatus');
    if (task.status === 'completed') {
        btnToggle.innerHTML = '⏳ Повернути в роботу';
        btnToggle.className = 'w-full py-3 text-white font-bold bg-orange-500 rounded-xl active:scale-95 transition-transform mb-2';
    } else {
        btnToggle.innerHTML = '✅ Відмітити як виконану';
        btnToggle.className = 'w-full py-3 text-white font-bold bg-green-500 rounded-xl active:scale-95 transition-transform mb-2';
    }

    btnToggle.onclick = () => {
        if (window.toggleTaskExecution) window.toggleTaskExecution(task._id);
    };

    const btn = document.getElementById('btnDeleteTask');
    btn.onclick = () => {
        closeTaskDetailsModal();
        if (window.deleteTask) window.deleteTask(task._id);
    };

    document.getElementById('taskDetailsModal').classList.remove('hidden');
}

export function closeTaskDetailsModal() {
    document.getElementById('taskDetailsModal').classList.add('hidden');
}

// --- КОНТЕКСТНЕ МЕНЮ (Long Press) ---
export let activeContext = { id: null, type: null, data: null };

export function showContextMenu(e, type, id, data = null) {
    e.preventDefault();
    if (window.triggerHaptic) window.triggerHaptic();

    activeContext = { id, type, data };

    const menuObj = type === 'task' ? document.getElementById('taskContextMenu') : document.getElementById('contextMenu');
    if (!menuObj) return;

    // Use rough heights for overflow checks 
    const menuWidth = 200;
    const menuHeight = type === 'task' ? 140 : 200;

    let x = e.clientX;
    let y = e.clientY;

    if (x + menuWidth > window.innerWidth) x -= menuWidth;
    if (y + menuHeight > window.innerHeight) y -= menuHeight;

    menuObj.style.left = `${x}px`;
    menuObj.style.top = `${y}px`;
    menuObj.classList.remove('hidden');

    const closeMenu = () => {
        const m1 = document.getElementById('contextMenu');
        const m2 = document.getElementById('taskContextMenu');
        if (m1) m1.classList.add('hidden');
        if (m2) m2.classList.add('hidden');
        document.removeEventListener('click', closeMenu);
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 50);
}

// 🔥 НОВЕ: Функція для зміни іконки FAB кнопки
export function updateFabIcon(isOpen) {
    const icon = document.getElementById('fabIcon');
    const btn = document.getElementById('fabEditBtn');
    if (!icon || !btn) return;

    if (isOpen) {
        icon.innerText = '✕'; // Хрестик
        // Змінюємо колір на сірий/чорний
        btn.classList.remove('bg-blue-600', 'shadow-blue-600/40');
        btn.classList.add('bg-gray-700', 'shadow-gray-700/40');
    } else {
        icon.innerText = '✏️'; // Олівець
        // Повертаємо синій колір
        btn.classList.remove('bg-gray-700', 'shadow-gray-700/40');
        btn.classList.add('bg-blue-600', 'shadow-blue-600/40');
    }
}