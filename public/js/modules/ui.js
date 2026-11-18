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
    
    const storedColorTheme = localStorage.getItem('colorTheme') || 'default';
    applyColorTheme(storedColorTheme);
}

function applyColorTheme(themeName) {
    if (themeName === 'default') {
        document.documentElement.removeAttribute('data-theme');
    } else {
        document.documentElement.setAttribute('data-theme', themeName);
    }
    
    // Update selector if it exists
    const select = document.getElementById('profileColorTheme');
    if (select) select.value = themeName;
}

export function changeColorTheme(themeName) {
    if (window.triggerHaptic) window.triggerHaptic();
    localStorage.setItem('colorTheme', themeName);
    applyColorTheme(themeName);
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

export function showToast(msg, type = 'success', duration = 3000) {
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
    }, duration);
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
    const tabs = ['shifts', 'tasks', 'requests', 'import', 'news', 'logs', 'global'];
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

export function formatText(type, fieldId = 'newsText') {
    const field = document.getElementById(fieldId);
    if (!field) return;

    const start = field.selectionStart;
    const end = field.selectionEnd;
    const text = field.value;
    const selectedText = text.substring(start, end);
    let before = '', after = '';
    let customLabel = '';

    if (type === 'bold') { before = '<b>'; after = '</b>'; }
    else if (type === 'italic') { before = '<i>'; after = '</i>'; }
    else if (type === 'link') {
        let url = prompt("Вставте посилання (URL):", "https://");
        if (!url || !url.trim() || url.trim() === 'https://') return;
        url = url.trim();
        if (!/^https?:\/\//i.test(url) && !/^tg:\/\//i.test(url) && !/^mailto:/i.test(url)) {
            url = 'https://' + url;
        }
        if (!selectedText) {
            const labelInput = prompt("Текст посилання (як воно буде відображатися):", "Посилання");
            if (labelInput === null) return;
            customLabel = labelInput.trim() || 'Посилання';
        }
        before = `<a href="${url}">`; after = '</a>';
    }

    const content = selectedText || customLabel || (type === 'link' ? 'Посилання' : 'текст');
    field.value = text.substring(0, start) + before + content + after + text.substring(end);
    field.focus();
}

