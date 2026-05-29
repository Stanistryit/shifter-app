import { state } from './state.js';
import { triggerHaptic, showToast } from './ui.js';
import { fetchJson, postJson } from './api.js'; 

// Імпортуємо розбиті модулі
import { renderTimeline } from './render_timeline.js';
import { renderTable } from './render_table.js';
import { renderCalendar } from './render_calendar.js';

// Експортуємо їх, щоб app.js міг їх використовувати
export { renderTimeline, renderTable, renderCalendar };

// Головна функція рендеру
export function renderAll() {
    renderTimeline();
    renderCalendar();
    renderTable();
}

// ==========================================
// 👤 ЛОГІКА РЕДАГУВАННЯ КОРИСТУВАЧА (MODAL)
// ==========================================

window.openEditUserProxy = (userId) => {
    const user = state.users.find(u => u._id === userId);
    if (!user) return;

    const existingModal = document.getElementById('editUserModal');
    if (existingModal) existingModal.remove();

    const gradesByPos = {
        'SE': [3, 4],
        'SSE': [5, 6],
        'SM': [7, 8, 9],
        'RRP': [0]
    };
    
    const getGradeOptions = (pos, selectedGrade) => {
        const allowed = gradesByPos[pos] || [0];
        return allowed.map(g => `<option value="${g}" ${g === selectedGrade ? 'selected' : ''}>${g}</option>`).join('');
    };

    // Селект для зміни магазину (Тільки для Global Admin)
    let storeSelectHtml = '';
    if (state.currentUser.role === 'admin') {
        let options = `<option value="null" ${!user.storeId ? 'selected' : ''}>Без магазину (Null)</option>`;
        if (state.stores) {
            state.stores.forEach(s => {
                const isSelected = String(user.storeId) === String(s._id) ? 'selected' : '';
                options += `<option value="${s._id}" ${isSelected}>🏪 ${s.name}</option>`;
            });
        }
        
        storeSelectHtml = `
            <div class="mt-3 p-3 bg-blue-50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-900/30 rounded-xl">
                <label class="block text-xs font-bold text-blue-600 dark:text-blue-400 mb-1">Прив'язка до магазину</label>
                <select id="edit_storeId" class="w-full p-2 bg-white dark:bg-[#1C1C1E] border border-blue-200 dark:border-blue-800 rounded-lg outline-none text-sm">
                    ${options}
                </select>
            </div>
        `;
    }

    const modalHtml = `
    <div id="editUserModal" class="fixed inset-0 z-[60] flex items-end sm:items-center justify-center pointer-events-none">
        <div class="fixed inset-0 bg-black/40 backdrop-blur-sm transition-opacity" onclick="document.getElementById('editUserModal').remove()"></div>
        <div class="bg-white dark:bg-[#1C1C1E] w-full sm:w-[400px] rounded-t-2xl sm:rounded-2xl p-5 shadow-2xl transform transition-transform pointer-events-auto max-h-[90vh] overflow-y-auto">
            <div class="flex justify-between items-center mb-5">
                <h3 class="text-xl font-bold">👤 Редагування</h3>
                <button onclick="document.getElementById('editUserModal').remove()" class="p-2 bg-gray-100 dark:bg-gray-800 rounded-full">✕</button>
            </div>
            
            <div class="space-y-4">
                <div>
                    <label class="block text-xs font-bold text-gray-400 mb-1">ПІП (Full Name)</label>
                    <input type="text" id="edit_fullName" value="${user.fullName || ''}" class="w-full p-3 bg-gray-50 dark:bg-[#2C2C2E] rounded-xl outline-none focus:ring-2 focus:ring-blue-500">
                </div>
                
                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="block text-xs font-bold text-gray-400 mb-1">Email</label>
                        <input type="email" id="edit_email" value="${user.email || ''}" class="w-full p-3 bg-gray-50 dark:bg-[#2C2C2E] rounded-xl outline-none">
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-gray-400 mb-1">Телефон</label>
                        <input type="text" id="edit_phone" value="${user.phone || ''}" class="w-full p-3 bg-gray-50 dark:bg-[#2C2C2E] rounded-xl outline-none">
                    </div>
                </div>
                
                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="block text-xs font-bold text-gray-400 mb-1">Посада</label>
                        <select id="edit_position" onchange="window.updateGradeOptions(this.value)" class="w-full p-3 bg-gray-50 dark:bg-[#2C2C2E] rounded-xl outline-none">
                            <option value="SE" ${user.position==='SE'?'selected':''}>SE</option>
                            <option value="SSE" ${user.position==='SSE'?'selected':''}>SSE</option>
                            <option value="SM" ${user.position==='SM'?'selected':''}>SM</option>
                            <option value="RRP" ${user.position==='RRP'?'selected':''}>RRP</option>
                        </select>
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-gray-400 mb-1">Грейд</label>
                        <select id="edit_grade" class="w-full p-3 bg-gray-50 dark:bg-[#2C2C2E] rounded-xl outline-none">
                            ${getGradeOptions(user.position, user.grade)}
                        </select>
                    </div>
                </div>

                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="block text-xs font-bold text-gray-400 mb-1">Роль в системі</label>
                        <select id="edit_role" class="w-full p-3 bg-gray-50 dark:bg-[#2C2C2E] rounded-xl outline-none">
                            <option value="Guest" ${user.role==='Guest'?'selected':''}>Guest</option>
                            <option value="SE" ${user.role==='SE'?'selected':''}>SE</option>
                            <option value="SSE" ${user.role==='SSE'?'selected':''}>SSE</option>
                            <option value="SM" ${user.role==='SM'?'selected':''}>SM</option>
                            ${state.currentUser.role === 'admin' ? `<option value="admin" ${user.role==='admin'?'selected':''}>Global Admin</option>` : ''}
                        </select>
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-blue-500 mb-1">Пріоритет (Сорт.)</label>
                        <input type="number" id="edit_sortOrder" value="${user.sortOrder !== undefined ? user.sortOrder : 999}" class="w-full p-3 bg-gray-50 dark:bg-[#2C2C2E] rounded-xl outline-none border border-transparent focus:border-blue-500">
                    </div>
                </div>
                
                ${storeSelectHtml}

                <div class="mt-4 p-3 bg-purple-50 dark:bg-purple-900/10 border border-purple-100 dark:border-purple-900/30 rounded-xl">
                    <label class="block text-xs font-bold text-purple-600 dark:text-purple-400 mb-2">🏅 Видати кастомний бейдж</label>
                    <div class="flex gap-2 mb-2">
                        <input type="text" id="badgeEmoji" placeholder="🦇" class="w-12 p-2 bg-white dark:bg-[#1C1C1E] border border-purple-200 dark:border-purple-800 rounded-lg outline-none text-center text-lg">
                        <input type="text" id="badgeName" placeholder="Назва бейджу" class="flex-1 p-2 bg-white dark:bg-[#1C1C1E] border border-purple-200 dark:border-purple-800 rounded-lg outline-none text-sm">
                    </div>
                    <button onclick="window.issueCustomBadge('${user._id}')" class="w-full py-2 bg-purple-500 text-white font-bold rounded-lg shadow-sm active:scale-95 transition-transform text-sm">Видати бейдж</button>
                    
                    <div id="userBadgesList" class="mt-2 space-y-1">
                        ${user.customBadges && user.customBadges.length > 0 ? user.customBadges.map(b => `
                            <div class="flex justify-between items-center text-xs p-1.5 bg-white dark:bg-[#1C1C1E] rounded-md border border-gray-100 dark:border-gray-800">
                                <span>${b.emoji} ${b.name}</span>
                                <button onclick="window.removeCustomBadge('${user._id}', '${b._id}')" class="text-red-500 hover:text-red-700 font-bold px-2 py-0.5 bg-red-50 dark:bg-red-900/20 rounded active:scale-95">✕</button>
                            </div>
                        `).join('') : '<div class="text-xs text-gray-500 text-center italic py-1">Немає бейджів</div>'}
                    </div>
                </div>

                <button onclick="saveUserChanges('${user._id}')" class="w-full py-3.5 bg-blue-500 text-white font-bold rounded-xl shadow-lg shadow-blue-500/30 active:scale-95 transition-transform mt-3">💾 Зберегти зміни</button>
                
                ${user.status !== 'blocked' ? 
                    `<button onclick="window.blockUser('${user._id}')" class="w-full py-3 text-red-500 font-bold bg-red-50 dark:bg-red-900/10 rounded-xl hover:bg-red-100 transition-colors mt-2">🚫 Звільнити співробітника</button>` 
                    : `
                    <div class="text-center text-red-500 font-bold py-2 mt-2">🔴 Співробітник звільнений</div>
                    <button onclick="window.restoreUser('${user._id}')" class="w-full py-3 text-green-600 font-bold bg-green-50 dark:bg-green-900/10 rounded-xl hover:bg-green-100 transition-colors mt-1">✅ Відновити співробітника</button>
                    `
                }
            </div>
        </div>
    </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
};

window.updateGradeOptions = (pos) => {
    const gradesByPos = { 'SE': [3, 4], 'SSE': [5, 6], 'SM': [7, 8, 9], 'RRP': [0] };
    const select = document.getElementById('edit_grade');
    const allowed = gradesByPos[pos] || [0];
    select.innerHTML = allowed.map(g => `<option value="${g}">${g}</option>`).join('');
};

window.blockUser = async (id) => {
    if(!confirm("Ви впевнені, що хочете звільнити цього співробітника?\n\nВін буде заблокований, а майбутні зміни (починаючи з завтра) будуть видалені.")) return;
    await window.saveUserChanges(id, { status: 'blocked' });
};

window.restoreUser = async (id) => {
    if(!confirm("Ви впевнені, що хочете відновити цього співробітника?")) return;
    await window.saveUserChanges(id, { status: 'active' });
};

window.saveUserChanges = async (id, overrideData = null) => {
    let data;
    if (overrideData) {
        data = { id, ...overrideData };
    } else {
        data = {
            id,
            fullName: document.getElementById('edit_fullName').value,
            email: document.getElementById('edit_email').value,
            phone: document.getElementById('edit_phone').value,
            position: document.getElementById('edit_position').value,
            grade: document.getElementById('edit_grade').value,
            role: document.getElementById('edit_role').value,
            // 🔥 НОВЕ: Зчитуємо пріоритет сортування
            sortOrder: document.getElementById('edit_sortOrder').value
        };
        
        // Збираємо вибраний магазин (Тільки для Admin)
        const storeSelect = document.getElementById('edit_storeId');
        if (storeSelect) {
            data.storeId = storeSelect.value;
        }
    }

    const btn = document.querySelector('#editUserModal button[onclick^="save"]');
    if(btn && !overrideData) btn.innerHTML = '⏳ Збереження...';
    
    try {
        const res = await fetch('/api/user/update', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(data)
        });
        const json = await res.json();
        
        if (json.success) {
            const modal = document.getElementById('editUserModal');
            if(modal) modal.remove();
            
            const idx = state.users.findIndex(u => u._id === id);
            if (idx !== -1) {
                state.users[idx] = { ...state.users[idx], ...data };
                if(data.grade) state.users[idx].grade = Number(data.grade);
                if(data.sortOrder) state.users[idx].sortOrder = Number(data.sortOrder); // Оновлюємо в стейті
                if(data.storeId) state.users[idx].storeId = data.storeId === 'null' ? null : data.storeId;
            }
            
            if(data.status === 'blocked' || data.status === 'active') triggerHaptic();

            // Оновлюємо всі в'юшки через нові експорти
            renderTable(); 
            const listContainer = document.getElementById('listViewContainer');
            if (listContainer && !listContainer.classList.contains('hidden')) renderTimeline();
            
            if(!overrideData) showToast('✅ Дані оновлено!');
        } else {
            showToast('❌ Помилка: ' + json.message, 'error');
        }
    } catch (e) {
        showToast('❌ Помилка з\'єднання', 'error');
    }
};

window.issueCustomBadge = async (targetUserId) => {
    const emoji = document.getElementById('badgeEmoji').value.trim();
    const name = document.getElementById('badgeName').value.trim();
    if (!emoji || !name) return showToast('Введіть емоджі та назву', 'error');

    const res = await postJson('/api/admin/badges/add', { targetUserId, emoji, name });
    if (res.success) {
        showToast('Бейдж видано!');
        const idx = state.users.findIndex(u => u._id === targetUserId);
        if (idx !== -1) state.users[idx].customBadges = res.badges;
        window.openEditUserProxy(targetUserId); // re-render modal
    } else {
        showToast(res.message || 'Помилка', 'error');
    }
};

window.removeCustomBadge = async (targetUserId, badgeId) => {
    if (!confirm("Видалити цей бейдж?")) return;
    const res = await postJson('/api/admin/badges/remove', { targetUserId, badgeId });
    if (res.success) {
        showToast('Бейдж видалено');
        const idx = state.users.findIndex(u => u._id === targetUserId);
        if (idx !== -1) state.users[idx].customBadges = res.badges;
        window.openEditUserProxy(targetUserId); // re-render modal
    } else {
        showToast(res.message || 'Помилка', 'error');
    }
};