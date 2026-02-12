import { state } from './state.js';
import { getUsersForView, getDisplayName } from './render_utils.js';

// Допоміжна функція: переведення часу "10:30" -> 10.5
function timeToDec(t) {
    if (!t || t === 'Відпустка' || t === 'DELETE') return 0;
    const [h, m] = t.split(':').map(Number);
    return h + (m / 60);
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

    // 🔥 1. ОТРИМУЄМО НАЛАШТУВАННЯ МАГАЗИНУ (Час роботи)
    let openTime = "10:00";
    let closeTime = "22:00";

    // Спроба 1: З об'єкта користувача (якщо populated)
    if (state.currentUser.store && state.currentUser.store.openTime) {
        openTime = state.currentUser.store.openTime;
        closeTime = state.currentUser.store.closeTime;
    } 
    // Спроба 2: Зі списку магазинів (state.stores), якщо він завантажений
    else if (state.stores && state.currentUser.storeId) {
        const foundStore = state.stores.find(s => s._id === state.currentUser.storeId || s.code === state.currentUser.storeId);
        if (foundStore) {
            openTime = foundStore.openTime || "10:00";
            closeTime = foundStore.closeTime || "22:00";
        }
    }

    // 🔥 2. ОТРИМУЄМО НОРМУ ГОДИН З KPI
    const monthNorm = state.kpiData?.settings?.normHours || 0;

    let html = '<table class="w-full text-xs border-collapse select-none">'; 
    
    // ================= HEADER =================
    html += '<thead>';
    
    // --- Рядок 1: Дні тижня ---
    html += '<tr class="h-10 border-b border-gray-100 dark:border-gray-800">';
    html += '<th class="sticky left-0 z-20 bg-gray-50 dark:bg-[#2C2C2E] px-2 text-left font-bold min-w-[120px] border-r border-gray-200 dark:border-gray-700 shadow-sm">Співробітник</th>';
    
    for(let d=1; d<=daysInMonth; d++) {
        const isToday = isCurrentMonth && d === todayDate;
        const dateObj = new Date(y, m, d);
        const dayName = dateObj.toLocaleDateString('uk-UA', {weekday: 'short'});
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
    
    // Заголовок колонки "Години"
    html += '<th class="sticky right-0 z-20 bg-gray-50 dark:bg-[#2C2C2E] px-2 text-center font-bold min-w-[80px] border-l border-gray-200 dark:border-gray-700 shadow-sm">Години</th>';
    html += '</tr>';

    // --- Рядок 2: Кількість людей (Перевірка покриття) ---
    html += '<tr class="h-6 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#202022]">';
    html += '<td class="sticky left-0 z-20 bg-gray-50 dark:bg-[#2C2C2E] px-2 text-[10px] text-gray-400 font-bold border-r border-gray-200 dark:border-gray-700 text-right">Людей:</td>';

    for(let d=1; d<=daysInMonth; d++) {
        const dStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        
        // Збираємо зміни на цей день (враховуючи чернетки)
        const dayShifts = state.shifts.filter(s => s.date === dStr && s.start !== 'Відпустка');
        const dayDrafts = state.pendingChanges ? Object.values(state.pendingChanges).filter(p => p.date === dStr) : [];
        
        const finalShifts = [];
        const processedUsers = new Set();

        // 1. Чернетки мають пріоритет
        dayDrafts.forEach(draft => {
            processedUsers.add(draft.name);
            if (draft.start !== 'DELETE' && draft.start !== 'Відпустка') {
                finalShifts.push(draft);
            }
        });
        
        // 2. Реальні зміни (якщо не перекриті чернеткою)
        dayShifts.forEach(shift => {
            if (!processedUsers.has(shift.name)) {
                finalShifts.push(shift);
            }
        });

        // Фільтруємо по поточному магазину/фільтру (щоб не рахувати людей з інших магазинів, якщо ми адмін)
        let relevantShifts = finalShifts;
        if (state.selectedStoreFilter && state.selectedStoreFilter !== 'all') {
            relevantShifts = finalShifts.filter(s => {
                const u = state.users.find(usr => usr.name === s.name);
                return u && String(u.storeId) === String(state.selectedStoreFilter);
            });
        }

        const count = relevantShifts.length;
        
        // 🔥 ВАЛІДАЦІЯ: Мінімум 2 людини на відкритті (openTime) і закритті (closeTime)
        const openers = relevantShifts.filter(s => s.start === openTime).length;
        const closers = relevantShifts.filter(s => s.end === closeTime).length;

        let badgeClass = "text-gray-500";
        let contentHtml = count > 0 ? count : '-';

        // Якщо є люди, але недостатньо для відкриття/закриття
        if (count > 0 && (openers < 2 || closers < 2)) {
            badgeClass = "bg-red-100 text-red-600 font-bold";
            contentHtml = `<div class="flex items-center justify-center gap-0.5"><span>${count}</span><span class="text-[8px]">⚠️</span></div>`;
        } else if (count > 0) {
            badgeClass = "text-green-600 font-medium";
        }

        html += `<td class="text-center border-r border-gray-100 dark:border-gray-800 text-[10px] ${badgeClass}">
            ${contentHtml}
        </td>`;
    }
    html += '<td class="sticky right-0 bg-gray-50 dark:bg-[#2C2C2E] border-l border-gray-200 dark:border-gray-700"></td>'; 
    html += '</tr>';
    html += '</thead>';

    // ================= BODY =================
    html += '<tbody>';

    let usersToShow = getUsersForView(viewMonthStr);
    const canEditUser = ['SM', 'admin'].includes(state.currentUser.role);

    usersToShow.forEach(user => {
        const shortName = getDisplayName(user);
        
        const editAttr = canEditUser ? `onclick="window.openEditUserProxy('${user._id}')" class="cursor-pointer hover:text-blue-500"` : '';
        const editIcon = canEditUser ? ' <span class="text-[9px] opacity-30">✏️</span>' : '';
        const blockedClass = user.status === 'blocked' ? 'opacity-50 grayscale' : '';
        
        const isMe = user.name === state.currentUser.name;
        const meStyle = isMe ? 'bg-blue-50/50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400' : 'bg-white dark:bg-[#1C1C1E]';

        html += `<tr class="h-10 border-b border-gray-50 dark:border-gray-800/50 hover:bg-gray-50 dark:hover:bg-[#2C2C2E] transition-colors ${blockedClass}">`;
        html += `<td ${editAttr} class="sticky left-0 z-10 ${meStyle} px-2 border-r border-gray-200 dark:border-gray-700 font-medium text-[11px] truncate max-w-[120px] shadow-sm">${shortName}${editIcon}</td>`;
        
        let totalHours = 0;

        for(let d=1; d<=daysInMonth; d++) {
            const ds = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const isToday = isCurrentMonth && d === todayDate;
            const isPast = ds < todayStr;
            
            const draftKey = `${ds}_${user.name}`;
            const draft = state.pendingChanges ? state.pendingChanges[draftKey] : null;
            const shift = state.shifts.find(s => s.date === ds && s.name === user.name);
            
            let sStart, sEnd;
            if (draft) {
                 if (draft.start !== 'DELETE' && draft.start !== 'Відпустка') { sStart = draft.start; sEnd = draft.end; }
            } else if (shift) {
                 if (shift.start !== 'Відпустка') { sStart = shift.start; sEnd = shift.end; }
            }

            if (sStart && sEnd) {
                totalHours += (timeToDec(sEnd) - timeToDec(sStart));
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
                } else {
                    content = `<div class="text-[10px] font-mono leading-tight bg-yellow-100 dark:bg-yellow-800/50 text-yellow-800 dark:text-yellow-200 rounded px-1 py-0.5 border border-yellow-300 dark:border-yellow-600 shadow-sm transform scale-105">${draft.start}<br>${draft.end}</div>`;
                }
            } else if (shift) {
                if (shift.start === 'Відпустка') { 
                    content = '<span class="text-lg">🌴</span>'; 
                } else { 
                    const opacity = isPast ? 'opacity-50' : ''; 
                    content = `<div class="text-[10px] font-mono leading-tight bg-gray-100 dark:bg-gray-800 rounded px-1 py-0.5 ${opacity}">${shift.start}<br>${shift.end}</div>`; 
                }
            }

            html += `<td ${dataAttrs} class="shift-cell text-center p-0.5 border-r border-gray-100 dark:border-gray-800 ${cellClass} cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">${content}</td>`;
        }

        // 🔥 КОЛОНКА "ГОДИНИ" (Факт / Норма)
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

        html += `<td class="sticky right-0 z-10 ${meStyle} border-l border-gray-200 dark:border-gray-700 text-center px-1 shadow-sm">${hoursHtml}</td>`;
        html += '</tr>';
    });
    html += '</tbody></table>';
    tableDiv.innerHTML = html;
    
    setTimeout(() => {
        const el = document.getElementById('todayColumn'); 
        if (el) el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        if (container) container.classList.remove('animate-slide-up');
    }, 600);
}