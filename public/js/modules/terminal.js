import { postJson, fetchJson } from './api.js';
import { showToast, triggerHaptic } from './ui.js';
import { state } from './state.js';

// Номінали банкнот України (тільки банкноти, починаючи з 2000 грн)
const DENOMINATIONS = [2000, 1000, 500, 200, 100, 50, 20, 10, 5, 2, 1];

let terminalState = {
    store: null,
    terminalData: null,
    activeTab: 'cash', // 'cash' | 'encashment'
    denominationsCount: {},
    expectedAmounts: [{ id: 1, label: 'Z-звіт сьогодні', amount: 0 }],
    nextExpectedId: 2,
    pollingInterval: null,
    alarmInterval: null,
    clockInterval: null,
    checklistState: {},
    alarmStatus: null
};

// 1. Ініціалізація або перевірка терміналу
export async function initTerminal() {
    startLiveClock();

    // Перевіряємо локальне збереження точки
    const savedStoreId = localStorage.getItem('shifter_terminal_storeId');
    const savedStoreCode = localStorage.getItem('shifter_terminal_storeCode');

    // Також перевіряємо, чи ми авторизовані як звичайний користувач із магазином
    const userStoreId = state.currentUser?.storeId?._id || state.currentUser?.storeId;

    const targetStoreId = savedStoreId || userStoreId;

    if (!targetStoreId && !savedStoreCode) {
        showTerminalLoginModal();
        return;
    }

    await loadTerminalData(targetStoreId, savedStoreCode);

    // Запускаємо фонове автооновлення кожні 60 секунд
    if (terminalState.pollingInterval) clearInterval(terminalState.pollingInterval);
    terminalState.pollingInterval = setInterval(() => {
        if (terminalState.store?._id) {
            loadTerminalData(terminalState.store._id, null, true);
        }
    }, 60000);

    // Запускаємо моніторинг тривог кожні 15 секунд
    if (terminalState.alarmInterval) clearInterval(terminalState.alarmInterval);
    terminalState.alarmInterval = setInterval(() => {
        if (terminalState.store?._id) {
            loadAlarmStatus(terminalState.store._id);
        }
    }, 15000);
}

// 2. Живий годинник
function startLiveClock() {
    if (terminalState.clockInterval) clearInterval(terminalState.clockInterval);
    let lastMinute = -1;
    const update = () => {
        const now = new Date();
        const el = document.getElementById('termLiveClock');
        if (el) {
            el.innerText = now.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/Kiev' });
        }
        const currentMinute = now.getMinutes();
        if (lastMinute !== currentMinute) {
            lastMinute = currentMinute;
            if (terminalState.todayShifts && terminalState.todayShifts.length > 0) {
                renderActiveShifts(terminalState.todayShifts, terminalState.employees);
            }
        }
    };
    update();
    terminalState.clockInterval = setInterval(update, 1000);
}

// 3. Завантаження даних терміналу
export async function loadTerminalData(storeId, storeCode, isSilent = false) {
    try {
        let url = `/api/terminal/data`;
        if (storeId) url += `?storeId=${storeId}`;
        else if (storeCode) url += `?code=${storeCode}`;

        const res = await fetchJson(url);
        if (res && res.success) {
            terminalState.store = res.store;
            terminalState.terminalData = res;
            terminalState.todayShifts = res.todayShifts || [];
            terminalState.employees = res.employees || [];

            localStorage.setItem('shifter_terminal_storeId', res.store._id);
            localStorage.setItem('shifter_terminal_storeCode', res.store.code);

            renderHeader(res.store);
            renderActiveShifts(res.todayShifts, res.employees);
            renderTomorrowOpener(res.tomorrowOpener);
            renderEmergencyContacts(res.store.emergencyContacts);
            renderTasks(res.tasks);
            renderChecklists(res.store);
            loadAlarmStatus(res.store._id);
            populateAuthorSelects(res.employees);

            if (!document.getElementById('termDenominationsRows')?.dataset.initialized) {
                initCashCalculator();
            }

            hideTerminalLoginModal();
            if (!isSilent) showToast(`Термінал: ${res.store.name} підключено`, 'success');
        } else {
            showTerminalLoginModal();
        }
    } catch (e) {
        console.error("loadTerminalData error:", e);
        if (!isSilent) showTerminalLoginModal();
    }
}

// 4. Відображення шапки
function renderHeader(store) {
    if (!store) return;
    const nameEl = document.getElementById('termStoreName');
    const codeEl = document.getElementById('termStoreCode');
    const hoursEl = document.getElementById('termStoreHours');
    const annBox = document.getElementById('termAnnouncementBox');
    const annBoxMob = document.getElementById('termAnnouncementBoxMob');
    const annText = document.getElementById('termAnnouncementText');
    const annTextMob = document.getElementById('termAnnouncementTextMob');

    if (nameEl) nameEl.innerText = store.name || 'Магазин';
    if (codeEl) codeEl.innerText = store.code || '';
    if (hoursEl) hoursEl.innerText = `${store.openTime || '10:00'} - ${store.closeTime || '22:00'}`;

    if (store.dailyAnnouncement && store.dailyAnnouncement.trim()) {
        if (annText) annText.innerText = store.dailyAnnouncement;
        if (annTextMob) annTextMob.innerText = store.dailyAnnouncement;
        annBox?.classList.remove('hidden');
        annBoxMob?.classList.remove('hidden');
    } else {
        annBox?.classList.add('hidden');
        annBoxMob?.classList.add('hidden');
    }
}

// Розрахунок статусу зміни на поточний момент (Europe/Kiev)
function getShiftStatus(startStr, endStr) {
    if (!startStr || !endStr || !startStr.includes(':') || !endStr.includes(':')) {
        return {
            status: 'current',
            order: 1,
            label: `до ${endStr || '--:--'}`,
            statusText: 'На зміні',
            dotClass: 'bg-green-500 animate-pulse shadow-sm shadow-green-500/50',
            badgeClass: 'bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400 font-bold',
            cardClass: 'bg-white dark:bg-[#1C1C1E] border-gray-200/80 dark:border-gray-800 shadow-sm'
        };
    }

    const kievTimeStr = new Date().toLocaleTimeString('uk-UA', { timeZone: 'Europe/Kiev', hour: '2-digit', minute: '2-digit', hour12: false });
    const [nowH, nowM] = kievTimeStr.split(':').map(Number);
    const nowMinutes = nowH * 60 + nowM;

    const [sH, sM] = startStr.split(':').map(Number);
    const [eH, eM] = endStr.split(':').map(Number);
    const startMinutes = sH * 60 + sM;
    const endMinutes = eH * 60 + eM;

    // Звичайна денна зміна
    if (endMinutes > startMinutes) {
        if (nowMinutes >= startMinutes && nowMinutes < endMinutes) {
            return {
                status: 'current',
                order: 1,
                label: `до ${endStr}`,
                statusText: 'Зараз на зміні',
                dotClass: 'bg-green-500 animate-pulse shadow-sm shadow-green-500/50',
                badgeClass: 'bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400 font-bold',
                cardClass: 'bg-white dark:bg-[#1C1C1E] border-gray-200/80 dark:border-gray-800 shadow-sm'
            };
        } else if (nowMinutes < startMinutes) {
            return {
                status: 'upcoming',
                order: 2,
                label: `початок о ${startStr}`,
                statusText: 'Очікується',
                dotClass: 'bg-amber-400 shadow-sm shadow-amber-400/40',
                badgeClass: 'bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 font-bold',
                cardClass: 'bg-amber-50/20 dark:bg-amber-950/10 border-amber-200/40 dark:border-amber-800/30'
            };
        } else {
            return {
                status: 'ended',
                order: 3,
                label: `завершено о ${endStr}`,
                statusText: 'Зміна завершена',
                dotClass: 'bg-gray-400 dark:bg-gray-600',
                badgeClass: 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 font-medium',
                cardClass: 'opacity-55 hover:opacity-90 transition-opacity bg-gray-50/60 dark:bg-[#2C2C2E]/40 border-dashed border-gray-200 dark:border-gray-800'
            };
        }
    } else {
        // Нічна зміна
        const isCurrent = nowMinutes >= startMinutes || nowMinutes < endMinutes;
        if (isCurrent) {
            return {
                status: 'current',
                order: 1,
                label: `до ${endStr}`,
                statusText: 'Зараз на зміні',
                dotClass: 'bg-green-500 animate-pulse shadow-sm shadow-green-500/50',
                badgeClass: 'bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400 font-bold',
                cardClass: 'bg-white dark:bg-[#1C1C1E] border-gray-200/80 dark:border-gray-800 shadow-sm'
            };
        } else {
            return {
                status: 'ended',
                order: 3,
                label: `завершено о ${endStr}`,
                statusText: 'Зміна завершена',
                dotClass: 'bg-gray-400 dark:bg-gray-600',
                badgeClass: 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 font-medium',
                cardClass: 'opacity-55 hover:opacity-90 transition-opacity bg-gray-50/60 dark:bg-[#2C2C2E]/40 border-dashed border-gray-200 dark:border-gray-800'
            };
        }
    }
}

