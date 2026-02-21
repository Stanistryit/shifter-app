import { state } from './state.js';
import { getUsersForView, getDisplayName } from './render_utils.js';

// Допоміжна функція: переведення часу "10:30" -> 10.5
function timeToDec(t) {
    if (!t || t === 'Відпустка' || t === 'Лікарняний' || t === 'DELETE') return 0;
    const [h, m] = t.split(':').map(Number);
    return h + (m / 60);
}

// 🔥 Кольорове кодування змін залежно від часу початку
function getShiftColor(start) {
    if (!start) return 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200';

    const h = parseInt(start.split(':')[0], 10);

    // 🌅 Ранок (до 11:00) -> Помаранчевий
    if (h < 11) {
        return 'bg-orange-100 dark:bg-orange-900/40 text-orange-800 dark:text-orange-200 border border-orange-200 dark:border-orange-800';
    }
    // ☀️ День (11:00 - 15:00) -> Блакитний
    else if (h < 15) {
        return 'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200 border border-blue-200 dark:border-blue-800';
    }
    // 🌆 Вечір (після 15:00) -> Фіолетовий
    else {
        return 'bg-purple-100 dark:bg-purple-900/40 text-purple-800 dark:text-purple-200 border border-purple-200 dark:border-purple-800';
    }
}

