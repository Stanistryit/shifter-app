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

// Функція для перемикання вкладок адмінки
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