// 5. Відображення співробітників на зміні (Зараз на зміні)
function renderActiveShifts(todayShifts, employees) {
    const listEl = document.getElementById('termActiveShiftsList');
    const badgeEl = document.getElementById('termActiveCountBadge');
    if (!listEl) return;

    if (!todayShifts || todayShifts.length === 0) {
        listEl.innerHTML = `<div class="p-3 text-center text-xs text-gray-400 bg-gray-50 dark:bg-[#2C2C2E] rounded-xl">Немає запланованих змін на сьогодні</div>`;
        if (badgeEl) {
            badgeEl.innerText = '0 на зміні';
            badgeEl.className = "text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400";
        }
        return;
    }

    // Визначаємо статус для кожного співробітника
    const items = todayShifts.map(s => {
        const emp = employees ? employees.find(e => e.name === s.name) : null;
        const displayName = emp ? (emp.fullName || emp.name) : s.name;
        const pos = emp?.position ? `<span class="text-[9px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 font-bold ml-1">${emp.position}</span>` : '';
        const info = getShiftStatus(s.start, s.end);
        return { shift: s, emp, displayName, pos, info };
    });

    // Сортування:
    // 1) Працюють зараз (🟢)
    // 2) Почнуть пізніше сьогодні (🟡)
    // 3) Зміна закінчилась (⚪)
    items.sort((a, b) => a.info.order - b.info.order || a.shift.start.localeCompare(b.shift.start));

    const activeCount = items.filter(x => x.info.status === 'current').length;

    if (badgeEl) {
        if (activeCount > 0) {
            badgeEl.innerText = `${activeCount} на зміні`;
            badgeEl.className = "text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300";
        } else {
            badgeEl.innerText = `0 на зміні (з ${todayShifts.length})`;
            badgeEl.className = "text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400";
        }
    }

    listEl.innerHTML = items.map(x => `
        <div class="p-2.5 rounded-xl border flex items-center justify-between ${x.info.cardClass}">
            <div class="flex items-center gap-2.5 overflow-hidden">
                <span class="w-2.5 h-2.5 rounded-full shrink-0 ${x.info.dotClass}"></span>
                <div class="truncate">
                    <div class="text-xs font-bold text-gray-900 dark:text-white flex items-center truncate">
                        <span class="truncate">${x.displayName}</span> ${x.pos}
                    </div>
                    <div class="text-[10px] text-gray-400 font-mono">
                        Зміна: ${x.shift.start} - ${x.shift.end}
                    </div>
                </div>
            </div>
            <div class="text-right shrink-0 ml-2">
                <span class="text-[10px] font-mono px-2 py-0.5 rounded-md ${x.info.badgeClass}">
                    ${x.info.label}
                </span>
            </div>
        </div>
    `).join('');
}

// 6. Хто завтра на відкриття
function renderTomorrowOpener(opener) {
    const box = document.getElementById('termTomorrowOpenerBox');
    if (!box) return;

    if (!opener) {
        box.innerHTML = `<span class="text-xs text-gray-400">Графік на завтра ще не заповнено</span>`;
        return;
    }

    box.innerHTML = `
        <div class="flex items-center gap-2">
            <span class="text-lg">🌅</span>
            <div>
                <div class="text-xs font-black text-orange-950 dark:text-orange-200">${opener.name}</div>
                <div class="text-[10px] text-orange-700/80 dark:text-orange-300 font-mono">Початок зміни: <b>${opener.start}</b></div>
            </div>
        </div>
        <span class="text-[10px] font-bold bg-orange-200/60 dark:bg-orange-900/60 text-orange-850 dark:text-orange-200 px-2 py-1 rounded-lg font-mono">
            ${opener.start} - ${opener.end}
        </span>
    `;
}

// 7. Важливі контакти
function renderEmergencyContacts(contacts) {
    const listEl = document.getElementById('termEmergencyContactsList');
    if (!listEl) return;

    const validContacts = (contacts || []).filter(c => c && (c.title || c.phone));

    if (validContacts.length === 0) {
        listEl.innerHTML = `
            <div class="p-2.5 rounded-lg bg-gray-50 dark:bg-[#2C2C2E] text-center text-xs text-gray-400">
                Контакти не вказані в налаштуваннях магазину (SM)
            </div>
        `;
        return;
    }

    listEl.innerHTML = validContacts.map(c => `
        <div class="p-2 rounded-lg bg-gray-50 dark:bg-[#2C2C2E] border border-gray-100 dark:border-gray-800 flex justify-between items-center text-xs">
            <span class="font-bold text-gray-700 dark:text-gray-200">${c.title || 'Контакт'}</span>
            <a href="tel:${c.phone || ''}" class="font-mono text-blue-500 hover:underline font-bold flex items-center gap-1">
                <span>📞</span> ${c.phone || '---'}
            </a>
        </div>
    `).join('');
}

// 8. Оперативні задачі
function renderTasks(tasks) {
    const listEl = document.getElementById('termTasksList');
    const badgeEl = document.getElementById('termTasksCountBadge');
    if (!listEl) return;

    const activeTasks = (tasks || []).filter(t => !t.done);
    if (badgeEl) badgeEl.innerText = activeTasks.length;

    if (!tasks || tasks.length === 0) {
        listEl.innerHTML = `<div class="text-center text-xs text-gray-400 py-4">Немає задач на сьогодні</div>`;
        return;
    }

    listEl.innerHTML = tasks.map(t => {
        const isDone = !!t.done;
        const opacity = isDone ? 'opacity-40 line-through' : '';
        return `
            <div class="p-2.5 rounded-xl bg-gray-50 dark:bg-[#2C2C2E] border border-gray-200/70 dark:border-gray-800 flex items-center justify-between gap-2 ${opacity}">
                <div class="flex items-center gap-2 overflow-hidden">
                    <button onclick="window.toggleTermTask('${t._id}', ${!isDone})" class="w-5 h-5 rounded-md border flex items-center justify-center text-xs ${isDone ? 'bg-green-500 border-green-500 text-white' : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-[#1C1C1E]'}">
                        ${isDone ? '✓' : ''}
                    </button>
                    <span class="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">${t.text}</span>
                </div>
                ${t.name ? `<span class="text-[9px] px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700 font-bold shrink-0">${t.name}</span>` : ''}
            </div>
        `;
    }).join('');
}

window.toggleTermTask = async function(taskId, doneStatus) {
    triggerHaptic();
    try {
        const authorSelect = document.getElementById('termCashAuthorSelect');
        const completedBy = authorSelect?.value || 'Співробітник';
        const res = await postJson('/api/tasks/toggle', { id: taskId, completedBy });
        if (res && res.success) {
            showToast(doneStatus ? 'Задачу виконано' : 'Статус оновлено', 'success');
            if (terminalState.store?._id) {
                loadTerminalData(terminalState.store._id, null, true);
            }
        }
    } catch(e) {
        showToast('Помилка оновлення задачі', 'error');
    }
};

