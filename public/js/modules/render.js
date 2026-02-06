import { state } from './state.js';
import { triggerHaptic } from './ui.js';

// --- ГОЛОВНА ФУНКЦІЯ РЕНДЕРУ ---
export function renderAll() {
    renderTimeline();
    renderCalendar();
    renderTable();
    // renderKpi викликається окремо через app.js при зміні режиму
}

export function renderTimeline() {
    const main = document.getElementById('scheduleView');
    main.innerHTML = '';
    const archive = document.getElementById('archiveContainer');
    archive.innerHTML = '';

    // 1. Визначаємо поточний місяць перегляду
    const viewY = state.currentDate.getFullYear();
    const viewM = state.currentDate.getMonth();
    const viewMonthStr = `${viewY}-${String(viewM + 1).padStart(2, '0')}`; // YYYY-MM

    // 2. Збираємо всі унікальні дати
    let allDates = [...new Set([...state.shifts.map(s => s.date), ...state.notes.map(n => n.date)])];
    
    // Додаємо "Сьогодні", якщо воно в цьому місяці
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    if (today.startsWith(viewMonthStr) && !allDates.includes(today)) {
        allDates.push(today);
    }
    
    // 3. Фільтруємо дати тільки для обраного місяця
    const dates = allDates.filter(d => d.startsWith(viewMonthStr)).sort();

    let pastDaysCount = 0;
    let usersToShow = (state.filter === 'all') ? state.users : state.users.filter(u => u.name === state.filter);

    // Підрахунок годин для обраного місяця
    const userHours = {};
    usersToShow.forEach(u => {
        let h = 0;
        state.shifts.filter(s => s.name === u.name && s.date.startsWith(viewMonthStr) && s.start !== 'Відпустка').forEach(s => {
            const [h1, m1] = s.start.split(':').map(Number);
            const [h2, m2] = s.end.split(':').map(Number);
            h += (h2 + m2/60) - (h1 + m1/60);
        });
        userHours[u.name] = h.toFixed(0);
    });

    // 4. Додаємо кнопку навігації "Попередній місяць" в Архів
    const prevBtnDiv = document.createElement('div');
    prevBtnDiv.className = "mb-4";
    prevBtnDiv.innerHTML = `<button onclick="changeMonth(-1)" class="w-full py-3 bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-700 text-blue-500 rounded-xl text-xs font-bold shadow-sm active:scale-95 transition-transform">⬅️ Попередній місяць (${new Date(viewY, viewM - 1).toLocaleDateString('uk-UA', {month:'long'})})</button>`;
    archive.appendChild(prevBtnDiv);

    // 5. Рендеримо дні
    if (dates.length === 0) {
        main.innerHTML = `<div class="text-center text-gray-400 py-10 text-sm">Немає записів на цей місяць</div>`;
    }

    dates.forEach((dateStr, index) => {
        // --- ДИНАМІЧНИЙ ЧАС ---
        let dayStart = 10; 
        let dayEnd = 20;   

        state.tasks.filter(t => t.date === dateStr).forEach(t => {
            if (!t.isFullDay && t.start) {
                const h = parseInt(t.start.split(':')[0]);
                if (h < dayStart) dayStart = h;
                if (t.end) {
                    const parts = t.end.split(':');
                    const hEnd = parseInt(parts[0]) + (parseInt(parts[1]) > 0 ? 1 : 0);
                    if (hEnd > dayEnd) dayEnd = hEnd;
                }
            }
        });

        state.shifts.filter(s => s.date === dateStr && s.start !== 'Відпустка').forEach(s => {
            const h = parseInt(s.start.split(':')[0]);
            if (h < dayStart) dayStart = h;
            const parts = s.end.split(':');
            const hEnd = parseInt(parts[0]) + (parseInt(parts[1]) > 0 ? 1 : 0);
            if (hEnd > dayEnd) dayEnd = hEnd;
        });

        if (dayStart < 6) dayStart = 6; 
        if (dayEnd > 23) dayEnd = 23;
        const totalHours = dayEnd - dayStart;
        // -----------------------

        const isPast = dateStr < today;
        const isToday = dateStr === today;
        const dObj = new Date(dateStr);
        const dName = dObj.toLocaleDateString('uk-UA', { weekday: 'long', day: 'numeric', month: 'long' });
        // Анімація тільки для майбутніх днів
        const animClass = isPast ? '' : `animate-slide-up stagger-${(index % 5) + 1}`;
        
        const block = document.createElement('div');
        block.className = `ios-card p-4 ${animClass}`;
        
        if(isToday) {
            block.classList.add('ring-2', 'ring-blue-500', 'shadow-lg', 'shadow-blue-500/20', 'dark:shadow-blue-500');
        }

        let html = `<div class="mb-3 border-b border-gray-100 dark:border-gray-800 pb-2 flex justify-between items-center cursor-pointer active:opacity-60" onclick="window.openNotesModal('${dateStr}')"><h3 class="font-bold text-lg capitalize ${isToday?'text-blue-500':'text-black dark:text-white'}">${dName}</h3><div class="text-blue-500 text-xs font-bold px-2 py-1 bg-blue-50 dark:bg-blue-900/30 rounded-lg">📝 Нотатки</div></div>`;
        
        const dayNotes = state.notes.filter(n => n.date === dateStr);
        if (dayNotes.length > 0) {
            html += `<div class="mb-3 space-y-1.5">`;
            dayNotes.forEach(n => {
                const style = n.type === 'public' ? 'bg-blue-50 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200 border-l-2 border-blue-500' : 'bg-yellow-50 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200 border-l-2 border-yellow-500';
                const icon = n.type === 'public' ? '📢' : '🔒';
                html += `<div class="text-[11px] p-2 rounded-r-md ${style} flex items-start gap-1"><span>${icon}</span> <span><b>${n.author}:</b> ${n.text}</span></div>`;
            });
            html += `</div>`;
        }

        html += `<div class="space-y-4">`;

        usersToShow.forEach(user => {
            const shift = state.shifts.find(s => s.date === dateStr && s.name === user.name);
            const userTasks = state.tasks.filter(t => t.date === dateStr && t.name === user.name);
            const parts = user.name.split(' ');
            const shortName = parts.length > 1 ? parts[1] : parts[0];
            const hoursBadges = ` <span class="text-[9px] text-gray-400 font-normal">(${userHours[user.name]} год.)</span>`;
            
            let avatarHtml = `<div class="w-5 h-5 rounded-full bg-gray-200 flex items-center justify-center text-[10px] overflow-hidden mr-2 border border-gray-300 dark:border-gray-600">👤</div>`;
            if(user.avatar) avatarHtml = `<div class="w-5 h-5 rounded-full overflow-hidden mr-2 border border-gray-300 dark:border-gray-600"><img src="${user.avatar}" class="w-full h-full object-cover"></div>`;

            if (shift) {
                const isMe = shift.name === state.currentUser.name;
                const canEdit = ['admin','SM','SSE'].includes(state.currentUser.role) && state.currentUser.role !== 'RRP';
                const ctxAttr = canEdit ? `oncontextmenu="window.contextMenuProxy(event, 'shift', '${shift._id}');"` : '';

                if (shift.start === 'Відпустка') {
                    html += `<div><div class="flex items-center text-xs mb-1 font-medium ${isMe?'text-teal-600 font-bold':'text-gray-900 dark:text-gray-200'}">${avatarHtml} <span>${shortName}</span> ${hoursBadges} <span class="ml-2 text-teal-500 font-mono">Відпустка</span></div><div class="timeline-track" ${ctxAttr}><div class="shift-segment vacation-segment">ВІДПУСТКА 🌴</div></div></div>`;
                } else {
                    const [sH, sM] = shift.start.split(':').map(Number);
                    const [eH, eM] = shift.end.split(':').map(Number);
                    const startDecimal = sH + sM/60;
                    const endDecimal = eH + eM/60;
                    
                    let left = ((startDecimal - dayStart) / totalHours) * 100;
                    let width = ((endDecimal - startDecimal) / totalHours) * 100;
                    
                    if(left < 0) { width += left; left = 0; }
                    if(left + width > 100) width = 100 - left;
                    if(width < 0) width = 0;

                    let tasksHtml = '';
                    let badges = '';
                    
                    userTasks.forEach(task => {
                        if(task.isFullDay) {
                            const clickAttr = `onclick="window.openTaskProxy('${task._id}'); event.stopPropagation();"`;
                            badges += `<span ${clickAttr} class="ml-2 text-[10px] text-purple-600 font-bold border border-purple-200 bg-purple-50 px-1 rounded cursor-pointer active:scale-95">★ ${task.title}</span>`;
                        } else {
                            const [tS_h, tS_m] = task.start.split(':').map(Number);
                            const [tE_h, tE_m] = task.end.split(':').map(Number);
                            const tStartD = tS_h + tS_m/60;
                            const tEndD = tE_h + tE_m/60;
                            
                            let tLeft = ((tStartD - dayStart) / totalHours) * 100;
                            let tWidth = ((tEndD - tStartD) / totalHours) * 100;
                            
                            if(tLeft < 0) { tWidth += tLeft; tLeft = 0; }
                            if(tLeft + tWidth > 100) tWidth = 100 - tLeft;

                            const clickAction = `onclick="window.openTaskProxy('${task._id}'); event.stopPropagation();"`;
                            tasksHtml += `<div class="task-segment flex items-center justify-center text-[10px]" style="left:${tLeft}%; width:${tWidth}%;" ${clickAction}>📌</div>`;
                        }
                    });

                    html += `<div><div class="flex items-center text-xs mb-1 font-medium ${isMe?'text-blue-600 font-bold':'text-gray-900 dark:text-gray-200'}">${avatarHtml} <span>${shortName}</span> ${hoursBadges} <span class="ml-2 text-gray-400 font-mono">${shift.start}-${shift.end}</span> ${badges}</div><div class="timeline-track shadow-inner"><div class="timeline-grid-overlay">${Array(totalHours).fill('<div class="timeline-line"></div>').join('')}</div><div class="shift-segment ${isMe?'my-shift':''}" ${ctxAttr} style="left:${left}%; width:${width}%"></div>${tasksHtml}</div></div>`;
                }
            } else if (userTasks.length > 0) {
                 let tasksHtml = ''; 
                 userTasks.forEach(task => { 
                     if(!task.isFullDay) { 
                        const [tS_h, tS_m] = task.start.split(':').map(Number); 
                        const [tE_h, tE_m] = task.end.split(':').map(Number); 
                        const tStartD = tS_h + tS_m/60; 
                        const tEndD = tE_h + tE_m/60; 
                        let tLeft = ((tStartD - dayStart) / totalHours) * 100; 
                        let tWidth = ((tEndD - tStartD) / totalHours) * 100; 
                        if(tLeft < 0) { tWidth += tLeft; tLeft = 0; }
                        if(tLeft + tWidth > 100) tWidth = 100 - tLeft;
                        const clickAction = `onclick="window.openTaskProxy('${task._id}'); event.stopPropagation();"`;
                        tasksHtml += `<div class="task-segment flex items-center justify-center text-[10px]" style="left:${tLeft}%; width:${tWidth}%;" ${clickAction}>📌</div>`; 
                     } 
                 });
                 html += `<div class="opacity-80"><div class="flex items-center text-xs mb-1 text-gray-500">${avatarHtml} <span>${shortName}</span> ${hoursBadges} <span class="ml-2 text-orange-500 font-bold">Тільки задача</span></div><div class="timeline-track"><div class="timeline-grid-overlay">${Array(totalHours).fill('<div class="timeline-line"></div>').join('')}</div>${tasksHtml}</div></div>`;
            } else {
                html += `<div class="opacity-40"><div class="flex items-center justify-between text-xs mb-1 text-gray-400"><div>${avatarHtml} <span>${shortName}</span> ${hoursBadges}</div> <span>Вихідний</span></div><div class="h-[1px] bg-gray-200 dark:bg-gray-800 rounded w-full mt-3 mb-4"></div></div>`;
            }
        });

        html += `</div>`;
        block.innerHTML = html;
        if(isPast) {
            archive.appendChild(block);
            pastDaysCount++;
        } else {
            main.appendChild(block);
        }
        if(isToday) setTimeout(()=>block.scrollIntoView({behavior:'smooth',block:'center'}),600);
    });

    // 6. Кнопка "Наступний місяць" внизу основного списку
    const nextBtnDiv = document.createElement('div');
    nextBtnDiv.className = "mt-4 pb-12";
    nextBtnDiv.innerHTML = `<button onclick="changeMonth(1)" class="w-full py-3 bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-700 text-blue-500 rounded-xl text-xs font-bold shadow-sm active:scale-95 transition-transform">Наступний місяць (${new Date(viewY, viewM + 1).toLocaleDateString('uk-UA', {month:'long'})}) ➡️</button>`;
    main.appendChild(nextBtnDiv);

    // Відображення кількості минулих днів
    const arcBtn = document.getElementById('archiveToggleBtn');
    const arcCnt = document.getElementById('archiveCount');
    if(pastDaysCount > 0) { 
        arcBtn.classList.remove('hidden'); 
        arcCnt.innerText = pastDaysCount; 
    } else { 
        arcBtn.classList.add('hidden'); 
    }
}

