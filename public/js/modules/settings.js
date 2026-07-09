import { state } from './state.js';
import { fetchJson, postJson } from './api.js';
import { showToast, triggerHaptic } from './ui.js';
import { renderAll } from './render.js';

// --- STORE SETTINGS (🔥 НОВЕ: Графік роботи) ---

export function openStoreSettingsModal() {
    triggerHaptic();
    const s = state.currentUser.store || {};
    const reportTime = s.reportTime || "20:00";
    const openTime = s.openTime || "10:00";
    const closeTime = s.closeTime || "22:00";
    const lunchDuration = s.lunch_duration_minutes || 0;
    
    const now = new Date();
    const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const normObj = s.normHours || {};
    const defaultNorm = normObj[defaultMonth] || 0;

    const modalHtml = `
    <div id="storeSettingsModal" class="fixed inset-0 z-[60] flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-black/60 backdrop-blur-md" onclick="document.getElementById('storeSettingsModal').remove()"></div>
        <div class="glass-modal rounded-2xl w-full max-w-sm p-6 relative z-10 animate-slide-up max-h-[90vh] overflow-y-auto">
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
            </div>

            <div class="h-px bg-gray-200 dark:bg-gray-700 my-4"></div>
            
            <h4 class="font-bold text-md mb-3 text-indigo-500">⏳ Норма годин</h4>
            <div class="space-y-4 mb-6 bg-gray-50 dark:bg-[#1C1C1E] p-3 rounded-xl border border-gray-100 dark:border-gray-800">
                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="block text-xs font-bold text-gray-400 mb-1">Місяць</label>
                        <input type="month" id="set_normMonth" value="${defaultMonth}" class="ios-input w-full text-sm" onchange="window.updateNormHoursInput()">
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-gray-400 mb-1">Години</label>
                        <input type="number" id="set_normHours" value="${defaultNorm}" class="ios-input w-full text-sm" placeholder="Наприклад, 160">
                    </div>
                </div>
                <button onclick="window.saveStoreNormHours()" id="btnSaveNormHours" class="w-full py-2 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-lg text-sm font-bold active:scale-95 transition-transform">
                    Зберегти норму годин
                </button>
            </div>

            <div class="h-px bg-gray-200 dark:bg-gray-700 my-4"></div>
            
            <button onclick="window.openReportConstructorModal()" class="w-full py-3 mb-4 bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 rounded-xl text-sm font-bold active:scale-95 transition-transform border border-purple-100 dark:border-purple-800/50 flex items-center justify-center gap-2">
                <span>🪄</span> Конструктор Вечірнього Звіту
            </button>

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

    const btn = document.querySelector('#storeSettingsModal .btn-primary');
    const oldText = btn.innerText;
    btn.innerText = "⏳ ...";

    try {
        const payload = { reportTime, openTime, closeTime, lunch_duration_minutes };
        if (window._tempReportTemplate) {
            payload.reportTemplate = window._tempReportTemplate;
        }

        const res = await postJson('/api/admin/store/settings', payload);
        if (res.success) {
            showToast("Налаштування збережено! ✅");

            if (state.currentUser.store) {
                state.currentUser.store.reportTime = reportTime;
                state.currentUser.store.openTime = openTime;
                state.currentUser.store.closeTime = closeTime;
                state.currentUser.store.lunch_duration_minutes = lunch_duration_minutes;
                if (!state.currentUser.store.telegram) state.currentUser.store.telegram = {};
                if (window._tempReportTemplate) {
                    state.currentUser.store.telegram.reportTemplate = window._tempReportTemplate;
                }
            }
            window._tempReportTemplate = null;

            if (window.checkEditorButtonVisibility) window.checkEditorButtonVisibility();

            document.getElementById('storeSettingsModal').remove();
            renderAll();
        } else {
            showToast(res.message || "Помилка", 'error');
            btn.innerText = oldText;
        }
    } catch (e) {
        showToast("Помилка мережі", 'error');
        btn.innerText = oldText;
    }
}

window.openReportConstructorModal = function() {
    triggerHaptic();
    const s = state.currentUser.store || {};
    let template = window._tempReportTemplate;
    if (!template) {
        template = (s.telegram && s.telegram.reportTemplate) ? s.telegram.reportTemplate : {
            header: '🌙 <b>План на завтра ({date}):</b>\\n',
            footer: 'Good luck! 🚀',
            blocks: [
                { id: 'working', enabled: true, title: '👷‍♂️ <b>На зміні:</b>' },
                { id: 'vacation', enabled: true, title: '🌴 <b>Відпустка:</b>' },
                { id: 'donor', enabled: true, title: '🩸 <b>Донорство:</b>' },
                { id: 'tasks', enabled: true, title: '📌 <b>Задачі:</b>' },
                { id: 'off', enabled: true, title: '😴 <b>Вихідні:</b>' }
            ]
        };
    }

    // deep copy to avoid mutating original state before save
    const t = JSON.parse(JSON.stringify(template));
    
    // Fallback for missing blocks if older template is saved
    const defaultBlocks = [
        { id: 'working', title: '👷‍♂️ <b>На зміні:</b>' },
        { id: 'vacation', title: '🌴 <b>Відпустка:</b>' },
        { id: 'donor', title: '🩸 <b>Донорство:</b>' },
        { id: 'tasks', title: '📌 <b>Задачі:</b>' },
        { id: 'off', title: '😴 <b>Вихідні:</b>' }
    ];
    defaultBlocks.forEach(db => {
        if (!t.blocks.find(b => b.id === db.id)) {
            t.blocks.push({ id: db.id, enabled: true, title: db.title });
        }
    });

    const modalHtml = `
    <div id="reportConstructorModal" class="fixed inset-0 z-[70] flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-black/60 backdrop-blur-md" onclick="document.getElementById('reportConstructorModal').remove()"></div>
        <div class="glass-modal rounded-2xl w-full max-w-md p-6 relative z-10 animate-slide-up max-h-[90vh] overflow-y-auto flex flex-col">
            <h3 class="font-bold text-xl mb-2 flex items-center gap-2">🪄 Конструктор Звіту</h3>
            <p class="text-xs text-gray-400 mb-4">Налаштуйте вигляд вечірнього звіту. Перетягуйте блоки, щоб змінити їх порядок.</p>
            
            <div class="space-y-4 mb-6 flex-1 overflow-y-auto pr-1 pb-4">
                <div>
                    <label class="block text-xs font-bold text-gray-400 mb-1">Заголовок звіту</label>
                    <textarea id="set_reportHeader" class="ios-input w-full text-sm font-mono h-16 resize-none">${t.header}</textarea>
                    <p class="text-[10px] text-gray-500 mt-1">{date} - буде замінено на завтрашню дату</p>
                </div>
                
                <div>
                    <label class="block text-xs font-bold text-gray-400 mb-2">Блоки звіту</label>
                    <div id="reportBlocksContainer" class="space-y-2">
                        ${t.blocks.map((b, idx) => `
                        <div class="report-block-item flex items-center gap-2 bg-gray-50 dark:bg-[#1C1C1E] p-2 rounded-xl border border-gray-100 dark:border-gray-800" data-id="${b.id}">
                            <div class="text-gray-400 cursor-move px-1 block-drag-handle">≡</div>
                            <input type="checkbox" class="w-4 h-4 rounded text-blue-500 block-enabled" ${b.enabled ? 'checked' : ''}>
                            <input type="text" class="ios-input flex-1 py-1 text-sm block-title" value="${b.title.replace(/"/g, '&quot;')}">
                        </div>
                        `).join('')}
                    </div>
                </div>

                <div>
                    <label class="block text-xs font-bold text-gray-400 mb-1">Текст в кінці звіту</label>
                    <textarea id="set_reportFooter" class="ios-input w-full text-sm font-mono h-16 resize-none">${t.footer}</textarea>
                </div>
            </div>

            <div class="mt-auto pt-4 border-t border-gray-100 dark:border-gray-800 bg-white/5 dark:bg-black/5">
                <button onclick="window.applyReportTemplate()" class="btn-primary bg-purple-600 shadow-lg shadow-purple-500/30 mb-2">Застосувати</button>
                <button onclick="document.getElementById('reportConstructorModal').remove()" class="w-full py-3 text-gray-500 font-medium hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors">Скасувати</button>
            </div>
        </div>
    </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    
    // Init simple Drag and Drop logic
    initDragAndDrop(document.getElementById('reportBlocksContainer'));
};

