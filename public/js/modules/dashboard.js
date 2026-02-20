import { state } from './state.js';
import { triggerHaptic, showToast } from './ui.js';
import { openNotesModal } from './notes.js';
import { fetchJson } from './api.js'; // 🔥 Додано для безпечних запитів на сервер

window.openTodayNote = (e) => {
    e.stopPropagation();
    triggerHaptic();
    openNotesModal();
};

let dashMode = 'hours'; // 'hours' | 'shifts' | 'percent' | 'money'
let tempOverride = false; 
let overrideTimeout = null;
let isFetchingSalary = false; // 🔥 Запобіжник для спаму запитами

export function initDashboardInteractions() {
    const card = document.getElementById('dashboardCard');
    if (!card) return;

    // 1. Клік на ліву частину -> Показати колег
    const leftPart = card.querySelector('.flex > div:first-child');
    if (leftPart) {
        leftPart.onclick = (e) => {
            e.stopPropagation();
            toggleColleagues();
        };
    }

    // 2. Клік на праву частину -> Розумне перемикання
    const rightPart = card.querySelector('.text-right');
    if (rightPart) {
        rightPart.onclick = (e) => {
            e.stopPropagation();
            triggerHaptic();

            const now = new Date();
            const todayStr = now.toISOString().split('T')[0];
            const me = state.currentUser;
            const myShifts = state.shifts.filter(s => s.name === me?.name);
            const todayShift = myShifts.find(s => s.date === todayStr && !['DELETE', 'Відпустка', 'Лікарняний'].includes(s.start));

            if (todayShift && !tempOverride) {
                // Якщо ми на зміні і зараз бачимо таймер -> вмикаємо статистику на 5 сек
                tempOverride = true;
                if (overrideTimeout) clearTimeout(overrideTimeout);
                overrideTimeout = setTimeout(() => { tempOverride = false; updateDashboard(); }, 5000);
            } else {
                // Якщо ми вихідні або вже дивимось статистику -> просто перемикаємо режим
                cycleDashMode();
                if (todayShift) {
                    // Якщо на зміні, продовжуємо таймер ще на 5 сек
                    if (overrideTimeout) clearTimeout(overrideTimeout);
                    overrideTimeout = setTimeout(() => { tempOverride = false; updateDashboard(); }, 5000);
                }
            }
            updateDashboard();
        };
    }
}

function cycleDashMode() {
    if (dashMode === 'hours') dashMode = 'shifts';
    else if (dashMode === 'shifts') dashMode = 'percent';
    else if (dashMode === 'percent') dashMode = 'money';
    else dashMode = 'hours';
    
    // Старий код з prompt() та localStorage видалено ✂️
}

function toggleColleagues() {
    triggerHaptic();
    const details = document.getElementById('dashColleagues');
    if (details) details.classList.toggle('hidden');
}