export function renderCalendar() {
    const g = document.getElementById('calendarGrid');
    g.innerHTML='';
    const t = document.getElementById('calendarTitle');
    const y = state.currentDate.getFullYear();
    const m = state.currentDate.getMonth();
    t.innerText = new Date(y, m).toLocaleDateString('uk-UA', { month: 'long', year: 'numeric' });
    
    const fd = new Date(y, m, 1).getDay() || 7;
    const ld = new Date(y, m + 1, 0).getDate();
    const today = new Date().toISOString().split('T')[0];

    for(let i = 1; i < fd; i++) { g.innerHTML += `<div class="calendar-day opacity-0 pointer-events-none"></div>`; }

    for(let d = 1; d <= ld; d++){
        const ds = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const shift = state.shifts.find(s => s.date === ds && s.name === state.currentUser.name);
        const tasks = state.tasks.filter(t => t.date === ds && t.name === state.currentUser.name);
        let dayClass = '';
        let content = `<span class="font-bold mb-1">${d}</span>`;
        if (shift) {
            if (shift.start === 'Відпустка') { dayClass = 'vacation-day'; content += `<div class="work-badge">🌴</div>`; }
            else { dayClass = 'my-work-day'; content += `<div class="work-badge">${shift.start}-${shift.end}</div>`; }
        }
        if(tasks.length > 0) { content += `<div class="absolute top-1 right-1 w-1.5 h-1.5 bg-purple-500 rounded-full"></div>`; }
        if (ds === today) dayClass += ' today';
        g.innerHTML += `<div class="calendar-day ${dayClass}" onclick="triggerHaptic(); window.openNotesModal('${ds}')">${content}</div>`;
    }
}

