import { state } from './state.js';
import { getUsersForView, getDisplayName } from './render_utils.js';

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

    let html = '<table class="w-full text-xs border-collapse select-none">'; 
    html += '<thead><tr class="h-10 border-b border-gray-100 dark:border-gray-800">';
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
    html += '</tr></thead><tbody>';

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
        
        for(let d=1; d<=daysInMonth; d++) {
            const ds = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const isToday = isCurrentMonth && d === todayDate;
            const isPast = ds < todayStr;
            
            // 🔥 LOGIC FOR EDITOR: Перевіряємо чернетки
            const draftKey = `${ds}_${user.name}`;
            const draft = state.pendingChanges ? state.pendingChanges[draftKey] : null;
            
            const shift = state.shifts.find(s => s.date === ds && s.name === user.name);
            
            let cellClass = '';
            if (isPast) cellClass = 'bg-gray-50/50 dark:bg-[#121212] text-gray-300';
            if (isToday) cellClass = 'bg-blue-50/50 dark:bg-blue-900/20 border-x-2 border-blue-200 dark:border-blue-800 relative z-0'; 
            
            // Атрибути для малювання
            const dataAttrs = `data-date="${ds}" data-name="${user.name}"`;

            let content = '';
            
            if (draft) {
                // Відображення чернетки (незбереженої зміни)
                cellClass += ' bg-yellow-50 dark:bg-yellow-900/20';
                if (draft.start === 'DELETE') {
                    content = '<span class="text-red-400 font-bold opacity-50">✕</span>'; // Позначка видалення
                } else if (draft.start === 'Відпустка') {
                    content = '<span class="text-lg">🌴</span><div class="absolute top-1 right-1 w-1.5 h-1.5 bg-yellow-500 rounded-full animate-pulse"></div>';
                } else {
                    content = `<div class="text-[10px] font-mono leading-tight bg-yellow-100 dark:bg-yellow-800/50 text-yellow-800 dark:text-yellow-200 rounded px-1 py-0.5 border border-yellow-300 dark:border-yellow-600 shadow-sm transform scale-105">${draft.start}<br>${draft.end}</div>`;
                }
            } else if (shift) {
                // Відображення реальної зміни з бази
                if (shift.start === 'Відпустка') { 
                    content = '<span class="text-lg">🌴</span>'; 
                } else { 
                    const opacity = isPast ? 'opacity-50' : ''; 
                    content = `<div class="text-[10px] font-mono leading-tight bg-gray-100 dark:bg-gray-800 rounded px-1 py-0.5 ${opacity}">${shift.start}<br>${shift.end}</div>`; 
                }
            }

            html += `<td ${dataAttrs} class="shift-cell text-center p-0.5 border-r border-gray-100 dark:border-gray-800 ${cellClass} cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">${content}</td>`;
        }
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