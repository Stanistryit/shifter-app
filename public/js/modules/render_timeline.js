import { state } from './state.js';
import { getUsersForView, getDisplayName } from './render_utils.js';

export function renderTimeline() {
    const main = document.getElementById('scheduleView');
    const archive = document.getElementById('archiveContainer');
    
    // Якщо елементів немає (наприклад, ми не в тому режимі), виходимо
    if (!main || !archive) return;

    main.innerHTML = '';
    archive.innerHTML = '';

    const viewY = state.currentDate.getFullYear();
    const viewM = state.currentDate.getMonth();
    const viewMonthStr = `${viewY}-${String(viewM + 1).padStart(2, '0')}`;

    // Збираємо всі унікальні дати (зміни + нотатки)
    let allDates = [...new Set([...state.shifts.map(s => s.date), ...state.notes.map(n => n.date)])];
    
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    
    // Завжди додаємо "сьогодні", якщо ми дивимось поточний місяць
    if (today.startsWith(viewMonthStr) && !allDates.includes(today)) allDates.push(today);
    
    // Фільтруємо дати тільки для обраного місяця і сортуємо
    const dates = allDates.filter(d => d.startsWith(viewMonthStr)).sort();
    
    // Отримуємо відфільтрований список користувачів (враховуючи магазин і пошук)
    let usersToShow = getUsersForView(viewMonthStr);

    // 🔥 ОТРИМУЄМО ГОДИНИ РОБОТИ МАГАЗИНУ
    // Якщо у юзера є прив'язка до магазину і там є налаштування - беремо їх. Інакше дефолт 10-22.
    let storeOpen = 10;
    let storeClose = 22;

    if (state.currentUser && state.currentUser.store) {
        if (state.currentUser.store.openTime) storeOpen = parseInt(state.currentUser.store.openTime.split(':')[0]);
        if (state.currentUser.store.closeTime) storeClose = parseInt(state.currentUser.store.closeTime.split(':')[0]);
        // Якщо закриття, наприклад, о 22:00, то графік має бути до 23:00, щоб візуально влізло
        if (state.currentUser.store.closeTime.endsWith(':00') === false) storeClose += 1; 
    }

    // Підрахунок годин
    let pastDaysCount = 0;
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

    // Кнопка "Попередній місяць"
    const prevBtnDiv = document.createElement('div');
    prevBtnDiv.className = "mb-4";
    prevBtnDiv.innerHTML = `<button onclick="changeMonth(-1)" class="w-full py-3 bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-700 text-blue-500 rounded-xl text-xs font-bold shadow-sm active:scale-95 transition-transform">⬅️ Попередній місяць (${new Date(viewY, viewM - 1).toLocaleDateString('uk-UA', {month:'long'})})</button>`;
    archive.appendChild(prevBtnDiv);

    if (dates.length === 0) main.innerHTML = `<div class="text-center text-gray-400 py-10 text-sm">Немає записів на цей місяць</div>`;

    dates.forEach((dateStr, index) => {
        // Визначаємо межі робочого дня для малювання графіку
        let dayStart = storeOpen;   
        let dayEnd = storeClose;
        
        // Розширюємо межі, якщо є ранні/пізні зміни/задачі
        state.tasks.filter(t => t.date === dateStr).forEach(t => {
            if (!t.isFullDay && t.start) {
                const h = parseInt(t.start.split(':')[0]); if (h < dayStart) dayStart = h;
                if (t.end) { const parts = t.end.split(':'); const hEnd = parseInt(parts[0]) + (parseInt(parts[1]) > 0 ? 1 : 0); if (hEnd > dayEnd) dayEnd = hEnd; }
            }
        });
        state.shifts.filter(s => s.date === dateStr && s.start !== 'Відпустка').forEach(s => {
            const h = parseInt(s.start.split(':')[0]); if (h < dayStart) dayStart = h;
            const parts = s.end.split(':'); const hEnd = parseInt(parts[0]) + (parseInt(parts[1]) > 0 ? 1 : 0); if (hEnd > dayEnd) dayEnd = hEnd;
        });
        
        // Hard limits (щоб не розтягувало на 24 години без потреби)
        if (dayStart < 6) dayStart = 6; 
        if (dayEnd > 23) dayEnd = 23;
        
        const totalHours = dayEnd - dayStart;

        const isPast = dateStr < today;
        const isToday = dateStr === today;
        const dObj = new Date(dateStr);
        const dName = dObj.toLocaleDateString('uk-UA', { weekday: 'long', day: 'numeric', month: 'long' });
        
        const animClass = isPast ? '' : `animate-slide-up stagger-${(index % 5) + 1}`;
        const block = document.createElement('div');
        block.className = `ios-card p-4 ${animClass}`;
        
        if(isToday) block.classList.add('ring-2', 'ring-blue-500', 'shadow-lg', 'shadow-blue-500/20', 'dark:shadow-blue-500');

        // Заголовок дня
        let html = `<div class="mb-3 border-b border-gray-100 dark:border-gray-800 pb-2 flex justify-between items-center cursor-pointer active:opacity-60" onclick="window.openNotesModal('${dateStr}')"><h3 class="font-bold text-lg capitalize ${isToday?'text-blue-500':'text-black dark:text-white'}">${dName}</h3><div class="text-blue-500 text-xs font-bold px-2 py-1 bg-blue-50 dark:bg-blue-900/30 rounded-lg">📝 Нотатки</div></div>`;
        
        // Нотатки
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
            
            const shortName = getDisplayName(user);
            const hoursBadges = ` <span class="text-[9px] text-gray-400 font-normal">(${userHours[user.name]} год.)</span>`;
            
            let avatarHtml = `<div class="w-5 h-5 rounded-full bg-gray-200 flex items-center justify-center text-[10px] overflow-hidden mr-2 border border-gray-300 dark:border-gray-600">👤</div>`;
            if(user.avatar) avatarHtml = `<div class="w-5 h-5 rounded-full overflow-hidden mr-2 border border-gray-300 dark:border-gray-600"><img src="${user.avatar}" class="w-full h-full object-cover"></div>`;

            const blockedStyle = user.status === 'blocked' ? 'opacity-60 grayscale' : '';

            let tasksHtml = ''; let badges = '';
            
            userTasks.forEach(task => {
                if(task.isFullDay) {
                    const clickAttr = `onclick="window.openTaskProxy('${task._id}'); event.stopPropagation();"`;
                    badges += `<span ${clickAttr} class="ml-2 text-[10px] text-purple-600 font-bold border border-purple-200 bg-purple-50 px-1 rounded cursor-pointer active:scale-95">★ ${task.title}</span>`;
                } else if (task.start && task.end && (!shift || shift.start !== 'Відпустка')) {
                    const [tS_h, tS_m] = task.start.split(':').map(Number); const [tE_h, tE_m] = task.end.split(':').map(Number);
                    const tStartD = tS_h + tS_m/60; const tEndD = tE_h + tE_m/60;
                    let tLeft = ((tStartD - dayStart) / totalHours) * 100; let tWidth = ((tEndD - tStartD) / totalHours) * 100;
                    if(tLeft < 0) { tWidth += tLeft; tLeft = 0; } if(tLeft + tWidth > 100) tWidth = 100 - tLeft;
                    tasksHtml += `<div class="task-segment flex items-center justify-center text-[10px]" style="left:${tLeft}%; width:${tWidth}%;" onclick="window.openTaskProxy('${task._id}'); event.stopPropagation();">📌</div>`;
                }
            });

            if (shift) {
                const isMe = shift.name === state.currentUser.name;
                const canEdit = ['admin','SM','SSE'].includes(state.currentUser.role) && state.currentUser.role !== 'RRP';
                const ctxAttr = canEdit ? `oncontextmenu="window.contextMenuProxy(event, 'shift', '${shift._id}');"` : '';
                
                if (shift.start === 'Відпустка') {
                    html += `<div class="${blockedStyle}"><div class="flex items-center text-xs mb-1 font-medium ${isMe?'text-teal-600 font-bold':'text-gray-900 dark:text-gray-200'}">${avatarHtml} <span>${shortName}</span> ${hoursBadges} <span class="ml-2 text-teal-500 font-mono">Відпустка</span> ${badges}</div><div class="timeline-track" ${ctxAttr}><div class="shift-segment vacation-segment">ВІДПУСТКА 🌴</div></div></div>`;
                } else {
                    const [sH, sM] = shift.start.split(':').map(Number);
                    const [eH, eM] = shift.end.split(':').map(Number);
                    const startDecimal = sH + sM/60; const endDecimal = eH + eM/60;
                    let left = ((startDecimal - dayStart) / totalHours) * 100; let width = ((endDecimal - startDecimal) / totalHours) * 100;
                    if(left < 0) { width += left; left = 0; } if(left + width > 100) width = 100 - left; if(width < 0) width = 0;
                    html += `<div class="${blockedStyle}"><div class="flex items-center text-xs mb-1 font-medium ${isMe?'text-blue-600 font-bold':'text-gray-900 dark:text-gray-200'}">${avatarHtml} <span>${shortName}</span> ${hoursBadges} <span class="ml-2 text-gray-400 font-mono">${shift.start}-${shift.end}</span> ${badges}</div><div class="timeline-track shadow-inner"><div class="timeline-grid-overlay">${Array(totalHours).fill('<div class="timeline-line"></div>').join('')}</div><div class="shift-segment ${isMe?'my-shift':''}" ${ctxAttr} style="left:${left}%; width:${width}%"></div>${tasksHtml}</div></div>`;
                }
            } else if (userTasks.length > 0) {
                 html += `<div class="opacity-80 ${blockedStyle}"><div class="flex items-center text-xs mb-1 text-gray-500">${avatarHtml} <span>${shortName}</span> ${hoursBadges} <span class="ml-2 text-orange-500 font-bold">Тільки задача</span> ${badges}</div><div class="timeline-track"><div class="timeline-grid-overlay">${Array(totalHours).fill('<div class="timeline-line"></div>').join('')}</div>${tasksHtml}</div></div>`;
            } else {
                html += `<div class="opacity-40 ${blockedStyle}"><div class="flex items-center justify-between text-xs mb-1 text-gray-400"><div>${avatarHtml} <span>${shortName}</span> ${hoursBadges}</div> <span>Вихідний</span></div><div class="h-[1px] bg-gray-200 dark:bg-gray-800 rounded w-full mt-3 mb-4"></div></div>`;
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

    // Кнопка "Наступний місяць"
    const nextBtnDiv = document.createElement('div');
    nextBtnDiv.className = "mt-4 pb-12";
    nextBtnDiv.innerHTML = `<button onclick="changeMonth(1)" class="w-full py-3 bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-700 text-blue-500 rounded-xl text-xs font-bold shadow-sm active:scale-95 transition-transform">Наступний місяць (${new Date(viewY, viewM + 1).toLocaleDateString('uk-UA', {month:'long'})}) ➡️</button>`;
    main.appendChild(nextBtnDiv);

    // Кнопка архіву
    const arcBtn = document.getElementById('archiveToggleBtn'); 
    const arcCnt = document.getElementById('archiveCount');
    if(arcBtn && arcCnt) {
        if(pastDaysCount > 0) { 
            arcBtn.classList.remove('hidden'); 
            arcCnt.innerText = pastDaysCount; 
        } else { 
            arcBtn.classList.add('hidden'); 
        }
    }
}