export function renderTable() {
    const container = document.getElementById('gridViewContainer');
    const tableDiv = document.getElementById('gridViewTable');
    if (!tableDiv) return;

    tableDiv.innerHTML = '';

    const tTitle = document.getElementById('gridTitle');
    const y = state.currentDate.getFullYear();
    const m = state.currentDate.getMonth();

    if (tTitle) {
        tTitle.innerText = new Date(y, m).toLocaleDateString('uk-UA', { month: 'long', year: 'numeric' });
    }

    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const now = new Date();
    const isCurrentMonth = now.getFullYear() === y && now.getMonth() === m;
    const todayDate = now.getDate();
    const todayStr = now.toISOString().split('T')[0];
    const viewMonthStr = `${y}-${String(m + 1).padStart(2, '0')}`;

    let openTime = "10:00";
    let closeTime = "22:00";

    if (state.currentUser.store && state.currentUser.store.openTime) {
        openTime = state.currentUser.store.openTime;
        closeTime = state.currentUser.store.closeTime;
    }
    else if (state.stores && state.currentUser.storeId) {
        const foundStore = state.stores.find(s => s._id === state.currentUser.storeId || s.code === state.currentUser.storeId);
        if (foundStore) {
            openTime = foundStore.openTime || "10:00";
            closeTime = foundStore.closeTime || "22:00";
        }
    }

    const monthNorm = state.kpiData?.settings?.normHours || 0;

    let html = '<table class="w-full text-xs border-collapse select-none">';

    // ================= HEADER =================
    html += '<thead>';
    html += '<tr class="h-10 border-b border-gray-100 dark:border-gray-800">';
    html += '<th class="sticky left-0 z-20 bg-[#F2F2F7] dark:bg-[#1C1C1E] px-2 text-left font-bold min-w-[120px] border-r border-gray-200 dark:border-gray-700 shadow-sm">Співробітник</th>';

    for (let d = 1; d <= daysInMonth; d++) {
        const isToday = isCurrentMonth && d === todayDate;
        const dateObj = new Date(y, m, d);
        const dayName = dateObj.toLocaleDateString('uk-UA', { weekday: 'short' });
        const isWeekend = dateObj.getDay() === 0 || dateObj.getDay() === 6;
        const dStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const isPast = dStr < todayStr;

        let bgClass = 'bg-white dark:bg-[#1C1C1E] text-gray-500 dark:text-gray-400';
        if (isPast) bgClass = 'bg-gray-100 text-gray-300 dark:bg-[#151515] dark:text-gray-600';
        else if (isWeekend) bgClass = 'bg-red-50 dark:bg-red-900/20 text-red-500';

        const thId = isToday ? 'id="todayColumn"' : '';
        if (isToday) bgClass = 'bg-blue-500 text-white shadow-md shadow-blue-500/30 rounded-t-lg transform scale-105 z-30 ring-2 ring-blue-500';

        html += `<th ${thId} class="px-1 text-center min-w-[40px] font-normal ${bgClass} border-r border-gray-100 dark:border-gray-800 relative group cursor-default">
            <div class="font-bold text-[13px]">${d}</div>
            <div class="text-[9px] opacity-80 uppercase">${dayName}</div>
        </th>`;
    }

    html += '<th class="sticky right-0 z-20 bg-[#F2F2F7] dark:bg-[#1C1C1E] px-2 text-center font-bold min-w-[80px] border-l border-gray-200 dark:border-gray-700 shadow-sm">Години</th>';
    html += '</tr>';

    // --- Рядок 2: Кількість людей ---
    html += '<tr class="h-6 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#202022]">';
    html += '<td class="sticky left-0 z-20 bg-[#F2F2F7] dark:bg-[#1C1C1E] px-2 text-[10px] text-gray-400 font-bold border-r border-gray-200 dark:border-gray-700 text-right">Людей:</td>';

    for (let d = 1; d <= daysInMonth; d++) {
        const dStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

        const dayShifts = state.shifts.filter(s => s.date === dStr && s.start !== 'Відпустка' && s.start !== 'Лікарняний');
        const dayDrafts = state.pendingChanges ? Object.values(state.pendingChanges).filter(p => p.date === dStr) : [];

        const finalShifts = [];
        const processedUsers = new Set();

        dayDrafts.forEach(draft => {
            processedUsers.add(draft.name);
            if (draft.start !== 'DELETE' && draft.start !== 'Відпустка' && draft.start !== 'Лікарняний') {
                finalShifts.push(draft);
            }
        });

        dayShifts.forEach(shift => {
            if (!processedUsers.has(shift.name)) {
                finalShifts.push(shift);
            }
        });

        let relevantShifts = finalShifts;
        if (state.selectedStoreFilter && state.selectedStoreFilter !== 'all') {
            relevantShifts = finalShifts.filter(s => {
                const u = state.users.find(usr => usr.name === s.name);
                return u && String(u.storeId) === String(state.selectedStoreFilter);
            });
        }

        // Розрахунок покриття (хто закриває, хто відкриває)
        const count = relevantShifts.length;
        const openTimeDec = timeToDec(openTime);
        const closeTimeDec = timeToDec(closeTime);

        let openers = 0;
        let closers = 0;

        relevantShifts.forEach(s => {
            const startD = timeToDec(s.start);
            const endD = timeToDec(s.end);

            // Людина вважається "відкриваючою", якщо прийшла до або рівно в час відкриття
            if (startD > 0 && startD <= openTimeDec) openers++;

            // Людина вважається "закриваючою", якщо йде після або рівно в час закриття
            if (endD > 0 && endD >= closeTimeDec) closers++;
        });

        let badgeClass = "text-gray-500";
        let contentHtml = count > 0 ? count : '-';

        if (count > 0 && (openers < 2 || closers < 2)) {
            badgeClass = "bg-red-100 text-red-600 font-bold";
            // Якщо не вистачає і відкриваючих, і закриваючих
            if (openers < 2 && closers < 2) {
                contentHtml = `<div class="flex items-center justify-center gap-0.5" title="Не вистачає відкриваючих та закриваючих"><span>${count}</span><span class="text-[8px]">⚠️</span></div>`;
            } else if (openers < 2) {
                contentHtml = `<div class="flex items-center justify-center gap-0.5" title="Не вистачає тих, хто відкриває"><span>${count}</span><span class="text-[8px]">🌅</span></div>`;
            } else {
                contentHtml = `<div class="flex items-center justify-center gap-0.5" title="Не вистачає тих, хто закриває"><span>${count}</span><span class="text-[8px]">🌙</span></div>`;
            }
        } else if (count > 0) {
            badgeClass = "text-green-600 font-medium";
        }

        html += `<td class="text-center border-r border-gray-100 dark:border-gray-800 text-[10px] ${badgeClass}">
            ${contentHtml}
        </td>`;
    }
    html += '<td class="sticky right-0 bg-[#F2F2F7] dark:bg-[#1C1C1E] border-l border-gray-200 dark:border-gray-700"></td>';
    html += '</tr>';
    html += '</thead>';

    // ================= BODY =================
    html += '<tbody>';

    let usersToShow = getUsersForView(viewMonthStr);
    const canEditUser = ['SM', 'admin'].includes(state.currentUser.role);

    usersToShow.forEach(user => {
        const shortName = getDisplayName(user);

        const editAction = canEditUser ? `onclick="window.openEditUserProxy('${user._id}')"` : '';
        const editClasses = canEditUser ? "cursor-pointer hover:text-blue-500" : "";
        const editIcon = canEditUser ? ' <span class="text-[9px] opacity-30">✏️</span>' : '';
        const blockedClass = user.status === 'blocked' ? 'opacity-50 grayscale' : '';

        const isMe = user.name === state.currentUser.name;
        const meStyleSticky = isMe ? 'bg-[#F0F9FF] dark:bg-[#1A2F4B] text-blue-600 dark:text-blue-400' : 'bg-white dark:bg-[#1C1C1E]';

        html += `<tr class="h-10 border-b border-gray-50 dark:border-gray-800/50 hover:bg-gray-50 dark:hover:bg-[#2C2C2E] transition-colors ${blockedClass}">`;

        html += `<td ${editAction} class="sticky left-0 z-10 ${meStyleSticky} ${editClasses} px-2 border-r border-gray-200 dark:border-gray-700 font-medium text-[11px] truncate max-w-[120px] shadow-sm">${shortName}${editIcon}</td>`;

        let totalHours = 0;

        for (let d = 1; d <= daysInMonth; d++) {
            const ds = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const isToday = isCurrentMonth && d === todayDate;
            const isPast = ds < todayStr;

            const draftKey = `${ds}_${user.name}`;
            const draft = state.pendingChanges ? state.pendingChanges[draftKey] : null;
            const shift = state.shifts.find(s => s.date === ds && s.name === user.name);

            let sStart, sEnd;
            if (draft) {
                if (draft.start !== 'DELETE' && draft.start !== 'Відпустка' && draft.start !== 'Лікарняний') { sStart = draft.start; sEnd = draft.end; }
            } else if (shift) {
                if (shift.start !== 'Відпустка' && shift.start !== 'Лікарняний') { sStart = shift.start; sEnd = shift.end; }
            }

            let duration = 0;
            if (sStart && sEnd) {
                duration = timeToDec(sEnd) - timeToDec(sStart);
                totalHours += duration;
            }

            // 🔥 Бейдж з годинами
            let badgeHtml = '';
            if (duration > 0) {
                const durStr = parseFloat(duration.toFixed(1));
                badgeHtml = `<div class="absolute -top-1.5 -right-1.5 z-10 bg-white dark:bg-[#3A3A3C] text-black dark:text-white text-[8px] font-bold px-1 rounded-full shadow-sm border border-gray-200 dark:border-gray-600 flex items-center justify-center min-w-[14px] h-[14px] leading-none">${durStr}</div>`;
            }

            let cellClass = '';
            if (isPast) cellClass = 'bg-gray-50/50 dark:bg-[#121212] text-gray-300';
            if (isToday) cellClass = 'bg-blue-50/50 dark:bg-blue-900/20 border-x-2 border-blue-200 dark:border-blue-800 relative z-0';

            const dataAttrs = `data-date="${ds}" data-name="${user.name}"`;
            let content = '';

            if (draft) {
                cellClass += ' bg-yellow-50 dark:bg-yellow-900/20';
                if (draft.start === 'DELETE') {
                    content = '<span class="text-red-400 font-bold opacity-50">✕</span>';
                } else if (draft.start === 'Відпустка') {
                    content = '<span class="text-lg">🌴</span><div class="absolute top-1 right-1 w-1.5 h-1.5 bg-yellow-500 rounded-full animate-pulse"></div>';
                } else if (draft.start === 'Лікарняний') {
                    content = '<span class="text-lg">💊</span><div class="absolute top-1 right-1 w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse"></div>';
                } else {
                    // Draft + Badge
                    content = `<div class="relative text-[10px] font-mono leading-tight bg-yellow-100 dark:bg-yellow-800/50 text-yellow-800 dark:text-yellow-200 rounded px-1 py-0.5 border border-yellow-300 dark:border-yellow-600 shadow-sm transform scale-105">
                        ${draft.start}<br>${draft.end}
                        ${badgeHtml}
                    </div>`;
                }
            } else if (shift) {
                if (shift.start === 'Відпустка') {
                    content = '<span class="text-lg">🌴</span>';
                } else if (shift.start === 'Лікарняний') {
                    content = '<span class="text-lg">💊</span>';
                } else {
                    const opacity = isPast ? 'opacity-50 grayscale' : '';
                    const colorClass = getShiftColor(shift.start);
                    // Shift + Badge
                    content = `<div class="relative text-[10px] font-mono leading-tight ${colorClass} rounded px-1 py-0.5 ${opacity}">
                        ${shift.start}<br>${shift.end}
                        ${badgeHtml}
                    </div>`;
                }
            }

            html += `<td ${dataAttrs} class="shift-cell text-center p-0.5 border-r border-gray-100 dark:border-gray-800 ${cellClass} cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">${content}</td>`;
        }

        let hoursHtml = `<div class="font-bold">${totalHours}</div>`;
        if (monthNorm > 0) {
            const diff = parseFloat((totalHours - monthNorm).toFixed(1));
            let diffClass = diff >= 0 ? "text-green-500" : "text-red-500";
            let diffSign = diff > 0 ? "+" : "";
            hoursHtml = `
                <div class="flex flex-col leading-none">
                    <span class="font-bold text-[11px]">${totalHours} <span class="text-gray-400 font-normal">/ ${monthNorm}</span></span>
                    <span class="text-[9px] ${diffClass} font-bold">${diffSign}${diff}</span>
                </div>
            `;
        } else {
            hoursHtml = `<div class="font-bold text-gray-500">${totalHours}</div>`;
        }

        html += `<td class="sticky right-0 z-10 ${meStyleSticky} border-l border-gray-200 dark:border-gray-700 text-center px-1 shadow-sm">${hoursHtml}</td>`;
        html += '</tr>';
    });
    html += '</tbody></table>';
    tableDiv.innerHTML = html;

    // 🔥 FIX: Скролимо таблицю до "сьогодні" ТІЛЬКИ по горизонталі.
    // Це залишає Дашборд у фокусі (без вертикальних стрибків сторінки).
    setTimeout(() => {
        const todayCol = document.getElementById('todayColumn');
        if (todayCol && tableDiv) {
            // Обчислюємо позицію: відступ колонки мінус половина екрану, щоб колонка стала по центру
            const scrollPos = todayCol.offsetLeft - (tableDiv.offsetWidth / 2) + (todayCol.offsetWidth / 2);
            tableDiv.scrollTo({
                left: scrollPos,
                behavior: 'smooth'
            });
        }
    }, 100);
}