// 9. Чек-лісти відкриття та закриття за часом
function renderChecklists(store) {
    const titleEl = document.getElementById('termChecklistTitle');
    const badgeEl = document.getElementById('termChecklistBadge');
    const container = document.getElementById('termChecklistItems');
    if (!container) return;

    const now = new Date();
    const currentHour = now.getHours();

    // Якщо до 14:00 — Ранковий чек-лист. Після 14:00 — Вечірній чек-лист
    const isMorning = currentHour < 14;

    if (titleEl) {
        titleEl.innerHTML = isMorning ? `<span>🌅</span> РАНКОВИЙ ЧЕК-ЛІСТ (ВІДКРИТТЯ)` : `<span>🌙</span> ВЕЧІРНІЙ ЧЕК-ЛІСТ (ЗАКРИТТЯ)`;
    }
    if (badgeEl) {
        badgeEl.innerText = isMorning ? 'Відкриття' : 'Закриття';
    }

    const defaultMorning = [
        { id: 'm_rro', text: 'Відкрити зміну РРО / роздрукувати X-звіт' },
        { id: 'm_terminal', text: 'Перевірити зв\'язок банківського терміналу' },
        { id: 'm_cash', text: 'Перерахувати та закласти розмінну монету' },
        { id: 'm_clean', text: 'Перевірити чистоту вітрин та порядок у залі' }
    ];
    const defaultEvening = [
        { id: 'e_cash', text: 'Вечірній перерахунок каси (вкладка Каса)' },
        { id: 'e_encash', text: 'Підготувати та зібрати інкасацію' },
        { id: 'e_stock', text: 'Заповнити вечірній перерахунок складу' },
        { id: 'e_zreport', text: 'Зняти фіскальний Z-звіт на РРО' },
        { id: 'e_safe', text: 'Сховати виручку в сейф та зачинити' },
        { id: 'e_lights', text: 'Вимкнути світло, вивіску та закрити ролети' }
    ];

    let items = [];
    if (isMorning) {
        if (store.checklists?.morning && store.checklists.morning.length > 0) {
            items = store.checklists.morning.map((text, idx) => ({ id: `m_${idx}`, text }));
        } else {
            items = defaultMorning;
        }
    } else {
        if (store.checklists?.evening && store.checklists.evening.length > 0) {
            items = store.checklists.evening.map((text, idx) => ({ id: `e_${idx}`, text }));
        } else {
            items = defaultEvening;
        }
    }

    // Зчитуємо локальний стан виконання чек-ліста за сьогодні
    const todayStr = new Date().toISOString().split('T')[0];
    const savedKey = `shifter_checklist_${store._id}_${todayStr}_${isMorning ? 'm' : 'e'}`;
    let savedState = {};
    try {
        savedState = JSON.parse(localStorage.getItem(savedKey) || '{}');
    } catch (e) { }

    terminalState.checklistState = savedState;

    container.innerHTML = items.map(item => {
        const record = savedState[item.id];
        const isChecked = !!record;
        const authorText = record ? `<span class="text-[9px] text-green-600 dark:text-green-400 font-bold ml-1">(${record.by}, ${record.time})</span>` : '';

        return `
            <div onclick="window.toggleChecklistItem('${item.id}', '${savedKey}')" class="p-2 rounded-xl bg-gray-50 dark:bg-[#2C2C2E] border border-gray-100 dark:border-gray-800 flex items-center justify-between cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors select-none">
                <div class="flex items-center gap-2 overflow-hidden">
                    <div class="w-4 h-4 rounded-md border flex items-center justify-center text-[10px] ${isChecked ? 'bg-green-500 border-green-500 text-white font-bold' : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-[#1C1C1E]'}">
                        ${isChecked ? '✓' : ''}
                    </div>
                    <span class="text-xs ${isChecked ? 'line-through text-gray-400' : 'text-gray-800 dark:text-gray-200 font-medium'} truncate">${item.text}</span>
                </div>
                ${authorText}
            </div>
        `;
    }).join('');
}

// 9.1 Моніторинг та рендеринг повітряної тривоги
async function loadAlarmStatus(storeId) {
    if (!storeId) return;
    try {
        const res = await fetchJson(`/api/terminal/alarm/status?storeId=${storeId}`);
        if (!res || !res.success) return;

        terminalState.alarmStatus = res;
        renderAlarmTile(res);
    } catch (e) {
        console.warn("loadAlarmStatus error:", e);
    }
}

function renderAlarmTile(data) {
    const cardEl = document.getElementById('termAlarmCard');
    const iconEl = document.getElementById('termAlarmIcon');
    const titleTextEl = document.getElementById('termAlarmTitleText');
    const regionBadgeEl = document.getElementById('termAlarmRegionBadge');
    const statusBoxEl = document.getElementById('termAlarmStatusBox');
    const statusTextEl = document.getElementById('termAlarmStatusText');
    const timerEl = document.getElementById('termAlarmTimer');
    const subtextEl = document.getElementById('termAlarmSubtext');
    const reopenBtn = document.getElementById('btnTermReopen');

    if (!cardEl || !statusBoxEl) return;

    if (regionBadgeEl) {
        regionBadgeEl.innerText = data.district ? `${data.region} (${data.district})` : (data.region || 'м. Київ');
    }

    if (data.isAlert) {
        // ТРИВОГА АКТИВНА
        const isRed = data.alertLevel === 'red';
        const levelBadge = isRed ? '🔴 Червоний (Ракетна небезпека)' : '🟡 Жовтий (Загроза БПЛА)';

        if (iconEl) iconEl.innerText = '🚨';
        if (titleTextEl) {
            titleTextEl.innerText = 'ПОВІТРЯНА ТРИВОГА';
            titleTextEl.className = 'text-xs font-black text-red-500 animate-pulse tracking-wider flex items-center gap-1.5';
        }

        cardEl.className = `ios-card p-3.5 border-2 ${isRed ? 'border-red-500 bg-red-50/20 dark:bg-red-950/20 shadow-lg shadow-red-500/20' : 'border-amber-500 bg-amber-50/20 dark:bg-amber-950/20 shadow-lg shadow-amber-500/20'} transition-all`;

        statusBoxEl.className = `p-2.5 rounded-xl ${isRed ? 'bg-red-100/60 dark:bg-red-900/40 border border-red-300 dark:border-red-800' : 'bg-amber-100/60 dark:bg-amber-900/40 border border-amber-300 dark:border-amber-800'} flex flex-col gap-1`;

        let durationText = '';
        if (data.enabledAt) {
            const startD = new Date(data.enabledAt);
            const now = new Date();
            const mins = Math.max(0, Math.round((now - startD) / 60000));
            const startH = String(startD.getHours()).padStart(2, '0');
            const startM = String(startD.getMinutes()).padStart(2, '0');
            durationText = `з ${startH}:${startM} (${mins} хв)`;
        }

        if (statusTextEl) {
            statusTextEl.className = `text-xs font-black ${isRed ? 'text-red-700 dark:text-red-300' : 'text-amber-700 dark:text-amber-300'} flex items-center gap-1.5`;
            statusTextEl.innerHTML = `<span>🚨</span> ТРИВОГА: ${levelBadge}`;
        }

        if (timerEl) {
            timerEl.innerText = durationText || 'Триває';
            timerEl.className = `text-[10px] font-mono font-bold ${isRed ? 'text-red-700 dark:text-red-300' : 'text-amber-700 dark:text-amber-300'}`;
        }

        if (subtextEl) {
            subtextEl.innerText = '⚠️ Робота точки призупинена! Працівники мають бути в укритті.';
            subtextEl.className = 'text-[10px] font-bold text-red-600 dark:text-red-400';
        }

        if (reopenBtn) {
            reopenBtn.className = 'w-full py-2 px-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 active:scale-95 text-white font-extrabold text-xs rounded-xl shadow-md shadow-emerald-600/20 transition-all flex items-center justify-center gap-1.5';
            reopenBtn.innerHTML = '<span>🏪</span> <span>Відкрились (зафіксувати)</span>';
        }
    } else {
        // ВІДБІЙ ТРИВОГИ / СПОКІЙНО
        if (iconEl) iconEl.innerText = '🟢';
        if (titleTextEl) {
            titleTextEl.innerText = 'СТАТУС БЕЗПЕКИ';
            titleTextEl.className = 'text-xs font-extrabold uppercase tracking-wider text-gray-500 dark:text-gray-400 flex items-center gap-1.5';
        }

        cardEl.className = 'ios-card p-3.5 bg-white dark:bg-[#1C1C1E] border border-gray-200/80 dark:border-gray-800 shadow-md transition-all';

        statusBoxEl.className = 'p-2.5 rounded-xl bg-green-50/70 dark:bg-green-950/30 border border-green-200/60 dark:border-green-800/50 flex flex-col gap-1 transition-colors';

        if (statusTextEl) {
            statusTextEl.className = 'text-xs font-bold text-green-700 dark:text-green-400 flex items-center gap-1.5';
            statusTextEl.innerHTML = '<span>🟢</span> Немає тривоги (Відбій)';
        }

        const lastEv = data.lastEvent;
        if (lastEv && lastEv.status === 'ended_waiting_reopen') {
            // Очікує відкриття!
            if (timerEl) {
                const endD = new Date(lastEv.endedAt);
                const endH = String(endD.getHours()).padStart(2, '0');
                const endM = String(endD.getMinutes()).padStart(2, '0');
                timerEl.innerText = `Відбій о ${endH}:${endM}`;
                timerEl.className = 'text-[10px] font-mono font-bold text-emerald-600 dark:text-emerald-400';
            }
            if (subtextEl) {
                subtextEl.innerHTML = `⚠️ <b>Відбій зафіксовано (${lastEv.alertDurationMinutes || 0} хв).</b> Натисніть кнопку <b>"Відкрились"</b> нижче після відновлення роботи!`;
                subtextEl.className = 'text-[10px] text-amber-600 dark:text-amber-400';
            }
            if (reopenBtn) {
                reopenBtn.className = 'w-full py-2.5 px-3 bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-500 hover:to-green-500 active:scale-95 text-white font-black text-xs rounded-xl shadow-lg shadow-emerald-600/30 transition-all flex items-center justify-center gap-1.5 animate-bounce';
                reopenBtn.innerHTML = '<span>🏪</span> <span>НА ТАЧКУ: НАТИСНІТЬ "ВІДКРИЛИСЬ"</span>';
            }
        } else {
            // Звичайний робочий стан
            if (timerEl) {
                const stats = data.todayStats;
                timerEl.innerText = stats?.count ? `${stats.count} тривог (${stats.totalDowntimeMins || 0} хв)` : 'Спокійно';
                timerEl.className = 'text-[10px] font-mono text-gray-500 dark:text-gray-400';
            }
            if (subtextEl) {
                subtextEl.innerText = 'Магазин працює у штатному режимі.';
                subtextEl.className = 'text-[10px] text-gray-500 dark:text-gray-400';
            }
            if (reopenBtn) {
                reopenBtn.className = 'w-full py-2 px-3 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 font-bold text-xs rounded-xl transition-all flex items-center justify-center gap-1.5';
                reopenBtn.innerHTML = '<span>🏪</span> <span>Відкрились (повідомити)</span>';
            }
        }
    }
}

