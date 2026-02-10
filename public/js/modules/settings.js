import { state } from './state.js';
import { fetchJson, postJson } from './api.js';
import { showToast, triggerHaptic } from './ui.js';
import { renderAll } from './render.js';

// --- STORE DISPLAY & TRANSFER (🔥 НОВЕ) ---

// Функція для відображення назви магазину в шапці
export async function updateStoreDisplay() {
    // Шукаємо повні дані про себе в списку юзерів (бо в state.currentUser може не бути storeId)
    const me = state.users.find(u => u.name === state.currentUser?.name);
    if (!me || !me.storeId) return;

    try {
        // Отримуємо список магазинів, щоб знайти назву за ID
        const stores = await fetchJson('/api/stores'); // Це кешований запит, швидко
        const myStore = stores.find(s => s._id === me.storeId || s.code === me.storeId); // На всяк випадок

        if (myStore) {
            const nameContainer = document.querySelector('#userNameDisplay').parentNode;
            
            // Видаляємо старий лейбл якщо є
            const oldLabel = document.getElementById('storeNameLabel');
            if (oldLabel) oldLabel.remove();

            // Додаємо назву магазину
            const label = document.createElement('div');
            label.id = 'storeNameLabel';
            label.className = "text-[10px] text-gray-400 font-bold uppercase tracking-wider mt-0.5";
            label.innerText = myStore.name;
            nameContainer.appendChild(label);
        }
    } catch (e) { console.error(e); }
}

export async function openTransferModal() {
    closeAvatarModal(); // Закриваємо попереднє вікно
    triggerHaptic();

    // Знаходимо свій поточний магазин
    const me = state.users.find(u => u.name === state.currentUser?.name);
    const currentStoreId = me ? me.storeId : null;

    // Завантажуємо магазини
    let stores = [];
    try {
        stores = await fetchJson('/api/stores');
    } catch (e) {
        return showToast("Не вдалося завантажити список магазинів", 'error');
    }

    // Фільтруємо: прибираємо поточний
    const availableStores = stores.filter(s => s._id !== currentStoreId);

    // Створюємо HTML модального вікна динамічно
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

// Функція відправки (має бути глобальною, щоб HTML її бачив)
window.submitTransferRequest = async function() {
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
    
    // Кнопка "Всі співробітники"
    let html = `
        <button onclick="window.applyFilter('all')" class="w-full text-left p-3 rounded-xl flex justify-between items-center ${state.filter === 'all' ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-500 font-bold' : 'hover:bg-gray-50 dark:hover:bg-[#2C2C2E]'}">
            <span class="font-medium">Всі співробітники</span>
            ${state.filter === 'all' ? '<span>✓</span>' : ''}
        </button>`;

    // Список юзерів
    state.users.forEach(u => {
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

// --- AVATAR ---

export function openAvatarModal() {
    triggerHaptic();
    const modal = document.getElementById('avatarModal');
    modal.classList.remove('hidden');

    // 🔥 ДОДАЄМО КНОПКУ ТРАНСФЕРУ, ЯКЩО ЇЇ ЩЕ НЕМАЄ
    const container = modal.querySelector('.glass-modal');
    // Перевіряємо, щоб не дублювати
    if (!document.getElementById('btnOpenTransfer') && state.currentUser.role !== 'Guest') {
        const btn = document.createElement('button');
        btn.id = 'btnOpenTransfer';
        btn.className = "w-full py-2 text-blue-500 font-medium text-sm rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors border-t border-gray-100 dark:border-gray-800 mt-2 flex items-center justify-center gap-2";
        btn.innerHTML = "🔄 Змінити Магазин";
        btn.onclick = openTransferModal;
        
        // Вставляємо перед блоком зміни паролю (він останній)
        const lastDiv = container.lastElementChild; 
        container.insertBefore(btn, lastDiv);
    }
}

export function closeAvatarModal() {
    document.getElementById('avatarModal').classList.add('hidden');
}

export function handleAvatarSelect(input) {
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = function(e) {
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
    
    // Використовуємо Canvas для стиснення зображення
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const size = 200; // Розмір квадрата
    
    canvas.width = size;
    canvas.height = size;
    
    const img = new Image();
    img.onload = function() {
        // Центрування та обрізка (Crop)
        const minSide = Math.min(img.width, img.height);
        const sx = (img.width - minSide) / 2;
        const sy = (img.height - minSide) / 2;
        
        ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);
        
        const dataUrl = canvas.toDataURL('image/jpeg', 0.7); // Якість 70%
        
        postJson('/api/user/avatar', { avatar: dataUrl }).then(data => {
            if (data.success) {
                // Оновлюємо аватарку в шапці
                document.getElementById('userAvatarImg').src = dataUrl;
                document.getElementById('userAvatarImg').classList.remove('hidden');
                document.getElementById('userAvatarPlaceholder').classList.add('hidden');
                
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