export function formatRichTextHtml(rawText) {
    if (!rawText) return '';
    const links = [];
    const addLinkPlaceholder = (url, label) => {
        let cleanUrl = String(url || '').trim();
        if (!/^https?:\/\//i.test(cleanUrl) && !/^tg:\/\//i.test(cleanUrl) && !/^mailto:/i.test(cleanUrl)) {
            cleanUrl = 'https://' + cleanUrl;
        }
        const safeUrl = cleanUrl.replace(/"/g, '&quot;');
        const idx = links.length;
        links.push(`<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()" class="text-blue-500 hover:text-blue-600 dark:text-blue-400 underline font-semibold break-all">🔗 ${label || cleanUrl}</a>`);
        return `%%RICH_LINK_${idx}%%`;
    };

    let processed = String(rawText)
        // 1. Існуючі HTML-посилання <a href="...">...</a>
        .replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, url, label) => addLinkPlaceholder(url, label))
        // 2. Markdown-посилання [текст](url)
        .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi, (_, label, url) => addLinkPlaceholder(url, label))
        // 3. Звичайні URL у тексті
        .replace(/(https?:\/\/[^\s<>"']+)/gi, (url) => addLinkPlaceholder(url, url));

    processed = processed.replace(/%%RICH_LINK_(\d+)%%/g, (_, idx) => links[Number(idx)] || '');
    return processed;
}

function formatFileSize(bytes) {
    const num = Number(bytes || 0);
    if (!num) return '';
    if (num < 1024) return `${num} Б`;
    if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} КБ`;
    return `${(num / (1024 * 1024)).toFixed(1)} МБ`;
}

function getAttachmentIcon(mimeType = '', fileName = '') {
    const m = String(mimeType).toLowerCase();
    const n = String(fileName).toLowerCase();
    if (m.startsWith('image/')) return '🖼️';
    if (m === 'application/pdf' || n.endsWith('.pdf')) return '📕';
    if (n.endsWith('.xls') || n.endsWith('.xlsx') || n.endsWith('.csv') || m.includes('spreadsheet') || m.includes('excel')) return '📊';
    if (n.endsWith('.doc') || n.endsWith('.docx') || m.includes('word')) return '📘';
    if (n.endsWith('.zip') || n.endsWith('.rar') || n.endsWith('.7z')) return '🗜️';
    return '📄';
}

export function updateFileName(inputId = 'newsFile', labelId = 'fileName') {
    const input = document.getElementById(inputId);
    const count = input.files.length;
    const label = document.getElementById(labelId);
    if (count > 0) {
        label.innerText = count === 1 ? input.files[0].name : `Обрано ${count} файлів`;
    } else {
        label.innerText = "Оберіть файли (можна декілька)";
    }
}

// --- ЗАДАЧІ (MODAL) ---

export function openTaskDetailsModal(task) {
    if (window.triggerHaptic) window.triggerHaptic();
    document.getElementById('taskModalTitle').innerText = task.title || task.text || 'Задача';
    
    if (task.type === 'todo' || (task.deadline && (!task.start || !task.end))) {
        document.getElementById('taskModalDate').innerText = 'Дедлайн:';
        document.getElementById('taskModalTime').innerText = task.deadline ? new Date(task.deadline).toLocaleString('uk-UA', {
            year: 'numeric', 
            day: '2-digit', 
            month: '2-digit', 
            hour: '2-digit', 
            minute: '2-digit',
            timeZone: 'Europe/Kiev'
        }) : 'Відсутній';
    } else {
        document.getElementById('taskModalDate').innerText = task.date || 'Сьогодні';
        let timeStr = task.isFullDay ? 'Весь день' : '';
        if (!timeStr && task.start && task.end) timeStr = `${task.start} - ${task.end}`;
        if (!timeStr && task.deadline) {
            try {
                timeStr = new Date(task.deadline).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kiev' });
            } catch(e) {}
        }
        document.getElementById('taskModalTime').innerText = timeStr || 'Весь день';
    }
    
    const displayUser = (!task.name || task.name === 'all') ? 'Всі співробітники' : task.name;
    document.getElementById('taskModalUser').innerText = displayUser;

    const descWrapper = document.getElementById('taskModalDescriptionWrapper');
    const descText = document.getElementById('taskModalDescription');

    if (task.description && task.description.trim() !== "") {
        descText.innerHTML = formatRichTextHtml(task.description);
        descWrapper.classList.remove('hidden');
    } else {
        descWrapper.classList.add('hidden');
        descText.innerHTML = '';
    }

    const subtasksContainer = document.getElementById('taskModalSubtasksList');
    if (subtasksContainer) {
        if (task.subtasks && task.subtasks.length > 0) {
            subtasksContainer.parentElement.classList.remove('hidden');
            subtasksContainer.innerHTML = '';
            task.subtasks.forEach(st => {
                const isChecked = st.completed ? 'checked' : '';
                const lineThrough = st.completed ? 'line-through text-gray-500' : 'text-gray-900 dark:text-gray-100';
                subtasksContainer.insertAdjacentHTML('beforeend', `
                    <label class="flex items-center gap-3 p-3 bg-gray-50 dark:bg-[#1C1C1E] rounded-xl active:scale-[0.98] transition-all cursor-pointer">
                        <input type="checkbox" ${isChecked} onchange="window.toggleSubtask('${task._id}', '${st._id}')" class="w-5 h-5 text-blue-600 rounded border-gray-300 focus:ring-blue-500 bg-white dark:bg-[#2C2C2E] dark:border-gray-600">
                        <span class="text-sm font-medium ${lineThrough} flex-1 overflow-hidden text-ellipsis">${st.title}</span>
                    </label>
                `);
            });
        } else {
            subtasksContainer.parentElement.classList.add('hidden');
        }
    }

    const attWrapper = document.getElementById('taskModalAttachmentsWrapper');
    const attList = document.getElementById('taskModalAttachmentsList');
    if (attWrapper && attList) {
        if (Array.isArray(task.attachments) && task.attachments.length > 0) {
            attWrapper.classList.remove('hidden');
            attList.innerHTML = task.attachments.map(att => {
                const viewUrl = `/api/tasks/${task._id}/attachment/${att._id}`;
                const downloadUrl = `/api/tasks/${task._id}/attachment/${att._id}?download=1`;
                const isImage = String(att.mimeType || '').toLowerCase().startsWith('image/');
                const icon = getAttachmentIcon(att.mimeType, att.name);
                const sizeStr = formatFileSize(att.size);
                const safeName = String(att.name || 'Файл')
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;');

                return `
                    <div class="p-2.5 bg-gray-50 dark:bg-[#1C1C1E] border border-gray-200/70 dark:border-gray-800 rounded-xl space-y-2">
                        ${isImage ? `
                            <a href="${viewUrl}" target="_blank" rel="noopener noreferrer" class="block rounded-lg overflow-hidden max-h-48 bg-black/5 dark:bg-white/5">
                                <img src="${viewUrl}" alt="${safeName}" class="w-full max-h-48 object-contain mx-auto">
                            </a>
                        ` : ''}
                        <div class="flex items-center justify-between gap-2">
                            <a href="${viewUrl}" target="_blank" rel="noopener noreferrer" class="flex items-center gap-2 min-w-0 flex-1 hover:opacity-80 transition-opacity">
                                <span class="text-lg shrink-0">${icon}</span>
                                <div class="min-w-0 flex-1">
                                    <div class="text-xs font-bold text-gray-800 dark:text-gray-100 truncate">${safeName}</div>
                                    ${sizeStr ? `<div class="text-[10px] text-gray-400 font-mono">${sizeStr}</div>` : ''}
                                </div>
                            </a>
                            <a href="${downloadUrl}" download="${safeName}"
                                class="px-2.5 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-100 text-xs font-bold shrink-0 transition-colors">
                                ⬇ Скачати
                            </a>
                        </div>
                    </div>
                `;
            }).join('');
        } else {
            attWrapper.classList.add('hidden');
            attList.innerHTML = '';
        }
    }

    const isManager = state.currentUser && (state.currentUser.role === 'SM' || state.currentUser.role === 'admin');
    
    const btnEdit = document.getElementById('btnEditTask');
    if (btnEdit) {
        if (isManager) {
            btnEdit.classList.remove('hidden');
            btnEdit.onclick = () => {
                closeTaskDetailsModal();
                if (window.openEditTaskModal) window.openEditTaskModal(task);
            };
        } else {
            btnEdit.classList.add('hidden');
        }
    }

    const btnForceRemind = document.getElementById('btnForceRemindTask');
    if (btnForceRemind) {
        if (isManager || task.type === 'todo') { 
            // Only SM can force remind. So we just check isManager
            if (isManager) {
                btnForceRemind.classList.remove('hidden');
                btnForceRemind.onclick = () => {
                    const originalText = btnForceRemind.innerHTML;
                    btnForceRemind.innerHTML = '⏳ Відправка...';
                    if (window.forceRemindTask) window.forceRemindTask(task._id, btnForceRemind, originalText);
                };
            } else {
                btnForceRemind.classList.add('hidden');
            }
        } else {
             btnForceRemind.classList.add('hidden');
        }
    }

    const btnToggle = document.getElementById('btnToggleTaskStatus');
    if (task.requireCompletion === false) {
        btnToggle.classList.add('hidden');
    } else {
        btnToggle.classList.remove('hidden');
        const isDone = task.status === 'completed' || Boolean(task.done);
        if (isDone) {
            btnToggle.innerHTML = '⏳ Повернути в роботу';
            btnToggle.className = 'w-full py-3 text-white font-bold bg-orange-500 rounded-xl active:scale-95 transition-transform mb-2 shadow-sm shadow-orange-500/30';
        } else {
            btnToggle.innerHTML = '✅ Відмітити як виконану';
            btnToggle.className = 'w-full py-3 text-white font-bold bg-green-500 rounded-xl active:scale-95 transition-transform mb-2 shadow-sm shadow-green-500/30';
        }
        
        btnToggle.onclick = () => {
            if (window.toggleTaskExecution) window.toggleTaskExecution(task._id);
        };
    }

    const btn = document.getElementById('btnDeleteTask');
    if (isManager) {
        btn.classList.remove('hidden');
        btn.onclick = () => {
            closeTaskDetailsModal();
            if (window.deleteTask) window.deleteTask(task._id);
        };
    } else {
        btn.classList.add('hidden');
    }

    document.getElementById('taskDetailsModal').classList.remove('hidden');
}

export function closeTaskDetailsModal() {
    document.getElementById('taskDetailsModal').classList.add('hidden');
}

// --- ЗМІНИ (MODAL) ---
export function openShiftDetailsModal(info) {
    if (state.isEditMode) return;
    if (window.triggerHaptic) window.triggerHaptic();

    const existing = document.getElementById('shiftDetailsModal');
    if (existing) existing.remove();

    const isGuest = info.type === 'guest';
    const isOutbound = info.type === 'substitute';
    const isSpecial = ['Відпустка', 'Лікарняний', 'Донорство'].includes(info.start);
    const canEdit = ['SM', 'admin'].includes(state.currentUser?.role);

    let typeBadge = '';
    if (isGuest) {
        typeBadge = `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-200 border border-amber-300 dark:border-amber-700/80 shadow-sm">
            <span>👤</span> Гість з магазину: <span class="font-extrabold underline">${info.homeStoreName || 'Інший магазин'}</span>
        </span>`;
    } else if (isOutbound) {
        typeBadge = `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-orange-100 text-orange-900 dark:bg-orange-900/50 dark:text-orange-200 border border-orange-300 dark:border-orange-700/80 shadow-sm">
            <span>📍</span> Підміна в магазині: <span class="font-extrabold underline">${info.targetStoreName || 'Інший магазин'}</span>
        </span>`;
    } else if (!isSpecial) {
        typeBadge = `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-blue-50 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
            <span>🏪</span> Основний штат магазину
        </span>`;
    }

    let editBtnHtml = '';
    if (canEdit && info.shiftId) {
        editBtnHtml = `
            <button onclick="window.closeShiftDetailsModal(); window.contextMenuProxy(event, 'shift', '${info.shiftId}')" 
                    class="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-sm shadow-lg shadow-blue-500/30 active:scale-95 transition-all flex items-center justify-center gap-2">
                <span>✏️</span> Редагувати або видалити
            </button>
        `;
    }

    let dateFormatted = info.date;
    try {
        const [y, m, d] = info.date.split('-').map(Number);
        const dt = new Date(y, m - 1, d);
        dateFormatted = dt.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long' });
        dateFormatted = dateFormatted.charAt(0).toUpperCase() + dateFormatted.slice(1);
    } catch(e) {}

    let contentRows = '';
    if (isSpecial) {
        let icon = '🌴';
        let title = 'Відпустка';
        if (info.start === 'Лікарняний') { icon = '💊'; title = 'Лікарняний'; }
        else if (info.start === 'Донорство') { icon = '🩸'; title = 'Донорство (8 год)'; }

        contentRows = `
            <div class="flex items-center gap-3 p-4 bg-gray-50 dark:bg-[#1C1C1E] rounded-xl border border-gray-100 dark:border-gray-800">
                <span class="text-3xl">${icon}</span>
                <div class="flex flex-col">
                    <span class="font-bold text-base text-gray-900 dark:text-white">${title}</span>
                    <span class="text-xs text-gray-400">Статус на цей день</span>
                </div>
            </div>
        `;
    } else {
        contentRows = `
            <div class="flex items-center justify-between text-xs">
                <span class="text-gray-400 flex items-center gap-1.5 font-medium"><span>📅</span> Дата:</span>
                <span class="font-bold text-gray-800 dark:text-gray-200 text-right">${dateFormatted}</span>
            </div>
            <div class="flex items-center justify-between text-xs border-t border-gray-100 dark:border-gray-800/80 pt-2.5">
                <span class="text-gray-400 flex items-center gap-1.5 font-medium"><span>⏰</span> Час зміни:</span>
                <span class="font-bold text-blue-600 dark:text-blue-400 font-mono text-sm">${info.start} – ${info.end}</span>
            </div>
            <div class="flex items-center justify-between text-xs border-t border-gray-100 dark:border-gray-800/80 pt-2.5">
                <span class="text-gray-400 flex items-center gap-1.5 font-medium"><span>⏳</span> Тривалість:</span>
                <span class="font-bold text-gray-800 dark:text-gray-200">${info.duration} год ${info.lunchMins ? `<span class="text-[10px] text-gray-400 font-normal">(-${info.lunchMins} хв обід)</span>` : ''}</span>
            </div>
        `;
    }

    const firstLetter = (info.fullName || info.userName || '👤').trim()[0].toUpperCase();
    const resolvedAvatar = info.avatar || (window.state?.users && window.state.users.find(u => u.name === info.userName)?.avatar) || null;
    const avatarContent = resolvedAvatar 
        ? `<img src="${resolvedAvatar}" class="w-full h-full object-cover rounded-full">`
        : firstLetter;

    const modalHtml = `
    <div id="shiftDetailsModal" class="fixed inset-0 z-[110] flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-black/60 backdrop-blur-md animate-fade-in" onclick="window.closeShiftDetailsModal()"></div>
        <div class="glass-modal rounded-2xl w-full max-w-sm p-6 relative z-10 animate-slide-up shadow-2xl border border-gray-100 dark:border-gray-800">
            <div class="flex justify-between items-start mb-3">
                <div class="flex items-center gap-3">
                    <div class="w-12 h-12 rounded-full bg-gradient-to-tr from-blue-500 to-indigo-600 flex items-center justify-center text-white text-xl font-bold shadow-md shadow-blue-500/30 flex-shrink-0">
                        ${avatarContent}
                    </div>
                    <div class="min-w-0">
                        <h3 class="font-bold text-lg text-gray-900 dark:text-white leading-tight truncate">${info.fullName || info.userName}</h3>
                        ${info.position ? `<span class="text-xs text-gray-400 font-medium">${info.position}</span>` : ''}
                    </div>
                </div>
                <button onclick="window.closeShiftDetailsModal()" class="w-8 h-8 rounded-full bg-gray-100 dark:bg-[#2C2C2E] text-gray-500 hover:text-gray-900 dark:hover:text-white flex items-center justify-center text-sm font-bold leading-none transition-colors ml-2">✕</button>
            </div>

            <div class="mb-4">
                ${typeBadge}
            </div>

            <div class="bg-gray-50/70 dark:bg-[#1C1C1E] rounded-xl p-3.5 space-y-2.5 mb-5 border border-gray-100 dark:border-gray-800">
                ${contentRows}
            </div>

            <div class="space-y-2">
                ${editBtnHtml}
                <button onclick="window.closeShiftDetailsModal()" class="w-full py-2.5 bg-gray-100 dark:bg-[#2C2C2E] hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-xl font-medium text-sm transition-colors text-center">
                    Закрити
                </button>
            </div>
        </div>
    </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

export function closeShiftDetailsModal() {
    const m = document.getElementById('shiftDetailsModal');
    if (m) m.remove();
}

window.openShiftDetailsModal = openShiftDetailsModal;
window.closeShiftDetailsModal = closeShiftDetailsModal;
window.showToast = showToast;
window.triggerHaptic = triggerHaptic;

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

    const delBtn = document.getElementById('ctxDelete');
    if (delBtn) {
        if (type === 'empty_shift') {
            delBtn.classList.add('hidden');
        } else {
            delBtn.classList.remove('hidden');
        }
    }

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