window.confirmStoreReopen = async function () {
    triggerHaptic();
    if (!terminalState.store?._id) return;

    const btn = document.getElementById('btnTermReopen');
    const oldHtml = btn ? btn.innerHTML : '';
    if (btn) btn.innerHTML = '<span>⏳</span> <span>Відправка...</span>';

    try {
        const openedBy = terminalState.employees[0]?.name || 'Співробітник';
        const res = await postJson('/api/terminal/alarm/reopen', {
            storeId: terminalState.store._id,
            openedBy
        });

        if (res && res.success) {
            showToast(res.message || "Повідомлення надіслано в Telegram! ✅", 'success');
            await loadAlarmStatus(terminalState.store._id);
        } else {
            showToast(res?.message || "Помилка відправки", 'error');
            if (btn) btn.innerHTML = oldHtml;
        }
    } catch (e) {
        console.error("confirmStoreReopen error:", e);
        showToast("Помилка зв'язку", 'error');
        if (btn) btn.innerHTML = oldHtml;
    }
};

// 10. Позначення чек-ліста з вибором виконавця
window.toggleChecklistItem = function (itemId, savedKey) {
    triggerHaptic();
    const currentState = terminalState.checklistState || {};
    const employees = terminalState.terminalData?.todayShifts || [];

    if (currentState[itemId]) {
        // Зняти галочку
        delete currentState[itemId];
        localStorage.setItem(savedKey, JSON.stringify(currentState));
        renderChecklists(terminalState.store);
    } else {
        // Поставити галочку — вибираємо автора зі зміни
        const authorSelect = document.getElementById('termCashAuthorSelect');
        const selectedAuthor = authorSelect?.value || (employees.length > 0 ? employees[0].name : 'Співробітник');

        const timeStr = new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
        currentState[itemId] = { by: selectedAuthor, time: timeStr };
        localStorage.setItem(savedKey, JSON.stringify(currentState));
        renderChecklists(terminalState.store);
        showToast(`Виконано: ${selectedAuthor}`, 'success');
    }
};

// 11. Заповнення селектів авторів (список активних на зміні)
function populateAuthorSelects(employees) {
    const cashSelect = document.getElementById('termCashAuthorSelect');
    const stockSelect = document.getElementById('termStockAuthorSelect');

    const shifts = terminalState.terminalData?.todayShifts || [];
    const names = shifts.length > 0 ? shifts.map(s => s.name) : (employees || []).map(e => e.name);

    const optionsHtml = '<option value="">👤 Оберіть співробітника...</option>' +
        names.map(name => {
            const emp = employees ? employees.find(e => e.name === name) : null;
            const full = emp ? (emp.fullName || emp.name) : name;
            return `<option value="${name}">${full}</option>`;
        }).join('');

    if (cashSelect) cashSelect.innerHTML = optionsHtml;
    if (stockSelect) stockSelect.innerHTML = optionsHtml;
}

// ========================================================
// 12. ПОКУПЮРНИК (КАСА ТА ІНКАСАЦІЯ)
// ========================================================

function initCashCalculator() {
    const rowsContainer = document.getElementById('termDenominationsRows');
    if (!rowsContainer) return;

    rowsContainer.dataset.initialized = "true";

    rowsContainer.innerHTML = DENOMINATIONS.map(denom => `
        <div class="grid grid-cols-12 items-center text-xs py-1 px-1 rounded-lg hover:bg-gray-50 dark:hover:bg-[#2C2C2E] transition-colors">
            <div class="col-span-4 font-bold text-gray-700 dark:text-gray-300 font-mono flex items-center gap-1">
                <span class="w-2 h-2 rounded-full bg-blue-500/60"></span>
                <span>${denom} грн</span>
            </div>
            <div class="col-span-4 text-center px-1">
                <input type="number" min="0" data-denom="${denom}" value="" placeholder="0" 
                    oninput="window.calculateCashTotals()" 
                    onkeydown="window.handleCashInputKey(event, ${denom})"
                    class="cash-input w-full p-1 text-center font-bold font-mono bg-gray-50 dark:bg-[#2C2C2E] border border-gray-200 dark:border-gray-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-xs">
            </div>
            <div class="col-span-4 text-right font-mono font-bold text-gray-900 dark:text-gray-200" id="subtotal-${denom}">
                0 грн
            </div>
        </div>
    `).join('');

    renderExpectedRows();
    calculateCashTotals();
}

// Перемикання між вкладками «Каса» та «Інкасація»
window.switchTermCashTab = function (tab) {
    triggerHaptic();
    terminalState.activeTab = tab;

    const cashBtn = document.getElementById('termTabCashBtn');
    const encashBtn = document.getElementById('termTabEncashBtn');
    const cashExpectedSec = document.getElementById('termCashExpectedSection');
    const encashExpectedSec = document.getElementById('termEncashExpectedSection');
    const submitBtn = document.getElementById('termSubmitCashBtn');
    const countedLabel = document.getElementById('termCountedLabel');
    const totalCountedText = document.getElementById('termTotalCountedText');

    if (tab === 'cash') {
        cashBtn.className = "flex-1 py-1.5 text-xs font-extrabold rounded-lg transition-all shadow-sm bg-white dark:bg-[#1C1C1E] text-blue-600 dark:text-blue-400";
        encashBtn.className = "flex-1 py-1.5 text-xs font-extrabold rounded-lg transition-all text-gray-500 hover:text-gray-900 dark:hover:text-white";
        cashExpectedSec?.classList.remove('hidden');
        encashExpectedSec?.classList.add('hidden');
        if (countedLabel) countedLabel.innerText = "Пораховано в касі:";
        if (totalCountedText) {
            totalCountedText.className = "text-lg font-black text-blue-600 dark:text-blue-400";
        }
        if (submitBtn) {
            submitBtn.className = "flex-1 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:opacity-95 text-white font-extrabold text-xs rounded-xl shadow-md shadow-blue-500/20 active:scale-95 transition-all flex items-center justify-center gap-1.5";
            submitBtn.innerHTML = `<span>💾</span> <span>Зберегти касу та в TG</span>`;
        }
    } else {
        encashBtn.className = "flex-1 py-1.5 text-xs font-extrabold rounded-lg transition-all shadow-sm bg-white dark:bg-[#1C1C1E] text-purple-600 dark:text-purple-400";
        cashBtn.className = "flex-1 py-1.5 text-xs font-extrabold rounded-lg transition-all text-gray-500 hover:text-gray-900 dark:hover:text-white";
        cashExpectedSec?.classList.add('hidden');
        encashExpectedSec?.classList.remove('hidden');
        if (countedLabel) countedLabel.innerText = "Зібрано в інкасацію:";
        if (totalCountedText) {
            totalCountedText.className = "text-lg font-black text-purple-600 dark:text-purple-400";
        }
        if (submitBtn) {
            submitBtn.className = "flex-1 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:opacity-95 text-white font-extrabold text-xs rounded-xl shadow-md shadow-purple-500/20 active:scale-95 transition-all flex items-center justify-center gap-1.5";
            submitBtn.innerHTML = `<span>💼</span> <span>Зберегти інкасацію та в TG</span>`;
        }
    }

    calculateCashTotals();
};

// Зручний перехід між номіналами через Enter/Tab
window.handleCashInputKey = function (e, currentDenom) {
    if (e.key === 'Enter') {
        e.preventDefault();
        const inputs = Array.from(document.querySelectorAll('.cash-input'));
        const index = inputs.findIndex(inp => Number(inp.dataset.denom) === currentDenom);
        if (index !== -1 && index + 1 < inputs.length) {
            inputs[index + 1].focus();
            inputs[index + 1].select();
        }
    }
};