export function updateDashboard() {
    const card = document.getElementById('dashboardCard');
    if (!card) return;

    if (!state.currentUser || state.currentUser.role === 'Guest' || state.currentUser.role === 'RRP') {
        card.classList.add('hidden');
        return;
    }
    card.classList.remove('hidden');

    if (!card.dataset.init) {
        initDashboardInteractions();
        card.dataset.init = "true";
    }

    const me = state.currentUser;
    const myShifts = state.shifts.filter(s => s.name === me.name);
    
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const sortedShifts = myShifts.sort((a, b) => a.date.localeCompare(b.date));

    // =========================================================
    // 1. НАСТУПНА ЗМІНА
    // =========================================================
    let nextShift = sortedShifts.find(s => s.date > todayStr && s.start !== 'DELETE');

    const nextTimeEl = document.getElementById('dashNextShiftTime');
    const nextDateEl = document.getElementById('dashNextShiftDate');
    const titleEl = document.getElementById('dashNextShiftTitle');

    let collContainer = document.getElementById('dashColleagues');
    if (!collContainer) {
        collContainer = document.createElement('div');
        collContainer.id = 'dashColleagues';
        collContainer.className = "hidden mt-3 pt-3 border-t border-white/20 text-sm animate-slide-up";
        card.querySelector('.p-4').appendChild(collContainer);
    }

    if (nextShift) {
        const dateObj = new Date(nextShift.date);
        const dayName = dateObj.toLocaleDateString('uk-UA', { weekday: 'long' });
        let dateLabel = `${nextShift.date.slice(5).replace('-','.')} (${dayName})`;
        
        const tomorrow = new Date(now); 
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = tomorrow.toISOString().split('T')[0];

        if (nextShift.date === tomorrowStr) dateLabel = "ЗАВТРА";

        nextDateEl.innerText = dateLabel;
        
        if (nextShift.start === 'Відпустка') nextTimeEl.innerText = 'Відпустка 🌴';
        else if (nextShift.start === 'Лікарняний') nextTimeEl.innerText = 'Лікарняний 💊';
        else nextTimeEl.innerText = `${nextShift.start} - ${nextShift.end}`;

        titleEl.innerHTML = '📅 НАСТУПНА ЗМІНА <span class="opacity-50 text-[10px]">▼</span>';

        const colleagues = state.shifts.filter(s => 
            s.date === nextShift.date && s.name !== me.name && s.start !== 'DELETE' && s.start !== 'Відпустка' && s.start !== 'Лікарняний'
        );
        
        if (colleagues.length > 0) {
            const names = colleagues.map(c => {
                const parts = c.name.trim().split(/\s+/);
                return parts.length >= 2 ? `${parts[1]} ${parts[0][0]}.` : parts[0];
            }).join(', ');
            collContainer.innerHTML = `<span class="opacity-70">Разом з:</span> <b>${names}</b>`;
        } else {
            collContainer.innerHTML = `<span class="opacity-70">Працюєш сам(а) 🦸‍♂️</span>`;
        }
    } else {
        nextTimeEl.innerText = "--:--";
        nextDateEl.innerText = "Немає змін";
        titleEl.innerHTML = '📅 НАСТУПНА ЗМІНА';
        collContainer.innerHTML = '';
    }

    // =========================================================
    // 2. ПРАВА ШКАЛА: ТАЙМЕР ЗМІНИ АБО СТАТИСТИКА
    // =========================================================
    const hoursTextEl = document.getElementById('dashHoursText');
    const subtitleEl = document.getElementById('dashHoursLabel');
    const bar = document.getElementById('dashProgressFill');

    const todayShift = myShifts.find(s => s.date === todayStr && !['DELETE', 'Відпустка', 'Лікарняний'].includes(s.start));

    if (todayShift && !tempOverride) {
        const [sH, sM] = todayShift.start.split(':').map(Number);
        const [eH, eM] = todayShift.end.split(':').map(Number);
        const startMins = sH * 60 + sM;
        const endMins = eH * 60 + eM;
        const currentMins = now.getHours() * 60 + now.getMinutes();

        if (currentMins < startMins) {
            const diff = startMins - currentMins;
            hoursTextEl.innerText = `${Math.floor(diff/60)}г ${diff%60}хв`;
            subtitleEl.innerText = 'до початку зміни (tap)';
            bar.style.width = '0%';
            bar.className = 'bg-white/30 h-full rounded-full transition-all duration-1000';
        } else if (currentMins >= startMins && currentMins < endMins) {
            const diff = endMins - currentMins;
            const total = endMins - startMins;
            const passed = currentMins - startMins;
            const pct = Math.min(100, (passed / total) * 100);
            
            hoursTextEl.innerText = `${Math.floor(diff/60)}г ${diff%60}хв`;
            subtitleEl.innerText = 'залишилось працювати (tap)';
            bar.style.width = `${pct}%`;
            bar.className = 'bg-yellow-400 h-full rounded-full transition-all duration-1000';
        } else {
            hoursTextEl.innerText = `Ура!`;
            subtitleEl.innerText = 'зміну завершено (tap)';
            bar.style.width = '100%';
            bar.className = 'bg-green-400 h-full rounded-full transition-all duration-1000';
        }
    } else {
        const viewYear = state.currentDate.getFullYear();
        const viewMonth = state.currentDate.getMonth();
        const monthlyShifts = myShifts.filter(s => {
            const [y, m, d] = s.date.split('-').map(Number);
            return y === viewYear && (m - 1) === viewMonth;
        });

        let totalHours = 0, totalShifts = 0;
        monthlyShifts.forEach(s => {
            const dur = getDuration(s.start, s.end);
            if (dur > 0) { totalHours += dur; totalShifts++; }
        });

        let norm = parseInt(state.kpiData?.settings?.normHours || 160);
        const percentVal = Math.min(100, (totalHours / norm) * 100);

        if (dashMode === 'hours') {
            hoursTextEl.innerText = `${parseFloat(totalHours.toFixed(1))} / ${norm}`;
            subtitleEl.innerText = 'годин за місяць';
        } else if (dashMode === 'shifts') {
            hoursTextEl.innerText = `${totalShifts}`;
            subtitleEl.innerText = 'змін за місяць';
        } else if (dashMode === 'percent') {
            hoursTextEl.innerText = `${Math.round(percentVal)}%`;
            subtitleEl.innerText = 'від норми';
        } else if (dashMode === 'money') {
            // 🔥 НОВЕ: Розумне завантаження ЗП з сервера
            const y = state.currentDate.getFullYear();
            const m = String(state.currentDate.getMonth() + 1).padStart(2, '0');
            const targetMonth = `${y}-${m}`;

            // Якщо дані вже завантажені і вони за цей місяць — показуємо
            if (state.paySlip && state.paySlip.month === targetMonth) {
                if (state.paySlip.baseRate > 0) {
                    hoursTextEl.innerText = `${state.paySlip.totalSalary.toLocaleString()} ₴`;
                    subtitleEl.innerText = `≈ зп (${state.paySlip.hourlyRate} ₴/год)`;
                } else {
                    hoursTextEl.innerText = `0 ₴`;
                    subtitleEl.innerText = `ставку не налаштовано`;
                }
            } else {
                // Якщо даних ще немає — показуємо лоадер і робимо запит
                hoursTextEl.innerText = `...`;
                subtitleEl.innerText = `рахуємо...`;
                
                if (!isFetchingSalary) {
                    isFetchingSalary = true;
                    fetchJson(`/api/salary?month=${targetMonth}`).then(res => {
                        isFetchingSalary = false;
                        if (res.success) {
                            state.paySlip = res.data;
                        } else {
                            state.paySlip = { month: targetMonth, baseRate: 0, totalSalary: 0, hourlyRate: 0 };
                        }
                        // Оновлюємо UI, тільки якщо юзер ще не переключив режим
                        if (dashMode === 'money') updateDashboard();
                    }).catch(() => {
                        isFetchingSalary = false;
                    });
                }
            }
        }

        bar.style.width = `${percentVal}%`;
        bar.className = (totalHours >= norm) ? 
            'bg-green-400 h-full rounded-full transition-all duration-1000' : 
            'bg-white h-full rounded-full transition-all duration-1000';
            
        if (tempOverride) subtitleEl.innerText += ' ⏱'; 
    }

    // =========================================================
    // 3. LIVE STORE STATUS & NOTES
    // =========================================================
    const liveStatusEl = document.getElementById('dashLiveStatus');
    const todayShiftsGlobal = state.shifts.filter(s => s.date === todayStr && s.start !== 'DELETE' && s.start !== 'Відпустка' && s.start !== 'Лікарняний');
    const currentTimeVal = now.getHours() + now.getMinutes()/60;

    const workingNow = todayShiftsGlobal.filter(s => {
        const startVal = timeToVal(s.start);
        const endVal = timeToVal(s.end);
        return currentTimeVal >= startVal && currentTimeVal < endVal;
    });

    if (workingNow.length > 0) {
        const names = workingNow.map(c => {
            const parts = c.name.trim().split(/\s+/);
            return parts.length >= 2 ? `${parts[1]} ${parts[0][0]}.` : parts[0];
        }).join(', ');
        liveStatusEl.innerHTML = `<span class="w-2 h-2 rounded-full bg-green-400 animate-pulse"></span> <span class="opacity-80 truncate">Зараз: <b>${names}</b></span>`;
    } else {
        liveStatusEl.innerHTML = `<span class="w-2 h-2 rounded-full bg-red-400"></span> <span class="opacity-80">Магазин зачинено</span>`;
    }

    const noteIcon = document.getElementById('dashNoteIcon');
    if (noteIcon) {
        const hasNote = state.notes?.some(n => n.date === todayStr);
        if (hasNote) noteIcon.classList.remove('hidden');
        else noteIcon.classList.add('hidden');
    }
}

// Helpers
function getDuration(start, end) {
    if (!start || !end || start === 'Відпустка' || start === 'Лікарняний' || start === 'DELETE') return 0;
    const s = timeToVal(start);
    const e = timeToVal(end);
    return (e - s) > 0 ? (e - s) : 0;
}

function timeToVal(t) {
    if(!t) return 0;
    const [h, m] = t.split(':').map(Number);
    return h + (m/60);
}

setInterval(() => {
    const card = document.getElementById('dashboardCard');
    if (card && !card.classList.contains('hidden')) {
        updateDashboard();
    }
}, 60000);