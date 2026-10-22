import { state } from './state.js';
import { getUsersForView, getDisplayName } from './render_utils.js';

// 🍎 iOS TOUCH SCROLL FIX — registered ONCE at module level to avoid stacking
// user-scalable=no in the viewport meta blocks overflow-x:auto touch scroll on iOS Safari.
// This handler manually moves scrollLeft for horizontal swipes.
let _iosScrollHandlerInit = false;
function initIosTableScroll() {
    if (_iosScrollHandlerInit) return;
    _iosScrollHandlerInit = true;

    let startX = 0, startY = 0, startLeft = 0, isHoriz = false, decided = false;

    document.addEventListener('touchstart', (e) => {
        const el = document.getElementById('gridViewTable');
        if (!el || !el.contains(e.target)) return;
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        startLeft = el.scrollLeft;
        isHoriz = false;
        decided = false;
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
        const el = document.getElementById('gridViewTable');
        if (!el || !el.contains(e.target)) return;

        const dx = startX - e.touches[0].clientX;
        const dy = startY - e.touches[0].clientY;

        if (!decided) {
            if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return; // wait for clearer signal
            decided = true;
            isHoriz = Math.abs(dx) > Math.abs(dy);
        }

        if (isHoriz) {
            e.preventDefault();
            el.scrollLeft = startLeft + dx;
        }
    }, { passive: false });
}

// Допоміжна функція: переведення часу "10:30" -> 10.5
function timeToDec(t) {
    if (!t || t === 'Відпустка' || t === 'Лікарняний' || t === 'Донорство' || t === 'DELETE') return 0;
    const [h, m] = t.split(':').map(Number);
    return h + (m / 60);
}

// 🔥 Всі варіанти кольорів для змін
const shiftColors = [
    'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200 border border-blue-200 dark:border-blue-800',
    'bg-purple-100 dark:bg-purple-900/40 text-purple-800 dark:text-purple-200 border border-purple-200 dark:border-purple-800',
    'bg-orange-100 dark:bg-orange-900/40 text-orange-800 dark:text-orange-200 border border-orange-200 dark:border-orange-800',
    'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-200 border border-green-200 dark:border-green-800',
    'bg-pink-100 dark:bg-pink-900/40 text-pink-800 dark:text-pink-200 border border-pink-200 dark:border-pink-800',
    'bg-teal-100 dark:bg-teal-900/40 text-teal-800 dark:text-teal-200 border border-teal-200 dark:border-teal-800',
    'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-800 dark:text-indigo-200 border border-indigo-200 dark:border-indigo-800',
    'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-200 border border-yellow-200 dark:border-yellow-800',
    'bg-rose-100 dark:bg-rose-900/40 text-rose-800 dark:text-rose-200 border border-rose-200 dark:border-rose-800',
    'bg-cyan-100 dark:bg-cyan-900/40 text-cyan-800 dark:text-cyan-200 border border-cyan-200 dark:border-cyan-800'
];

const popularShiftsMap = {
    '10:00-19:00': 0, // blue
    '09:30-18:30': 3, // green
    '11:30-20:30': 2, // orange
    '12:00-21:00': 1, // purple
    '13:00-22:00': 6, // indigo
    '14:00-22:00': 9, // cyan
    '09:00-18:00': 5, // teal
    '08:00-17:00': 7, // yellow
    '10:30-19:30': 4, // pink
    '11:00-20:00': 8  // rose
};

// 🔥 Кольорове кодування змін залежно від графіку (однакові зміни = однакові кольори)
function getShiftColor(start, end) {
    if (!start || !end) return 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 border border-gray-200 dark:border-gray-700';

    const shiftKey = `${start}-${end}`;

    if (popularShiftsMap[shiftKey] !== undefined) {
        return shiftColors[popularShiftsMap[shiftKey]];
    }

    // Простий генератор хешу з рядка (djb2 алгоритм)
    let hash = 5381;
    for (let i = 0; i < shiftKey.length; i++) {
        hash = (hash * 33) ^ shiftKey.charCodeAt(i);
    }

    // Беремо модуль по кількості доступних кольорів (робимо хеш позитивним)
    const colorIndex = Math.abs(hash) % shiftColors.length;

    return shiftColors[colorIndex];
}

