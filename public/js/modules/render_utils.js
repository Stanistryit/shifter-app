import { state } from './state.js';

// Фільтрація користувачів для відображення
export function getUsersForView(viewMonthStr) {
    let users = Array.isArray(state.users) ? state.users : [];
    const shifts = Array.isArray(state.shifts) ? state.shifts : [];

    const isAllStoresAdmin = state.currentUser?.role === 'admin' && state.selectedStoreFilter === 'all';
    const effectiveStoreFilter = (state.currentUser?.role === 'admin' && state.selectedStoreFilter && state.selectedStoreFilter !== 'all')
        ? state.selectedStoreFilter
        : (!isAllStoresAdmin ? (state.currentUser?.storeId?._id || state.currentUser?.storeId) : null);

    // 1. Фільтр по магазину
    if (effectiveStoreFilter && effectiveStoreFilter !== 'all') {
        users = users.filter(u => {
            if (String(u.storeId?._id || u.storeId) === String(effectiveStoreFilter)) return true;
            if (state.usersToShow && state.usersToShow.includes(u.name)) return true;
            const hasShiftHere = shifts.some(s => s.name === u.name && s.date && s.date.startsWith(viewMonthStr) && String(s.storeId?._id || s.storeId) === String(effectiveStoreFilter));
            if (hasShiftHere) return true;
            const hasDraftHere = state.pendingChanges && Object.values(state.pendingChanges).some(d => d.name === u.name && d.date && d.date.startsWith(viewMonthStr) && String(d.storeId?._id || d.storeId) === String(effectiveStoreFilter));
            if (hasDraftHere) return true;
            return false;
        });
    }

    // 2. Фільтр по конкретному співробітнику (Local Filter)
    if (state.filter !== 'all') {
        users = users.filter(u => u.name === state.filter);
    }

    let filtered = users.filter(u => {
        if (state.currentUser && u.name === state.currentUser.name) return true;
        if (u.status !== 'blocked') return true;

        // Показуємо заблокованих, якщо у них є зміни в цьому місяці
        const hasShifts = shifts.some(s => s.name === u.name && s.date && s.date.startsWith(viewMonthStr));
        return hasShifts;
    });

    return filtered.sort((a, b) => {
        // 1. Сортування за пріоритетом (sortOrder)
        const orderA = (a.sortOrder !== undefined && a.sortOrder !== null) ? a.sortOrder : 999;
        const orderB = (b.sortOrder !== undefined && b.sortOrder !== null) ? b.sortOrder : 999;
        if (orderA !== orderB) return orderA - orderB;

        // 2. "Я" завжди перший серед рівних
        if (state.currentUser && a.name === state.currentUser.name) return -1;
        if (state.currentUser && b.name === state.currentUser.name) return 1;

        // 3. Групування за посадою (SM -> SSE -> SE -> Інші)
        const roleWeights = { 'SM': 1, 'SSE': 2, 'SE': 3, 'RRP': 4, 'Intern': 5 };
        const wA = roleWeights[a.position] || 99;
        const wB = roleWeights[b.position] || 99;
        if (wA !== wB) return wA - wB;

        // 4. Алфавітне сортування
        return (a.name || '').localeCompare(b.name || '');
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