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
