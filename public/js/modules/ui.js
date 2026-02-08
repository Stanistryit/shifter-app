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
    if(window.triggerHaptic) window.triggerHaptic();
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
    if(type !== 'info' && window.triggerHaptic) window.triggerHaptic();

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 400);
    }, 3000);
}

export function triggerHaptic() {
    if(tg?.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
}

export function showAdminTab(t) {
    if(window.triggerHaptic) window.triggerHaptic();
    
    // 🔥 ДОДАНО: 'global' у список вкладок
    const tabs = ['shifts','tasks','requests','import','news','logs', 'kpi', 'global'];
    
    // Ховаємо всі
    tabs.forEach(x => {
        // ID контенту (adminTabShifts, adminTabGlobal...)
        const contentId = 'adminTab' + x.charAt(0).toUpperCase() + x.slice(1);
        const content = document.getElementById(contentId);
        if(content) content.classList.add('hidden');
        
        // ID кнопки (btnTabShifts, btnTabGlobal...)
        const btnId = 'btnTab' + x.charAt(0).toUpperCase() + x.slice(1);
        const btn = document.getElementById(btnId);
        // Скидаємо стиль кнопки (неактивна)
        if(btn) {
            btn.className = "flex flex-col items-center justify-center p-3 rounded-xl transition-all active:scale-95 bg-gray-100 dark:bg-[#2C2C2E] text-gray-500 opacity-70 hover:opacity-100";
            // Якщо кнопка була прихована (hidden), ми не чіпаємо цей клас.
            // Але якщо вона видима (flex), то клас flex має залишитись.
            // Тому краще керувати hidden/flex окремо, а тут тільки кольорами.
            // Щоб спростити, просто додамо базові класи, а hidden керується в auth.js
        }
    });

    // Показуємо активну
    const activeContentId = 'adminTab' + t.charAt(0).toUpperCase() + t.slice(1);
    const activeContent = document.getElementById(activeContentId);
    if(activeContent) activeContent.classList.remove('hidden');
    
    // Підсвічуємо активну кнопку
    const activeBtnId = 'btnTab' + t.charAt(0).toUpperCase() + t.slice(1);
    const activeBtn = document.getElementById(activeBtnId);
    if(activeBtn) {
        // Видаляємо старі класи кольору і додаємо активні
        // Важливо: зберігаємо 'hidden' або 'flex' якщо вони там були, 
        // але в нашому випадку ми просто переписуємо className, 
        // тому треба переконатися, що кнопка має display:flex (через клас flex або в CSS).
        // В index.html кнопки мають `hidden flex-col...` або `flex flex-col...`
        // Тому краще маніпулювати classList.
        
        activeBtn.classList.remove('bg-gray-100', 'dark:bg-[#2C2C2E]', 'text-gray-500', 'opacity-70');
        activeBtn.classList.add('bg-white', 'dark:bg-[#3A3A3C]', 'shadow-md', 'text-blue-500', 'ring-2', 'ring-blue-500', 'scale-105');
    }
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
    if(window.triggerHaptic) window.triggerHaptic();
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
export let activeContext = { id: null, type: null, data: null };

export function showContextMenu(e, type, id, data = null) {
    e.preventDefault(); 
    if(window.triggerHaptic) window.triggerHaptic();
    
    activeContext = { id, type, data };
    
    const menu = document.getElementById('contextMenu');
    const menuWidth = 192; 
    const menuHeight = 120; 
    
    let x = e.clientX;
    let y = e.clientY;
    
    if (x + menuWidth > window.innerWidth) x -= menuWidth;
    if (y + menuHeight > window.innerHeight) y -= menuHeight;
    
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.classList.remove('hidden');
    
    const closeMenu = () => {
        menu.classList.add('hidden');
        document.removeEventListener('click', closeMenu);
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 50);
}