import { state } from './state.js';
import { fetchJson, postJson } from './api.js';
import { showToast, triggerHaptic } from './ui.js';
import { renderAll } from './render.js';

// --- STORE SETTINGS (🔥 НОВЕ: Графік роботи) ---

export function openStoreSettingsModal() {
    triggerHaptic();
    // Беремо поточні налаштування зі стейту (або дефолтні)
    const s = state.currentUser.store || {};
    const reportTime = s.reportTime || "20:00";
    const openTime = s.openTime || "10:00";
    const closeTime = s.closeTime || "22:00";
    const lunchDuration = s.lunch_duration_minutes || 0;
    const kpiEnabled = s.kpi_enabled !== false; // Default to true if undefined

    const modalHtml = `
    <div id="storeSettingsModal" class="fixed inset-0 z-[60] flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-black/60 backdrop-blur-md" onclick="document.getElementById('storeSettingsModal').remove()"></div>
        <div class="glass-modal rounded-2xl w-full max-w-sm p-6 relative z-10 animate-slide-up">
            <h3 class="font-bold text-xl mb-4">⚙️ Налаштування Магазину</h3>
            
            <div class="space-y-4 mb-6">
                <div>
                    <label class="block text-xs font-bold text-gray-400 mb-1">Час відправки звіту (Telegram)</label>
                    <input type="time" id="set_reportTime" value="${reportTime}" class="ios-input w-full">
                </div>
                
                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="block text-xs font-bold text-gray-400 mb-1">Відкриття</label>
                        <input type="time" id="set_openTime" value="${openTime}" class="ios-input w-full">
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-gray-400 mb-1">Закриття</label>
                        <input type="time" id="set_closeTime" value="${closeTime}" class="ios-input w-full">
                    </div>
                </div>

                <div>
                    <label class="block text-xs font-bold text-gray-400 mb-1">Обід (хв)</label>
                    <input type="number" id="set_lunchDuration" value="${lunchDuration}" min="0" class="ios-input w-full">
                    <p class="text-[10px] text-gray-500 mt-1">Вкажіть час у хвилинах. Це значення буде автоматично відніматися від кожної зміни</p>
                </div>
                
                <div class="flex items-center justify-between pt-2 border-t border-gray-100 dark:border-gray-800">
                    <div class="pr-2">
                        <label class="block text-xs font-bold text-gray-800 dark:text-gray-200 mb-1">Доступ до вкладки KPI для персоналу</label>
                        <p class="text-[10px] text-gray-500">Якщо вимкнено, користувачі не бачитимуть вкладку KPI</p>
                    </div>
                    <label class="relative inline-flex items-center cursor-pointer flex-shrink-0">
                        <input type="checkbox" id="set_kpiEnabled" class="sr-only peer" ${kpiEnabled ? 'checked' : ''}>
                        <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
                    </label>
                </div>
            </div>

            <button onclick="window.saveStoreSettings()" class="btn-primary bg-blue-600 shadow-lg shadow-blue-500/30 mb-2">💾 Зберегти</button>
            <button onclick="document.getElementById('storeSettingsModal').remove()" class="w-full py-3 text-gray-500 font-medium hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors">Скасувати</button>
        </div>
    </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

export async function saveStoreSettings() {
    const reportTime = document.getElementById('set_reportTime').value;
    const openTime = document.getElementById('set_openTime').value;
    const closeTime = document.getElementById('set_closeTime').value;
    const lunch_duration_minutes = parseInt(document.getElementById('set_lunchDuration').value, 10) || 0;
    const kpi_enabled = document.getElementById('set_kpiEnabled').checked;


    const btn = document.querySelector('#storeSettingsModal .btn-primary');
    const oldText = btn.innerText;
    btn.innerText = "⏳ ...";

    try {
        const res = await postJson('/api/admin/store/settings', { reportTime, openTime, closeTime, lunch_duration_minutes, kpi_enabled });
        if (res.success) {
            showToast("Налаштування збережено! ✅");

            // Оновлюємо локальний стейт, щоб графік перемалювався одразу
            if (state.currentUser.store) {
                state.currentUser.store.reportTime = reportTime;
                state.currentUser.store.openTime = openTime;
                state.currentUser.store.closeTime = closeTime;
                state.currentUser.store.lunch_duration_minutes = lunch_duration_minutes;
                state.currentUser.store.kpi_enabled = kpi_enabled;
            }

            // Якщо є функція для перевірки видимості кнопок, викликаємо її
            if (window.checkEditorButtonVisibility) {
                window.checkEditorButtonVisibility();
            }

            document.getElementById('storeSettingsModal').remove();
            renderAll(); // Перемальовуємо графік з новими межами
        } else {
            showToast(res.message || "Помилка", 'error');
            btn.innerText = oldText;
        }
    } catch (e) {
        showToast("Помилка мережі", 'error');
        btn.innerText = oldText;
    }
}

// --- STORE DISPLAY & TRANSFER ---

export async function updateStoreDisplay() {
    const me = state.users.find(u => u.name === state.currentUser?.name);
    if (!me || !me.storeId) return;

    try {
        const stores = await fetchJson('/api/stores');

        // 🔥 FIX: Додана перевірка, чи прийшов масив
        if (!Array.isArray(stores)) {
            return;
        }

        const myStore = stores.find(s => s._id === me.storeId || s.code === me.storeId);

        if (myStore) {
            const nameContainer = document.querySelector('#userNameDisplay').parentNode;
            const oldLabel = document.getElementById('storeNameLabel');
            if (oldLabel) oldLabel.remove();

            const label = document.createElement('div');
            label.id = 'storeNameLabel';
            label.className = "text-[10px] text-gray-400 font-bold uppercase tracking-wider mt-0.5";
            label.innerText = myStore.name;
            nameContainer.appendChild(label);
        }
    } catch (e) { console.error(e); }
}

export async function openTransferModal() {
    closeAvatarModal();
    triggerHaptic();

    const me = state.users.find(u => u.name === state.currentUser?.name);
    const currentStoreId = me ? me.storeId : null;

    let stores = [];
    try {
        stores = await fetchJson('/api/stores');
        // 🔥 FIX: Тут теж додаємо перевірку, щоб не ламало модалку
        if (!Array.isArray(stores)) throw new Error("Invalid stores data");
    } catch (e) {
        return showToast("Не вдалося завантажити список магазинів", 'error');
    }

    const availableStores = stores.filter(s => s._id !== currentStoreId);

    const modalHtml = `
        <div id="transferModal" class="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <div class="absolute inset-0 bg-black/60 backdrop-blur-md" onclick="document.getElementById('transferModal').remove()"></div>
            <div class="glass-modal rounded-2xl w-full max-w-sm p-6 relative z-10 animate-slide-up text-center">
                <h3 class="font-bold text-xl mb-2">🔄 Переведення</h3>
                <p class="text-sm text-gray-500 mb-6">Оберіть магазин, в який плануєте перейти. SM нової точки отримає запит.</p>
                
                <div class="relative mb-6 text-left">
                    <label class="text-[10px] uppercase font-bold text-gray-400 ml-2 mb-1 block">Новий магазин</label>
                    <div class="relative">
                        <select id="transferStoreSelect" class="ios-input bg-transparent appearance-none w-full p-3 border rounded-xl bg-gray-50 dark:bg-white/5">
                            <option value="" disabled selected>Оберіть зі списку...</option>
                            ${availableStores.map(s => `<option value="${s.code}">${s.name}</option>`).join('')}
                        </select>
                        <div class="absolute right-3 top-3.5 text-gray-400 pointer-events-none">▼</div>
                    </div>
                </div>

                <button onclick="window.submitTransferRequest()" class="btn-primary bg-blue-600 shadow-lg shadow-blue-500/30 mb-3">Надіслати запит</button>
                <button onclick="document.getElementById('transferModal').remove()" class="w-full py-3 text-red-500 font-medium hover:bg-red-50 dark:hover:bg-red-900/10 rounded-xl transition-colors">Скасувати</button>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

window.submitTransferRequest = async function () {
    const select = document.getElementById('transferStoreSelect');
    const targetStoreCode = select.value;

    if (!targetStoreCode) return showToast("Будь ласка, оберіть магазин", 'error');

    const btn = document.querySelector('#transferModal .btn-primary');
    const originalText = btn.innerText;
    btn.innerText = "⏳ Надсилаю...";
    btn.disabled = true;

    try {
        const res = await postJson('/api/user/transfer/request', { targetStoreCode });

        if (res.success) {
            showToast(res.message || "Запит надіслано! ✅");
            document.getElementById('transferModal').remove();
        } else {
            showToast(res.message || "Помилка", 'error');
            btn.innerText = originalText;
            btn.disabled = false;
        }
    } catch (e) {
        showToast("Помилка мережі", 'error');
        btn.innerText = originalText;
        btn.disabled = false;
    }
};

// --- FILTER ---

export function openFilterModal() {
    triggerHaptic();
    document.getElementById('filterModal').classList.remove('hidden');
    renderFilterList();
}

export function closeFilterModal() {
    document.getElementById('filterModal').classList.add('hidden');
}

export function renderFilterList() {
    const list = document.getElementById('filterList');

    // 🔥 ОНОВЛЕНО: Фільтруємо список користувачів, якщо обрано магазин (для Global Admin)
    let usersToShow = state.users;
    if (state.selectedStoreFilter && state.selectedStoreFilter !== 'all') {
        usersToShow = state.users.filter(u => String(u.storeId) === String(state.selectedStoreFilter));
    }

    let html = `
        <button onclick="window.applyFilter('all')" class="w-full text-left p-3 rounded-xl flex justify-between items-center ${state.filter === 'all' ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-500 font-bold' : 'hover:bg-gray-50 dark:hover:bg-[#2C2C2E]'}">
            <span class="font-medium">Всі співробітники</span>
            ${state.filter === 'all' ? '<span>✓</span>' : ''}
        </button>`;

    // Використовуємо відфільтрований список usersToShow
    usersToShow.forEach(u => {
        const isSelected = state.filter === u.name;
        html += `
            <button onclick="window.applyFilter('${u.name}')" class="w-full text-left p-3 rounded-xl flex justify-between items-center ${isSelected ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-500 font-bold' : 'hover:bg-gray-50 dark:hover:bg-[#2C2C2E]'}">
                <span class="font-medium">${u.name}</span>
                ${isSelected ? '<span>✓</span>' : ''}
            </button>`;
    });

    list.innerHTML = html;
}

export function applyFilter(val) {
    triggerHaptic();
    state.filter = val;
    const label = val === 'all' ? 'Всі співробітники' : (val.split(' ')[1] || val);
    document.getElementById('currentFilterLabel').innerText = label;
    closeFilterModal();
    renderAll();
}

// --- STORE FILTER MODAL ---

export function openStoreFilterModal() {
    triggerHaptic();
    document.getElementById('storeFilterModal').classList.remove('hidden');
    renderStoreFilterList();
}

export function closeStoreFilterModal() {
    document.getElementById('storeFilterModal').classList.add('hidden');
}

export function renderStoreFilterList() {
    const list = document.getElementById('storeFilterList');

    let html = `
        <button onclick="window.changeStoreFilter('all')" class="w-full text-left p-3 rounded-xl flex justify-between items-center ${state.selectedStoreFilter === 'all' ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-500 font-bold' : 'hover:bg-gray-50 dark:hover:bg-[#2C2C2E]'}">
            <span class="font-medium">🌍 Всі магазини</span>
            ${state.selectedStoreFilter === 'all' ? '<span>✓</span>' : ''}
        </button>`;

    state.stores.forEach(s => {
        const isSelected = state.selectedStoreFilter === s._id;
        html += `
            <button onclick="window.changeStoreFilter('${s._id}', '${s.name}')" class="w-full text-left p-3 rounded-xl flex justify-between items-center ${isSelected ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-500 font-bold' : 'hover:bg-gray-50 dark:hover:bg-[#2C2C2E]'}">
                <span class="font-medium">🏪 ${s.name}</span>
                ${isSelected ? '<span>✓</span>' : ''}
            </button>`;
    });

    list.innerHTML = html;
}

// --- AVATAR ---

export function openAvatarModal() {
    triggerHaptic();
    const modal = document.getElementById('avatarModal');
    modal.classList.remove('hidden');

    const img = document.getElementById('avatarPreview');
    const placeholder = document.getElementById('avatarPlaceholder');

    // Reset explicitly or load existing
    if (state.currentUser && state.currentUser.avatarId) {
        img.src = `/api/avatar/${state.currentUser.avatarId}?t=${new Date().getTime()}`;
        img.classList.remove('hidden');
        placeholder.classList.add('hidden');
    } else {
        img.src = '';
        img.classList.add('hidden');
        placeholder.classList.remove('hidden');
    }
}

export function closeAvatarModal() {
    document.getElementById('avatarModal').classList.add('hidden');
}

export function handleAvatarSelect(input) {
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = function (e) {
            const img = document.getElementById('avatarPreview');
            img.src = e.target.result;
            img.classList.remove('hidden');
            document.getElementById('avatarPlaceholder').classList.add('hidden');
            document.getElementById('avatarActions').classList.remove('hidden');
        };
        reader.readAsDataURL(input.files[0]);
    }
}

