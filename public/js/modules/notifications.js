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
                showToast(`🔔 ${data.notification.title}\n${data.notification.message}`, 'info', 5000);

                // Trigger local push notification if supported and in background
                if (document.hidden && 'serviceWorker' in navigator && Notification.permission === 'granted') {
                    navigator.serviceWorker.ready.then(reg => {
                        reg.showNotification(data.notification.title, {
                            body: data.notification.message,
                            icon: '/icons/icon-192.png',
                            badge: '/icons/icon-192.png',
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
    if (unreadCount === 0) {
        showToast('Немає нових сповіщень', 'info');
        return;
    }

    try {
        await postJson('/api/notifications/read', {});
        unreadCount = 0;
        updateBadge();
        showToast('Всі сповіщення прочитані', 'success');
    } catch (e) {
        showToast('Помилка сервера', 'error');
    }
}
