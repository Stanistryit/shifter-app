const tg = window.Telegram.WebApp;

export function initTheme() {
    const storedTheme = localStorage.getItem('theme');
    let isDark = false;

    if (storedTheme) {
        isDark = storedTheme === 'dark';
    } else {
        // Fallback or user OS check
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            isDark = true;
        } else {
            isDark = (tg?.colorScheme === 'dark');
        }
    }

    applyTheme(isDark);
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
        if (tg?.setHeaderColor) { tg.setHeaderColor('#F2F2F7'); tg.setBackgroundColor('#F2F2F7'); }
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

export function triggerHaptic(style = 'medium', type = 'impact') {
    if (tg && tg.HapticFeedback) {
        if (type === 'impact') {
            tg.HapticFeedback.impactOccurred(style); // 'light', 'medium', 'heavy', 'rigid', 'soft'
        } else if (type === 'notification') {
            tg.HapticFeedback.notificationOccurred(style); // 'error', 'success', 'warning'
        } else if (type === 'selection') {
            tg.HapticFeedback.selectionChanged();
        }
    } else if (navigator.vibrate) {
        // Fallback for non-telegram environments
        if (style === 'light') navigator.vibrate(10);
        else if (style === 'heavy' || style === 'error') navigator.vibrate([30, 50, 30]);
        else if (style === 'success') navigator.vibrate([20, 30, 20]);
        else navigator.vibrate(15);
    }
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

// --- SKELETON LOADERS ---
export function showSkeletonLoader(containerId, type = 'table') {
    const container = document.getElementById(containerId);
    if (!container) return;

    let html = '';
    if (type === 'table') {
        // Skeleton for Grid View
        html = `
        <div class="skeleton-loader p-4 space-y-4">
            <div class="flex gap-2 mb-6">
                <div class="h-8 w-24 bg-gray-200 dark:bg-gray-700 rounded-lg animate-pulse"></div>
                <div class="h-8 w-16 bg-gray-200 dark:bg-gray-700 rounded-lg animate-pulse"></div>
            </div>
            ${Array(6).fill(`
            <div class="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 pb-4">
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-full bg-gray-200 dark:bg-gray-700 animate-pulse flex-shrink-0"></div>
                    <div class="space-y-2">
                        <div class="h-4 w-28 bg-gray-200 dark:bg-gray-700 rounded animate-pulse"></div>
                        <div class="h-3 w-16 bg-gray-200 dark:bg-gray-700 rounded animate-pulse opacity-70"></div>
                    </div>
                </div>
                <div class="flex gap-2">
                    <div class="h-8 w-12 bg-gray-200 dark:bg-gray-700 rounded animate-pulse"></div>
                    <div class="h-8 w-12 bg-gray-200 dark:bg-gray-700 rounded animate-pulse"></div>
                </div>
            </div>`).join('')}
        </div>`;
    } else if (type === 'kpi') {
        html = `
        <div class="skeleton-loader p-4 space-y-4">
            <div class="h-24 w-full bg-gray-200 dark:bg-gray-700 rounded-2xl animate-pulse mb-6"></div>
            <div class="grid grid-cols-2 gap-4">
                <div class="h-16 bg-gray-200 dark:bg-gray-700 rounded-xl animate-pulse"></div>
                <div class="h-16 bg-gray-200 dark:bg-gray-700 rounded-xl animate-pulse"></div>
                <div class="h-16 bg-gray-200 dark:bg-gray-700 rounded-xl animate-pulse"></div>
                <div class="h-16 bg-gray-200 dark:bg-gray-700 rounded-xl animate-pulse"></div>
            </div>
            <div class="h-40 w-full bg-gray-200 dark:bg-gray-700 rounded-2xl animate-pulse mt-6"></div>
        </div>`;
    } else if (type === 'list') {
        html = `
        <div class="skeleton-loader p-4 space-y-5">
            ${Array(3).fill(`
            <div class="ios-card p-4 h-32 bg-gray-50 dark:bg-[#1C1C1E] animate-pulse">
                <div class="h-5 w-1/3 bg-gray-200 dark:bg-gray-700 rounded mb-4"></div>
                <div class="flex items-center gap-3 mb-3">
                    <div class="w-6 h-6 rounded-full bg-gray-200 dark:bg-gray-700"></div>
                    <div class="h-4 w-1/2 bg-gray-200 dark:bg-gray-700 rounded"></div>
                </div>
                <div class="h-2 w-full bg-gray-200 dark:bg-gray-700 rounded"></div>
            </div>`).join('')}
        </div>`;
    }

    container.innerHTML = html;
}

export function hideSkeletonLoader(containerId) {
    // This is mostly a semantic wrapper, usually render methods just overwrite innerHTML,
    // but we can add fade-out if necessary in the future.
    const container = document.getElementById(containerId);
    if (container) {
        const loaders = container.querySelectorAll('.skeleton-loader');
        loaders.forEach(l => l.remove());
    }
}