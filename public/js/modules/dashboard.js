import { state } from './state.js';
import { triggerHaptic, showToast } from './ui.js';
import { openNotesModal } from './notes.js';
import { fetchJson } from './api.js'; // 🔥 Додано для безпечних запитів на сервер

window.openTodayNote = (e) => {
    e.stopPropagation();
    triggerHaptic();
    openNotesModal();
};

let tempOverride = false;
let overrideTimeout = null;
let isFetchingSalary = false;

export function initDashboardInteractions() {
    const card = document.getElementById('dashboardCard');
    if (!card) return;

    // Скрол події для оновлення точок (індікаторів)
    const carousel = document.getElementById('dashboardCarousel');
    if (carousel) {
        carousel.addEventListener('scroll', () => {
            const scrollLeft = carousel.scrollLeft;
            const width = carousel.offsetWidth;
            const index = Math.round(scrollLeft / width);

            for (let i = 1; i <= 5; i++) {
                const dot = document.getElementById(`dot${i}`);
                if (dot) {
                    if (i === index + 1) {
                        dot.classList.remove('opacity-40');
                        dot.classList.add('opacity-100');
                    } else {
                        dot.classList.add('opacity-40');
                        dot.classList.remove('opacity-100');
                    }
                }
            }
        });

        // Клік по карточці прокручує до наступного слайду (циклічно)
        card.onclick = (e) => {
            // Не блокуємо клік по нотатці або по задачі
            if (e.target.closest('#dashNoteIcon') || e.target.closest('.dash-task-click')) return;

            triggerHaptic();
            const width = carousel.offsetWidth;
            const scrollLeft = carousel.scrollLeft;
            const scrollWidth = carousel.scrollWidth;

            // Якщо дійшли до кінця, вертаємо на початок
            if (scrollLeft + width >= scrollWidth - 10) {
                carousel.scrollTo({ left: 0, behavior: 'smooth' });
            } else {
                carousel.scrollBy({ left: width, behavior: 'smooth' });
            }
        };
    }
}

