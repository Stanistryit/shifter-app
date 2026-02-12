import { state } from './state.js';

// Фільтрація користувачів для відображення
export function getUsersForView(viewMonthStr) {
    let users = state.users;
    
    // 1. Фільтр по магазину (Для Global Admin)
    if (state.selectedStoreFilter && state.selectedStoreFilter !== 'all') {
        users = users.filter(u => String(u.storeId) === String(state.selectedStoreFilter));
    }

    // 2. Фільтр по конкретному співробітнику (Local Filter)
    if (state.filter !== 'all') {
        users = users.filter(u => u.name === state.filter);
    }

    let filtered = users.filter(u => {
        if (u.name === state.currentUser.name) return true; 
        if (u.status !== 'blocked') return true; 
        
        // Показуємо заблокованих, якщо у них є зміни в цьому місяці
        const hasShifts = state.shifts.some(s => s.name === u.name && s.date.startsWith(viewMonthStr));
        return hasShifts;
    });

    return filtered.sort((a, b) => {
        // 1. Сортування за пріоритетом (sortOrder)
        // За замовчуванням у всіх 999. Якщо хтось має 1, 2, 3 - вони будуть вище.
        const orderA = (a.sortOrder !== undefined && a.sortOrder !== null) ? a.sortOrder : 999;
        const orderB = (b.sortOrder !== undefined && b.sortOrder !== null) ? b.sortOrder : 999;

        if (orderA !== orderB) {
            return orderA - orderB;
        }

        // 2. Якщо пріоритет однаковий (наприклад, у всіх 999) - "Я" завжди перший серед рівних
        if (a.name === state.currentUser.name) return -1;
        if (b.name === state.currentUser.name) return 1;

        // 3. Алфавітне сортування
        return a.name.localeCompare(b.name);
    });
}

// Форматування імені (Ім'я П. + Посада)
export function getDisplayName(user) {
    if (!user) return 'Анонім';
    const nameToParse = user.fullName || user.name || '';
    const parts = nameToParse.trim().split(/\s+/);
    
    let displayName = parts[0];
    if (parts.length > 1) {
        displayName = `${parts[1]} ${parts[0][0]}.`;
    }
    
    if (user.position && user.position !== 'None' && user.position !== 'Guest') {
        displayName += ` ${user.position}`;
    }
    
    return displayName;
}