import { state } from './state.js';
import { getDisplayName } from './render_utils.js';

// 🔥 Same color system as render_table.js - shift times get consistent colors
const shiftColors = [
    { bg: 'rgba(59,130,246,0.18)', border: 'rgba(59,130,246,0.4)', text: '#1d4ed8' },   // blue
    { bg: 'rgba(168,85,247,0.18)', border: 'rgba(168,85,247,0.4)', text: '#7e22ce' },   // purple
    { bg: 'rgba(249,115,22,0.18)', border: 'rgba(249,115,22,0.4)', text: '#c2410c' },   // orange
    { bg: 'rgba(34,197,94,0.18)', border: 'rgba(34,197,94,0.4)', text: '#15803d' },    // green
    { bg: 'rgba(236,72,153,0.18)', border: 'rgba(236,72,153,0.4)', text: '#be185d' },  // pink
    { bg: 'rgba(20,184,166,0.18)', border: 'rgba(20,184,166,0.4)', text: '#0f766e' },  // teal
    { bg: 'rgba(99,102,241,0.18)', border: 'rgba(99,102,241,0.4)', text: '#4338ca' },  // indigo
    { bg: 'rgba(234,179,8,0.18)', border: 'rgba(234,179,8,0.4)', text: '#a16207' },   // yellow
    { bg: 'rgba(244,63,94,0.18)', border: 'rgba(244,63,94,0.4)', text: '#be123c' },   // rose
    { bg: 'rgba(6,182,212,0.18)', border: 'rgba(6,182,212,0.4)', text: '#0e7490' },   // cyan
];

function getCalendarShiftColor(start, end) {
    if (!start || !end) return null;
    const key = `${start}-${end}`;
    let hash = 5381;
    for (let i = 0; i < key.length; i++) hash = (hash * 33) ^ key.charCodeAt(i);
    return shiftColors[Math.abs(hash) % shiftColors.length];
}

function getShiftIcon(start, end) {
    if (!start || !end) return '';
    const startH = parseInt(start.split(':')[0]);
    const endH = parseInt(end.split(':')[0]);
    if (startH <= 10) return '🌅';
    if (endH >= 20) return '🌙';
    return '';
}

function getShiftDuration(start, end) {
    if (!start || !end) return '';
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    const h = (eh + em / 60) - (sh + sm / 60);
    return h % 1 === 0 ? `${h}г` : `${h.toFixed(1)}г`;
}

export function renderCalendar() {
    const g = document.getElementById('calendarGrid');
    const t = document.getElementById('calendarTitle');

    if (!g || !t) return;
    if (!state.currentUser) return;

    g.innerHTML = '';
    const y = state.currentDate.getFullYear();
    const m = state.currentDate.getMonth();

    t.innerText = new Date(y, m).toLocaleDateString('uk-UA', { month: 'long', year: 'numeric' });

    const fd = new Date(y, m, 1).getDay() || 7;
    const ld = new Date(y, m + 1, 0).getDate();
    const todayStr = new Date().toISOString().split('T')[0];

    // Пусті клітинки до першого дня місяця
    for (let i = 1; i < fd; i++) {
        g.innerHTML += `<div class="calendar-day opacity-0 pointer-events-none"></div>`;
    }

    for (let d = 1; d <= ld; d++) {
        const ds = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const shift = state.shifts.find(s => s.date === ds && s.name === state.currentUser.name);
        const tasks = state.tasks.filter(t => t.date === ds && t.name === state.currentUser.name);

        const dateObj = new Date(ds);
        const isWeekend = dateObj.getDay() === 0 || dateObj.getDay() === 6;
        const isToday = ds === todayStr;
        const isPast = ds < todayStr;

        // --- Base class for the day cell ---
        let extraStyle = '';
        let extraClass = 'calendar-day';

        if (isToday) {
            extraClass += ' calendar-today';
        } else if (isPast) {
            extraClass += ' calendar-past';
        } else if (isWeekend) {
            extraClass += ' calendar-weekend';
        }

        // --- Date number ---
        let content = `<span class="cal-day-num ${isToday ? 'text-white' : isWeekend && !isPast ? 'text-red-500' : ''}">${d}</span>`;

        // --- Shift badge ---
        if (shift) {
            if (shift.start === 'Відпустка') {
                content += `<div class="cal-badge cal-vacation">🌴</div>`;
            } else if (shift.start === 'Лікарняний') {
                content += `<div class="cal-badge cal-sick">💊</div>`;
            } else {
                const color = getCalendarShiftColor(shift.start, shift.end);
                const icon = getShiftIcon(shift.start, shift.end);
                const duration = getShiftDuration(shift.start, shift.end);
                const colorStyle = color
                    ? `background:${color.bg}; border-color:${color.border}; color:${color.text};`
                    : '';
                content += `<div class="cal-badge cal-shift" style="${colorStyle}">${icon ? icon + ' ' : ''}${duration}</div>`;
                content += `<div class="cal-time-hint">${shift.start}–${shift.end}</div>`;
            }
        }

        // --- Task dot ---
        if (tasks.length > 0) {
            content += `<div class="cal-task-dot"></div>`;
        }

        g.innerHTML += `<div class="${extraClass}" style="${extraStyle}" onclick="triggerHaptic(); window.handleCalendarDayClick('${ds}')">${content}</div>`;
    }
}