export function renderTable() {
    const container = document.getElementById('gridViewContainer');
    const tableDiv = document.getElementById('gridViewTable');
    tableDiv.innerHTML = '';
    
    const tTitle = document.getElementById('gridTitle');
    const y = state.currentDate.getFullYear();
    const m = state.currentDate.getMonth();
    tTitle.innerText = new Date(y, m).toLocaleDateString('uk-UA', { month: 'long', year: 'numeric' });

    const daysInMonth = new Date(y, m + 1, 0).getDate();
    
    const now = new Date();
    const isCurrentMonth = now.getFullYear() === y && now.getMonth() === m;
    const todayDate = now.getDate();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

    let html = '<table class="w-full text-xs border-collapse">';
    
    html += '<thead><tr class="h-10 border-b border-gray-100 dark:border-gray-800">';
    html += '<th class="sticky left-0 z-20 bg-gray-50 dark:bg-[#2C2C2E] px-2 text-left font-bold min-w-[100px] border-r border-gray-200 dark:border-gray-700 shadow-sm">Співробітник</th>';
    
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
    html += '</tr></thead>';

    html += '<tbody>';
    
    let usersToShow = (state.filter === 'all') ? state.users : state.users.filter(u => u.name === state.filter);

    usersToShow.forEach(user => {
        const parts = user.name.split(' ');
        const shortName = parts.length > 1 ? parts[1] : parts[0];
        
        html += '<tr class="h-10 border-b border-gray-50 dark:border-gray-800/50 hover:bg-gray-50 dark:hover:bg-[#2C2C2E] transition-colors">';
        html += `<td class="sticky left-0 z-10 bg-white dark:bg-[#1C1C1E] px-2 border-r border-gray-200 dark:border-gray-700 font-medium text-[11px] truncate max-w-[100px] shadow-sm">${shortName}</td>`;
        
        for(let d=1; d<=daysInMonth; d++) {
            const ds = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const isToday = isCurrentMonth && d === todayDate;
            const shift = state.shifts.find(s => s.date === ds && s.name === user.name);
            const isPast = ds < todayStr;

            let cellClass = '';
            if (isPast) cellClass = 'bg-gray-50/50 dark:bg-[#121212] text-gray-300';
            if (isToday) cellClass = 'bg-blue-50/50 dark:bg-blue-900/20 border-x-2 border-blue-200 dark:border-blue-800 relative z-0'; 

            let content = '';
            if (shift) {
                if (shift.start === 'Відпустка') {
                    content = '<span class="text-lg">🌴</span>';
                } else {
                    const opacity = isPast ? 'opacity-50' : '';
                    content = `<div class="text-[10px] font-mono leading-tight bg-gray-100 dark:bg-gray-800 rounded px-1 py-0.5 ${opacity}">${shift.start}<br>${shift.end}</div>`;
                }
            }

            html += `<td class="text-center p-0.5 border-r border-gray-100 dark:border-gray-800 ${cellClass}">${content}</td>`;
        }
        html += '</tr>';
    });
    
    html += '</tbody></table>';
    tableDiv.innerHTML = html;

    setTimeout(() => {
        const el = document.getElementById('todayColumn');
        if (el) el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }, 100);
}

