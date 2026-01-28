import { state } from './state.js';
import { triggerHaptic } from './ui.js';

const START_HOUR = 10;
const TOTAL_HOURS = 10;

// ... (renderTimeline залишаємо без змін) ...
export function renderTimeline() {
    const main = document.getElementById('scheduleView');
    main.innerHTML = '';
    const archive = document.getElementById('archiveContainer');
    archive.innerHTML = '';

    const dates = [...new Set([...state.shifts.map(s => s.date), ...state.notes.map(n => n.date)])].sort();
    
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    
    if (!dates.includes(today)) dates.push(today);
    dates.sort();

    let pastDaysCount = 0;
    
    // Фільтрація юзерів
    let usersToShow = (state.filter === 'all') ? state.users : state.users.filter(u => u.name === state.filter);

    // Підрахунок годин
    const currentMonthPrefix = today.substring(0, 7);
    const userHours = {};
    usersToShow.forEach(u => {
        let h = 0;
        state.shifts.filter(s => s.name === u.name && s.date.startsWith(currentMonthPrefix) && s.start !== 'Відпустка').forEach(s => {
            const [h1, m1] = s.start.split(':').map(Number);
            const [h2, m2] = s.end.split(':').map(Number);
            h += (h2 + m2/60) - (h1 + m1/60);
        });
        userHours[u.name] = h.toFixed(0);
    });

    dates.forEach((dateStr, index) => {
        const isPast = dateStr < today;
        const isToday = dateStr === today;
        const dObj = new Date(dateStr);
        const dName = dObj.toLocaleDateString('uk-UA', { weekday: 'long', day: 'numeric', month: 'long' });
        const animClass = isPast ? '' : `animate-slide-up stagger-${(index % 5) + 1}`;
        
        const block = document.createElement('div');
        block.className = `ios-card p-4 ${animClass}`;
        
        if(isToday) {
            block.classList.add(
                'ring-2', 'ring-blue-500', 
                'shadow-lg', 'shadow-blue-500/20', 
                'dark:shadow-blue-500'
            );
        }

        let html = `<div class="mb-3 border-b border-gray-100 dark:border-gray-800 pb-2 flex justify-between items-center cursor-pointer active:opacity-60" onclick="openNotesModal('${dateStr}')"><h3 class="font-bold text-lg capitalize ${isToday?'text-blue-500':'text-black dark:text-white'}">${dName}</h3><div class="text-blue-500 text-xs font-bold px-2 py-1 bg-blue-50 dark:bg-blue-900/30 rounded-lg">📝 Нотатки</div></div>`;
        
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
                const delShift = canEdit ? `<button onclick="delS('${shift._id}')" class="ml-auto text-gray-300 hover:text-red-500 p-1">✕</button>` : '';

                if (shift.start === 'Відпустка') {
                    html += `<div><div class="flex items-center text-xs mb-1 font-medium ${isMe?'text-teal-600 font-bold':'text-gray-900 dark:text-gray-200'}">${avatarHtml} <span>${shortName}</span> ${hoursBadges} <span class="ml-2 text-teal-500 font-mono">Відпустка</span> ${delShift}</div><div class="timeline-track"><div class="shift-segment vacation-segment">ВІДПУСТКА 🌴</div></div></div>`;
                } else {
                    const [sH, sM] = shift.start.split(':').map(Number);
                    const [eH, eM] = shift.end.split(':').map(Number);
                    const startDecimal = sH + sM/60;
                    const endDecimal = eH + eM/60;
                    let left = ((startDecimal - START_HOUR) / TOTAL_HOURS) * 100;
                    let width = ((endDecimal - startDecimal) / TOTAL_HOURS) * 100;
                    if(left < 0) { width += left; left = 0; }
                    if(left + width > 100) width = 100 - left;

                    let tasksHtml = '';
                    let badges = '';
                    
                    userTasks.forEach(task => {
                        if(task.isFullDay) {
                            badges += `<span class="ml-2 text-[10px] text-purple-600 font-bold border border-purple-200 bg-purple-50 px-1 rounded">★ ${task.title}</span>`;
                        } else {
                            const [tS_h, tS_m] = task.start.split(':').map(Number);
                            const [tE_h, tE_m] = task.end.split(':').map(Number);
                            const tStartD = tS_h + tS_m/60;
                            const tEndD = tE_h + tE_m/60;
                            let tLeft = ((tStartD - START_HOUR) / TOTAL_HOURS) * 100;
                            let tWidth = ((tEndD - tStartD) / TOTAL_HOURS) * 100;
                            const delAction = canEdit ? `onclick="deleteTask('${task._id}'); event.stopPropagation();"` : '';
                            tasksHtml += `<div class="task-segment" style="left:${tLeft}%; width:${tWidth}%;" ${delAction}>${task.title}</div>`;
                        }
                    });

                    html += `<div><div class="flex items-center text-xs mb-1 font-medium ${isMe?'text-blue-600 font-bold':'text-gray-900 dark:text-gray-200'}">${avatarHtml} <span>${shortName}</span> ${hoursBadges} <span class="ml-2 text-gray-400 font-mono">${shift.start}-${shift.end}</span> ${badges} ${delShift}</div><div class="timeline-track shadow-inner"><div class="timeline-grid-overlay">${Array(10).fill('<div class="timeline-line"></div>').join('')}</div><div class="shift-segment ${isMe?'my-shift':''}" style="left:${left}%; width:${width}%"></div>${tasksHtml}</div></div>`;
                }
            } else if (userTasks.length > 0) {
                 let tasksHtml = ''; userTasks.forEach(task => { if(!task.isFullDay) { const [tS_h, tS_m] = task.start.split(':').map(Number); const [tE_h, tE_m] = task.end.split(':').map(Number); const tStartD = tS_h + tS_m/60; const tEndD = tE_h + tE_m/60; let tLeft = ((tStartD - START_HOUR) / TOTAL_HOURS) * 100; let tWidth = ((tEndD - tStartD) / TOTAL_HOURS) * 100; const canEdit = ['admin','SM','SSE'].includes(state.currentUser.role) && state.currentUser.role !== 'RRP'; const delAction = canEdit ? `onclick="deleteTask('${task._id}'); event.stopPropagation();"` : ''; tasksHtml += `<div class="task-segment" style="left:${tLeft}%; width:${tWidth}%;" ${delAction}>${task.title}</div>`; } });
                 html += `<div class="opacity-80"><div class="flex items-center text-xs mb-1 text-gray-500">${avatarHtml} <span>${shortName}</span> ${hoursBadges} <span class="ml-2 text-orange-500 font-bold">Тільки задача</span></div><div class="timeline-track"><div class="timeline-grid-overlay">${Array(10).fill('<div class="timeline-line"></div>').join('')}</div>${tasksHtml}</div></div>`;
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

    const arcBtn = document.getElementById('archiveToggleBtn');
    const arcCnt = document.getElementById('archiveCount');
    if(pastDaysCount > 0) { arcBtn.classList.remove('hidden'); arcCnt.innerText = pastDaysCount; } else { arcBtn.classList.add('hidden'); }
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
        g.innerHTML += `<div class="calendar-day ${dayClass}" onclick="triggerHaptic(); openNotesModal('${ds}')">${content}</div>`;
    }
}

// НОВА ФУНКЦІЯ: ТАБЛИЦЯ (GRID)
export function renderTable() {
    const container = document.getElementById('gridViewContainer');
    // Очищаємо контейнер (крім контролів місяця)
    const tableDiv = document.getElementById('gridViewTable');
    tableDiv.innerHTML = '';
    
    const tTitle = document.getElementById('gridTitle');
    const y = state.currentDate.getFullYear();
    const m = state.currentDate.getMonth();
    tTitle.innerText = new Date(y, m).toLocaleDateString('uk-UA', { month: 'long', year: 'numeric' });

    const daysInMonth = new Date(y, m + 1, 0).getDate();
    
    // Перевірка "Сьогодні"
    const now = new Date();
    const isCurrentMonth = now.getFullYear() === y && now.getMonth() === m;
    const todayDate = now.getDate();

    let html = '<table class="w-full text-xs border-collapse">';
    
    // HEADER (Дати)
    html += '<thead><tr class="h-10 border-b border-gray-100 dark:border-gray-800">';
    // Лівий кут (фіксований)
    html += '<th class="sticky left-0 z-20 bg-gray-50 dark:bg-[#2C2C2E] px-2 text-left font-bold min-w-[100px] border-r border-gray-200 dark:border-gray-700 shadow-sm">Співробітник</th>';
    
    for(let d=1; d<=daysInMonth; d++) {
        const isToday = isCurrentMonth && d === todayDate;
        const dateObj = new Date(y, m, d);
        const dayName = dateObj.toLocaleDateString('uk-UA', {weekday: 'short'});
        const isWeekend = dateObj.getDay() === 0 || dateObj.getDay() === 6;
        
        // Стилі для заголовка дня
        let bgClass = isWeekend ? 'bg-red-50 dark:bg-red-900/20 text-red-500' : 'bg-white dark:bg-[#1C1C1E] text-gray-500 dark:text-gray-400';
        if (isToday) bgClass = 'bg-blue-500 text-white shadow-md shadow-blue-500/30 rounded-t-lg transform scale-105 z-10'; // Виділення сьогодні
        
        html += `<th class="px-1 text-center min-w-[40px] font-normal ${bgClass} border-r border-gray-100 dark:border-gray-800 relative group cursor-default">
            <div class="font-bold text-[13px]">${d}</div>
            <div class="text-[9px] opacity-80 uppercase">${dayName}</div>
        </th>`;
    }
    html += '</tr></thead>';

    // BODY (Співробітники)
    html += '<tbody>';
    
    // Фільтр юзерів (якщо треба, або показуємо всіх)
    let usersToShow = (state.filter === 'all') ? state.users : state.users.filter(u => u.name === state.filter);

    usersToShow.forEach(user => {
        const parts = user.name.split(' ');
        const shortName = parts.length > 1 ? parts[1] : parts[0];
        
        html += '<tr class="h-10 border-b border-gray-50 dark:border-gray-800/50 hover:bg-gray-50 dark:hover:bg-[#2C2C2E] transition-colors">';
        
        // Ім'я (фіксоване)
        html += `<td class="sticky left-0 z-10 bg-white dark:bg-[#1C1C1E] px-2 border-r border-gray-200 dark:border-gray-700 font-medium text-[11px] truncate max-w-[100px] shadow-sm">${shortName}</td>`;
        
        for(let d=1; d<=daysInMonth; d++) {
            const ds = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const isToday = isCurrentMonth && d === todayDate;
            const shift = state.shifts.find(s => s.date === ds && s.name === user.name);
            
            // Фон клітинки
            let cellClass = '';
            if (isToday) cellClass += ' bg-blue-50/50 dark:bg-blue-900/10 border-x-2 border-blue-200 dark:border-blue-800'; // Світла смуга на весь стовпчик "сьогодні"

            let content = '';
            if (shift) {
                if (shift.start === 'Відпустка') {
                    content = '<span class="text-lg">🌴</span>';
                } else {
                    content = `<div class="text-[10px] font-mono leading-tight bg-gray-100 dark:bg-gray-800 rounded px-1 py-0.5">${shift.start}<br>${shift.end}</div>`;
                }
            }

            html += `<td class="text-center p-0.5 border-r border-gray-100 dark:border-gray-800 ${cellClass}">${content}</td>`;
        }
        html += '</tr>';
    });
    
    html += '</tbody></table>';
    tableDiv.innerHTML = html;
}