export function uploadAvatar() {
    const imgElement = document.getElementById('avatarPreview');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const size = 200;

    canvas.width = size;
    canvas.height = size;

    const img = new Image();
    img.onload = function () {
        const minSide = Math.min(img.width, img.height);
        const sx = (img.width - minSide) / 2;
        const sy = (img.height - minSide) / 2;
        ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.7);

        postJson('/api/user/avatar', { avatar: dataUrl }).then(data => {
            if (data.success) {
                // Update top-right small avatar (if it still exists somewhere)
                const smallImg = document.getElementById('userAvatarImg');
                if (smallImg) {
                    smallImg.src = dataUrl;
                    smallImg.classList.remove('hidden');
                }
                const smallPh = document.getElementById('userAvatarPlaceholder');
                if (smallPh) smallPh.classList.add('hidden');

                const deskImg = document.getElementById('userAvatarImgDesk');
                if (deskImg) {
                    deskImg.src = dataUrl;
                    deskImg.classList.remove('hidden');
                }
                const deskPh = document.getElementById('userAvatarPlaceholderDesk');
                if (deskPh) deskPh.classList.add('hidden');

                // Update main Profile view avatar
                const pfImg = document.getElementById('profileAvatarImg');
                if (pfImg) {
                    pfImg.src = dataUrl;
                    pfImg.classList.remove('hidden');
                }
                const pfPlaceholder = document.getElementById('profileAvatarPlaceholder');
                if (pfPlaceholder) pfPlaceholder.classList.add('hidden');

                closeAvatarModal();
                showToast("Аватар оновлено");
            } else {
                showToast("Помилка", 'error');
            }
        });
    };
    img.src = imgElement.src;
}