// Підрахунок сум купюр
window.calculateCashTotals = function () {
    let totalCounted = 0;
    const inputs = document.querySelectorAll('.cash-input');

    inputs.forEach(input => {
        const denom = Number(input.dataset.denom);
        const count = parseInt(input.value) || 0;
        const subtotal = count * denom;
        totalCounted += subtotal;

        const subtotalEl = document.getElementById(`subtotal-${denom}`);
        if (subtotalEl) {
            subtotalEl.innerText = `${subtotal.toLocaleString('uk-UA')} грн`;
        }

        terminalState.denominationsCount[denom] = count;
    });

    const totalEl = document.getElementById('termTotalCountedText');
    if (totalEl) totalEl.innerText = `${totalCounted.toLocaleString('uk-UA')} грн`;

    // 1) Якщо це Каса — рахуємо очікувану суму та різницю за Z-звітами
    if (terminalState.activeTab === 'cash') {
        let totalExpected = 0;
        terminalState.expectedAmounts.forEach(row => {
            totalExpected += (Number(row.amount) || 0);
        });

        const totalExpEl = document.getElementById('termTotalExpectedText');
        if (totalExpEl) totalExpEl.innerText = `${totalExpected.toLocaleString('uk-UA')} грн`;

        const diff = totalCounted - totalExpected;
        const diffBadge = document.getElementById('termDifferenceBadge');

        if (diffBadge) {
            if (diff === 0) {
                diffBadge.className = "px-2 py-0.5 rounded-lg text-xs font-black bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300";
                diffBadge.innerText = "0 грн ✅ Каса зійшлася";
            } else if (diff > 0) {
                diffBadge.className = "px-2 py-0.5 rounded-lg text-xs font-black bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300";
                diffBadge.innerText = `+${diff.toLocaleString('uk-UA')} грн (Надлишок)`;
            } else {
                diffBadge.className = "px-2 py-0.5 rounded-lg text-xs font-black bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300";
                diffBadge.innerText = `${diff.toLocaleString('uk-UA')} грн (Нестача ⚠️)`;
            }
        }
    } else {
        // 2) Якщо це Інкасація — рахуємо прогрес від цільової суми до збору
        const targetInput = document.getElementById('termEncashTargetInput');
        const target = parseFloat(targetInput?.value) || 0;

        const targetDisplay = document.getElementById('termEncashTargetDisplay');
        if (targetDisplay) targetDisplay.innerText = `${target.toLocaleString('uk-UA')} грн`;

        const statusBadge = document.getElementById('termEncashStatusBadge');
        const progressBar = document.getElementById('termEncashProgressBar');

        if (target <= 0) {
            if (statusBadge) {
                statusBadge.className = "px-2 py-0.5 rounded-lg text-xs font-black bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400";
                statusBadge.innerText = "Вкажіть суму для контролю";
            }
            if (progressBar) progressBar.style.width = '0%';
        } else {
            const diff = totalCounted - target;
            const pct = Math.min(100, Math.round((totalCounted / target) * 100));
            if (progressBar) progressBar.style.width = `${pct}%`;

            if (statusBadge) {
                if (diff === 0) {
                    statusBadge.className = "px-2 py-0.5 rounded-lg text-xs font-black bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300";
                    statusBadge.innerText = "Суму зібрано точно 100% ✅";
                } else if (diff < 0) {
                    statusBadge.className = "px-2 py-0.5 rounded-lg text-xs font-black bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200";
                    statusBadge.innerText = `Залишилось зібрати: ${Math.abs(diff).toLocaleString('uk-UA')} грн (${pct}%) ⏳`;
                } else {
                    statusBadge.className = "px-2 py-0.5 rounded-lg text-xs font-black bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300";
                    statusBadge.innerText = `Зібрано більше: +${diff.toLocaleString('uk-UA')} грн ⚠️`;
                }
            }
        }
    }
};

// 13. Мульти-ввід очікуваних сум (кілька днів/звітів)
function renderExpectedRows() {
    const container = document.getElementById('termExpectedRowsContainer');
    if (!container) return;

    container.innerHTML = terminalState.expectedAmounts.map((row, idx) => `
        <div class="flex items-center gap-1.5">
            <input type="text" value="${row.label}" onchange="window.updateExpectedRowLabel(${row.id}, this.value)" placeholder="День/звіт" class="flex-1 p-1 text-[11px] bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-700 rounded-lg outline-none font-medium">
            <input type="number" min="0" value="${row.amount || ''}" oninput="window.updateExpectedRowAmount(${row.id}, this.value)" placeholder="Сума (грн)" class="w-28 p-1 text-right text-[11px] font-mono font-bold bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-700 rounded-lg outline-none">
            ${terminalState.expectedAmounts.length > 1 ? `
                <button onclick="window.removeExpectedAmountRow(${row.id})" class="text-red-500 hover:text-red-700 px-1 text-xs font-bold">✕</button>
            ` : ''}
        </div>
    `).join('');
}

window.addExpectedAmountRow = function () {
    triggerHaptic();
    const count = terminalState.expectedAmounts.length + 1;
    terminalState.expectedAmounts.push({
        id: terminalState.nextExpectedId++,
        label: `Z-звіт день ${count}`,
        amount: 0
    });
    renderExpectedRows();
    calculateCashTotals();
};

window.removeExpectedAmountRow = function (id) {
    triggerHaptic();
    terminalState.expectedAmounts = terminalState.expectedAmounts.filter(r => r.id !== id);
    renderExpectedRows();
    calculateCashTotals();
};

window.updateExpectedRowLabel = function (id, val) {
    const r = terminalState.expectedAmounts.find(x => x.id === id);
    if (r) r.label = val;
};

window.updateExpectedRowAmount = function (id, val) {
    const r = terminalState.expectedAmounts.find(x => x.id === id);
    if (r) r.amount = parseFloat(val) || 0;
    calculateCashTotals();
};

// 14. Очищення форми покупюрника
window.resetCashCountInputs = function () {
    triggerHaptic();
    if (!confirm("Очистити всі введені суми та купюри?")) return;

    document.querySelectorAll('.cash-input').forEach(i => i.value = '');
    const encashTarget = document.getElementById('termEncashTargetInput');
    if (encashTarget) encashTarget.value = '';

    terminalState.expectedAmounts = [{ id: 1, label: 'Z-звіт сьогодні', amount: 0 }];
    renderExpectedRows();
    calculateCashTotals();
    showToast("Форму очищено", "info");
};

// 15. Збереження перерахунку каси / інкасації
window.submitCashCount = async function () {
    triggerHaptic();
    const store = terminalState.store;
    if (!store) return showToast("Магазин не визначено", "error");

    const authorSelect = document.getElementById('termCashAuthorSelect');
    const countedBy = authorSelect?.value;
    if (!countedBy) {
        return showToast("Будь ласка, оберіть співробітника, який проводив перерахунок", "warning");
    }

    let totalCounted = 0;
    const inputs = document.querySelectorAll('.cash-input');
    inputs.forEach(i => {
        totalCounted += (parseInt(i.value) || 0) * Number(i.dataset.denom);
    });

    let totalExpected = 0;
    let expectedAmounts = [];
    let difference = 0;

    if (terminalState.activeTab === 'cash') {
        terminalState.expectedAmounts.forEach(r => totalExpected += (Number(r.amount) || 0));
        difference = totalCounted - totalExpected;
        expectedAmounts = terminalState.expectedAmounts;
    } else {
        const targetInput = document.getElementById('termEncashTargetInput');
        const targetVal = parseFloat(targetInput?.value) || 0;
        totalExpected = targetVal;
        difference = targetVal > 0 ? (totalCounted - targetVal) : 0;
        expectedAmounts = targetVal > 0 ? [{ id: 1, label: 'Ціль інкасації', amount: targetVal }] : [];
    }

    const payload = {
        storeId: store._id,
        type: terminalState.activeTab,
        countedBy,
        denominations: terminalState.denominationsCount,
        totalCounted,
        expectedAmounts,
        totalExpected,
        difference
    };

    try {
        const res = await postJson('/api/terminal/cash-count', payload);
        if (res && res.success) {
            const title = terminalState.activeTab === 'encashment' ? 'Інкасацію збережено' : 'Перерахунок каси збережено';
            showToast(`${title} та надіслано в Telegram!`, 'success');
        } else {
            showToast(res?.message || 'Помилка збереження', 'error');
        }
    } catch (e) {
        showToast("Помилка при збереженні", "error");
    }
};