// --- KPI RENDER (ОНОВЛЕНО) ---
export function renderKpi() {
    const listDiv = document.getElementById('kpiList');
    const totalDiv = document.getElementById('kpiTotalCard');
    const title = document.getElementById('kpiTitle');
    const updateDate = document.getElementById('kpiUpdateDate');
    
    if (!listDiv || !totalDiv) return;
    
    listDiv.innerHTML = '';
    totalDiv.innerHTML = '';
    
    const { kpi, settings, hours } = state.kpiData || { kpi: [], settings: null, hours: {} };
    const normHours = settings?.normHours || 0;

    const y = state.currentDate.getFullYear();
    const m = state.currentDate.getMonth();
    title.innerText = new Date(y, m).toLocaleDateString('uk-UA', { month: 'long', year: 'numeric' });
    
    if (!kpi || kpi.length === 0) {
        listDiv.innerHTML = '<div class="text-center text-gray-400 py-10">Немає даних за цей місяць</div>';
        updateDate.innerText = '';
        return;
    }

    const lastUpdate = kpi.reduce((latest, item) => {
        const itemDate = new Date(item.updatedAt);
        return itemDate > latest ? itemDate : latest;
    }, new Date(0));
    updateDate.innerText = `Оновлено: ${lastUpdate.toLocaleString('uk-UA')}`;

    const totalData = kpi.find(k => k.name === 'TOTAL');
    let usersData = kpi.filter(k => k.name !== 'TOTAL');

    usersData.sort((a, b) => {
        if (a.name === state.currentUser.name) return -1;
        if (b.name === state.currentUser.name) return 1;
        // Сортуємо по % Device KPI
        const aPerc = a.stats.devicePercent || 0; 
        const bPerc = b.stats.devicePercent || 0;
        return bPerc - aPerc;
    });

    const renderProgressBar = (val, max, colorClass, label, customDiffHtml = '') => {
        const perc = max > 0 ? Math.min(100, (val / max) * 100) : 0;
        return `
            <div class="mt-3">
                <div class="flex justify-between text-[10px] mb-0.5">
                    <span class="text-gray-500">${label}</span>
                    <span class="font-bold">${val} / ${max}${customDiffHtml}</span>
                </div>
                <div class="w-full bg-gray-100 dark:bg-gray-700 h-1.5 rounded-full overflow-hidden">
                    <div class="h-full rounded-full ${colorClass}" style="width: ${perc}%"></div>
                </div>
            </div>
        `;
    };

    // Helper: Статистичний Блок (План/Факт або просто %)
    const renderStatBox = (label, fact, target, percent, isPercentOnly = false) => {
        let valueHtml = '';
        let subHtml = '';
        
        if (isPercentOnly) {
            valueHtml = `<div class="text-lg font-bold text-blue-500">${fact}%</div>`;
        } else {
            valueHtml = `<div class="text-sm font-bold text-gray-800 dark:text-gray-200">${fact}</div>`;
            if (target) {
                subHtml += `<div class="text-[10px] text-gray-400">План: ${target}</div>`;
            }
            if (percent !== undefined && percent !== null) {
                const color = percent >= 100 ? 'text-green-500' : 'text-orange-500';
                subHtml += `<div class="text-[10px] ${color} font-bold">${percent}%</div>`;
            }
        }

        return `
            <div class="bg-gray-50 dark:bg-[#2C2C2E] p-2 rounded-lg text-center flex flex-col justify-center min-h-[60px]">
                <div class="text-[9px] text-gray-400 uppercase font-bold mb-1">${label}</div>
                ${valueHtml}
                ${subHtml}
            </div>
        `;
    };

    // RENDER TOTAL
    if (totalData) {
        const s = totalData.stats;
        totalDiv.innerHTML = `
            <div class="ios-card p-4 border-l-4 border-blue-500 shadow-md">
                <div class="flex justify-between items-center mb-3">
                    <h3 class="font-bold text-lg">🏢 Тотал Магазину</h3>
                    <span class="text-xs bg-blue-100 text-blue-600 px-2 py-1 rounded-full font-bold">TOTAL</span>
                </div>
                <div class="grid grid-cols-2 gap-2 mb-2">
                    ${renderStatBox('Девайси', s.devices, s.devicesTarget, s.devicePercent)}
                    ${renderStatBox('UPT', s.upt, s.uptTarget, s.uptPercent)}
                </div>
                <div class="grid grid-cols-2 gap-2">
                    ${renderStatBox('NPS', s.nps, s.npsTarget || null, s.npsPercent || null)}
                    ${renderStatBox('NBA', s.nba, null, null, true)}
                </div>
            </div>
        `;
    }

    // RENDER USERS
    usersData.forEach((u, index) => {
        const s = u.stats;
        const isMe = u.name === state.currentUser.name;
        const highlightClass = isMe ? 'ring-2 ring-blue-500 shadow-lg' : '';
        const rank = index + 1;
        
        const userWorkedHours = hours[u.name] || 0;
        let diffHtml = '';
        if (normHours > 0 && userWorkedHours > normHours) {
            const diff = parseFloat((userWorkedHours - normHours).toFixed(1));
            diffHtml = ` <span class="text-green-600 font-bold ml-1">+${diff} год.</span>`;
        }

        const userObj = state.users.find(usr => usr.name === u.name);
        let avatarHtml = `<div class="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-bold text-gray-500 uppercase">${u.name.substring(0,2)}</div>`;
        if (userObj && userObj.avatar) {
            avatarHtml = `<div class="w-8 h-8 rounded-full overflow-hidden border border-gray-200"><img src="${userObj.avatar}" class="w-full h-full object-cover"></div>`;
        }

        let medal = '';
        if(rank === 1) medal = '🥇';
        if(rank === 2) medal = '🥈';
        if(rank === 3) medal = '🥉';

        listDiv.innerHTML += `
            <div class="ios-card p-3 ${highlightClass} relative">
                <div class="absolute top-3 right-3 text-xs opacity-50 font-mono font-bold">#${rank} ${medal}</div>
                
                <div class="flex items-center gap-3 mb-3">
                    ${avatarHtml}
                    <div>
                        <div class="font-bold text-sm ${isMe ? 'text-blue-600' : ''}">${u.name}</div>
                        <div class="text-[10px] text-gray-400">KPI Девайсів: ${s.devicePercent}%</div>
                    </div>
                </div>

                <div class="grid grid-cols-3 gap-2 mb-2">
                    ${renderStatBox('Девайси', s.devices, s.devicesTarget, s.devicePercent)}
                    ${renderStatBox('UPT', s.upt, s.uptTarget, s.uptPercent)}
                    ${renderStatBox('NBA', s.nba, null, null, true)}
                </div>

                ${renderProgressBar(userWorkedHours, normHours, 'bg-yellow-500', 'Години', diffHtml)}
            </div>
        `;
    });
}