export function updateDashboard() {
    const card = document.getElementById('dashboardCard');
    if (!card) return;

    if (!state.currentUser || state.currentUser.role === 'Guest' || state.currentUser.role === 'RRP') {
        card.classList.add('hidden');
        return;
    }

    if (localStorage.getItem('shifter_viewMode') === 'profile') {
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
    // 1. СЛАЙД 1 (СТАТУС ТА КОЛЕГИ) ТА ДИНАМІЧНИЙ КОЛІР КАРТКИ
    // =========================================================
    let nextShift = sortedShifts.find(s => s.date > todayStr && s.start !== 'DELETE');
    const todayShift = myShifts.find(s => s.date === todayStr && !['DELETE', 'Відпустка', 'Лікарняний'].includes(s.start));

    const nextTimeEl = document.getElementById('dashNextShiftTime');
    const nextDateEl = document.getElementById('dashNextShiftDate');
    const titleEl = document.getElementById('dashNextShiftTitle');
    const collContainer = document.getElementById('dashColleagues');
    const bar1 = document.getElementById('dashProgressFill1');

    // Базові градієнти (Зелений, Жовтий, Синій, Сірий)
    const colorClasses = {
        working: 'bg-gradient-to-br from-emerald-500 to-teal-600',
        waiting: 'bg-gradient-to-br from-amber-500 to-amber-600',
        off: 'bg-gradient-to-br from-blue-500 to-indigo-600',
        vacation: 'bg-gradient-to-br from-gray-500 to-gray-700'
    };

    // Видаляємо старі класи кольорів, залишаємо базові
    card.className = "ios-card text-white shadow-lg animate-slide-up relative overflow-hidden group cursor-pointer active:scale-[0.98] transition-transform";

    if (todayShift) {
        const [sH, sM] = todayShift.start.split(':').map(Number);
        const [eH, eM] = todayShift.end.split(':').map(Number);
        const startMins = sH * 60 + sM;
        const endMins = eH * 60 + eM;
        const currentMins = now.getHours() * 60 + now.getMinutes();

        titleEl.innerHTML = '⏱️ СЬОГОДНІ НА ЗМІНІ';
        nextDateEl.innerText = `${todayShift.start} - ${todayShift.end}`;

        if (currentMins < startMins) {
            // Ще не почалась (Waiting)
            card.classList.add(...colorClasses.waiting.split(' '));
            const diff = startMins - currentMins;
            nextTimeEl.innerText = `${Math.floor(diff / 60)}г ${diff % 60}хв до старту`;
            bar1.style.width = '0%';
            bar1.className = 'bg-white/30 h-full rounded-full transition-all duration-1000';
        } else if (currentMins >= startMins && currentMins < endMins) {
            // Зараз працює (Working)
            card.classList.add(...colorClasses.working.split(' '));
            const diff = endMins - currentMins;
            const total = endMins - startMins;
            const passed = currentMins - startMins;
            const pct = Math.min(100, (passed / total) * 100);

            nextTimeEl.innerText = `${Math.floor(diff / 60)}г ${diff % 60}хв до кінця`;
            bar1.style.width = `${pct}%`;
            bar1.className = 'bg-white h-full rounded-full transition-all duration-1000';
        } else {
            // Зміна пройшла
            card.classList.add(...colorClasses.off.split(' '));
            nextTimeEl.innerText = `Зміну завершено`;
            bar1.style.width = '100%';
            bar1.className = 'bg-white h-full rounded-full transition-all duration-1000 opacity-50';
        }

        // Колеги на СЬОГОДНІ
        const colleagues = state.shifts.filter(s => s.date === todayStr && s.name !== me.name && s.start !== 'DELETE' && s.start !== 'Відпустка' && s.start !== 'Лікарняний');
        if (colleagues.length > 0) {
            const names = colleagues.map(c => {
                const parts = c.name.trim().split(/\s+/);
                return parts.length >= 2 ? `${parts[1]} ${parts[0][0]}.` : parts[0];
            }).join(', ');
            collContainer.innerHTML = `<span class="opacity-70">З тобою:</span> <b>${names}</b>`;
        } else {
            collContainer.innerHTML = `<span class="opacity-70">Працюєш сам(а) 🦸‍♂️</span>`;
        }

    } else {
        // ВИХІДНИЙ (АБО ВІДПУСТКА/ЛІК)
        const currentAbsent = myShifts.find(s => s.date === todayStr && (s.start === 'Відпустка' || s.start === 'Лікарняний'));

        if (currentAbsent) {
            card.classList.add(...colorClasses.vacation.split(' '));
            titleEl.innerHTML = `🏖️ ${currentAbsent.start.toUpperCase()}`;
            nextTimeEl.innerText = "Відпочивай!";
            nextDateEl.innerText = "";
            collContainer.innerHTML = "";
            bar1.style.width = '100%';
            bar1.className = 'bg-white/30 h-full rounded-full';
        } else {
            card.classList.add(...colorClasses.off.split(' '));
            titleEl.innerHTML = '🏖️ СЬОГОДНІ ВИХІДНИЙ';
            bar1.style.width = '0%';

            if (nextShift) {
                const dateObj = new Date(nextShift.date);
                const dayName = dateObj.toLocaleDateString('uk-UA', { weekday: 'long' });
                let dateLabel = `${nextShift.date.slice(5).replace('-', '.')} (${dayName})`;

                const tomorrow = new Date(now);
                tomorrow.setDate(tomorrow.getDate() + 1);
                const tomorrowStr = tomorrow.toISOString().split('T')[0];

                if (nextShift.date === tomorrowStr) dateLabel = "ЗАВТРА";

                if (nextShift.start === 'Відпустка' || nextShift.start === 'Лікарняний') {
                    nextTimeEl.innerText = nextShift.start;
                } else {
                    nextTimeEl.innerText = dateLabel;
                    nextDateEl.innerText = `Наступна: ${nextShift.start} - ${nextShift.end}`;
                }

                const colleagues = state.shifts.filter(s => s.date === nextShift.date && s.name !== me.name && s.start !== 'DELETE' && s.start !== 'Відпустка' && s.start !== 'Лікарняний');
                if (colleagues.length > 0) {
                    const names = colleagues.map(c => {
                        const parts = c.name.trim().split(/\s+/);
                        return parts.length >= 2 ? `${parts[1]} ${parts[0][0]}.` : parts[0];
                    }).join(', ');
                    collContainer.innerHTML = `<span class="opacity-70">Працюватимеш з:</span> <b>${names}</b>`;
                } else {
                    collContainer.innerHTML = `<span class="opacity-70">Працюватимеш сам(а)</span>`;
                }
            } else {
                nextTimeEl.innerText = "Без змін";
                nextDateEl.innerText = "У графіку поки пусто";
                collContainer.innerHTML = "";
            }
        }
    }

    // =========================================================
    // 1.5. СЛАЙД 2 (АКТУАЛЬНІ ЗАДАЧІ)
    // =========================================================
    const dashTasksContent = document.getElementById('dashTasksContent');
    const dashTasksCountBadge = document.getElementById('dashTasksCountBadge');
    
    if (dashTasksContent) {
        // Only active tasks assigned to the current user
        const myTasks = state.tasks.filter(t => t.name === me.name && t.status !== 'completed');
        
        // Sort: Timeline (date + start), ToDo (deadline)
        myTasks.sort((a, b) => {
            let dtA = a.type === 'todo' && a.deadline ? new Date(a.deadline) : new Date(`${a.date}T${a.start || '23:59'}:00`);
            let dtB = b.type === 'todo' && b.deadline ? new Date(b.deadline) : new Date(`${b.date}T${b.start || '23:59'}:00`);
            if (isNaN(dtA)) dtA = new Date('2099-12-31');
            if (isNaN(dtB)) dtB = new Date('2099-12-31');
            return dtA - dtB;
        });

        if (myTasks.length > 0) {
            dashTasksCountBadge.innerText = myTasks.length;
            dashTasksCountBadge.classList.remove('hidden');
            let tasksHtml = '';
            
            // Show top 2 tasks so it fits the slide nicely
            const showTasks = myTasks.slice(0, 2);
            
            showTasks.forEach(task => {
                let badgeStr = '';
                if (task.type === 'todo') {
                    const dlStr = task.deadline ? task.deadline.replace('T', ' ') : 'Без дедлайну';
                    badgeStr = `<span class="bg-indigo-500/20 text-indigo-200 border border-indigo-500/30 px-1.5 py-0.5 rounded text-[8px] uppercase tracking-wider">ToDo: ${dlStr}</span>`;
                } else {
                    const tlStr = task.isFullDay ? 'Весь день' : `${task.start} - ${task.end}`;
                    const dStr = task.date.slice(5).replace('-', '.');
                    badgeStr = `<span class="bg-sky-500/20 text-sky-200 border border-sky-500/30 px-1.5 py-0.5 rounded text-[8px] uppercase tracking-wider">${dStr} | ${tlStr}</span>`;
                }

                tasksHtml += `
                    <div class="dash-task-click bg-white/10 hover:bg-white/20 active:bg-white/30 transition-colors rounded-xl p-2 cursor-pointer flex flex-col gap-1 border border-white/5"
                         onclick="window.openTaskFromDash('${task._id}')">
                        <div class="flex justify-between items-start gap-2">
                            <h4 class="text-sm font-bold text-white truncate max-w-[80%]">${task.title}</h4>
                            <div class="flex-shrink-0 mt-0.5">
                                <div class="w-3.5 h-3.5 rounded-sm border-2 border-white/50 flex items-center justify-center"></div>
                            </div>
                        </div>
                        <div class="flex items-center">
                            ${badgeStr}
                        </div>
                    </div>
                `;
            });
            
            if (myTasks.length > 2) {
                tasksHtml += `<div class="text-[10px] text-white/50 text-center font-bold uppercase mt-1 w-full dash-task-click cursor-pointer" onclick="setMode('todo')">+ ЩЕ ${myTasks.length - 2} ЗАДАЧ</div>`;
            }
            
            dashTasksContent.innerHTML = tasksHtml;
        } else {
            dashTasksCountBadge.classList.add('hidden');
            dashTasksContent.innerHTML = `
                <div class="flex flex-col items-center justify-center h-full text-white/50 mt-4">
                    <span class="text-3xl mb-1">🎉</span>
                    <span class="text-xs font-bold uppercase">Усі задачі виконано</span>
                </div>
            `;
        }
    }

    // =========================================================
    // 2. СЛАЙД 3 (МІСЯЧНА СТАТИСТИКА)
    // =========================================================
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

    const hoursEl = document.getElementById('dashHoursText');
    const shiftsEl = document.getElementById('dashShiftsText');
    const bar2 = document.getElementById('dashProgressFill2');

    if (hoursEl) hoursEl.innerText = `${parseFloat(totalHours.toFixed(1))} / ${norm}`;
    if (shiftsEl) shiftsEl.innerText = `${totalShifts}`;
    if (bar2) {
        bar2.style.width = `${percentVal}%`;
        bar2.className = (totalHours >= norm) ?
            'bg-green-300 h-full rounded-full transition-all duration-1000' :
            'bg-white h-full rounded-full transition-all duration-1000';
    }

    // =========================================================
    // 3. СЛАЙД 4 (ОРІЄНТОВНИЙ ДОХІД)
    // =========================================================
    const dashMoneyText = document.getElementById('dashMoneyText');
    const dashMoneySub = document.getElementById('dashMoneySub');

    // Завантаження ЗП як і раніше
    const targetMonth = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}`;

    if (dashMoneyText && dashMoneySub) {
        if (state.paySlip && state.paySlip.month === targetMonth) {
            if (state.paySlip.baseRate > 0) {
                dashMoneyText.innerText = `${state.paySlip.totalSalary.toLocaleString()} ₴`;
                dashMoneySub.innerText = `≈ ${state.paySlip.hourlyRate} ₴/год`;
            } else {
                dashMoneyText.innerText = `0 ₴`;
                dashMoneySub.innerText = `ставку не налаштовано (зверніться до адміна)`;
            }
        } else {
            dashMoneyText.innerText = `...`;
            dashMoneySub.innerText = `рахуємо...`;

            if (!isFetchingSalary) {
                isFetchingSalary = true;
                fetchJson(`/api/salary?month=${targetMonth}`).then(res => {
                    isFetchingSalary = false;
                    if (res.success) {
                        state.paySlip = res.data;
                    } else {
                        state.paySlip = { month: targetMonth, baseRate: 0, totalSalary: 0, hourlyRate: 0 };
                    }
                    updateDashboard(); // ререндер щоб показало ЗП
                }).catch(() => {
                    isFetchingSalary = false;
                });
            }
        }
    }

    // =========================================================
    // 4. СЛАЙД 5 (СМАРТ KPI)
    // =========================================================
    const slideKpi = document.getElementById('slideKpi');
    const dot5 = document.getElementById('dot5');

    if (slideKpi && dot5) {
        if (state.currentUser?.store?.kpi_enabled !== false && state.kpiData && state.kpiData.kpi?.length > 0) {
            slideKpi.classList.remove('hidden');
            dot5.classList.remove('hidden');

            const dashKpiContent = document.getElementById('dashKpiContent');
            const myKpi = state.kpiData.kpi.find(k => k.name === me.name);
            const totalKpi = state.kpiData.kpi.find(k => k.name === 'TOTAL');

            let htmlKpi = '';

            if (myKpi) {
                const s = myKpi.stats;
                const devPerc = s.devicesTarget ? Math.min(100, (s.devices / s.devicesTarget) * 100) : 0;
                htmlKpi += `
                    <div class="mb-3">
                        <div class="flex justify-between text-[10px] mb-1 font-bold">
                            <span class="text-white/80">📱 Мої Девайси</span>
                            <span class="text-white">${s.devices} / ${s.devicesTarget}</span>
                        </div>
                        <div class="w-full bg-black/20 h-1.5 rounded-full overflow-hidden">
                            <div class="h-full rounded-full ${devPerc >= 100 ? 'bg-green-400' : 'bg-white'}" style="width: ${devPerc}%"></div>
                        </div>
                    </div>
                `;
            }
            if (totalKpi) {
                const ts = totalKpi.stats;
                const devPerc = ts.devicesTarget ? Math.min(100, (ts.devices / ts.devicesTarget) * 100) : 0;
                htmlKpi += `
                    <div>
                        <div class="flex justify-between text-[10px] mb-1 font-bold">
                            <span class="text-white/80">🏬 Тотал Магазину</span>
                            <span class="text-white">${ts.devices} / ${ts.devicesTarget}</span>
                        </div>
                        <div class="w-full bg-black/20 h-1.5 rounded-full overflow-hidden">
                            <div class="h-full rounded-full ${devPerc >= 100 ? 'bg-green-400' : 'bg-indigo-300'}" style="width: ${devPerc}%"></div>
                        </div>
                    </div>
                `;
            }

            if (!htmlKpi) {
                htmlKpi = '<div class="text-[10px] text-white/50 text-center">Дані KPI ще не завантажені</div>';
            }
            if (dashKpiContent) dashKpiContent.innerHTML = htmlKpi;

        } else {
            slideKpi.classList.add('hidden');
            dot5.classList.add('hidden');
        }
    }

    // =========================================================
    // 5. LIVE STORE STATUS & NOTES
    // =========================================================
    const liveStatusEl = document.getElementById('dashLiveStatus');
    const todayShiftsGlobal = state.shifts.filter(s => s.date === todayStr && s.start !== 'DELETE' && s.start !== 'Відпустка' && s.start !== 'Лікарняний');
    const currentTimeVal = now.getHours() + now.getMinutes() / 60;

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
    if (!t) return 0;
    const [h, m] = t.split(':').map(Number);
    return h + (m / 60);
}

// Global function to open a specific task directly
window.openTaskFromDash = async (id) => {
    triggerHaptic();
    const task = state.tasks.find(t => t._id === id);
    if (!task) return;
    
    // Lazy load UI functions if needed, though they should be readily available 
    // Usually they are in ui.js or admin.js
    const ui = await import('./ui.js');
    ui.openTaskDetailsModal(task);
};

setInterval(() => {
    const card = document.getElementById('dashboardCard');
    if (card && !card.classList.contains('hidden')) {
        updateDashboard();
    }
}, 60000);