// 16. Збереження перерахунку складу
window.submitStockCount = async function () {
    triggerHaptic();
    const store = terminalState.store;
    if (!store) return showToast("Магазин не визначено", "error");

    const textEl = document.getElementById('termStockText');
    const content = textEl?.value?.trim();
    if (!content) {
        return showToast("Введіть дані перерахунку складу", "warning");
    }

    const authorSelect = document.getElementById('termStockAuthorSelect');
    const countedBy = authorSelect?.value;
    if (!countedBy) {
        return showToast("Оберіть співробітника (СЕ), який заповнив перерахунок", "warning");
    }

    try {
        const res = await postJson('/api/terminal/stock-count', {
            storeId: store._id,
            countedBy,
            content
        });

        if (res && res.success) {
            textEl.value = '';
            showToast("Перерахунок складу збережено та надіслано в Telegram!", "success");
        } else {
            showToast(res?.message || 'Помилка збереження', 'error');
        }
    } catch (e) {
        showToast("Помилка збереження складу", "error");
    }
};

// 17. Історія каси та інкасацій (Модалка)
window.openCashHistoryModal = async function () {
    triggerHaptic();
    const modal = document.getElementById('cashHistoryModal');
    const container = document.getElementById('cashHistoryListContainer');
    if (!modal || !container) return;

    modal.classList.remove('hidden');
    container.innerHTML = `<div class="text-center text-xs text-gray-400 py-6">Завантаження...</div>`;

    try {
        const storeId = terminalState.store?._id;
        const res = await fetchJson(`/api/terminal/cash-count/history?storeId=${storeId}`);
        if (res && res.history && res.history.length > 0) {
            container.innerHTML = res.history.map(item => {
                const dateStr = new Date(item.createdAt).toLocaleString('uk-UA', { dateStyle: 'short', timeStyle: 'short' });
                const isEncash = item.type === 'encashment';
                const typeBadge = isEncash
                    ? `<span class="px-2 py-0.5 rounded bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 font-bold text-[10px]">Інкасація</span>`
                    : `<span class="px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-bold text-[10px]">Каса</span>`;

                let statusBadge = '';
                if (!isEncash) {
                    statusBadge = item.difference === 0
                        ? `<span class="text-green-600 dark:text-green-400 font-bold text-xs">0 грн ✅</span>`
                        : `<span class="text-red-500 font-bold text-xs">${item.difference > 0 ? '+' : ''}${item.difference.toLocaleString('uk-UA')} грн ⚠️</span>`;
                } else if (item.totalExpected > 0) {
                    statusBadge = item.difference === 0
                        ? `<span class="text-green-600 dark:text-green-400 font-bold text-xs">Ціль: ${item.totalExpected.toLocaleString('uk-UA')} грн ✅</span>`
                        : `<span class="text-purple-600 dark:text-purple-400 font-bold text-xs">Ціль: ${item.totalExpected.toLocaleString('uk-UA')} грн (${item.difference > 0 ? '+' : ''}${item.difference.toLocaleString('uk-UA')})</span>`;
                }

                return `
                    <div class="p-3 rounded-xl bg-gray-50 dark:bg-[#2C2C2E] border border-gray-100 dark:border-gray-800 space-y-1.5 text-xs">
                        <div class="flex justify-between items-center">
                            <div class="flex items-center gap-2">
                                ${typeBadge}
                                <span class="font-bold text-gray-800 dark:text-gray-200">${item.countedBy}</span>
                            </div>
                            <span class="text-gray-400 font-mono text-[10px]">${dateStr}</span>
                        </div>
                        <div class="flex justify-between items-baseline pt-1 border-t border-gray-200/50 dark:border-gray-700/50">
                            <span class="font-mono text-base font-extrabold text-blue-600 dark:text-blue-400">${item.totalCounted.toLocaleString('uk-UA')} грн</span>
                            ${statusBadge}
                        </div>
                    </div>
                `;
            }).join('');
        } else {
            container.innerHTML = `<div class="text-center text-xs text-gray-400 py-6">Історія перерахунків порожня</div>`;
        }
    } catch (e) {
        container.innerHTML = `<div class="text-center text-xs text-red-500 py-6">Не вдалося завантажити історію</div>`;
    }
};

window.closeCashHistoryModal = function () {
    document.getElementById('cashHistoryModal')?.classList.add('hidden');
};

// 18. Історія складу (Модалка)
window.openStockHistoryModal = async function () {
    triggerHaptic();
    const modal = document.getElementById('stockHistoryModal');
    const container = document.getElementById('stockHistoryListContainer');
    if (!modal || !container) return;

    modal.classList.remove('hidden');
    container.innerHTML = `<div class="text-center text-xs text-gray-400 py-6">Завантаження...</div>`;

    try {
        const storeId = terminalState.store?._id;
        const res = await fetchJson(`/api/terminal/stock-count/history?storeId=${storeId}`);
        if (res && res.history && res.history.length > 0) {
            container.innerHTML = res.history.map(item => {
                const dateStr = new Date(item.createdAt).toLocaleString('uk-UA', { dateStyle: 'short', timeStyle: 'short' });
                return `
                    <div class="p-3 rounded-xl bg-gray-50 dark:bg-[#2C2C2E] border border-gray-100 dark:border-gray-800 space-y-2 text-xs">
                        <div class="flex justify-between items-center">
                            <span class="font-bold text-gray-800 dark:text-gray-200">👤 ${item.countedBy}</span>
                            <span class="text-gray-400 font-mono text-[10px]">${dateStr}</span>
                        </div>
                        <div class="p-2 rounded-lg bg-white dark:bg-[#1C1C1E] border border-gray-100 dark:border-gray-800 text-xs font-mono whitespace-pre-wrap text-gray-700 dark:text-gray-300">
${item.content}
                        </div>
                    </div>
                `;
            }).join('');
        } else {
            container.innerHTML = `<div class="text-center text-xs text-gray-400 py-6">Історія складу порожня</div>`;
        }
    } catch (e) {
        container.innerHTML = `<div class="text-center text-xs text-red-500 py-6">Не вдалося завантажити історію</div>`;
    }
};

window.closeStockHistoryModal = function () {
    document.getElementById('stockHistoryModal')?.classList.add('hidden');
};

// 19. Авторизація терміналу (Вхід на ПК)
function showTerminalLoginModal() {
    document.getElementById('terminalLoginModal')?.classList.remove('hidden');
}

function hideTerminalLoginModal() {
    document.getElementById('terminalLoginModal')?.classList.add('hidden');
}

window.submitTerminalLogin = async function () {
    triggerHaptic();
    const code = document.getElementById('termInputStoreCode')?.value?.trim();
    const pin = document.getElementById('termInputPin')?.value?.trim();

    if (!code || !pin) {
        return showToast("Введіть код точки та PIN-код", "warning");
    }

    try {
        const res = await postJson('/api/terminal/login', { code, pin });
        if (res && res.success) {
            localStorage.setItem('shifter_terminal_storeId', res.store._id);
            localStorage.setItem('shifter_terminal_storeCode', res.store.code);
            hideTerminalLoginModal();
            showToast(`Підключено: ${res.store.name}`, 'success');
            await loadTerminalData(res.store._id, res.store.code);
        } else {
            showToast(res?.message || "Невірний код чи PIN", "error");
        }
    } catch (e) {
        showToast("Помилка авторизації ПК", "error");
    }
};

window.terminalLogout = function () {
    triggerHaptic();
    if (!confirm("Вийти з цього магазину на цьому комп'ютері?")) return;
    localStorage.removeItem('shifter_terminal_storeId');
    localStorage.removeItem('shifter_terminal_storeCode');
    showTerminalLoginModal();
    showToast("ПК відключено від магазину", "info");
};

window.terminalRefresh = function () {
    triggerHaptic();
    if (terminalState.store?._id) {
        loadTerminalData(terminalState.store._id, null);
        loadAlarmStatus(terminalState.store._id);
    }
};

window.cancelTerminalLogin = function () {
    triggerHaptic();
    document.getElementById('terminalLoginModal')?.classList.add('hidden');
    window.exitTerminalMode();
};

window.toggleTerminalFullscreen = function () {
    triggerHaptic();
    if (!document.fullscreenElement) {
        if (document.documentElement.requestFullscreen) {
            document.documentElement.requestFullscreen().catch(() => {});
        }
        const icon = document.getElementById('termFullscreenIcon');
        if (icon) icon.innerText = '🗗';
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen().catch(() => {});
        }
        const icon = document.getElementById('termFullscreenIcon');
        if (icon) icon.innerText = '⛶';
    }
};

