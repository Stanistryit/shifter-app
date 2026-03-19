import { state } from './state.js';
import { fetchJson, postJson } from './api.js';
import { showToast, triggerHaptic } from './ui.js';

let sseSource = null;
let unreadCount = 0;

export async function initNotifications() {
    if (!state.currentUser) return;

    // 1. Fetch existing unread
    try {
        const notifs = await fetchJson('/api/notifications');
        const unread = notifs.filter(n => !n.isRead);
        unreadCount = unread.length;
        updateBadge();
    } catch (e) {
        console.error("Помилка завантаження сповіщень", e);
    }

    // 2. Connect SSE
    if (sseSource) sseSource.close();
    sseSource = new EventSource('/api/notifications/stream');

    sseSource.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.type === 'notification') {
                unreadCount++;
                updateBadge();
                showToast(`🔔 ${data.notification.title}: ${data.notification.message}`, 'info');

                // Trigger local push notification if supported and in background
                if (document.hidden && 'serviceWorker' in navigator && Notification.permission === 'granted') {
                    navigator.serviceWorker.ready.then(reg => {
                        reg.showNotification(data.notification.title, {
                            body: data.notification.message,
                            icon: '/icons/icon-192x192.png',
                            badge: '/icons/icon-192x192.png',
                            vibrate: [200, 100, 200]
                        });
                    });
                }
            }
        } catch (e) { }
    };

    sseSource.onerror = (err) => {
        console.log("SSE Connection Error. Auto-reconnecting...");
    };
}

export function updateBadge() {
    const mobBadge = document.getElementById('notifBadgeMob');
    const deskBadge = document.getElementById('notifBadgeDesk');

    if (unreadCount > 0) {
        if (mobBadge) { mobBadge.innerText = unreadCount > 9 ? '9+' : unreadCount; mobBadge.classList.remove('hidden'); }
        if (deskBadge) { deskBadge.innerText = unreadCount > 9 ? '9+' : unreadCount; deskBadge.classList.remove('hidden'); }
    } else {
        if (mobBadge) mobBadge.classList.add('hidden');
        if (deskBadge) deskBadge.classList.add('hidden');
    }
}

export async function readNotifications() {
    triggerHaptic();
    document.getElementById('notificationsModal').classList.remove('hidden');
    const list = document.getElementById('notificationsList');
    const countText = document.getElementById('notifCountText');
    
    list.innerHTML = '<div class="text-center text-sm text-gray-400 py-4">Завантаження...</div>';
    
    try {
        const notifs = await fetchJson('/api/notifications');
        list.innerHTML = '';
        
        if (notifs.length === 0) {
            list.innerHTML = '<div class="text-center text-sm text-gray-500 py-4">Немає сповіщень</div>';
            countText.innerText = 'Пусто';
            return;
        }

        const unreadList = notifs.filter(n => !n.isRead);
        unreadCount = unreadList.length;
        updateBadge();
        
        countText.innerText = unreadCount > 0 ? `${unreadCount} нових` : 'Всі прочитані';

        notifs.forEach(n => {
            const dateStr = new Date(n.createdAt).toLocaleString('uk-UA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
            const bgClass = n.isRead ? 'opacity-70' : 'bg-blue-50 dark:bg-blue-900/20 shadow-sm border border-blue-100 dark:border-blue-800/50';
            const dot = n.isRead ? '' : '<div class="w-2.5 h-2.5 rounded-full bg-blue-500 mt-1 shrink-0"></div>';
            const titleClass = n.isRead ? 'text-gray-600 dark:text-gray-400' : 'text-gray-900 dark:text-gray-100 font-bold';
            
            list.innerHTML += `
                <div class="p-3 rounded-xl flex items-start gap-3 mb-2 bg-gray-50 dark:bg-[#2C2C2E] transition-all ${bgClass}">
                    ${dot}
                    <div class="flex-1 min-w-0">
                        <div class="flex justify-between items-start gap-2 mb-1">
                            <h4 class="text-sm ${titleClass} truncate break-words whitespace-normal">${n.title}</h4>
                        </div>
                        <p class="text-xs text-gray-500 dark:text-gray-400 leading-relaxed break-words pb-1 border-b border-gray-200 dark:border-gray-700/50">${n.message}</p>
                        <span class="text-[10px] text-gray-400 mt-1 block">${dateStr}</span>
                    </div>
                </div>
            `;
        });
        
    } catch (e) {
        list.innerHTML = '<div class="text-center text-sm text-red-500 py-4">Помилка завантаження</div>';
    }
}

export function closeNotificationsModal() {
    triggerHaptic();
    document.getElementById('notificationsModal').classList.add('hidden');
}

export async function markAllNotificationsAsRead() {
    triggerHaptic();
    if (unreadCount === 0) return;
    
    const btn = document.querySelector('#notificationsModal button[onclick="window.markAllNotificationsAsRead()"]');
    if (btn) btn.innerHTML = '⏳';
    
    try {
        await postJson('/api/notifications/read', {});
        unreadCount = 0;
        updateBadge();
        await readNotifications(); 
        showToast('Всі сповіщення прочитані', 'success');
    } catch (e) {
        showToast('Помилка сервера', 'error');
    } finally {
        if (btn) btn.innerHTML = 'Прочитати всі';
    }
}