window.applyReportTemplate = function() {
    const header = document.getElementById('set_reportHeader').value;
    const footer = document.getElementById('set_reportFooter').value;
    
    const blocksContainer = document.getElementById('reportBlocksContainer');
    const blockEls = blocksContainer.querySelectorAll('.report-block-item');
    const blocks = [];
    
    blockEls.forEach(el => {
        blocks.push({
            id: el.getAttribute('data-id'),
            enabled: el.querySelector('.block-enabled').checked,
            title: el.querySelector('.block-title').value
        });
    });
    
    window._tempReportTemplate = { header, footer, blocks };
    document.getElementById('reportConstructorModal').remove();
    showToast('Шаблон збережено локально. Натисніть "Зберегти" в основному вікні.');
};

function initDragAndDrop(container) {
    let draggedItem = null;
    
    const items = container.querySelectorAll('.report-block-item');
    items.forEach(item => {
        const handle = item.querySelector('.block-drag-handle');
        
        handle.addEventListener('mousedown', () => item.setAttribute('draggable', true));
        handle.addEventListener('mouseup', () => item.removeAttribute('draggable'));
        
        item.addEventListener('dragstart', (e) => {
            draggedItem = item;
            setTimeout(() => item.classList.add('opacity-50'), 0);
        });
        
        item.addEventListener('dragend', () => {
            draggedItem = null;
            item.classList.remove('opacity-50');
            item.removeAttribute('draggable');
        });
        
        item.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (draggedItem !== item) {
                const rect = item.getBoundingClientRect();
                const next = (e.clientY - rect.top) / (rect.bottom - rect.top) > 0.5;
                container.insertBefore(draggedItem, next ? item.nextSibling : item);
            }
        });
    });
}