window.exitTerminalMode = function () {
    triggerHaptic();
    if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
        const icon = document.getElementById('termFullscreenIcon');
        if (icon) icon.innerText = '⛶';
    }
    if (terminalState.pollingInterval) {
        clearInterval(terminalState.pollingInterval);
        terminalState.pollingInterval = null;
    }
    if (terminalState.clockInterval) {
        clearInterval(terminalState.clockInterval);
        terminalState.clockInterval = null;
    }

    localStorage.removeItem('shifter_viewMode');

    if (window.location.hash === '#terminal' || window.location.search.includes('terminal')) {
        history.replaceState(null, '', window.location.pathname);
    }

    if (state.currentUser && state.currentUser.role && state.currentUser.role !== 'Terminal' && state.currentUser.role !== 'Guest') {
        if (window.setMode) {
            window.setMode('list');
            return;
        }
    }

    state.currentUser = null;
    if (window.applyTerminalLayout) {
        window.applyTerminalLayout(false);
    }

    const appScreen = document.getElementById('appScreen');
    const loginScreen = document.getElementById('loginScreen');
    const termDiv = document.getElementById('terminal-container');

    if (termDiv) termDiv.classList.add('hidden');
    if (appScreen) appScreen.classList.add('hidden');
    if (loginScreen) {
        loginScreen.classList.remove('hidden');
    } else {
        window.location.href = '/';
    }
};

// ==========================================
// 19. ГРАФІК ЗМІН МАГАЗИНУ (МОДАЛЬНЕ ВІКНО)
// ==========================================

let terminalScheduleState = {
    year: null,
    month: null,
    data: null,
    loading: false
};

const monthNamesUa = [
    'Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень',
    'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень'
];

function calcTerminalShiftHours(start, end) {
    if (!start || !end || start === 'Відпустка' || start === 'Лікарняний' || start === 'Донорство' || start === 'DELETE') return 0;
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    if (isNaN(sh) || isNaN(eh)) return 0;
    let diff = (eh + (em || 0) / 60) - (sh + (sm || 0) / 60);
    if (diff < 0) diff += 24;
    return diff;
}

function getTerminalShiftColorClass(start, end) {
    const key = `${start}-${end}`;
    const map = {
        '10:00-19:00': 'bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-200 border border-blue-300 dark:border-blue-700',
        '09:30-18:30': 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-200 border border-emerald-300 dark:border-emerald-700',
        '11:30-20:30': 'bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-200 border border-amber-300 dark:border-amber-700',
        '12:00-21:00': 'bg-purple-100 dark:bg-purple-900/50 text-purple-800 dark:text-purple-200 border border-purple-300 dark:border-purple-700',
        '13:00-22:00': 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-800 dark:text-indigo-200 border border-indigo-300 dark:border-indigo-700',
        '14:00-22:00': 'bg-cyan-100 dark:bg-cyan-900/50 text-cyan-800 dark:text-cyan-200 border border-cyan-300 dark:border-cyan-700',
        '09:00-18:00': 'bg-teal-100 dark:bg-teal-900/50 text-teal-800 dark:text-teal-200 border border-teal-300 dark:border-teal-700',
        '08:00-17:00': 'bg-yellow-100 dark:bg-yellow-900/50 text-yellow-800 dark:text-yellow-200 border border-yellow-300 dark:border-yellow-700'
    };
    if (map[key]) return map[key];
    return 'bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800';
}

async function loadTerminalSchedule() {
    const storeId = terminalState.store?._id || localStorage.getItem('shifter_terminal_storeId');
    const container = document.getElementById('termScheduleBody');
    const monthLabel = document.getElementById('termSchedCurrentMonthLabel');
    const badge = document.getElementById('termSchedStoreBadge');

    if (monthLabel) {
        monthLabel.innerText = `${monthNamesUa[terminalScheduleState.month - 1]} ${terminalScheduleState.year}`;
    }
    if (badge && terminalState.store) {
        badge.innerText = terminalState.store.name || terminalState.store.code || '---';
    }

    if (container) {
        container.innerHTML = `
            <div class="text-center text-xs text-gray-400 py-16 flex flex-col items-center justify-center gap-2">
                <div class="w-7 h-7 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                <span>Завантаження розкладу...</span>
            </div>
        `;
    }

    try {
        const res = await fetchJson(`/api/terminal/schedule?storeId=${storeId}&year=${terminalScheduleState.year}&month=${terminalScheduleState.month}`);
        if (res && res.success) {
            terminalScheduleState.data = res;
            renderTerminalScheduleTable(res);
        } else {
            if (container) container.innerHTML = `<div class="text-center text-xs text-red-500 py-16">${res?.message || 'Помилка завантаження графіку'}</div>`;
        }
    } catch (e) {
        if (container) container.innerHTML = `<div class="text-center text-xs text-red-500 py-16">Не вдалося завантажити розклад</div>`;
    }
}

