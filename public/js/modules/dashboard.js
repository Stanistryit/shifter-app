import { state } from './state.js';
import { triggerHaptic, showToast } from './ui.js';
import { openNotesModal } from './notes.js'; // 🔥 ВИПРАВЛЕНО: Імпорт з правильного файлу

// Експортуємо функцію для HTML
window.openTodayNote = (e) => {
    e.stopPropagation();
    triggerHaptic();
    openNotesModal();
};

let dashMode = 'hours'; // 'hours' | 'shifts' | 'percent' | 'money'

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

    // 2. Клік на праву частину -> Перемикання режимів
    const rightPart = card.querySelector('.text-right');
    if (rightPart) {
        rightPart.onclick = (e) => {
            e.stopPropagation();
            toggleDashMode();
        };
    }
}

function toggleDashMode() {
    triggerHaptic();
    
    if (dashMode === 'hours') dashMode = 'shifts';
    else if (dashMode === 'shifts') dashMode = 'percent';
    else if (dashMode === 'percent') dashMode = 'money';
    else dashMode = 'hours';

    if (dashMode === 'money') {
        const rate = localStorage.getItem('shifter_hourlyRate');
        if (!rate) {
            askHourlyRate();
            return; 
        }
    }
    
    updateDashboard(); 
}

function askHourlyRate() {
    const rate = prompt("Вкажіть вашу ставку за годину (грн):", "100");
    if (rate && !isNaN(rate)) {
        localStorage.setItem('shifter_hourlyRate', rate);
        showToast(`Ставка ${rate} грн/год збережена`);
        dashMode = 'money';
        updateDashboard();
    } else {
        dashMode = 'hours';
        updateDashboard();
    }
}

function toggleColleagues() {
    triggerHaptic();
    const details = document.getElementById('dashColleagues');
    if (details) {
        details.classList.toggle('hidden');
    }
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
    
    // --- 1. NEXT SHIFT ---
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    
    const sortedShifts = myShifts.sort((a, b) => a.date.localeCompare(b.date));
    let nextShift = sortedShifts.find(s => s.date >= todayStr && s.start !== 'DELETE');

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

        if (nextShift.date === todayStr) dateLabel = "СЬОГОДНІ 🔥";
        else if (nextShift.date === tomorrowStr) dateLabel = "ЗАВТРА";

        nextDateEl.innerText = dateLabel;
        
        if (nextShift.start === 'Відпустка') {
            nextTimeEl.innerText = 'Відпустка 🌴';
        } else if (nextShift.start === 'Лікарняний') {
            nextTimeEl.innerText = 'Лікарняний 💊';
        } else {
            nextTimeEl.innerText = `${nextShift.start} - ${nextShift.end}`;
        }

        titleEl.innerHTML = '📅 НАСТУПНА ЗМІНА <span class="opacity-50 text-[10px]">▼</span>';

        const colleagues = state.shifts.filter(s => 
            s.date === nextShift.date && 
            s.name !== me.name && 
            s.start !== 'DELETE' && s.start !== 'Відпустка' && s.start !== 'Лікарняний'
        );
        
        if (colleagues.length > 0) {
            const names = colleagues.map(c => {
                const parts = c.name.trim().split(/\s+/);
                if (parts.length >= 2) return `${parts[1]} ${parts[0][0]}.`; 
                return parts[0];
            }).join(', ');
            
            collContainer.innerHTML = `<span class="opacity-70">Разом з:</span> <b>${names}</b>`;
        } else {
            collContainer.innerHTML = `<span class="opacity-70">Працюєш сам(а) 🦸‍♂️</span>`;
        }
    } else {
        nextTimeEl.innerText = "--:--";
        nextDateEl.innerText = "Немає змін";
        titleEl.innerText = '📅 НАСТУПНА ЗМІНА';
        collContainer.innerHTML = '';
    }

    // --- 2. PROGRESS ---
    const viewYear = state.currentDate.getFullYear();
    const viewMonth = state.currentDate.getMonth();
    
    const monthlyShifts = myShifts.filter(s => {
        const [y, m, d] = s.date.split('-').map(Number);
        return y === viewYear && (m - 1) === viewMonth;
    });

    let totalHours = 0;
    let totalShifts = 0;
    
    monthlyShifts.forEach(s => {
        const dur = getDuration(s.start, s.end);
        if (dur > 0) {
            totalHours += dur;
            totalShifts++;
        }
    });

    let norm = 160;
    if (state.kpiData?.settings?.normHours) norm = parseInt(state.kpiData.settings.normHours);

    const percentVal = Math.min(100, (totalHours / norm) * 100);
    
    const hoursTextEl = document.getElementById('dashHoursText');
    const subtitleEl = document.getElementById('dashHoursLabel');

    if (dashMode === 'hours') {
        hoursTextEl.innerText = `${parseFloat(totalHours.toFixed(1))} / ${norm}`;
        subtitleEl.innerText = 'годин (tap)';
    } else if (dashMode === 'shifts') {
        hoursTextEl.innerText = `${totalShifts}`;
        subtitleEl.innerText = 'змін (tap)';
    } else if (dashMode === 'percent') {
        hoursTextEl.innerText = `${Math.round(percentVal)}%`;
        subtitleEl.innerText = 'від норми (tap)';
    } else if (dashMode === 'money') {
        const rate = localStorage.getItem('shifter_hourlyRate') || 0;
        const salary = Math.round(totalHours * rate);
        hoursTextEl.innerText = `${salary.toLocaleString()} ₴`;
        subtitleEl.innerText = `≈ зарплата (${rate} грн/год)`;
    }

    const bar = document.getElementById('dashProgressFill');
    bar.style.width = `${percentVal}%`;
    bar.className = (totalHours >= norm) ? 
        'bg-green-400 h-full rounded-full transition-all duration-1000' : 
        'bg-white h-full rounded-full transition-all duration-1000';

    // --- 3. LIVE STATUS ---
    const liveStatusEl = document.getElementById('dashLiveStatus');
    
    const todayShifts = state.shifts.filter(s => 
        s.date === todayStr && 
        s.start !== 'DELETE' && 
        s.start !== 'Відпустка' && 
        s.start !== 'Лікарняний'
    );
    
    const currentHour = now.getHours();
    const currentMin = now.getMinutes();
    const currentTimeVal = currentHour + currentMin/60;

    const workingNow = todayShifts.filter(s => {
        const startVal = timeToVal(s.start);
        const endVal = timeToVal(s.end);
        return currentTimeVal >= startVal && currentTimeVal < endVal;
    });

    if (workingNow.length > 0) {
        const names = workingNow.map(c => {
            const parts = c.name.trim().split(/\s+/);
            if (parts.length >= 2) return `${parts[1]} ${parts[0][0]}.`; 
            return parts[0];
        }).join(', ');
        
        liveStatusEl.innerHTML = `<span class="w-2 h-2 rounded-full bg-green-400 animate-pulse"></span> <span class="opacity-80 truncate">Зараз: <b>${names}</b></span>`;
    } else {
        liveStatusEl.innerHTML = `<span class="w-2 h-2 rounded-full bg-red-400"></span> <span class="opacity-80">Магазин зачинено</span>`;
    }

    // --- 4. NOTES ALERT ---
    const noteIcon = document.getElementById('dashNoteIcon');
    if (noteIcon) {
        const hasNote = state.notes && state.notes.some(n => n.date === todayStr);
        if (hasNote) {
            noteIcon.classList.remove('hidden');
        } else {
            noteIcon.classList.add('hidden');
        }
    }
}

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