export function renderTable() {
    const container = document.getElementById('gridViewContainer');
    const tableDiv = document.getElementById('gridViewTable');
    if (!tableDiv) return;

    if (!state.currentUser) return;

    const isManager = state.currentUser.role === 'SM' || state.currentUser.role === 'admin';
    const pdfExportWrapper = document.getElementById('pdfExportBtnWrapper');
    if (pdfExportWrapper) {
        if (isManager) {
            pdfExportWrapper.classList.remove('hidden');
        } else {
            pdfExportWrapper.classList.add('hidden');
        }
    }

    const sheetsSyncWrapper = document.getElementById('sheetsSyncBtnWrapper');
    if (sheetsSyncWrapper) {
        if (isManager) {
            sheetsSyncWrapper.classList.remove('hidden');
        } else {
            sheetsSyncWrapper.classList.add('hidden');
        }
    }

    // Зберігаємо позицію скролу до перемальовування
    const previousScrollX = tableDiv.scrollLeft;

    tableDiv.innerHTML = '';

    const tTitle = document.getElementById('gridTitle');
    const y = state.currentDate.getFullYear();
    const m = state.currentDate.getMonth();

    if (tTitle) {
        tTitle.innerText = new Date(y, m).toLocaleDateString('uk-UA', { month: 'long', year: 'numeric' });
    }

    if (window.updateFilterUI) window.updateFilterUI();

    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const now = new Date();
    const isCurrentMonth = now.getFullYear() === y && now.getMonth() === m;
    const todayDate = now.getDate();
    const todayStr = now.toISOString().split('T')[0];
    const viewMonthStr = `${y}-${String(m + 1).padStart(2, '0')}`;

    let openTime = "10:00";
    let closeTime = "22:00";

    const isAllStoresAdmin = state.currentUser?.role === 'admin' && state.selectedStoreFilter === 'all';

    // Надійно беремо час роботи з масиву всіх магазинів (state.stores)
    const activeStoreId = (state.currentUser?.role === 'admin' && state.selectedStoreFilter && state.selectedStoreFilter !== 'all')
        ? state.selectedStoreFilter
        : (state.currentUser?.storeId?._id || state.currentUser?.storeId || (state.selectedStoreFilter !== 'all' ? state.selectedStoreFilter : null));

    let monthNorm = 0;

    if (state.stores && activeStoreId) {
        const foundStore = state.stores.find(s => String(s._id) === String(activeStoreId) || String(s.code) === String(activeStoreId));
        if (foundStore) {
            if (foundStore.openTime) openTime = foundStore.openTime;
            if (foundStore.closeTime) closeTime = foundStore.closeTime;
            if (foundStore.normHours) monthNorm = foundStore.normHours[viewMonthStr] || 0;
        }
    }

    // Якщо в state.stores не знайшло (або його ще немає), пробуємо взяти з populated currentUser
    if (openTime === "10:00" && closeTime === "22:00" && monthNorm === 0) {
        const userStoreObj = state.currentUser?.store || state.currentUser?.storeId;
        if (userStoreObj && typeof userStoreObj === 'object') {
            if (userStoreObj.openTime) openTime = userStoreObj.openTime;
            if (userStoreObj.closeTime) closeTime = userStoreObj.closeTime;
            if (userStoreObj.normHours) monthNorm = userStoreObj.normHours[viewMonthStr] || 0;
        }
    }

    let usersToShow = getUsersForView(viewMonthStr);

    // Розділяємо співробітників на:
    // - Основний штат поточного магазину (homeUsers)
    // - Гості з інших магазинів, які мають зміни в цьому магазині в поточному місяці (guestUsers)
    let homeUsers = [];
    let guestUsers = [];

    if (activeStoreId && !isAllStoresAdmin) {
        usersToShow.forEach(user => {
            const userHomeStoreId = user.storeId ? (user.storeId._id || user.storeId) : null;
            const isGuest = userHomeStoreId && String(userHomeStoreId) !== String(activeStoreId);

            if (isGuest) {
                const hasShiftHere = (state.shifts || []).some(s => 
                    s.name === user.name && 
                    s.date.startsWith(viewMonthStr) && 
                    String(s.storeId?._id || s.storeId) === String(activeStoreId)
                );
                const hasDraftHere = state.pendingChanges && Object.values(state.pendingChanges).some(d => 
                    d.name === user.name && 
                    d.date.startsWith(viewMonthStr) && 
                    String(d.storeId?._id || d.storeId) === String(activeStoreId)
                );

                if (hasShiftHere || hasDraftHere) {
                    guestUsers.push(user);
                }
            } else {
                homeUsers.push(user);
            }
        });
    } else {
        homeUsers = usersToShow;
        guestUsers = [];
    }


    
    let storeTotalHours = 0;
    let storeTotalDonorHours = 0;
    
    usersToShow.forEach(user => {
        for (let d = 1; d <= daysInMonth; d++) {
            const ds = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const draft = state.pendingChanges ? state.pendingChanges[`${ds}_${user.name}`] : null;
            let sStart = null, sEnd = null;
            
            const userHomeStoreId = user.storeId ? (user.storeId._id || user.storeId) : null;
            if (draft) {
                // Check store match for hours computation
                const dStoreId = draft.storeId ? (draft.storeId._id || draft.storeId) : userHomeStoreId;
                const countsForStore = isAllStoresAdmin || (String(dStoreId) === String(activeStoreId));
                if (countsForStore) {
                    if (draft.start !== 'DELETE' && draft.start !== 'Відпустка' && draft.start !== 'Лікарняний' && draft.start !== 'Донорство') { sStart = draft.start; sEnd = draft.end; }
                    if (draft.start === 'Донорство') storeTotalDonorHours += 8;
                }
            } else {
                const shift = state.shifts.find(s => s.date === ds && s.name === user.name);
                if (shift) {
                    const sStoreId = shift.storeId ? (shift.storeId._id || shift.storeId) : userHomeStoreId;
                    const countsForStore = isAllStoresAdmin || (String(sStoreId) === String(activeStoreId));
                    if (countsForStore) {
                        if (shift.start !== 'Відпустка' && shift.start !== 'Лікарняний' && shift.start !== 'Донорство') { sStart = shift.start; sEnd = shift.end; }
                        if (shift.start === 'Донорство') storeTotalDonorHours += 8;
                    }
                }
            }
            if (sStart && sEnd) {
                const [h1, m1] = sStart.split(':').map(Number);
                const [h2, m2] = sEnd.split(':').map(Number);
                
                let lunchMins = 60;
                if (state.currentUser.store && state.currentUser.store.lunch_duration_minutes !== undefined) {
                    lunchMins = state.currentUser.store.lunch_duration_minutes;
                } else if (state.stores && state.currentUser.storeId) {
                    const foundStore = state.stores.find(s => String(s._id) === String(state.currentUser.storeId) || s.code === state.currentUser.storeId);
                    if (foundStore && foundStore.lunch_duration_minutes !== undefined) lunchMins = foundStore.lunch_duration_minutes;
                }
                
                let dur = (h2 + m2 / 60) - (h1 + m1 / 60) - (lunchMins / 60);
                if (dur < 0) dur = 0;
                storeTotalHours += dur;
            }
        }
    });

    let storeTotalNorm = 0;
    if (monthNorm > 0) {
        // Find store FTE
        let storeFte = 1;
        if (state.stores && activeStoreId) {
            const foundStore = state.stores.find(s => String(s._id) === String(activeStoreId) || String(s.code) === String(activeStoreId));
            if (foundStore && foundStore.fte) storeFte = foundStore.fte;
        } else if (state.currentUser && state.currentUser.store && state.currentUser.store.fte) {
            storeFte = state.currentUser.store.fte;
        }
        
        // If FTE is specified, use it for total norm. If not, fallback to usersToShow.length
        if (storeFte > 0) {
            storeTotalNorm = Math.round(monthNorm * storeFte);
        } else {
            storeTotalNorm = monthNorm * homeUsers.length;
        }
    }

    let storeHoursText = `<span class="text-gray-600 dark:text-gray-300">${storeTotalHours}</span>`;
    if (storeTotalDonorHours > 0) storeHoursText += `<span class="text-indigo-500 text-[8px] ml-0.5">+${storeTotalDonorHours}</span>`;
    if (storeTotalNorm > 0) storeHoursText += `<span class="text-gray-400 font-normal mx-0.5">\\</span><span class="text-gray-500">${storeTotalNorm}</span>`;

    let html = '<table class="w-full text-xs border-collapse">';

    // ================= HEADER =================
    html += '<thead>';
    html += '<tr class="h-10 border-b border-gray-100 dark:border-gray-800">';
    html += '<th class="sticky left-0 z-40 bg-[#F2F2F7] dark:bg-[#1C1C1E] px-2 text-left font-bold min-w-[120px] border-r border-gray-200 dark:border-gray-700 shadow-sm">Співробітник</th>';

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

        let thId = `id="grid-col-${dStr}"`;
        if (isToday) {
            bgClass = 'bg-blue-500 text-white shadow-md shadow-blue-500/30 rounded-t-lg transform scale-105 z-30 ring-2 ring-blue-500';
            thId = `id="todayColumn"`;
        }

        html += `<th ${thId} class="px-1 text-center min-w-[40px] font-normal ${bgClass} border-r border-gray-100 dark:border-gray-800 relative group cursor-default">
            <div class="font-bold text-[13px]">${d}</div>
            <div class="text-[9px] opacity-80 uppercase">${dayName}</div>
        </th>`;
    }

    const hoursStickyClass = state.isHoursPinned ? 'sticky right-0 z-40' : '';
    html += `<th class="${hoursStickyClass} bg-[#F2F2F7] dark:bg-[#1C1C1E] px-2 text-center font-bold min-w-[80px] border-l border-gray-200 dark:border-gray-700 shadow-sm">Години</th>`;
    html += '</tr>';

    // --- Рядок 2: Кількість людей ---
    html += '<tr class="h-6 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#202022]">';
    html += '<td class="sticky left-0 z-40 bg-[#F2F2F7] dark:bg-[#1C1C1E] px-2 text-[10px] text-gray-400 font-bold border-r border-gray-200 dark:border-gray-700 text-right">Людей:</td>';

    for (let d = 1; d <= daysInMonth; d++) {
        const dStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

        const dayShifts = state.shifts.filter(s => s.date === dStr && s.start !== 'Відпустка' && s.start !== 'Лікарняний' && s.start !== 'Донорство');
        const dayDrafts = state.pendingChanges ? Object.values(state.pendingChanges).filter(p => p.date === dStr) : [];

        const finalShifts = [];
        const processedUsers = new Set();

        dayDrafts.forEach(draft => {
            processedUsers.add(draft.name);
            if (draft.start !== 'DELETE' && draft.start !== 'Відпустка' && draft.start !== 'Лікарняний' && draft.start !== 'Донорство') {
                finalShifts.push(draft);
            }
        });

        dayShifts.forEach(shift => {
            if (!processedUsers.has(shift.name)) {
                finalShifts.push(shift);
            }
        });

        let relevantShifts = finalShifts;
        if (!isAllStoresAdmin && activeStoreId) {
            relevantShifts = finalShifts.filter(s => {
                const sStoreId = s.storeId?._id || s.storeId;
                return sStoreId && String(sStoreId) === String(activeStoreId);
            });
        }

        // Покращений розрахунок (хто закриває, хто відкриває)
        const openTimeDec = timeToDec(openTime);
        let closeTimeDec = timeToDec(closeTime);

        // Якщо закриття рівно о 00:00 або пізніше за північ (01:00, 02:00), вважаємо це наступним днем (додаємо 24)
        if (closeTimeDec <= 6) {
            closeTimeDec += 24;
        }

        let openers = 0;
        let closers = 0;
        let shiftCountForValidation = 0;

        relevantShifts.forEach(s => {
            const startD = timeToDec(s.start);
            let endD = timeToDec(s.end);

            if (startD === 0 && endD === 0) return; // Ігноруємо пусті записи або некоректні мітки

            shiftCountForValidation++; // Лише реальні робочі зміни

            // Якщо зміна закінчується о 00:00, 01:00 тощо (до 6 ранку), додаємо 24 години
            if (endD <= 6 && startD > endD) {
                endD += 24;
            } else if (endD === 0) {
                // Якщо кінець зміни "00:00" але старт, наприклад, "14:00"
                if (startD > 0) endD = 24;
            }

            // Людина вважається "відкриваючою", якщо прийшла до або рівно в час відкриття
            if (s.start !== 'Відпустка' && s.start !== 'Лікарняний' && s.start !== 'Донорство') {
                // Допуск 15 хвилин для закриття та відкриття:
                // Якщо прийшов трошки пізніше відкриття (наприклад відкриття 10:00, прийшов о 10:00 - рахується)
                if (startD <= openTimeDec) openers++;

                // Якщо пішов рівно в час закриття або пізніше
                if (endD >= closeTimeDec) closers++;
            }
        });

        const count = shiftCountForValidation > 0 ? shiftCountForValidation : relevantShifts.length;
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
    const rightSideStickyClass = state.isHoursPinned ? 'sticky right-0 z-40' : '';
    html += `<td class="${rightSideStickyClass} bg-[#F2F2F7] dark:bg-[#1C1C1E] border-l border-gray-200 dark:border-gray-700 text-center px-1 shadow-sm"><div class="flex items-center justify-center h-full text-[9px] font-bold whitespace-nowrap leading-tight">${storeHoursText}</div></td>`;
    html += '</tr>';
    html += '</thead>';

    // ================= BODY =================
    html += '<tbody>';

    const canEditUser = ['SM', 'admin'].includes(state.currentUser.role);

    homeUsers.forEach(user => {
        const shortName = getDisplayName(user);
        const safeUserFullName = (user.fullName || user.name || '').replace(/'/g, "\\'");
        const safeUserName = (user.name || '').replace(/'/g, "\\'");

        const editAction = canEditUser ? `onclick="window.openEditUserProxy('${user._id}')"` : '';
        const editClasses = canEditUser ? "cursor-pointer hover:text-blue-500" : "";
        const editIcon = canEditUser ? ' <span class="text-[9px] opacity-30">✏️</span>' : '';
        const blockedClass = user.status === 'blocked' ? 'opacity-50 grayscale' : '';

        const isMe = user.name === state.currentUser.name;
        const meStyleSticky = isMe ? 'bg-[#F0F9FF] dark:bg-[#1A2F4B] text-blue-600 dark:text-blue-400' : 'bg-white dark:bg-[#1C1C1E]';

        html += `<tr class="h-10 border-b border-gray-50 dark:border-gray-800/50 hover:bg-gray-50 dark:hover:bg-[#2C2C2E] transition-colors ${blockedClass}">`;

        html += `<td ${editAction} class="sticky left-0 z-30 ${meStyleSticky} ${editClasses} px-2 border-r border-gray-200 dark:border-gray-700 font-medium text-[11px] truncate max-w-[120px] shadow-sm">${shortName}${editIcon}</td>`;

        let totalHours = 0;
        let donorDays = 0;
        
        const userTasks = (state.tasks || []).filter(t => t.name === user.name && t.includeHours && !t.isFullDay && t.date && t.date.startsWith(`${y}-${String(m + 1).padStart(2, '0')}`));
        userTasks.forEach(t => {
            if (t.start && t.end) {
                let duration = timeToDec(t.end) - timeToDec(t.start);
                if (duration < 0) duration += 24;
                
                const draftKey = `${t.date}_${user.name}`;
                const draft = state.pendingChanges ? state.pendingChanges[draftKey] : null;
                const shift = state.shifts.find(s => s.date === t.date && s.name === user.name);
                const activeShift = draft || shift;
                
                if (activeShift && activeShift.start !== 'Відпустка' && activeShift.start !== 'Лікарняний' && activeShift.start !== 'Донорство' && activeShift.start !== 'DELETE') {
                    let ts = timeToDec(t.start);
                    let te = timeToDec(t.end);
                    if (te < ts) te += 24;
                    
                    let ss = timeToDec(activeShift.start);
                    let se = timeToDec(activeShift.end);
                    if (se < ss) se += 24;
                    
                    const overlapStart = Math.max(ts, ss);
                    const overlapEnd = Math.min(te, se);
                    if (overlapEnd > overlapStart) {
                        duration -= (overlapEnd - overlapStart);
                    }
                }
                
                if (duration > 0) totalHours += duration;
            }
        });

        for (let d = 1; d <= daysInMonth; d++) {
            const ds = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const isToday = isCurrentMonth && d === todayDate;
            const isPast = ds < todayStr;

            const draftKey = `${ds}_${user.name}`;
            const draft = state.pendingChanges ? state.pendingChanges[draftKey] : null;
            const shift = state.shifts.find(s => s.date === ds && s.name === user.name);

            let sStart, sEnd;
            if (draft) {
                if (draft.start !== 'DELETE' && draft.start !== 'Відпустка' && draft.start !== 'Лікарняний' && draft.start !== 'Донорство') { sStart = draft.start; sEnd = draft.end; }
                if (draft.start === 'Донорство') donorDays++;
            } else if (shift) {
                if (shift.start !== 'Відпустка' && shift.start !== 'Лікарняний' && shift.start !== 'Донорство') { sStart = shift.start; sEnd = shift.end; }
                if (shift.start === 'Донорство') donorDays++;
            }

            let duration = 0;
            let durStr = 0;
            let lunchMins = 60;
            if (state.currentUser.store && state.currentUser.store.lunch_duration_minutes !== undefined) {
                lunchMins = state.currentUser.store.lunch_duration_minutes;
            } else if (state.stores && state.currentUser.storeId) {
                const foundStore = state.stores.find(s => String(s._id) === String(state.currentUser.storeId) || s.code === state.currentUser.storeId);
                if (foundStore && foundStore.lunch_duration_minutes !== undefined) lunchMins = foundStore.lunch_duration_minutes;
            }

            if (sStart && sEnd) {
                let rawDur = timeToDec(sEnd) - timeToDec(sStart);
                if (rawDur < 0) rawDur += 24;
                duration = rawDur - (lunchMins / 60);
                if (duration < 0) duration = 0;
                totalHours += duration;
                durStr = parseFloat(duration.toFixed(1));
            }

            // 🔥 Бейдж з годинами
            let badgeHtml = '';
            if (duration > 0) {
                badgeHtml = `<div class="absolute -top-1.5 -right-1.5 z-10 bg-white dark:bg-[#3A3A3C] text-black dark:text-white text-[8px] font-bold px-1 rounded-full shadow-sm border border-gray-200 dark:border-gray-600 flex items-center justify-center min-w-[14px] h-[14px] leading-none">${durStr}</div>`;
            }

            let cellClass = '';
            if (isPast) cellClass = 'bg-gray-50/50 dark:bg-[#121212] text-gray-300';
            if (isToday) cellClass = 'bg-blue-50/50 dark:bg-blue-900/20 border-x-2 border-blue-200 dark:border-blue-800 relative z-0';

            const dataAttrs = `data-date="${ds}" data-name="${user.name}"`;
            let content = '';

            const userHomeStoreId = user.storeId ? (user.storeId._id || user.storeId) : null;
            if (draft) {
                const dStoreId = draft.storeId ? (draft.storeId._id || draft.storeId) : userHomeStoreId;
                const shouldRender = isAllStoresAdmin || (String(dStoreId) === String(activeStoreId)) || (String(userHomeStoreId) === String(activeStoreId));
                
                if (shouldRender) {
                    cellClass += ' bg-yellow-50 dark:bg-yellow-900/20';
                    let isSubstituteRender = false;
                    let isGuestRender = false;
                    if (isAllStoresAdmin) {
                        isSubstituteRender = userHomeStoreId && String(dStoreId) !== String(userHomeStoreId);
                    } else {
                        isSubstituteRender = String(dStoreId) !== String(activeStoreId);
                        isGuestRender = String(dStoreId) === String(activeStoreId) && userHomeStoreId && String(userHomeStoreId) !== String(activeStoreId);
                    }

                    if (draft.start === 'DELETE') {
                        content = '<span class="text-red-400 font-bold opacity-50">✕</span>';
                    } else if (draft.start === 'Відпустка') {
                        content = '<span class="text-lg">🌴</span><div class="absolute top-1 right-1 w-1.5 h-1.5 bg-yellow-500 rounded-full animate-pulse"></div>';
                    } else if (draft.start === 'Лікарняний') {
                        content = '<span class="text-lg">💊</span><div class="absolute top-1 right-1 w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse"></div>';
                    } else if (draft.start === 'Донорство') {
                        content = '<span class="text-lg">🩸</span><div class="absolute top-1 right-1 w-1.5 h-1.5 bg-indigo-500 rounded-full animate-pulse"></div>';
                    } else {
                        if (isSubstituteRender) {
                            const subStoreObj = (state.stores && draft.storeId) 
                                ? state.stores.find(s => String(s._id) === String(draft.storeId._id || draft.storeId) || s.code === draft.storeId) 
                                : draft.storeId;
                            const storeName = subStoreObj?.name || 'Інший магазин';
                            const safeStoreName = storeName.replace(/'/g, "\\'");
                            content = `<div onclick="window.showToast('📍 Підміна в магазині: ${safeStoreName}')" title="Підміна в магазині: ${storeName}" class="relative text-[9.5px] font-mono leading-tight bg-orange-100 dark:bg-orange-950/60 text-orange-800 dark:text-orange-200 rounded px-1 py-0.5 shadow-sm border border-orange-300 dark:border-orange-800 cursor-pointer transform scale-105">
                                <div class="text-[7.5px] font-sans font-bold truncate text-orange-700 dark:text-orange-300 leading-none mb-0.5 flex items-center justify-center gap-0.5">
                                    <span class="text-[8px] leading-none">📍</span>
                                    <span class="truncate">${storeName}</span>
                                </div>
                                <div class="leading-none font-bold">${draft.start}<br>${draft.end}</div>
                            </div>`;
                        } else {
                            let guestIndicator = '';
                            let guestAttr = '';
                            if (isGuestRender) {
                                const homeStore = state.stores ? state.stores.find(s => String(s._id) === String(userHomeStoreId) || s.code === userHomeStoreId) : null;
                                const homeStoreName = homeStore ? homeStore.name : 'Інший магазин';
                                const safeHomeStoreName = homeStoreName.replace(/'/g, "\\'");
                                guestIndicator = '<div class="absolute -top-1.5 -left-1.5 z-10 text-[10px] filter drop-shadow-md">📍</div>';
                                guestAttr = `title="Гість з: ${homeStoreName}" onclick="window.showToast('Гість з: ${safeHomeStoreName}')"`;
                            }
                            content = `<div ${guestAttr} class="relative text-[10px] font-mono leading-tight bg-yellow-100 dark:bg-yellow-800/50 text-yellow-800 dark:text-yellow-200 rounded px-1 py-0.5 border border-yellow-300 dark:border-yellow-600 shadow-sm transform scale-105 ${isGuestRender ? 'cursor-pointer' : ''}">
                                ${guestIndicator}
                                ${draft.start}<br>${draft.end}
                                ${badgeHtml}
                            </div>`;
                        }
                    }
                }
            } else if (shift) {
                const sStoreId = shift.storeId ? (shift.storeId._id || shift.storeId) : userHomeStoreId;
                const shouldRender = isAllStoresAdmin || (String(sStoreId) === String(activeStoreId)) || (String(userHomeStoreId) === String(activeStoreId));

                if (shouldRender) {
                    let isSubstituteRender = false;
                    let isGuestRender = false;
                    if (isAllStoresAdmin) {
                        isSubstituteRender = userHomeStoreId && String(sStoreId) !== String(userHomeStoreId);
                    } else {
                        isSubstituteRender = String(sStoreId) !== String(activeStoreId);
                        isGuestRender = String(sStoreId) === String(activeStoreId) && userHomeStoreId && String(userHomeStoreId) !== String(activeStoreId);
                    }

                    if (shift.start === 'Відпустка') {
                        content = `<div onclick="if(!window.state?.isEditMode) window.openShiftDetailsModal({ fullName: '${safeUserFullName}', userName: '${safeUserName}', date: '${ds}', start: 'Відпустка', shiftId: '${shift._id || ''}' })" class="cursor-pointer text-lg active:scale-95 transition-transform">🌴</div>`;
                    } else if (shift.start === 'Лікарняний') {
                        content = `<div onclick="if(!window.state?.isEditMode) window.openShiftDetailsModal({ fullName: '${safeUserFullName}', userName: '${safeUserName}', date: '${ds}', start: 'Лікарняний', shiftId: '${shift._id || ''}' })" class="cursor-pointer text-lg active:scale-95 transition-transform">💊</div>`;
                    } else if (shift.start === 'Донорство') {
                        content = `<div onclick="if(!window.state?.isEditMode) window.openShiftDetailsModal({ fullName: '${safeUserFullName}', userName: '${safeUserName}', date: '${ds}', start: 'Донорство', shiftId: '${shift._id || ''}' })" class="cursor-pointer text-lg active:scale-95 transition-transform">🩸</div>`;
                    } else {
                        const opacity = isPast ? 'opacity-50 grayscale' : '';
                        
                        if (isSubstituteRender) {
                            const subStoreObj = (state.stores && shift.storeId) 
                                ? state.stores.find(s => String(s._id) === String(shift.storeId._id || shift.storeId) || s.code === shift.storeId) 
                                : shift.storeId;
                            const storeName = subStoreObj?.name || 'Інший магазин';
                            const safeStoreName = storeName.replace(/'/g, "\\'");
                            content = `<div onclick="if(!window.state?.isEditMode) window.openShiftDetailsModal({ fullName: '${safeUserFullName}', userName: '${safeUserName}', avatar: '${user.avatar || ''}', position: '${user.position || ''}', type: 'substitute', targetStoreName: '${safeStoreName}', date: '${ds}', start: '${shift.start}', end: '${shift.end}', duration: ${durStr}, lunchMins: ${lunchMins}, shiftId: '${shift._id || ''}' })" title="Підміна в магазині: ${storeName}" class="relative text-[9.5px] font-mono leading-tight bg-orange-100 dark:bg-orange-950/60 text-orange-800 dark:text-orange-200 rounded px-1 py-0.5 shadow-sm border border-orange-300 dark:border-orange-800 cursor-pointer active:scale-95 ${opacity}">
                                <div class="text-[7.5px] font-sans font-bold truncate text-orange-700 dark:text-orange-300 leading-none mb-0.5 flex items-center justify-center gap-0.5">
                                    <span class="text-[8px] leading-none">📍</span>
                                    <span class="truncate">${storeName}</span>
                                </div>
                                <div class="leading-none font-bold">${shift.start}<br>${shift.end}</div>
                                ${badgeHtml}
                            </div>`;
                        } else {
                            const colorClass = getShiftColor(shift.start, shift.end, closeTime);
                            let guestIndicator = '';
                            if (isGuestRender) {
                                const homeStore = state.stores ? state.stores.find(s => String(s._id) === String(userHomeStoreId) || s.code === userHomeStoreId) : null;
                                const homeStoreName = homeStore ? homeStore.name : 'Інший магазин';
                                const safeHomeStoreName = homeStoreName.replace(/'/g, "\\'");
                                guestIndicator = '<div class="absolute -top-1.5 -left-1.5 z-10 text-[10px] filter drop-shadow-md">📍</div>';
                            }
                            content = `<div onclick="if(!window.state?.isEditMode) window.openShiftDetailsModal({ fullName: '${safeUserFullName}', userName: '${safeUserName}', avatar: '${user.avatar || ''}', position: '${user.position || ''}', type: 'regular', date: '${ds}', start: '${shift.start}', end: '${shift.end}', duration: ${durStr}, lunchMins: ${lunchMins}, shiftId: '${shift._id || ''}' })" title="${user.fullName || user.name}&#10;⏰ ${shift.start} - ${shift.end} (${durStr} год)" class="relative text-[10px] font-mono leading-tight ${colorClass} rounded px-1 py-0.5 ${opacity} cursor-pointer active:scale-95">
                                ${guestIndicator}
                                ${shift.start}<br>${shift.end}
                                ${badgeHtml}
                            </div>`;
                        }
                    }
                }
            }

            let ctxAttr = '';
            if (shift && !draft) {
                ctxAttr = `oncontextmenu="window.contextMenuProxy(event, 'shift', '${shift._id}')"`;
            } else {
                ctxAttr = `oncontextmenu="window.contextMenuProxy(event, 'empty_shift', '${ds}|${safeUserName}')"`;
            }

            const hasTask = (state.tasks || []).some(t => t.name === user.name && t.date === ds && t.status !== 'completed');
            const taskHtml = hasTask ? '<div class="absolute top-0 left-0 z-10 text-[11px] drop-shadow-sm pointer-events-none">📌</div>' : '';

            html += `<td ${dataAttrs} ${ctxAttr} class="shift-cell relative text-center p-0.5 border-r border-gray-100 dark:border-gray-800 ${cellClass} cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">${taskHtml}${content}</td>`;
        }

        let donorHours = donorDays * 8;
        let hoursHtml = `<div class="font-bold">${totalHours}${donorHours > 0 ? ` <span class="text-indigo-500 text-[10px]">+${donorHours}</span>` : ''}</div>`;
        
        if (monthNorm > 0) {
            const diff = parseFloat((totalHours - monthNorm).toFixed(1));
            let diffClass = diff >= 0 ? "text-green-500" : "text-red-500";
            let diffSign = diff > 0 ? "+" : "";
            hoursHtml = `
                <div class="flex flex-col leading-none">
                    <span class="font-bold text-[11px]">${totalHours}${donorHours > 0 ? ` <span class="text-indigo-500">+${donorHours}</span>` : ''} <span class="text-gray-400 font-normal">/ ${monthNorm}</span></span>
                    <span class="text-[9px] ${diffClass} font-bold">${diffSign}${diff}</span>
                </div>
            `;
        } else if (donorHours > 0) {
            hoursHtml = `<div class="font-bold text-gray-500">${totalHours} <span class="text-indigo-500 text-[10px]">+${donorHours}</span></div>`;
        } else {
            hoursHtml = `<div class="font-bold text-gray-500">${totalHours}</div>`;
        }

        const hsClass = state.isHoursPinned ? 'sticky right-0 z-30' : '';
        html += `<td class="${hsClass} ${meStyleSticky} border-l border-gray-200 dark:border-gray-700 text-center px-1 shadow-sm">${hoursHtml}</td>`;
        html += '</tr>';
    });

    // ================= UNIFIED GUESTS / SUBSTITUTES ROW =================
    if (guestUsers.length > 0 && !state.hideSubstitutes) {
        let totalGuestsHours = 0;
        let totalGuestsShifts = 0;
        let guestCellsHtml = '';

        for (let d = 1; d <= daysInMonth; d++) {
            const ds = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const isToday = isCurrentMonth && d === todayDate;
            const isPast = ds < todayStr;

            let cellClass = '';
            if (isPast) cellClass = 'bg-gray-50/50 dark:bg-[#121212] text-gray-300';
            if (isToday) cellClass = 'bg-blue-50/50 dark:bg-blue-900/20 border-x-2 border-blue-200 dark:border-blue-800 relative z-0';

            const dayGuestItems = [];
            guestUsers.forEach(gUser => {
                const draftKey = `${ds}_${gUser.name}`;
                const draft = state.pendingChanges ? state.pendingChanges[draftKey] : null;
                const shift = (state.shifts || []).find(s => s.date === ds && s.name === gUser.name);

                if (draft) {
                    const dStoreId = draft.storeId ? (draft.storeId._id || draft.storeId) : (gUser.storeId?._id || gUser.storeId);
                    if (String(dStoreId) === String(activeStoreId) && !['DELETE', 'Відпустка', 'Лікарняний', 'Донорство'].includes(draft.start)) {
                        dayGuestItems.push({ user: gUser, shift: draft, isDraft: true });
                    }
                } else if (shift) {
                    const sStoreId = shift.storeId ? (shift.storeId._id || shift.storeId) : (gUser.storeId?._id || gUser.storeId);
                    if (String(sStoreId) === String(activeStoreId) && !['Відпустка', 'Лікарняний', 'Донорство'].includes(shift.start)) {
                        dayGuestItems.push({ user: gUser, shift: shift, isDraft: false });
                    }
                }
            });

            if (dayGuestItems.length === 0) {
                guestCellsHtml += `<td data-date="${ds}" class="shift-cell relative text-center p-0.5 border-r border-gray-100 dark:border-gray-800/60 ${cellClass}"><span class="opacity-15 text-[8px] text-gray-400">·</span></td>`;
            } else {
                let badgesHtml = '<div class="flex flex-col gap-1 w-full justify-center">';
                dayGuestItems.forEach(item => {
                    const [h1, m1] = item.shift.start.split(':').map(Number);
                    const [h2, m2] = item.shift.end.split(':').map(Number);
                    let lunchMins = 60;
                    if (state.currentUser.store && state.currentUser.store.lunch_duration_minutes !== undefined) {
                        lunchMins = state.currentUser.store.lunch_duration_minutes;
                    } else if (state.stores && activeStoreId) {
                        const foundStore = state.stores.find(s => String(s._id) === String(activeStoreId) || s.code === activeStoreId);
                        if (foundStore && foundStore.lunch_duration_minutes !== undefined) lunchMins = foundStore.lunch_duration_minutes;
                    }
                    let rawDur = (h2 + m2 / 60) - (h1 + m1 / 60);
                    if (rawDur < 0) rawDur += 24;
                    let dur = rawDur - (lunchMins / 60);
                    if (dur < 0) dur = 0;
                    totalGuestsHours += dur;
                    totalGuestsShifts++;

                    const durStr = parseFloat(dur.toFixed(1));
                    const gDisplayName = getDisplayName(item.user);
                    const parts = gDisplayName.split(' ');
                    const gShortName = parts.length > 1 ? `${parts[0]} ${parts[1][0]}.` : parts[0];
                    const gFullName = item.user.fullName || item.user.name;

                    const gHomeStoreId = item.user.storeId ? (item.user.storeId._id || item.user.storeId) : null;
                    const gHomeStore = state.stores ? state.stores.find(s => String(s._id) === String(gHomeStoreId) || s.code === gHomeStoreId) : null;
                    const gHomeStoreName = gHomeStore ? gHomeStore.name : 'Інший магазин';

                    const opacity = isPast ? 'opacity-60 grayscale' : '';
                    const safeFullName = gFullName.replace(/'/g, "\\'");
                    const safeHomeStoreName = gHomeStoreName.replace(/'/g, "\\'");

                    let ctxAttr = '';
                    const safeGUserName = item.user.name.replace(/'/g, "\\'");
                    if (!item.isDraft && item.shift._id) {
                        ctxAttr = `oncontextmenu="window.contextMenuProxy(event, 'shift', '${item.shift._id}')"`;
                    } else {
                        ctxAttr = `oncontextmenu="window.contextMenuProxy(event, 'empty_shift', '${ds}|${safeGUserName}')"`;
                    }

                    const borderStyle = item.isDraft ? 'border-dashed border-amber-500 animate-pulse' : 'border-amber-300 dark:border-amber-700/80';

                    badgesHtml += `
                        <div ${ctxAttr}
                             data-date="${ds}" 
                             data-name="${item.user.name}"
                             onclick="if(!window.state?.isEditMode) window.openShiftDetailsModal({
                                 fullName: '${safeFullName}',
                                 userName: '${safeGUserName}',
                                 shortName: '${gShortName}',
                                 avatar: '${item.user.avatar || ''}',
                                 position: '${item.user.position || ''}',
                                 type: 'guest',
                                 homeStoreName: '${safeHomeStoreName}',
                                 date: '${ds}',
                                 start: '${item.shift.start}',
                                 end: '${item.shift.end}',
                                 duration: ${durStr},
                                 lunchMins: ${lunchMins},
                                 shiftId: '${item.shift._id || ''}'
                             })"
                             title="${gFullName}&#10;📍 Гість з: ${gHomeStoreName}&#10;⏰ ${item.shift.start} - ${item.shift.end} (${durStr} год)"
                             class="relative text-[9px] font-mono leading-tight bg-amber-100/90 dark:bg-amber-950/70 text-amber-900 dark:text-amber-200 rounded px-1 py-0.5 border ${borderStyle} shadow-sm cursor-pointer hover:scale-105 active:scale-95 transition-transform ${opacity}">
                            <div class="text-[7.5px] font-sans font-bold truncate text-amber-800 dark:text-amber-300 leading-none mb-0.5 flex items-center justify-center gap-0.5">
                                <span class="text-[8px] leading-none">👤</span>
                                <span class="truncate">${gShortName}</span>
                            </div>
                            <div class="leading-none font-bold">${item.shift.start}<br>${item.shift.end}</div>
                            <div class="absolute -top-1.5 -right-1.5 z-10 bg-amber-500 text-white text-[7.5px] font-bold px-1 rounded-full shadow-sm min-w-[13px] h-[13px] flex items-center justify-center leading-none">${durStr}</div>
                        </div>
                    `;
                });
                badgesHtml += '</div>';

                guestCellsHtml += `<td data-date="${ds}" class="shift-cell relative text-center p-0.5 border-r border-gray-100 dark:border-gray-800/60 ${cellClass}">${badgesHtml}</td>`;
            }
        }

        const rightSideStickyClass = state.isHoursPinned ? 'sticky right-0 z-30' : '';
        const guestHoursHtml = `
            <div class="flex flex-col items-center justify-center leading-tight">
                <span class="text-[7.5px] uppercase tracking-wider text-amber-700 dark:text-amber-400 font-bold">Підміни</span>
                <span class="font-bold text-amber-900 dark:text-amber-200 text-xs">${parseFloat(totalGuestsHours.toFixed(1))}</span>
                <span class="text-[8px] text-gray-400">${totalGuestsShifts} змін</span>
            </div>
        `;

        html += `<tr class="min-h-10 border-t-2 border-dashed border-amber-200 dark:border-amber-800/60 bg-[#FFFDF9] dark:bg-[#1A1816] transition-colors">`;
        html += `<td class="sticky left-0 z-30 bg-[#FFFDF9] dark:bg-[#1A1816] px-2 py-1.5 border-r border-amber-200 dark:border-amber-800/60 font-medium text-[11px] shadow-sm">
            <div class="flex items-center gap-1.5">
                <span class="text-sm">🤝</span>
                <div class="flex flex-col leading-tight">
                    <span class="font-bold text-amber-900 dark:text-amber-200">Підміни</span>
                    <span class="text-[8.5px] text-gray-400 font-normal">${guestUsers.length} співроб.</span>
                </div>
            </div>
        </td>`;
        html += guestCellsHtml;
        html += `<td class="${rightSideStickyClass} bg-[#FFFDF9] dark:bg-[#1A1816] border-l border-amber-200 dark:border-amber-800/60 text-center px-1 shadow-sm">${guestHoursHtml}</td>`;
        html += `</tr>`;
    }

    html += '</tbody></table>';
    tableDiv.innerHTML = html;

    // 🍎 Ініціалізуємо iOS touch scroll один раз
    initIosTableScroll();

    // 🔥 FIX: Скролимо таблицю до "сьогодні" ТІЛЬКИ якщо ми НЕ в режимі редагування.
    // Інакше — повертаємо до попереднього скролу, щоб сітка не "стрибала" під час малювання пензликом.
    if (state.isEditMode) {
        tableDiv.scrollLeft = previousScrollX;
    } else {
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
}