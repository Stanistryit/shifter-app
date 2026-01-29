const tg = window.Telegram.WebApp;

export function initTheme() {
    if ((tg?.colorScheme === 'dark') || localStorage.theme === 'dark') {
        document.documentElement.classList.add('dark');
        document.getElementById('themeIcon').innerText = '☀️';
        if(tg?.setHeaderColor) { tg.setHeaderColor('#1C1C1E'); tg.setBackgroundColor('#000000'); }
    } else {
        document.documentElement.classList.remove('dark');
        document.getElementById('themeIcon').innerText = '🌙';
        if(tg?.setHeaderColor) { tg.setHeaderColor('#FFFFFF'); tg.setBackgroundColor('#F2F2F7'); }
    }
}

export function toggleTheme() {
    triggerHaptic();
    const html = document.documentElement;
    if (html.classList.contains('dark')) {
        html.classList.remove('dark');
        localStorage.theme = 'light';
        document.getElementById('themeIcon').innerText = '🌙';
        if(tg?.setHeaderColor) { tg.setHeaderColor('#FFFFFF'); tg.setBackgroundColor('#F2F2F7'); }
    } else {
        html.classList.add('dark');
        localStorage.theme = 'dark';
        document.getElementById('themeIcon').innerText = '☀️';
        if(tg?.setHeaderColor) { tg.setHeaderColor('#1C1C1E'); tg.setBackgroundColor('#000000'); }
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
    if(type !== 'info') triggerHaptic();

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 400);
    }, 3000);
}

export function triggerHaptic() {
    if(tg?.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
}

export function showAdminTab(t) {
    triggerHaptic();
    const tabs = ['shifts','tasks','requests','import','news','logs'];
    tabs.forEach(x => {
        const content = document.getElementById('adminTab'+x.charAt(0).toUpperCase()+x.slice(1));
        if(content) content.classList.add('hidden');
        const btn = document.getElementById('btnTab'+x.charAt(0).toUpperCase()+x.slice(1));
        if(btn) btn.className = "flex flex-col items-center justify-center p-3 rounded-xl transition-all active:scale-95 bg-gray-100 dark:bg-[#2C2C2E] text-gray-500 opacity-70 hover:opacity-100";
    });

    const activeContent = document.getElementById('adminTab'+t.charAt(0).toUpperCase()+t.slice(1));
    if(activeContent) activeContent.classList.remove('hidden');
    
    const activeBtn = document.getElementById('btnTab'+t.charAt(0).toUpperCase()+t.slice(1));
    if(activeBtn) activeBtn.className = "flex flex-col items-center justify-center p-3 rounded-xl transition-all active:scale-95 bg-white dark:bg-[#3A3A3C] shadow-md text-blue-500 ring-2 ring-blue-500 scale-105";
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
    triggerHaptic();
    document.getElementById('taskModalTitle').innerText = task.title;
    document.getElementById('taskModalDate').innerText = task.date;
    document.getElementById('taskModalTime').innerText = task.isFullDay ? 'Весь день' : `${task.start} - ${task.end}`;
    document.getElementById('taskModalUser').innerText = task.name;
    
    // Прив'язуємо кнопку видалення
    const btn = document.getElementById('btnDeleteTask');
    btn.onclick = () => {
        closeTaskDetailsModal();
        if(window.deleteTask) window.deleteTask(task._id);
    };

    document.getElementById('taskDetailsModal').classList.remove('hidden');
}

export function closeTaskDetailsModal() {
    document.getElementById('taskDetailsModal').classList.add('hidden');
}

// --- КОНТЕКСТНЕ МЕНЮ (Long Press) ---
// Зберігаємо ID та Тип об'єкта, на якому викликали меню
export let activeContext = { id: null, type: null, data: null };

export function showContextMenu(e, type, id, data = null) {
    e.preventDefault(); // Блокуємо стандартне меню браузера
    triggerHaptic();
    
    activeContext = { id, type, data };
    
    const menu = document.getElementById('contextMenu');
    const menuWidth = 192; // 12rem
    const menuHeight = 120; // приблизно
    
    let x = e.clientX;
    let y = e.clientY;
    
    // Перевірка меж екрану (щоб меню не вилізло за край)
    if (x + menuWidth > window.innerWidth) x -= menuWidth;
    if (y + menuHeight > window.innerHeight) y -= menuHeight;
    
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.classList.remove('hidden');
    
    // Закриття меню при кліку будь-де
    const closeMenu = () => {
        menu.classList.add('hidden');
        document.removeEventListener('click', closeMenu);
    };
    // Невелика затримка, щоб меню не закрилось одразу ж від цього ж кліку
    setTimeout(() => document.addEventListener('click', closeMenu), 50);
}