export function renderKpi() {
    const listDiv = document.getElementById('kpiList');
    const totalDiv = document.getElementById('kpiTotalCard');
    const title = document.getElementById('kpiTitle');
    const updateDate = document.getElementById('kpiUpdateDate');

    if (!listDiv || !totalDiv) return;
    if (!state.currentUser) return;

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

    // 🔥 Фільтр KPI по магазину
    if (state.selectedStoreFilter && state.selectedStoreFilter !== 'all') {
        usersData = usersData.filter(k => {
            const u = state.users.find(user => user.name === k.name);
            return u && String(u.storeId) === String(state.selectedStoreFilter);
        });
    }

    usersData.sort((a, b) => {
        if (a.name === state.currentUser.name) return -1;
        if (b.name === state.currentUser.name) return 1;

        const aPerc = a.stats.devicesTarget ? (a.stats.devices / a.stats.devicesTarget) : 0;
        const bPerc = b.stats.devicesTarget ? (b.stats.devices / b.stats.devicesTarget) : 0;
        return bPerc - aPerc;
    });

    const renderProgress = (val, max, colorClass, label, customDiffHtml = '') => {
        const perc = max > 0 ? Math.min(100, (val / max) * 100) : 0;
        return `
            <div class="mb-2">
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

    const renderStatWithTarget = (label, val, target, perc) => `
        <div class="bg-gray-50 dark:bg-[#2C2C2E] p-2 rounded-lg text-center flex flex-col justify-between min-h-[50px]">
            <div class="text-[9px] text-gray-400 uppercase font-bold mb-1">${label}</div>
            <div class="text-sm font-bold text-gray-800 dark:text-gray-200 leading-none">${val}</div>
            ${target ? `<div class="text-[9px] text-gray-400 mt-1">/ ${target}</div>` : ''}
            ${perc ? `<div class="text-[9px] ${perc >= 100 ? 'text-green-500' : 'text-orange-500'} font-bold mt-0.5">${perc}%</div>` : ''}
        </div>
    `;

    if (totalData) {
        const s = totalData.stats;
        totalDiv.innerHTML = `
            <div class="ios-card p-4 border-l-4 border-blue-500 shadow-md">
                <div class="flex justify-between items-center mb-3">
                    <h3 class="font-bold text-lg">🏢 Тотал Магазину</h3>
                    <span class="text-xs bg-blue-100 text-blue-600 px-2 py-1 rounded-full font-bold">TOTAL</span>
                </div>
                <div class="grid grid-cols-4 gap-2 mb-3">
                    ${renderStatWithTarget('Замовлень', s.orders)}
                    ${renderStatWithTarget('Девайси', s.devices)}
                    ${renderStatWithTarget('UPT', s.upt, s.uptTarget, s.uptPercent)}
                    ${renderStatWithTarget('NPS', s.nps)}
                </div>
                ${renderProgress(s.devices, s.devicesTarget, 'bg-blue-500', 'План по девайсах')}
            </div>
        `;
    }

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
        const displayName = getDisplayName(userObj) || u.name;
        const initial = displayName.substring(0, 2);

        let avatarHtml = `<div class="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-bold text-gray-500 uppercase">${initial}</div>`;
        if (userObj && userObj.avatar) {
            avatarHtml = `<div class="w-8 h-8 rounded-full overflow-hidden border border-gray-200"><img src="${userObj.avatar}" class="w-full h-full object-cover"></div>`;
        }

        let medal = '';
        if (rank === 1) medal = '🥇';
        if (rank === 2) medal = '🥈';
        if (rank === 3) medal = '🥉';

        const deviceShareBadge = s.devicePercent
            ? `<div class="absolute top-3 right-10 bg-indigo-50 text-indigo-600 text-[10px] px-2 py-0.5 rounded-full font-bold border border-indigo-100">🏆 Share: ${s.devicePercent}%</div>`
            : '';

        listDiv.innerHTML += `
            <div class="ios-card p-3 ${highlightClass} relative">
                <div class="absolute top-3 right-3 text-xs opacity-50 font-mono font-bold">#${rank} ${medal}</div>
                ${deviceShareBadge}
                
                <div class="flex items-center gap-3 mb-3">
                    ${avatarHtml}
                    <div>
                        <div class="font-bold text-sm ${isMe ? 'text-blue-600' : ''}">${displayName}</div>
                        <div class="text-[10px] text-gray-400">KPI Девайсів: ${s.devicesTarget ? Math.round(s.devices / s.devicesTarget * 100) : 0}%</div>
                    </div>
                </div>

                <div class="grid grid-cols-3 gap-2 mb-3">
                    ${renderStatWithTarget('UPT', s.upt, s.uptTarget, s.uptPercent)}
                    ${renderStatWithTarget('NPS', s.nps)}
                    ${renderStatWithTarget('NBA', s.nba)}
                </div>

                ${renderProgress(s.devices, s.devicesTarget, 'bg-green-500', 'Девайси')}
                ${renderProgress(userWorkedHours, normHours, 'bg-yellow-500', 'Години', diffHtml)}
            </div>
        `;
    });
}