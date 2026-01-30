import { state } from './state.js';
import { fetchJson, postJson } from './api.js';
import { showToast, triggerHaptic } from './ui.js';
import { renderAll } from './render.js';

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
    document.getElementById('avatarModal').classList.remove('hidden');
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