window.updateNormHoursInput = function() {
    const month = document.getElementById('set_normMonth').value;
    const s = state.currentUser.store || {};
    const normObj = s.normHours || {};
    const val = normObj[month] || 0;
    document.getElementById('set_normHours').value = val;
};

window.saveStoreNormHours = async function() {
    const month = document.getElementById('set_normMonth').value;
    const normHours = parseInt(document.getElementById('set_normHours').value, 10) || 0;

    if (!month) return showToast("Оберіть місяць", 'error');

    const btn = document.getElementById('btnSaveNormHours');
    const oldText = btn.innerText;
    btn.innerText = "⏳ ...";
    btn.disabled = true;

    try {
        const res = await postJson('/api/admin/store/norm-hours', { month, normHours });
        if (res.success) {
            showToast(`Норму на ${month} збережено! ✅`);
            
            if (state.currentUser.store) {
                if (!state.currentUser.store.normHours) {
                    state.currentUser.store.normHours = {};
                }
                state.currentUser.store.normHours[month] = normHours;
            }
            
            // Якщо є інші магазини в state.stores, їх теж треба оновити, щоб таблиця перемалювалась правильно
            if (state.stores) {
                const s = state.stores.find(x => String(x._id) === String(state.currentUser.storeId?._id || state.currentUser.storeId));
                if (s) {
                    if (!s.normHours) s.normHours = {};
                    s.normHours[month] = normHours;
                }
            }

            renderAll(); // Перемалювати таблицю, щоб показати прогрес бар
        } else {
            showToast(res.message || "Помилка", 'error');
        }
    } catch (e) {
        showToast("Помилка мережі", 'error');
    } finally {
        btn.innerText = oldText;
        btn.disabled = false;
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