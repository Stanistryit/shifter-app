import { state } from './state.js';
import { triggerHaptic } from './ui.js';

let dashMode = 'hours'; // 'hours' | 'shifts' | 'percent'

export function initDashboardInteractions() {
    const card = document.getElementById('dashboardCard');
    if (!card) return;

    // 1. Клік на ліву частину (Наступна зміна) -> Показати колег
    const leftPart = card.querySelector('.flex > div:first-child');
    if (leftPart) {
        leftPart.onclick = (e) => {
            e.stopPropagation();
            toggleColleagues();
        };
    }

    // 2. Клік на праву частину (Прогрес) -> Перемикання режимів
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
    else dashMode = 'hours';
    
    updateDashboard(); // Перемальовуємо з новим режимом
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

    // Ховаємо, якщо гість
    if (!state.currentUser || state.currentUser.role === 'Guest') {
        card.classList.add('hidden');
        return;
    }
    card.classList.remove('hidden');

    // Ініціалізуємо кліки (один раз)
    if (!card.dataset.init) {
        initDashboardInteractions();
        card.dataset.init = "true";
    }

    const me = state.currentUser;
    const myShifts = state.shifts.filter(s => s.name === me.name);
    
    // --- 1. NEXT SHIFT ---
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    
    // Сортуємо
    const sortedShifts = myShifts.sort((a, b) => a.date.localeCompare(b.date));
    let nextShift = sortedShifts.find(s => s.date >= todayStr && s.start !== 'DELETE');

    const nextTimeEl = document.getElementById('dashNextShiftTime');
    const nextDateEl = document.getElementById('dashNextShiftDate');
    const titleEl = document.getElementById('dashNextShiftTitle');

    // Контейнер для колег (створюємо, якщо немає)
    let collContainer = document.getElementById('dashColleagues');
    if (!collContainer) {
        collContainer = document.createElement('div');
        collContainer.id = 'dashColleagues';
        collContainer.className = "hidden mt-3 pt-3 border-t border-white/20 text-sm animate-slide-up";
        card.appendChild(collContainer);
    }

    if (nextShift) {
        // Дата
        const dateObj = new Date(nextShift.date);
        const dayName = dateObj.toLocaleDateString('uk-UA', { weekday: 'long' });
        
        let dateLabel = `${nextShift.date.slice(5).replace('-','.')} (${dayName})`;
        
        // Логіка "Завтра/Сьогодні"
        const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = tomorrow.toISOString().split('T')[0];

        if (nextShift.date === todayStr) dateLabel = "СЬОГОДНІ 🔥";
        else if (nextShift.date === tomorrowStr) dateLabel = "ЗАВТРА";

        nextDateEl.innerText = dateLabel;
        
        // Час
        if (nextShift.start === 'Відпустка') nextTimeEl.innerText = 'Відпустка 🌴';
        else if (nextShift.start === 'Лікарняний') nextTimeEl.innerText = 'Лікарняний 💊';
        else nextTimeEl.innerText = `${nextShift.start} - ${nextShift.end}`;

        // Підказка про клік
        titleEl.innerHTML = '📅 НАСТУПНА ЗМІНА <span class="opacity-50 text-[10px]">▼</span>';

        // --- ЛОГІКА КОЛЕГ ---
        // Шукаємо, хто ще працює в цей день в цьому магазині
        const colleagues = state.shifts.filter(s => 
            s.date === nextShift.date && 
            s.name !== me.name && 
            s.start !== 'DELETE' &&
            s.start !== 'Відпустка' &&
            s.start !== 'Лікарняний'
        );
        
        // Фільтр по магазину (якщо треба) - тут припускаємо, що shifts вже відфільтровані або глобальні
        // Але краще перевірити магазин користувача, якщо shifts глобальні
        
        if (colleagues.length > 0) {
            const names = colleagues.map(c => c.name.split(' ')[0]).join(', ');
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
    
    // Відображення залежно від режиму
    const hoursTextEl = document.getElementById('dashHoursText');
    const subtitleEl = hoursTextEl.nextElementSibling; // div з текстом "годин"

    if (dashMode === 'hours') {
        hoursTextEl.innerText = `${parseFloat(totalHours.toFixed(1))} / ${norm}`;
        subtitleEl.innerText = 'годин (tap)';
    } else if (dashMode === 'shifts') {
        hoursTextEl.innerText = `${totalShifts}`;
        subtitleEl.innerText = 'змін (tap)';
    } else {
        hoursTextEl.innerText = `${Math.round(percentVal)}%`;
        subtitleEl.innerText = 'від норми (tap)';
    }

    const bar = document.getElementById('dashProgressFill');
    bar.style.width = `${percentVal}%`;
    
    if (totalHours >= norm) {
        bar.className = 'bg-green-400 h-full rounded-full transition-all duration-1000';
    } else {
        bar.className = 'bg-white h-full rounded-full transition-all duration-1000';
    }
}

function getDuration(start, end) {
    if (!start || !end || start === 'Відпустка' || start === 'Лікарняний' || start === 'DELETE') return 0;
    const [h1, m1] = start.split(':').map(Number);
    const [h2, m2] = end.split(':').map(Number);
    const d = (h2 + m2/60) - (h1 + m1/60);
    return d > 0 ? d : 0;
}