function renderTerminalScheduleTable(data) {
    const container = document.getElementById('termScheduleBody');
    if (!container) return;

    const { year, month, daysInMonth, todayStr, employees, shifts } = data;

    if (!employees || employees.length === 0) {
        container.innerHTML = `
            <div class="text-center text-xs text-gray-400 py-16">
                У цьому магазині поки немає доданих співробітників
            </div>
        `;
        return;
    }

    const daysOfWeekUa = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
    const monthStr = String(month).padStart(2, '0');

    // Рахуємо статистику по днях і по співробітниках
    const dailyCounts = {};
    for (let d = 1; d <= daysInMonth; d++) dailyCounts[d] = 0;

    let totalMonthShifts = 0;
    let totalMonthHours = 0;

    const empStats = employees.map(emp => {
        let hours = 0;
        let count = 0;
        for (let d = 1; d <= daysInMonth; d++) {
            const dStr = `${year}-${monthStr}-${String(d).padStart(2, '0')}`;
            const s = shifts.find(item => item.name === emp.name && item.date === dStr);
            if (s && s.start && s.start !== 'DELETE') {
                if (s.start !== 'Відпустка' && s.start !== 'Лікарняний' && s.start !== 'Донорство') {
                    const h = calcTerminalShiftHours(s.start, s.end);
                    hours += h;
                    count++;
                    dailyCounts[d]++;
                    totalMonthShifts++;
                    totalMonthHours += h;
                }
            }
        }
        return { emp, hours, count };
    });

    // Сортуємо: керівники/більше змін зверху
    empStats.sort((a, b) => b.count - a.count || a.emp.name.localeCompare(b.emp.name));

    let html = `
    <div class="inline-block min-w-full align-middle">
        <div class="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm bg-white dark:bg-[#1C1C1E]">
            <table class="min-w-full border-collapse text-left text-xs">
                <thead>
                    <tr class="bg-gray-100/90 dark:bg-[#252528] backdrop-blur sticky top-0 z-30 shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
                        <th scope="col" class="sticky left-0 z-40 bg-gray-100 dark:bg-[#252528] px-3 py-2.5 font-black text-gray-700 dark:text-gray-200 border-b border-r border-gray-200 dark:border-gray-800 min-w-[170px] max-w-[200px]">
                            Співробітник
                        </th>
    `;

    // Заголовки днів
    for (let d = 1; d <= daysInMonth; d++) {
        const dStr = `${year}-${monthStr}-${String(d).padStart(2, '0')}`;
        const dateObj = new Date(year, month - 1, d);
        const dow = daysOfWeekUa[dateObj.getDay()];
        const isWeekend = dateObj.getDay() === 0 || dateObj.getDay() === 6;
        const isToday = dStr === todayStr;

        let thClass = 'border-b border-r border-gray-200 dark:border-gray-800 text-center py-2 px-1 min-w-[76px] transition-colors ';
        if (isToday) {
            thClass += 'bg-blue-500 text-white font-extrabold shadow-sm';
        } else if (isWeekend) {
            thClass += 'bg-rose-50/50 dark:bg-rose-950/20 text-rose-500 font-bold';
        } else {
            thClass += 'text-gray-600 dark:text-gray-300 font-semibold';
        }

        html += `
            <th scope="col" class="${thClass}" ${isToday ? 'data-sched-today="true"' : ''}>
                <div class="text-[10px] ${isToday ? 'text-blue-100' : 'text-gray-400 dark:text-gray-400'} uppercase font-bold tracking-tight">${dow}</div>
                <div class="text-xs ${isToday ? 'text-white' : ''}">${d}</div>
            </th>
        `;
    }

    // Колонка "Всього"
    html += `
                        <th scope="col" class="sticky right-0 z-40 bg-gray-100 dark:bg-[#252528] px-3 py-2.5 text-center font-black text-gray-700 dark:text-gray-200 border-b border-l border-gray-200 dark:border-gray-800 min-w-[90px]">
                            Всього
                        </th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-gray-100 dark:divide-gray-800/60 font-medium">
    `;

    // Рядки для кожного співробітника
    empStats.forEach(({ emp, hours, count }, idx) => {
        const rowBg = idx % 2 === 0 ? 'bg-white dark:bg-[#1C1C1E]' : 'bg-gray-50/40 dark:bg-[#202022]';
        html += `<tr class="${rowBg} hover:bg-blue-50/30 dark:hover:bg-blue-900/10 transition-colors">`;

        // Ліва закріплена колонка (ПІБ, посада)
        const initial = (emp.fullName || emp.name).charAt(0).toUpperCase();
        html += `
            <td class="sticky left-0 z-20 ${rowBg} px-3 py-2 border-r border-gray-200 dark:border-gray-800 shadow-[2px_0_4px_rgba(0,0,0,0.03)]">
                <div class="flex items-center gap-2">
                    <div class="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300 flex items-center justify-center font-bold text-[10px] flex-shrink-0">
                        ${initial}
                    </div>
                    <div class="min-w-0 flex-1">
                        <div class="font-bold text-xs truncate text-gray-900 dark:text-white" title="${emp.fullName || emp.name}">
                            ${emp.fullName || emp.name}
                        </div>
                        <div class="text-[10px] text-gray-400 truncate leading-none mt-0.5">
                            ${emp.position || 'Співробітник'}
                        </div>
                    </div>
                </div>
            </td>
        `;

        // Клітинки днів
        for (let d = 1; d <= daysInMonth; d++) {
            const dStr = `${year}-${monthStr}-${String(d).padStart(2, '0')}`;
            const s = shifts.find(item => item.name === emp.name && item.date === dStr);
            const isToday = dStr === todayStr;

            let tdClass = `border-r border-gray-100 dark:border-gray-800/80 text-center p-1 relative `;
            if (isToday) {
                tdClass += `bg-blue-50/60 dark:bg-blue-950/30 `;
            }

            html += `<td class="${tdClass}">`;

            if (s && s.start && s.start !== 'DELETE') {
                if (s.start === 'Відпустка') {
                    html += `
                        <div class="py-1 px-1 rounded-lg bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60 text-[10px] font-bold" title="Відпустка">
                            🌴 Відп
                        </div>
                    `;
                } else if (s.start === 'Лікарняний') {
                    html += `
                        <div class="py-1 px-1 rounded-lg bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800/60 text-[10px] font-bold" title="Лікарняний">
                            💊 Лік
                        </div>
                    `;
                } else if (s.start === 'Донорство') {
                    html += `
                        <div class="py-1 px-1 rounded-lg bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800/60 text-[10px] font-bold" title="Донорство">
                            🩸 Дон
                        </div>
                    `;
                } else {
                    const shiftH = calcTerminalShiftHours(s.start, s.end);
                    const pillColor = getTerminalShiftColorClass(s.start, s.end);
                    const isSubBadge = s.isSubstitute ? '<span class="text-[9px] text-indigo-500 font-bold" title="Підміна">🔄</span>' : '';
                    html += `
                        <div class="py-1 px-1.5 rounded-lg ${pillColor} text-[11px] font-black leading-tight shadow-xs active:scale-95 transition-transform" title="${emp.fullName || emp.name}: ${s.start} - ${s.end} (${shiftH} год)">
                            <div class="font-extrabold tracking-tight flex items-center justify-center gap-0.5">${s.start} ${isSubBadge}</div>
                            <div class="text-[10px] opacity-80">${s.end}</div>
                        </div>
                    `;
                }
            } else {
                html += `<span class="text-gray-300 dark:text-gray-600 text-xs select-none">•</span>`;
            }

            html += `</td>`;
        }

        // Права закріплена колонка (Всього годин та змін)
        html += `
            <td class="sticky right-0 z-20 ${rowBg} px-2 py-2 text-center border-l border-gray-200 dark:border-gray-800 shadow-[-2px_0_4px_rgba(0,0,0,0.03)]">
                <div class="font-black text-xs text-blue-600 dark:text-blue-400">
                    ${hours % 1 === 0 ? hours : hours.toFixed(1)}г
                </div>
                <div class="text-[10px] text-gray-400 font-medium">
                    ${count} зм
                </div>
            </td>
        `;

        html += `</tr>`;
    });

    // Підсумковий рядок: кількість людей на зміні кожного дня
    html += `
                </tbody>
                <tfoot>
                    <tr class="bg-gray-100/90 dark:bg-[#252528] sticky bottom-0 z-30 font-bold border-t-2 border-gray-300 dark:border-gray-700">
                        <td class="sticky left-0 z-40 bg-gray-100 dark:bg-[#252528] px-3 py-2 text-xs text-gray-700 dark:text-gray-300 border-r border-gray-200 dark:border-gray-800 shadow-[2px_0_4px_rgba(0,0,0,0.03)] font-black">
                            👥 На зміні
                        </td>
    `;

    for (let d = 1; d <= daysInMonth; d++) {
        const count = dailyCounts[d];
        const dStr = `${year}-${monthStr}-${String(d).padStart(2, '0')}`;
        const isToday = dStr === todayStr;

        let tdClass = `border-r border-gray-200 dark:border-gray-800 text-center py-2 px-1 `;
        if (isToday) tdClass += `bg-blue-100 dark:bg-blue-900/40 `;

        html += `
            <td class="${tdClass}">
                <span class="inline-block px-1.5 py-0.5 rounded-md text-[10px] font-black ${count > 0 ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400' : 'text-gray-400 dark:text-gray-500'}">
                    ${count}
                </span>
            </td>
        `;
    }

    html += `
                        <td class="sticky right-0 z-40 bg-gray-100 dark:bg-[#252528] px-2 py-2 text-center text-xs text-blue-600 dark:text-blue-400 font-black border-l border-gray-200 dark:border-gray-800 shadow-[-2px_0_4px_rgba(0,0,0,0.03)]">
                            ${totalMonthHours % 1 === 0 ? totalMonthHours : totalMonthHours.toFixed(1)}г
                        </td>
                    </tr>
                </tfoot>
            </table>
        </div>
    </div>
    `;

    container.innerHTML = html;

    // Оновлюємо статистику в підвалі
    const statsEl = document.getElementById('termSchedSummaryStats');
    if (statsEl) {
        statsEl.innerHTML = `Всього на місяць: <span class="text-blue-600 dark:text-blue-400 font-black">${totalMonthShifts}</span> змін • <span class="text-blue-600 dark:text-blue-400 font-black">${totalMonthHours % 1 === 0 ? totalMonthHours : totalMonthHours.toFixed(1)}</span> год`;
    }

    // Автоматично прокручуємо до сьогодні, якщо дивимося поточний місяць
    const nowKiev = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Kiev" }));
    if (year === nowKiev.getFullYear() && month === (nowKiev.getMonth() + 1)) {
        setTimeout(() => {
            const todayEl = container.querySelector('[data-sched-today="true"]');
            if (todayEl) {
                todayEl.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
            }
        }, 120);
    }
}

window.openTerminalScheduleModal = function () {
    triggerHaptic();
    const modal = document.getElementById('terminalScheduleModal');
    if (!modal) return;

    modal.classList.remove('hidden');

    if (!terminalScheduleState.year || !terminalScheduleState.month) {
        const nowKiev = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Kiev" }));
        terminalScheduleState.year = nowKiev.getFullYear();
        terminalScheduleState.month = nowKiev.getMonth() + 1;
    }

    loadTerminalSchedule();
};

window.closeTerminalScheduleModal = function () {
    triggerHaptic();
    document.getElementById('terminalScheduleModal')?.classList.add('hidden');
};

window.changeTerminalScheduleMonth = function (delta) {
    triggerHaptic();
    terminalScheduleState.month += delta;
    if (terminalScheduleState.month > 12) {
        terminalScheduleState.month = 1;
        terminalScheduleState.year += 1;
    } else if (terminalScheduleState.month < 1) {
        terminalScheduleState.month = 12;
        terminalScheduleState.year -= 1;
    }
    loadTerminalSchedule();
};

window.jumpTerminalScheduleToToday = async function () {
    triggerHaptic();
    const nowKiev = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Kiev" }));
    const currYear = nowKiev.getFullYear();
    const currMonth = nowKiev.getMonth() + 1;

    if (terminalScheduleState.year !== currYear || terminalScheduleState.month !== currMonth) {
        terminalScheduleState.year = currYear;
        terminalScheduleState.month = currMonth;
        await loadTerminalSchedule();
    }

    setTimeout(() => {
        const todayEl = document.querySelector('#termScheduleBody [data-sched-today="true"]');
        if (todayEl) {
            todayEl.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        }
    }, 150);
};

// Закриття модалки розкладу по Esc
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const schedModal = document.getElementById('terminalScheduleModal');
        if (schedModal && !schedModal.classList.contains('hidden')) {
            window.closeTerminalScheduleModal();
        }
    }
});

