import { state } from './state.js';

export function updateDashboard() {
    const card = document.getElementById('dashboardCard');
    if (!card) return;

    // Ховаємо дашборд, якщо це Гість або користувач не залогінений
    if (!state.currentUser || state.currentUser.role === 'Guest') {
        card.classList.add('hidden');
        return;
    }

    card.classList.remove('hidden');

    const me = state.currentUser;
    // Фільтруємо зміни тільки для поточного користувача
    const myShifts = state.shifts.filter(s => s.name === me.name);
    
    // ----------------------------------------------------
    // 1. ПОШУК НАСТУПНОЇ ЗМІНИ (Next Shift)
    // ----------------------------------------------------
    const now = new Date();
    // Скидаємо час до нулів, щоб коректно порівнювати дати (сьогодні/завтра)
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todayStr = today.toISOString().split('T')[0];
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    // Сортуємо зміни за датою
    const sortedShifts = myShifts.sort((a, b) => a.date.localeCompare(b.date));

    // Шукаємо першу зміну, яка сьогодні або в майбутньому
    // Якщо зміна сьогодні, перевіряємо час? Для спрощення показуємо "Сьогодні", навіть якщо зміна вже почалася.
    let nextShift = sortedShifts.find(s => s.date >= todayStr && s.start !== 'DELETE');

    const nextTimeEl = document.getElementById('dashNextShiftTime');
    const nextDateEl = document.getElementById('dashNextShiftDate');

    if (nextShift) {
        // Визначаємо підпис дати
        let dateLabel = nextShift.date.split('-').slice(1).reverse().join('.'); // 25.10
        if (nextShift.date === todayStr) dateLabel = "СЬОГОДНІ 🔥";
        else if (nextShift.date === tomorrowStr) dateLabel = "ЗАВТРА";

        nextDateEl.innerText = dateLabel;
        
        // Визначаємо час або статус
        if (nextShift.start === 'Відпустка') {
            nextTimeEl.innerText = 'Відпустка 🌴';
            // nextTimeEl.className = "text-xl font-bold leading-none mb-1 text-green-200";
        } else if (nextShift.start === 'Лікарняний') {
            nextTimeEl.innerText = 'Лікарняний 💊';
        } else {
            nextTimeEl.innerText = `${nextShift.start} - ${nextShift.end}`;
        }
    } else {
        nextTimeEl.innerText = "--:--";
        nextDateEl.innerText = "Немає змін";
    }

    // ----------------------------------------------------
    // 2. ПРОГРЕС ГОДИН (Current View Month)
    // ----------------------------------------------------
    // Ми рахуємо години для того місяця, який зараз ВІДКРИТИЙ у календарі (state.currentDate)
    const viewYear = state.currentDate.getFullYear();
    const viewMonth = state.currentDate.getMonth(); // 0-11

    // Фільтруємо зміни, що належать до відображуваного місяця
    const monthlyShifts = myShifts.filter(s => {
        const [y, m, d] = s.date.split('-').map(Number);
        return y === viewYear && (m - 1) === viewMonth;
    });

    let totalHours = 0;
    monthlyShifts.forEach(s => {
        totalHours += getDuration(s.start, s.end);
    });

    // Намагаємось взяти норму з KPI, якщо вона там є, або ставимо 160 як заглушку
    let norm = 160;
    if (state.kpiData && state.kpiData.settings && state.kpiData.settings.normHours) {
        norm = parseInt(state.kpiData.settings.normHours);
    }

    // Рахуємо відсоток (не більше 100% для смужки)
    const percent = Math.min(100, (totalHours / norm) * 100);

    // Оновлюємо DOM
    document.getElementById('dashHoursText').innerText = `${parseFloat(totalHours.toFixed(1))} / ${norm}`;
    document.getElementById('dashProgressFill').style.width = `${percent}%`;
    
    // Змінюємо колір смужки, якщо норма виконана
    if (totalHours >= norm) {
        document.getElementById('dashProgressFill').classList.add('bg-green-400');
        document.getElementById('dashProgressFill').classList.remove('bg-white');
    } else {
        document.getElementById('dashProgressFill').classList.add('bg-white');
        document.getElementById('dashProgressFill').classList.remove('bg-green-400');
    }
}

// Допоміжна функція для розрахунку тривалості
function getDuration(start, end) {
    if (!start || !end || start === 'Відпустка' || start === 'Лікарняний' || start === 'DELETE') return 0;
    const [h1, m1] = start.split(':').map(Number);
    const [h2, m2] = end.split(':').map(Number);
    const d = (h2 + m2/60) - (h1 + m1/60);
    return d > 0 ? d : 0;
}