// --- PASSWORD ---

export function openChangePasswordModal() {
    closeAvatarModal();
    document.getElementById('changePasswordModal').classList.remove('hidden');
}

export function closeChangePasswordModal() {
    document.getElementById('changePasswordModal').classList.add('hidden');
    document.getElementById('oldPassword').value = '';
    document.getElementById('newPassword').value = '';
    document.getElementById('confirmPassword').value = '';
}

export async function submitChangePassword() {
    const oldP = document.getElementById('oldPassword').value;
    const newP = document.getElementById('newPassword').value;
    const confirmP = document.getElementById('confirmPassword').value;

    if (!oldP || !newP || !confirmP) return showToast("Заповніть всі поля", 'error');
    if (newP !== confirmP) return showToast("Нові паролі не співпадають", 'error');
    if (newP.length < 3) return showToast("Пароль закороткий", 'error');

    const d = await postJson('/api/user/change-password', { oldPassword: oldP, newPassword: newP });

    if (d.success) {
        showToast("Пароль змінено! ✅");
        closeChangePasswordModal();
    } else {
        showToast(d.message || "Помилка", 'error');
    }
}

// --- LOGS ---

export async function loadLogs() {
    const logs = await fetchJson('/api/logs');
    const c = document.getElementById('logsList');
    c.innerHTML = '';

    logs.forEach(l => {
        const date = new Date(l.timestamp).toLocaleString('uk-UA');
        c.innerHTML += `
            <div class="bg-gray-50 dark:bg-gray-800 p-2 rounded border-l-2 border-gray-400">
                <div class="font-bold text-[10px] text-gray-400">${date}</div>
                <div><b>${l.performer}</b>: ${l.action} (${l.details})</div>
            </div>`;
    });
}