import { postJson, fetchJson } from './api.js';
import { showToast, triggerHaptic } from './ui.js';
import { state } from './state.js';
import { getDisplayName } from './render_utils.js';

// Номінали банкнот України (тільки банкноти, починаючи з 2000 грн)
const DENOMINATIONS = [2000, 1000, 500, 200, 100, 50, 20, 10, 5, 2, 1];

let terminalState = {
    store: null,
    terminalData: null,
    activeTab: 'cash', // 'cash' | 'encashment'
    denominationsCount: {},
    expectedAmounts: [{ id: 1, label: 'X-звіт за сьогодні', amount: 0 }],
    nextExpectedId: 2,
    pollingInterval: null,
    alarmInterval: null,
    clockInterval: null,
    checklistState: {},
    checklistsProgress: { morning: {}, evening: {} },
    checklistManualTab: null, // null (авто за часом) | 'morning' | 'evening'
    latestCashToday: null,
    latestStockToday: null,
    previousStockCount: null,
    isPrevStockExpanded: true,
    alarmStatus: null,
    soundEnabled: localStorage.getItem('shifter_terminal_sound') !== 'off',
    prevAlarmIsAlert: null,
    knownTaskIds: new Set(),
    tasksInitialized: false,
    closingSoundPlayedDate: null
};

// Синтезатор звукових сповіщень терміналу (Web Audio API, без зовнішніх mp3)
let termAudioCtx = null;
function playTerminalSound(type = 'notification') {
    if (!terminalState.soundEnabled) return;
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        if (!termAudioCtx) termAudioCtx = new AudioCtx();
        if (termAudioCtx.state === 'suspended') {
            termAudioCtx.resume().catch(() => {});
        }

        const now = termAudioCtx.currentTime;

        const playTone = (freq, startTime, duration, wave = 'sine', maxGain = 0.18) => {
            const osc = termAudioCtx.createOscillator();
            const gain = termAudioCtx.createGain();
            osc.type = wave;
            osc.frequency.setValueAtTime(freq, startTime);
            gain.gain.setValueAtTime(0.001, startTime);
            gain.gain.exponentialRampToValueAtTime(maxGain, startTime + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
            osc.connect(gain);
            gain.connect(termAudioCtx.destination);
            osc.start(startTime);
            osc.stop(startTime + duration + 0.02);
        };

        if (type === 'alarm_start') {
            // Тривожний сигнал (3 пульси сирени)
            playTone(880, now, 0.22, 'sawtooth', 0.22);
            playTone(660, now + 0.25, 0.22, 'sawtooth', 0.22);
            playTone(880, now + 0.50, 0.22, 'sawtooth', 0.22);
            playTone(660, now + 0.75, 0.28, 'sawtooth', 0.22);
        } else if (type === 'alarm_end') {
            // Приємний мажорний акорд відбою (C5 -> E5 -> G5)
            playTone(523.25, now, 0.18, 'triangle', 0.2);
            playTone(659.25, now + 0.16, 0.18, 'triangle', 0.2);
            playTone(783.99, now + 0.32, 0.35, 'triangle', 0.22);
        } else if (type === 'test') {
            playTone(659.25, now, 0.12, 'sine', 0.15);
            playTone(880, now + 0.12, 0.18, 'sine', 0.15);
        } else {
            // 'notification' — нова задача або нагадування перед закриттям
            playTone(587.33, now, 0.15, 'sine', 0.18);
            playTone(880.0, now + 0.16, 0.25, 'sine', 0.2);
        }
    } catch (e) {
        console.warn("Audio alert error:", e);
    }
}

function renderSoundToggleBtn() {
    const btn = document.getElementById('termSoundToggleBtn');
    if (!btn) return;
    if (terminalState.soundEnabled) {
        btn.className = "px-2.5 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-xs font-bold hover:bg-emerald-100 dark:hover:bg-emerald-900/60 transition-colors border border-emerald-200/70 dark:border-emerald-800/50 flex items-center gap-1";
        btn.innerHTML = `<span>🔔</span><span class="hidden sm:inline">Звук</span>`;
    } else {
        btn.className = "px-2.5 py-1.5 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 text-xs font-bold hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors flex items-center gap-1";
        btn.innerHTML = `<span>🔕</span><span class="hidden sm:inline line-through">Звук</span>`;
    }
}

window.toggleTerminalSound = function () {
    triggerHaptic();
    terminalState.soundEnabled = !terminalState.soundEnabled;
    localStorage.setItem('shifter_terminal_sound', terminalState.soundEnabled ? 'on' : 'off');
    renderSoundToggleBtn();
    if (terminalState.soundEnabled) {
        playTerminalSound('test');
        showToast("Звукові сповіщення увімкнено 🔔", "success");
    } else {
        showToast("Звукові сповіщення вимкнено 🔕", "info");
    }
};

// Міжвкладкова / міжтермінальна синхронізація в межах браузера
let terminalSyncChannel = null;
try {
    if ('BroadcastChannel' in window) {
        terminalSyncChannel = new BroadcastChannel('shifter_terminal_sync');
        terminalSyncChannel.onmessage = (event) => {
            const data = event.data;
            if (!data || data.storeId !== terminalState.store?._id) return;

            if (data.type === 'checklist_update') {
                if (!terminalState.checklistsProgress) terminalState.checklistsProgress = {};
                terminalState.checklistsProgress[data.checklistType] = data.items;
                renderChecklists(terminalState.store);
            } else if (data.type === 'stock_update') {
                terminalState.latestStockToday = data.stock;
                renderStockTodayStatus(data.stock);
            } else if (data.type === 'cash_update') {
                terminalState.latestCashToday = data.cash;
                renderCashTodayStatus(data.cash);
            }
        };
    }
} catch (e) {
    console.warn("BroadcastChannel error:", e);
}

// 1. Ініціалізація або перевірка терміналу
export async function initTerminal() {
    startLiveClock();
    renderSoundToggleBtn();

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

    const isSilent = Boolean(terminalState.store && (terminalState.store._id === targetStoreId || terminalState.store.code === savedStoreCode));
    await loadTerminalData(targetStoreId, savedStoreCode, isSilent);

    // Запускаємо фонове автооновлення кожні 20 секунд для міжтермінальної синхронізації
    if (terminalState.pollingInterval) clearInterval(terminalState.pollingInterval);
    terminalState.pollingInterval = setInterval(() => {
        if (terminalState.store?._id) {
            loadTerminalData(terminalState.store._id, null, true);
        }
    }, 20000);

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
            checkClosingReminders();
        }
    };
    update();
    terminalState.clockInterval = setInterval(update, 1000);
}

let isTerminalLoading = false;

// 3. Завантаження даних терміналу
export async function loadTerminalData(storeId, storeCode, isSilent = false) {
    if (isTerminalLoading) return;
    isTerminalLoading = true;
    try {
        let url = `/api/terminal/data`;
        if (storeId) url += `?storeId=${storeId}`;
        else if (storeCode) url += `?code=${storeCode}`;

        const res = await fetchJson(url);
        if (res && res.success) {
            const isInitialConnection = !terminalState.store || terminalState.store._id !== res.store._id;
            if (isInitialConnection) {
                terminalState.tasksInitialized = false;
                terminalState.knownTaskIds = new Set();
                terminalState.prevAlarmIsAlert = null;
                terminalState.checklistManualTab = null;
            }

            terminalState.store = res.store;
            terminalState.terminalData = res;
            terminalState.todayShifts = res.todayShifts || [];
            terminalState.employees = res.employees || [];
            terminalState.checklistsProgress = res.checklistsProgress || { morning: {}, evening: {} };
            terminalState.latestCashToday = res.latestCashToday || null;
            terminalState.latestStockToday = res.latestStockToday || null;
            terminalState.previousStockCount = res.previousStockCount || null;

            localStorage.setItem('shifter_terminal_storeId', res.store._id);
            localStorage.setItem('shifter_terminal_storeCode', res.store.code);

            // Перевірка на появу нових задач для звукового сповіщення
            const incomingTasks = res.tasks || [];
            if (!terminalState.tasksInitialized) {
                incomingTasks.forEach(t => terminalState.knownTaskIds.add(String(t._id)));
                terminalState.tasksInitialized = true;
            } else {
                const newActiveTasks = incomingTasks.filter(t => !terminalState.knownTaskIds.has(String(t._id)) && t.status !== 'completed' && !t.done);
                incomingTasks.forEach(t => terminalState.knownTaskIds.add(String(t._id)));
                if (newActiveTasks.length > 0) {
                    playTerminalSound('notification');
                    const newTaskTitle = newActiveTasks[0].title || newActiveTasks[0].text || 'Перевірте список задач';
                    showToast(`📌 Нова задача: ${newTaskTitle}`, 'info');
                }
            }

            renderHeader(res.store);
            renderActiveShifts(res.todayShifts, res.employees);
            renderTomorrowOpener(res.tomorrowOpener);
            renderEmergencyContacts(res.store.emergencyContacts);
            renderTasks(res.tasks);
            renderChecklists(res.store);
            renderStockTodayStatus(res.latestStockToday);
            renderPreviousStockCount(terminalState.previousStockCount);
            renderCashTodayStatus(res.latestCashToday);
            loadAlarmStatus(res.store._id);
            populateAuthorSelects(res.employees);

            if (!document.getElementById('termDenominationsRows')?.dataset.initialized) {
                initCashCalculator();
            } else if (isInitialConnection) {
                loadCashDraft();
            }

            checkClosingReminders();

            hideTerminalLoginModal();
            if (!isSilent && isInitialConnection) showToast(`Термінал: ${res.store.name} підключено`, 'success');
        } else {
            showTerminalLoginModal();
        }
    } catch (e) {
        console.error("loadTerminalData error:", e);
        if (!isSilent) showTerminalLoginModal();
    } finally {
        isTerminalLoading = false;
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

    const activeTasks = (tasks || []).filter(t => t.status !== 'completed' && !t.done);
    if (badgeEl) badgeEl.innerText = activeTasks.length;

    if (!tasks || tasks.length === 0) {
        listEl.innerHTML = `<div class="text-center text-xs text-gray-400 py-4">Немає задач на сьогодні</div>`;
        return;
    }

    listEl.innerHTML = tasks.map(t => {
        const isDone = t.status === 'completed' || Boolean(t.done);
        const taskTitle = t.title || t.text || 'Задача';
        const opacity = isDone ? 'opacity-40 line-through' : '';

        let timeBadge = '';
        if (t.start && t.end && !t.isFullDay) {
            timeBadge = `<span class="text-[9px] text-gray-400 font-mono">${t.start}-${t.end}</span>`;
        } else if (t.deadline) {
            let timeStr = '';
            try {
                const dt = new Date(t.deadline);
                if (!isNaN(dt.getTime())) {
                    timeStr = dt.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kiev' });
                }
            } catch (e) { }
            if (!timeStr) {
                const part = t.deadline.includes('T') ? t.deadline.split('T')[1] : t.deadline.split(' ')[1];
                timeStr = part ? part.slice(0, 5) : t.deadline;
            }
            if (timeStr) timeBadge = `<span class="text-[9px] text-purple-600 dark:text-purple-400 font-mono">до ${timeStr}</span>`;
        }

        let subBadge = '';
        if (t.subtasks && t.subtasks.length > 0) {
            const completedCount = t.subtasks.filter(s => s.completed).length;
            subBadge = `<span class="text-[9px] px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-mono font-medium" title="Підзадачі">📋 ${completedCount}/${t.subtasks.length}</span>`;
        }

        const hasDesc = t.description && t.description.trim();
        const descBadge = hasDesc ? `<span class="text-[10px] text-gray-400" title="Є опис задачі">📄</span>` : '';

        return `
            <div onclick="window.openTaskProxy('${t._id}')" title="Натисніть для перегляду деталей" class="p-2 rounded-xl bg-gray-50 dark:bg-[#2C2C2E] border border-gray-200/70 dark:border-gray-800 flex items-center justify-between gap-2 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700/50 active:scale-[0.99] transition-all ${opacity}">
                <div class="flex items-center gap-2 overflow-hidden flex-1">
                    <button type="button" onclick="event.stopPropagation(); window.toggleTermTask('${t._id}', ${!isDone})" title="${isDone ? 'Повернути в роботу' : 'Позначити як виконану'}" class="w-5 h-5 rounded-md border flex items-center justify-center text-xs shrink-0 active:scale-90 transition-transform ${isDone ? 'bg-green-500 border-green-500 text-white' : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-[#1C1C1E]'}">
                        ${isDone ? '✓' : ''}
                    </button>
                    <span class="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">${taskTitle}</span>
                </div>
                <div class="flex items-center gap-1.5 shrink-0">
                    ${descBadge}
                    ${subBadge}
                    ${timeBadge}
                    ${t.name ? `<span class="text-[9px] px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700 font-bold">${t.name}</span>` : ''}
                </div>
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
            const modal = document.getElementById('taskDetailsModal');
            if (modal && !modal.classList.contains('hidden')) {
                window.openTaskProxy(taskId);
            }
        }
    } catch(e) {
        showToast('Помилка оновлення задачі', 'error');
    }
};

window.getTerminalTask = function(id) {
    return terminalState.terminalData?.tasks?.find(t => t._id === id || String(t._id) === String(id));
};

window.reloadTerminalTasks = function() {
    if (terminalState.store?._id) {
        loadTerminalData(terminalState.store._id, null, true);
    }
};

// 9. Чек-лісти відкриття та закриття (авто за часом + ручний перемикач Ранок / Вечір)
function getStoreChecklistItems(store, type) {
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

    if (type === 'morning') {
        if (store?.checklists?.morning && store.checklists.morning.length > 0) {
            return store.checklists.morning.map((text, idx) => ({ id: `m_${idx}`, text }));
        }
        return defaultMorning;
    } else {
        if (store?.checklists?.evening && store.checklists.evening.length > 0) {
            return store.checklists.evening.map((text, idx) => ({ id: `e_${idx}`, text }));
        }
        return defaultEvening;
    }
}

function getStoreChecklistProgress(store, type) {
    if (!store) return {};
    const todayStr = new Date().toISOString().split('T')[0];
    const savedKey = `shifter_checklist_${store._id}_${todayStr}_${type}`;
    let prog = (terminalState.checklistsProgress && terminalState.checklistsProgress[type]) || null;
    if (!prog || Object.keys(prog).length === 0) {
        try {
            prog = JSON.parse(localStorage.getItem(savedKey) || '{}');
        } catch (e) {
            prog = {};
        }
    }
    return prog || {};
}

window.switchTermChecklistTab = function (tab) {
    triggerHaptic();
    terminalState.checklistManualTab = tab;
    if (terminalState.store) {
        renderChecklists(terminalState.store);
    }
};

function renderChecklists(store) {
    const titleEl = document.getElementById('termChecklistTitle');
    const badgeEl = document.getElementById('termChecklistBadge');
    const container = document.getElementById('termChecklistItems');
    const tabMorningBtn = document.getElementById('termChecklistTabMorning');
    const tabEveningBtn = document.getElementById('termChecklistTabEvening');
    if (!container || !store) return;

    const now = new Date();
    const currentHour = now.getHours();

    // Якщо користувач перемкнув вручну — використовуємо вибір, інакше до 14:00 — Ранок, після 14:00 — Вечір
    const isMorning = terminalState.checklistManualTab
        ? (terminalState.checklistManualTab === 'morning')
        : (currentHour < 14);
    const checklistType = isMorning ? 'morning' : 'evening';

    if (titleEl) {
        titleEl.innerHTML = isMorning ? `<span>🌅</span> РАНКОВИЙ ЧЕК-ЛІСТ` : `<span>🌙</span> ВЕЧІРНІЙ ЧЕК-ЛІСТ`;
    }

    const morningItems = getStoreChecklistItems(store, 'morning');
    const eveningItems = getStoreChecklistItems(store, 'evening');
    const morningProg = getStoreChecklistProgress(store, 'morning');
    const eveningProg = getStoreChecklistProgress(store, 'evening');

    const morningDoneCount = morningItems.filter(i => Boolean(morningProg[i.id])).length;
    const eveningDoneCount = eveningItems.filter(i => Boolean(eveningProg[i.id])).length;

    // Оновлюємо кнопки перемикача Ранок / Вечір
    if (tabMorningBtn) {
        tabMorningBtn.innerText = `🌅 Ранок (${morningDoneCount}/${morningItems.length})`;
        tabMorningBtn.className = isMorning
            ? "px-2 py-0.5 text-[10px] font-extrabold rounded-md transition-all bg-white dark:bg-[#1C1C1E] text-blue-600 dark:text-blue-400 shadow-2xs"
            : "px-2 py-0.5 text-[10px] font-extrabold rounded-md transition-all text-gray-500 hover:text-gray-800 dark:hover:text-gray-200";
    }
    if (tabEveningBtn) {
        tabEveningBtn.innerText = `🌙 Вечір (${eveningDoneCount}/${eveningItems.length})`;
        tabEveningBtn.className = !isMorning
            ? "px-2 py-0.5 text-[10px] font-extrabold rounded-md transition-all bg-white dark:bg-[#1C1C1E] text-indigo-600 dark:text-indigo-400 shadow-2xs"
            : "px-2 py-0.5 text-[10px] font-extrabold rounded-md transition-all text-gray-500 hover:text-gray-800 dark:hover:text-gray-200";
    }

    const items = isMorning ? morningItems : eveningItems;
    const activeProgress = isMorning ? morningProg : eveningProg;
    terminalState.checklistState = activeProgress;

    // Підрахунок прогресу виконання
    const totalItems = items.length;
    const completedItems = isMorning ? morningDoneCount : eveningDoneCount;
    const isAllCompleted = totalItems > 0 && completedItems === totalItems;

    if (badgeEl) {
        if (isAllCompleted) {
            badgeEl.className = "text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300";
            badgeEl.innerText = `Завершено ✅ (${completedItems}/${totalItems})`;
        } else if (completedItems > 0) {
            badgeEl.className = "text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300";
            badgeEl.innerText = `Виконано ${completedItems}/${totalItems}`;
        } else {
            badgeEl.className = "text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300";
            badgeEl.innerText = isMorning ? 'Відкриття' : 'Закриття';
        }
    }

    container.innerHTML = items.map(item => {
        const record = activeProgress[item.id];
        const isChecked = Boolean(record);
        // Не пишемо, хто заповнює — показуємо лише позначку часу виконання
        const timeText = record && record.time
            ? `<span class="text-[9px] text-green-600 dark:text-green-400 font-mono font-medium ml-1">✓ ${record.time}</span>`
            : '';

        return `
            <div onclick="window.toggleChecklistItem('${item.id}', '${checklistType}')" class="p-2 rounded-xl bg-gray-50 dark:bg-[#2C2C2E] border border-gray-100 dark:border-gray-800 flex items-center justify-between cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors select-none">
                <div class="flex items-center gap-2 overflow-hidden">
                    <div class="w-4 h-4 rounded-md border flex items-center justify-center text-[10px] ${isChecked ? 'bg-green-500 border-green-500 text-white font-bold' : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-[#1C1C1E]'}">
                        ${isChecked ? '✓' : ''}
                    </div>
                    <span class="text-xs ${isChecked ? 'line-through text-gray-400' : 'text-gray-800 dark:text-gray-200 font-medium'} truncate">${item.text}</span>
                </div>
                ${timeText}
            </div>
        `;
    }).join('');

    checkClosingReminders();
}

// 9.1 Моніторинг та рендеринг повітряної тривоги
async function loadAlarmStatus(storeId) {
    if (!storeId) return;
    try {
        const res = await fetchJson(`/api/terminal/alarm/status?storeId=${storeId}`);
        if (!res || !res.success) return;

        const currentIsAlert = Boolean(res.isAlert);
        if (terminalState.prevAlarmIsAlert !== null && terminalState.prevAlarmIsAlert !== currentIsAlert) {
            playTerminalSound(currentIsAlert ? 'alarm_start' : 'alarm_end');
            showToast(
                currentIsAlert ? '🚨 УВАГА! Оголошено повітряну тривогу!' : '🟢 Відбій повітряної тривоги!',
                currentIsAlert ? 'error' : 'success'
            );
        }
        terminalState.prevAlarmIsAlert = currentIsAlert;

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

let selectedReopenName = '';

window.openReopenStoreModal = function () {
    triggerHaptic();
    if (!terminalState.store?._id) {
        showToast("Магазин не ініціалізовано", "warning");
        return;
    }

    const modal = document.getElementById('termReopenModal');
    if (!modal) return;

    // Встановлюємо живий час
    const now = new Date();
    const timeStr = now.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kiev' });
    const liveTimeEl = document.getElementById('termReopenLiveTime');
    if (liveTimeEl) liveTimeEl.innerText = timeStr;

    // Відображаємо тривалість тривоги та розрахунки
    const statsRow = document.getElementById('termReopenStatsRow');
    if (statsRow) {
        const lastEv = terminalState.alarmStatus?.lastEvent;
        if (lastEv && (lastEv.status === 'ended_waiting_reopen' || lastEv.status === 'active')) {
            const alertMins = lastEv.alertDurationMinutes || 0;
            const endD = lastEv.endedAt ? new Date(lastEv.endedAt) : now;
            const reopenMins = Math.max(0, Math.round((now - endD) / 60000));
            const totalDowntime = alertMins + reopenMins;

            statsRow.innerHTML = `
                <div class="flex justify-between py-0.5">
                    <span>⏱️ Тривалість тривоги:</span>
                    <span class="font-bold font-mono text-gray-900 dark:text-gray-100">${alertMins > 0 ? `${alertMins} хв` : '0 хв'}</span>
                </div>
                <div class="flex justify-between py-0.5">
                    <span>⏳ Час на відкриття:</span>
                    <span class="font-bold font-mono text-gray-900 dark:text-gray-100">~${reopenMins} хв</span>
                </div>
                <div class="flex justify-between font-black text-gray-900 dark:text-white pt-1 mt-0.5 border-t border-emerald-200/40 dark:border-emerald-800/40">
                    <span>🚫 Загальний неробочий час ТТ:</span>
                    <span class="font-mono text-emerald-600 dark:text-emerald-400">~${totalDowntime} хв</span>
                </div>
            `;
        } else {
            statsRow.innerHTML = `
                <div class="text-[11px] text-gray-500 py-1">
                    Фіксація відновлення/відкриття магазину та відправка звіту в Telegram канал ТТ.
                </div>
            `;
        }
    }

    // Очищаємо інпут кастомного імені
    const customInput = document.getElementById('termReopenCustomName');
    if (customInput) customInput.value = '';

    // Формуємо список співробітників
    const listEl = document.getElementById('termReopenEmployeeList');
    if (listEl) {
        const shifts = terminalState.terminalData?.todayShifts || [];
        const allEmployees = terminalState.employees || [];

        // Об'єднуємо унікальних кандидатів
        const candidates = [];
        const seen = new Set();

        // 1. Спочатку ті, хто за графіком сьогодні
        for (const s of shifts) {
            if (s.name && !seen.has(s.name)) {
                seen.add(s.name);
                const emp = allEmployees.find(e => e.name === s.name);
                candidates.push({
                    name: s.name,
                    fullName: emp?.fullName || s.name,
                    onShift: true,
                    shiftLabel: s.start && s.end ? `${s.start} - ${s.end}` : 'Сьогодні на зміні'
                });
            }
        }

        // 2. Решта співробітників магазину
        for (const e of allEmployees) {
            if (e.name && !seen.has(e.name)) {
                seen.add(e.name);
                candidates.push({
                    name: e.name,
                    fullName: e.fullName || e.name,
                    onShift: false,
                    shiftLabel: 'Команда магазину'
                });
            }
        }

        // За замовчуванням НЕ обираємо нікого, щоб співробітник обов'язково клікнув своє ім'я
        selectedReopenName = '';

        if (candidates.length === 0) {
            listEl.innerHTML = `
                <div class="p-3 text-center text-xs text-gray-400 bg-gray-50 dark:bg-[#2C2C2E] rounded-xl border border-gray-200 dark:border-gray-700">
                    Співробітників не знайдено. Введіть ваше ім'я нижче:
                </div>
            `;
        } else {
            listEl.innerHTML = candidates.map((c) => {
                const targetName = c.fullName || c.name;
                const isSelected = false;
                const initials = targetName.split(' ').map(p => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
                return `
                    <button type="button" onclick="window.selectReopenEmployee('${targetName}')"
                        data-reopen-name="${targetName}"
                        class="reopen-emp-item w-full p-2.5 rounded-xl border text-left flex items-center justify-between transition-all active:scale-[0.99] bg-gray-50/70 dark:bg-[#2C2C2E]/60 border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600">
                        <div class="flex items-center gap-2.5">
                            <div class="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 font-bold text-xs flex items-center justify-center flex-shrink-0">
                                ${initials || '👤'}
                            </div>
                            <div>
                                <div class="text-xs font-bold text-gray-900 dark:text-white leading-tight">
                                    ${targetName}
                                </div>
                                <div class="text-[10px] text-gray-500 dark:text-gray-400">
                                    ${c.onShift ? '🟢 ' : ''}${c.shiftLabel}
                                </div>
                            </div>
                        </div>
                        <div class="reopen-check text-emerald-600 dark:text-emerald-400 font-black text-sm hidden">
                            ✓
                        </div>
                    </button>
                `;
            }).join('');
        }
    }

    updateReopenSubmitButton();
    modal.classList.remove('hidden');
};

window.closeReopenStoreModal = function () {
    const modal = document.getElementById('termReopenModal');
    if (modal) modal.classList.add('hidden');
};

window.selectReopenEmployee = function (name) {
    triggerHaptic();
    selectedReopenName = name;

    const customInput = document.getElementById('termReopenCustomName');
    if (customInput) customInput.value = '';

    // Оновлюємо класи підсвітки
    const items = document.querySelectorAll('.reopen-emp-item');
    items.forEach(el => {
        const isMatch = el.dataset.reopenName === name;
        if (isMatch) {
            el.className = 'reopen-emp-item w-full p-2.5 rounded-xl border text-left flex items-center justify-between transition-all active:scale-[0.99] bg-emerald-50 dark:bg-emerald-950/40 border-emerald-500 shadow-sm ring-2 ring-emerald-500';
            el.querySelector('.reopen-check')?.classList.remove('hidden');
            const avatar = el.querySelector('div > div:first-child');
            if (avatar) avatar.className = 'w-8 h-8 rounded-full bg-emerald-500 text-white font-bold text-xs flex items-center justify-center flex-shrink-0';
        } else {
            el.className = 'reopen-emp-item w-full p-2.5 rounded-xl border text-left flex items-center justify-between transition-all active:scale-[0.99] bg-gray-50/70 dark:bg-[#2C2C2E]/60 border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600';
            el.querySelector('.reopen-check')?.classList.add('hidden');
            const avatar = el.querySelector('div > div:first-child');
            if (avatar) avatar.className = 'w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 font-bold text-xs flex items-center justify-center flex-shrink-0';
        }
    });

    updateReopenSubmitButton();
};

window.onReopenCustomNameInput = function (val) {
    selectedReopenName = (val && val.trim()) ? val.trim() : '';
    // Знімаємо виділення зі списку
    const items = document.querySelectorAll('.reopen-emp-item');
    items.forEach(el => {
        el.className = 'reopen-emp-item w-full p-2.5 rounded-xl border text-left flex items-center justify-between transition-all active:scale-[0.99] bg-gray-50/70 dark:bg-[#2C2C2E]/60 border-gray-200 dark:border-gray-700';
        el.querySelector('.reopen-check')?.classList.add('hidden');
        const avatar = el.querySelector('div > div:first-child');
        if (avatar) avatar.className = 'w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 font-bold text-xs flex items-center justify-center flex-shrink-0';
    });
    updateReopenSubmitButton();
};

function updateReopenSubmitButton() {
    const btn = document.getElementById('termReopenSubmitBtn');
    const btnText = document.getElementById('termReopenSubmitBtnText');
    if (!btn || !btnText) return;

    if (selectedReopenName) {
        btnText.innerText = `Відкрити: ${selectedReopenName}`;
        btn.disabled = false;
        btn.classList.remove('opacity-50', 'cursor-not-allowed');
    } else {
        btnText.innerText = `👤 Оберіть себе зі списку`;
        btn.disabled = true;
        btn.classList.add('opacity-50', 'cursor-not-allowed');
    }
}

window.submitStoreReopen = async function () {
    triggerHaptic();
    if (!terminalState.store?._id) return;

    const customName = document.getElementById('termReopenCustomName')?.value?.trim();
    const openedBy = selectedReopenName || customName;

    if (!openedBy) {
        showToast("Будь ласка, оберіть своє ім'я зі списку або введіть його!", "warning");
        return;
    }

    const btn = document.getElementById('termReopenSubmitBtn');
    const oldHtml = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span>⏳</span> <span>Відправка...</span>';
    }

    try {
        const res = await postJson('/api/terminal/alarm/reopen', {
            storeId: terminalState.store._id,
            openedBy
        });

        if (res && res.success) {
            showToast(res.message || "Відкриття успішно надіслано в Telegram! ✅", 'success');
            window.closeReopenStoreModal();
            await loadAlarmStatus(terminalState.store._id);
        } else {
            showToast(res?.message || "Помилка відправки", 'error');
        }
    } catch (e) {
        console.error("submitStoreReopen error:", e);
        showToast("Помилка зв'язку", 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = oldHtml;
        }
    }
};

window.confirmStoreReopen = function () {
    window.openReopenStoreModal();
};

// 10. Позначення чек-ліста з міжтермінальною синхронізацією
window.toggleChecklistItem = async function (itemId, checklistType) {
    triggerHaptic();
    const store = terminalState.store;
    if (!store) return;

    if (!terminalState.checklistsProgress) terminalState.checklistsProgress = { morning: {}, evening: {} };
    if (!terminalState.checklistsProgress[checklistType]) terminalState.checklistsProgress[checklistType] = {};

    const activeProgress = terminalState.checklistsProgress[checklistType];
    const willBeChecked = !activeProgress[itemId];
    const timeStr = new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });

    // Оптимістичне локальне оновлення
    if (willBeChecked) {
        activeProgress[itemId] = { checked: true, time: timeStr };
        showToast("Пункт чек-ліста виконано", "success");
    } else {
        delete activeProgress[itemId];
        showToast("Пункт відновлено", "info");
    }

    // Резервне збереження в localStorage
    const todayStr = new Date().toISOString().split('T')[0];
    const savedKey = `shifter_checklist_${store._id}_${todayStr}_${checklistType}`;
    try {
        localStorage.setItem(savedKey, JSON.stringify(activeProgress));
    } catch (e) { }

    renderChecklists(store);

    // Миттєва синхронізація через BroadcastChannel (між сусідніми вкладками/вікнами)
    try {
        if (terminalSyncChannel) {
            terminalSyncChannel.postMessage({
                type: 'checklist_update',
                storeId: store._id,
                checklistType,
                items: activeProgress
            });
        }
    } catch (e) { }

    // Збереження в базі даних для синхронізації між різними пристроями/терміналами
    try {
        const res = await postJson('/api/terminal/checklist/toggle', {
            storeId: store._id,
            type: checklistType,
            itemId,
            checked: willBeChecked
        });
        if (res && res.success && res.items) {
            terminalState.checklistsProgress[checklistType] = res.items;
            localStorage.setItem(savedKey, JSON.stringify(res.items));
            renderChecklists(store);
        }
    } catch (err) {
        console.warn("Помилка відправки статусу чек-ліста:", err);
    }
};

// Відображення сьогоднішнього статусу складу
function renderStockTodayStatus(item) {
    const el = document.getElementById('termStockTodayStatus');
    if (!el) return;
    if (item && item.time) {
        el.innerHTML = `<span>✅ Склад уже перераховано о <b>${item.time}</b> (${item.countedBy})</span><button type="button" onclick="window.openStockHistoryModal()" class="text-blue-600 dark:text-blue-400 font-bold hover:underline">Деталі</button>`;
        el.classList.remove('hidden');
    } else {
        el.classList.add('hidden');
    }
    checkClosingReminders();
}

// Показ попереднього (вчорашнього) перерахунку складу поруч та підстановка в 1 клік
function renderPreviousStockCount(prev) {
    const box = document.getElementById('termStockPrevBox');
    const headerEl = document.getElementById('termStockPrevHeader');
    const contentEl = document.getElementById('termStockPrevContent');
    const iconEl = document.getElementById('termStockPrevToggleIcon');
    if (!box || !headerEl || !contentEl) return;

    if (!prev || !prev.content) {
        box.classList.add('hidden');
        return;
    }

    box.classList.remove('hidden');
    headerEl.innerText = `Минулий перерахунок (${prev.date || 'раніше'} о ${prev.time || '--:--'} • ${prev.countedBy || 'СЕ'})`;
    contentEl.innerText = prev.content;

    if (terminalState.isPrevStockExpanded) {
        contentEl.classList.remove('hidden');
        if (iconEl) iconEl.innerText = '▼';
    } else {
        contentEl.classList.add('hidden');
        if (iconEl) iconEl.innerText = '▶';
    }
}

window.togglePrevStockPreview = function () {
    triggerHaptic();
    terminalState.isPrevStockExpanded = !terminalState.isPrevStockExpanded;
    renderPreviousStockCount(terminalState.previousStockCount);
};

window.copyPreviousStockToInput = function () {
    triggerHaptic();
    const prev = terminalState.previousStockCount;
    if (!prev || !prev.content) return;

    const textEl = document.getElementById('termStockText');
    if (!textEl) return;

    if (textEl.value.trim() && textEl.value.trim() !== prev.content.trim()) {
        if (!confirm("Замінити поточний текст у полі на шаблон минулого перерахунку?")) return;
    }

    textEl.value = prev.content;
    textEl.focus();
    showToast("Шаблон минулого перерахунку підставлено! Оновіть цифри 📋", "success");
};

// Відображення сьогоднішнього статусу каси
function renderCashTodayStatus(item) {
    const el = document.getElementById('termCashTodayStatus');
    if (!el) return;
    if (item && item.time) {
        const typeName = item.type === 'encashment' ? 'Інкасація' : 'Каса';
        el.innerHTML = `<span>✅ Сьогодні: <b>${typeName} о ${item.time}</b> (${item.countedBy})</span><span class="font-bold text-blue-600 dark:text-blue-400">${item.totalCounted.toLocaleString('uk-UA')} грн</span>`;
        el.classList.remove('hidden');
    } else {
        el.classList.add('hidden');
    }
    checkClosingReminders();
}

// Розумне нагадування перед закриттям магазину (за 45 хв до closeTime)
function checkClosingReminders() {
    const store = terminalState.store;
    if (!store) return;

    const bannerEl = document.getElementById('termClosingReminderBanner');
    const titleEl = document.getElementById('termClosingReminderTitle');
    const badgesEl = document.getElementById('termClosingReminderBadges');

    const closeTimeStr = store.closeTime || '22:00';
    if (!closeTimeStr.includes(':')) return;

    const kievTimeStr = new Date().toLocaleTimeString('uk-UA', { timeZone: 'Europe/Kiev', hour: '2-digit', minute: '2-digit', hour12: false });
    const [nowH, nowM] = kievTimeStr.split(':').map(Number);
    const [closeH, closeM] = closeTimeStr.split(':').map(Number);

    const nowMinutes = nowH * 60 + nowM;
    const closeMinutes = closeH * 60 + closeM;
    const minsUntilClose = closeMinutes - nowMinutes;

    // Вікно нагадування: за 45 хвилин до закриття і до 15 хвилин після закриття
    const isClosingWindow = minsUntilClose <= 45 && minsUntilClose >= -15;

    // Перевіряємо виконання 3 обов'язкових вечірніх пунктів
    const eveningItems = getStoreChecklistItems(store, 'evening');
    const eveningProg = getStoreChecklistProgress(store, 'evening');
    const isEveningChecklistDone = eveningItems.length > 0 && eveningItems.every(i => Boolean(eveningProg[i.id]));
    const isCashDone = Boolean(terminalState.latestCashToday && terminalState.latestCashToday.time);
    const isStockDone = Boolean(terminalState.latestStockToday && terminalState.latestStockToday.time);

    const setCardHighlight = (cardId, badgeId, shouldHighlight) => {
        const card = document.getElementById(cardId);
        const badge = document.getElementById(badgeId);
        if (card) {
            if (shouldHighlight) {
                card.classList.add('ring-2', 'ring-amber-400', 'dark:ring-amber-500');
            } else {
                card.classList.remove('ring-2', 'ring-amber-400', 'dark:ring-amber-500');
            }
        }
        if (badge) {
            badge.classList.toggle('hidden', !shouldHighlight);
        }
    };

    setCardHighlight('termCashCard', 'termCashClosingBadge', isClosingWindow && !isCashDone);
    setCardHighlight('termStockCard', 'termStockClosingBadge', isClosingWindow && !isStockDone);
    setCardHighlight('termChecklistCard', 'termChecklistClosingBadge', isClosingWindow && !isEveningChecklistDone);

    if (!bannerEl || !titleEl || !badgesEl) return;

    const missing = [];
    if (!isCashDone) missing.push({ key: 'cash', label: '💵 Каса не здана' });
    if (!isStockDone) missing.push({ key: 'stock', label: '📦 Склад не перераховано' });
    if (!isEveningChecklistDone) {
        const doneCount = eveningItems.filter(i => Boolean(eveningProg[i.id])).length;
        missing.push({ key: 'checklist', label: `🌙 Вечірній чек-ліст (${doneCount}/${eveningItems.length})` });
    }

    if (isClosingWindow && missing.length > 0) {
        bannerEl.classList.remove('hidden');
        if (minsUntilClose > 0) {
            titleEl.innerText = `⏰ До закриття зміни (${closeTimeStr}) залишилось ${minsUntilClose} хв! Не забудьте виконати:`;
        } else {
            titleEl.innerText = `⏰ Час закриття зміни (${closeTimeStr}) настав! Залишилось виконати:`;
        }

        badgesEl.innerHTML = missing.map(m => `
            <button type="button" onclick="window.focusClosingCard('${m.key}')" class="px-2.5 py-1 rounded-lg bg-white dark:bg-[#1C1C1E] border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-200 text-[11px] font-extrabold shadow-2xs hover:bg-amber-100 dark:hover:bg-amber-900/50 active:scale-95 transition-all">
                ${m.label} →
            </button>
        `).join('');

        // Одноразовий звуковий сигнал за 30 хв до закриття
        if (minsUntilClose <= 30 && minsUntilClose >= 0) {
            const todayKey = new Date().toISOString().split('T')[0];
            if (terminalState.closingSoundPlayedDate !== todayKey) {
                terminalState.closingSoundPlayedDate = todayKey;
                playTerminalSound('notification');
            }
        }
    } else {
        bannerEl.classList.add('hidden');
    }
}

window.focusClosingCard = function (target) {
    triggerHaptic();
    if (target === 'checklist') {
        window.switchTermChecklistTab('evening');
        document.getElementById('termChecklistCard')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if (target === 'stock') {
        document.getElementById('termStockCard')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        document.getElementById('termStockText')?.focus();
    } else if (target === 'cash') {
        document.getElementById('termCashCard')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
};

// 11. Заповнення селектів авторів (список активних на зміні) із збереженням обраного значення
function populateAuthorSelects(employees) {
    const cashSelect = document.getElementById('termCashAuthorSelect');
    const stockSelect = document.getElementById('termStockAuthorSelect');

    const prevCashAuthor = cashSelect?.value || '';
    const prevStockAuthor = stockSelect?.value || '';

    const shifts = terminalState.terminalData?.todayShifts || [];
    const names = shifts.length > 0 ? shifts.map(s => s.name) : (employees || []).map(e => e.name);

    const optionsHtml = '<option value="">👤 Оберіть співробітника...</option>' +
        names.map(name => {
            const emp = employees ? employees.find(e => e.name === name) : null;
            const full = emp ? (emp.fullName || emp.name) : name;
            return `<option value="${name}">${full}</option>`;
        }).join('');

    if (cashSelect) {
        cashSelect.innerHTML = optionsHtml;
        if (prevCashAuthor && names.includes(prevCashAuthor)) cashSelect.value = prevCashAuthor;
    }
    if (stockSelect) {
        stockSelect.innerHTML = optionsHtml;
        if (prevStockAuthor && names.includes(prevStockAuthor)) stockSelect.value = prevStockAuthor;
    }
}

// ========================================================
// 12. ПОКУПЮРНИК (КАСА ТА ІНКАСАЦІЯ) + АВТОЗБЕРЕЖЕННЯ ЧЕРНЕТКИ
// ========================================================

function getCashDraftKey() {
    const storeId = terminalState.store?._id || localStorage.getItem('shifter_terminal_storeId') || 'default';
    return `shifter_cash_draft_${storeId}`;
}

function saveCashDraft() {
    try {
        const encashTarget = document.getElementById('termEncashTargetInput')?.value || '';
        const hasBills = Object.values(terminalState.denominationsCount || {}).some(c => Number(c) > 0);
        const hasExpected = (terminalState.expectedAmounts || []).some(r => Number(r.amount) > 0 || (r.label && r.label !== 'X-звіт за сьогодні')) || (terminalState.expectedAmounts || []).length > 1;
        const hasEncashTarget = Number(encashTarget) > 0;

        const hasDraftData = hasBills || hasExpected || hasEncashTarget;
        const draftBadge = document.getElementById('termCashDraftBadge');
        if (draftBadge) {
            draftBadge.classList.toggle('hidden', !hasDraftData);
        }

        if (hasDraftData) {
            const draft = {
                activeTab: terminalState.activeTab,
                denominationsCount: terminalState.denominationsCount,
                expectedAmounts: terminalState.expectedAmounts,
                nextExpectedId: terminalState.nextExpectedId,
                encashTarget,
                updatedAt: Date.now()
            };
            localStorage.setItem(getCashDraftKey(), JSON.stringify(draft));
        } else {
            localStorage.removeItem(getCashDraftKey());
        }
    } catch (e) {
        console.warn("saveCashDraft error:", e);
    }
}

function loadCashDraft() {
    try {
        const raw = localStorage.getItem(getCashDraftKey());
        const inputs = document.querySelectorAll('.cash-input');
        const encashInput = document.getElementById('termEncashTargetInput');
        const draftBadge = document.getElementById('termCashDraftBadge');

        if (!raw) {
            inputs.forEach(inp => inp.value = '');
            if (encashInput) encashInput.value = '';
            terminalState.denominationsCount = {};
            terminalState.expectedAmounts = [{ id: 1, label: 'X-звіт за сьогодні', amount: 0 }];
            terminalState.nextExpectedId = 2;
            if (draftBadge) draftBadge.classList.add('hidden');
            renderExpectedRows();
            calculateCashTotals();
            return;
        }

        const draft = JSON.parse(raw);
        terminalState.denominationsCount = draft.denominationsCount || {};
        inputs.forEach(inp => {
            const denom = Number(inp.dataset.denom);
            const cnt = Number(terminalState.denominationsCount[denom]) || 0;
            inp.value = cnt > 0 ? cnt : '';
        });

        if (Array.isArray(draft.expectedAmounts) && draft.expectedAmounts.length > 0) {
            terminalState.expectedAmounts = draft.expectedAmounts;
            const maxId = draft.expectedAmounts.reduce((m, r) => Math.max(m, Number(r.id) || 0), 1);
            terminalState.nextExpectedId = Math.max(Number(draft.nextExpectedId) || 2, maxId + 1);
        } else {
            terminalState.expectedAmounts = [{ id: 1, label: 'X-звіт за сьогодні', amount: 0 }];
            terminalState.nextExpectedId = 2;
        }

        if (encashInput) {
            encashInput.value = draft.encashTarget || '';
        }

        renderExpectedRows();

        if (draft.activeTab === 'encashment' || draft.activeTab === 'cash') {
            window.switchTermCashTab(draft.activeTab, true);
        } else {
            calculateCashTotals();
        }
    } catch (e) {
        console.warn("loadCashDraft error:", e);
    }
}

function clearCashDraft() {
    try {
        localStorage.removeItem(getCashDraftKey());
        const draftBadge = document.getElementById('termCashDraftBadge');
        if (draftBadge) draftBadge.classList.add('hidden');
    } catch (e) { }
}

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
                    onwheel="this.blur()"
                    class="cash-input no-spin w-full p-1 text-center font-bold font-mono bg-gray-50 dark:bg-[#2C2C2E] border border-gray-200 dark:border-gray-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-xs">
            </div>
            <div class="col-span-4 text-right font-mono font-bold text-gray-900 dark:text-gray-200" id="subtotal-${denom}">
                0 грн
            </div>
        </div>
    `).join('');

    loadCashDraft();
}

// Перемикання між вкладками «Каса» та «Інкасація»
window.switchTermCashTab = function (tab, silent = false) {
    if (!silent) triggerHaptic();
    terminalState.activeTab = tab;

    const cashBtn = document.getElementById('termTabCashBtn');
    const encashBtn = document.getElementById('termTabEncashBtn');
    const cashExpectedSec = document.getElementById('termCashExpectedSection');
    const encashExpectedSec = document.getElementById('termEncashExpectedSection');
    const submitBtn = document.getElementById('termSubmitCashBtn');
    const countedLabel = document.getElementById('termCountedLabel');
    const totalCountedText = document.getElementById('termTotalCountedText');

    if (tab === 'cash') {
        if (cashBtn) cashBtn.className = "flex-1 py-1.5 text-xs font-extrabold rounded-lg transition-all shadow-sm bg-white dark:bg-[#1C1C1E] text-blue-600 dark:text-blue-400";
        if (encashBtn) encashBtn.className = "flex-1 py-1.5 text-xs font-extrabold rounded-lg transition-all text-gray-500 hover:text-gray-900 dark:hover:text-white";
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
        if (encashBtn) encashBtn.className = "flex-1 py-1.5 text-xs font-extrabold rounded-lg transition-all shadow-sm bg-white dark:bg-[#1C1C1E] text-purple-600 dark:text-purple-400";
        if (cashBtn) cashBtn.className = "flex-1 py-1.5 text-xs font-extrabold rounded-lg transition-all text-gray-500 hover:text-gray-900 dark:hover:text-white";
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

// Зручний перехід між номіналами через Enter/Tab та блокування зміни кількості стрілочками
window.handleCashInputKey = function (e, currentDenom) {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        return;
    }
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

    // 1) Якщо це Каса — рахуємо очікувану суму та різницю за звітами
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
        // 2) Якщо це Інкасація — рахуємо прогрес від цільової суми до збору та виділяємо різницю
        const targetInput = document.getElementById('termEncashTargetInput');
        const target = parseFloat(targetInput?.value) || 0;

        const targetDisplay = document.getElementById('termEncashTargetDisplay');
        if (targetDisplay) targetDisplay.innerText = `${target.toLocaleString('uk-UA')} грн`;

        const countedDisplay = document.getElementById('termEncashCountedDisplay');
        if (countedDisplay) countedDisplay.innerText = `${totalCounted.toLocaleString('uk-UA')} грн`;

        const diffBox = document.getElementById('termEncashDiffBox');
        const diffLabel = document.getElementById('termEncashDiffLabel');
        const statusBadge = document.getElementById('termEncashStatusBadge');
        const progressBar = document.getElementById('termEncashProgressBar');

        if (target <= 0) {
            if (diffBox) {
                diffBox.className = "p-2.5 rounded-xl bg-gray-100 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 flex items-center justify-between transition-all";
            }
            if (diffLabel) {
                diffLabel.className = "text-xs font-extrabold text-gray-600 dark:text-gray-300";
                diffLabel.innerText = "Різниця:";
            }
            if (statusBadge) {
                statusBadge.className = "text-xs font-black text-gray-500 dark:text-gray-400";
                statusBadge.innerText = "Вкажіть суму для контролю";
            }
            if (progressBar) {
                progressBar.style.width = '0%';
                progressBar.className = "bg-gradient-to-r from-purple-500 to-indigo-500 h-full w-0 transition-all duration-300";
            }
        } else {
            const diff = totalCounted - target;
            const pct = Math.min(100, Math.round((totalCounted / target) * 100));
            if (progressBar) progressBar.style.width = `${pct}%`;

            if (diff === 0) {
                if (diffBox) {
                    diffBox.className = "p-2.5 rounded-xl bg-emerald-100/90 dark:bg-emerald-950/60 border-2 border-emerald-400 dark:border-emerald-700 flex items-center justify-between shadow-sm transition-all";
                }
                if (diffLabel) {
                    diffLabel.className = "text-xs font-black text-emerald-800 dark:text-emerald-300";
                    diffLabel.innerText = "✅ Зійшлося точно:";
                }
                if (statusBadge) {
                    statusBadge.className = "text-sm font-black font-mono text-emerald-700 dark:text-emerald-300";
                    statusBadge.innerText = "0 грн (100%)";
                }
                if (progressBar) {
                    progressBar.className = "bg-gradient-to-r from-emerald-500 to-green-500 h-full transition-all duration-300";
                }
            } else if (diff < 0) {
                if (diffBox) {
                    diffBox.className = "p-2.5 rounded-xl bg-amber-100/90 dark:bg-amber-950/60 border-2 border-amber-400 dark:border-amber-700 flex items-center justify-between shadow-sm transition-all";
                }
                if (diffLabel) {
                    diffLabel.className = "text-xs font-black text-amber-900 dark:text-amber-300";
                    diffLabel.innerText = "⏳ Ще докласти:";
                }
                if (statusBadge) {
                    statusBadge.className = "text-sm font-black font-mono text-amber-800 dark:text-amber-200";
                    statusBadge.innerText = `${Math.abs(diff).toLocaleString('uk-UA')} грн (${pct}%)`;
                }
                if (progressBar) {
                    progressBar.className = "bg-gradient-to-r from-amber-500 to-orange-500 h-full transition-all duration-300";
                }
            } else {
                if (diffBox) {
                    diffBox.className = "p-2.5 rounded-xl bg-rose-100/90 dark:bg-rose-950/60 border-2 border-rose-400 dark:border-rose-700 flex items-center justify-between shadow-sm transition-all";
                }
                if (diffLabel) {
                    diffLabel.className = "text-xs font-black text-rose-800 dark:text-rose-300";
                    diffLabel.innerText = "⚠️ Зайве (перебір):";
                }
                if (statusBadge) {
                    statusBadge.className = "text-sm font-black font-mono text-rose-700 dark:text-rose-300";
                    statusBadge.innerText = `+${diff.toLocaleString('uk-UA')} грн`;
                }
                if (progressBar) {
                    progressBar.className = "bg-gradient-to-r from-rose-500 to-red-600 h-full transition-all duration-300";
                }
            }
        }
    }

    saveCashDraft();
};

// 13. Мульти-ввід очікуваних сум (кілька днів/звітів)
function renderExpectedRows() {
    const container = document.getElementById('termExpectedRowsContainer');
    if (!container) return;

    container.innerHTML = terminalState.expectedAmounts.map((row, idx) => `
        <div class="flex items-center gap-1.5">
            <input type="text" value="${row.label}" oninput="window.updateExpectedRowLabel(${row.id}, this.value)" placeholder="Напр.: X-звіт або Розмін" class="flex-1 p-1 text-[11px] bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-700 rounded-lg outline-none font-medium">
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
        label: `X-звіт день ${count}`,
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
    saveCashDraft();
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

    terminalState.denominationsCount = {};
    terminalState.expectedAmounts = [{ id: 1, label: 'X-звіт за сьогодні', amount: 0 }];
    terminalState.nextExpectedId = 2;
    clearCashDraft();
    renderExpectedRows();
    calculateCashTotals();
    showToast("Форму та чернетку очищено", "info");
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
    const denominations = {};
    const inputs = document.querySelectorAll('.cash-input');
    inputs.forEach(i => {
        const denom = Number(i.dataset.denom);
        const count = parseInt(i.value) || 0;
        if (count > 0) {
            denominations[denom] = count;
        }
        totalCounted += count * denom;
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
        denominations,
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

            terminalState.latestCashToday = {
                type: terminalState.activeTab,
                countedBy,
                time: new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }),
                totalCounted: Number(totalCounted)
            };
            renderCashTodayStatus(terminalState.latestCashToday);

            try {
                if (terminalSyncChannel && store?._id) {
                    terminalSyncChannel.postMessage({
                        type: 'cash_update',
                        storeId: store._id,
                        cash: terminalState.latestCashToday
                    });
                }
            } catch (e) { }
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

            terminalState.latestStockToday = {
                countedBy,
                time: new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }),
                preview: content.slice(0, 80)
            };
            renderStockTodayStatus(terminalState.latestStockToday);

            try {
                if (terminalSyncChannel && store?._id) {
                    terminalSyncChannel.postMessage({
                        type: 'stock_update',
                        storeId: store._id,
                        stock: terminalState.latestStockToday
                    });
                }
            } catch (e) { }
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
                    if (item.difference === 0) {
                        statusBadge = `<span class="px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 font-black text-xs">Ціль: ${item.totalExpected.toLocaleString('uk-UA')} грн (0 грн ✅)</span>`;
                    } else if (item.difference < 0) {
                        statusBadge = `<span class="px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 font-black text-xs">Ціль: ${item.totalExpected.toLocaleString('uk-UA')} грн (${item.difference.toLocaleString('uk-UA')} грн ⏳)</span>`;
                    } else {
                        statusBadge = `<span class="px-2 py-0.5 rounded-md bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 font-black text-xs">Ціль: ${item.totalExpected.toLocaleString('uk-UA')} грн (+${item.difference.toLocaleString('uk-UA')} грн ⚠️)</span>`;
                    }
                }

                let expectedHtml = '';
                if (!isEncash && Array.isArray(item.expectedAmounts) && item.expectedAmounts.length > 0) {
                    expectedHtml = `
                        <div class="flex flex-wrap gap-1 pt-1">
                            ${item.expectedAmounts.map(r => `
                                <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-gray-100 dark:bg-[#1C1C1E] text-[10px] text-gray-600 dark:text-gray-300">
                                    <span>📑 ${r.label || 'X-звіт за сьогодні'}:</span>
                                    <span class="font-bold font-mono">${Number(r.amount || 0).toLocaleString('uk-UA')} грн</span>
                                </span>
                            `).join('')}
                        </div>
                    `;
                }

                let denomHtml = '';
                if (item.denominations) {
                    const dObj = (item.denominations instanceof Map)
                        ? Object.fromEntries(item.denominations)
                        : item.denominations;
                    const entries = Object.entries(dObj)
                        .filter(([_, count]) => Number(count) > 0)
                        .sort((a, b) => Number(b[0]) - Number(a[0]));
                    if (entries.length > 0) {
                        denomHtml = `
                            <div class="mt-2 pt-1.5 border-t border-gray-200/50 dark:border-gray-700/50">
                                <div class="text-[10px] text-gray-500 dark:text-gray-400 font-semibold mb-1">Купюри:</div>
                                <div class="flex flex-wrap gap-1">
                                    ${entries.map(([denom, count]) => `
                                        <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-700 font-mono text-[10px] text-gray-700 dark:text-gray-300 shadow-2xs">
                                            <span class="font-bold text-blue-600 dark:text-blue-400">${denom} грн</span>: <span class="font-bold">${count} шт</span>
                                        </span>
                                    `).join('')}
                                </div>
                            </div>
                        `;
                    }
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
                        ${expectedHtml}
                        ${denomHtml}
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
            await loadTerminalData(res.store._id, res.store.code, true);
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
        loadTerminalData(terminalState.store._id, null, true);
        loadAlarmStatus(terminalState.store._id);
        showToast("Дані оновлено", "info");
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

function timeToDec(t) {
    if (!t || t === 'Відпустка' || t === 'Лікарняний' || t === 'Донорство' || t === 'DELETE') return 0;
    const [h, m] = t.split(':').map(Number);
    return h + ((m || 0) / 60);
}

const shiftColors = [
    'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200 border border-blue-200 dark:border-blue-800',
    'bg-purple-100 dark:bg-purple-900/40 text-purple-800 dark:text-purple-200 border border-purple-200 dark:border-purple-800',
    'bg-orange-100 dark:bg-orange-900/40 text-orange-800 dark:text-orange-200 border border-orange-200 dark:border-orange-800',
    'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-200 border border-green-200 dark:border-green-800',
    'bg-pink-100 dark:bg-pink-900/40 text-pink-800 dark:text-pink-200 border border-pink-200 dark:border-pink-800',
    'bg-teal-100 dark:bg-teal-900/40 text-teal-800 dark:text-teal-200 border border-teal-200 dark:border-teal-800',
    'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-800 dark:text-indigo-200 border border-indigo-200 dark:border-indigo-800',
    'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-200 border border-yellow-200 dark:border-yellow-800',
    'bg-rose-100 dark:bg-rose-900/40 text-rose-800 dark:text-rose-200 border border-rose-200 dark:border-rose-800',
    'bg-cyan-100 dark:bg-cyan-900/40 text-cyan-800 dark:text-cyan-200 border border-cyan-200 dark:border-cyan-800'
];

const popularShiftsMap = {
    '10:00-19:00': 0, // blue
    '09:30-18:30': 3, // green
    '11:30-20:30': 2, // orange
    '12:00-21:00': 1, // purple
    '13:00-22:00': 6, // indigo
    '14:00-22:00': 9, // cyan
    '09:00-18:00': 5, // teal
    '08:00-17:00': 7, // yellow
    '10:30-19:30': 4, // pink
    '11:00-20:00': 8  // rose
};

function getTerminalShiftColorClass(start, end) {
    if (!start || !end) return 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 border border-gray-200 dark:border-gray-700';

    const shiftKey = `${start}-${end}`;

    if (popularShiftsMap[shiftKey] !== undefined) {
        return shiftColors[popularShiftsMap[shiftKey]];
    }

    let hash = 5381;
    for (let i = 0; i < shiftKey.length; i++) {
        hash = (hash * 33) ^ shiftKey.charCodeAt(i);
    }

    const colorIndex = Math.abs(hash) % shiftColors.length;
    return shiftColors[colorIndex];
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

    const { store, year, month, daysInMonth, todayStr, employees = [], shifts = [], tasks = [] } = data;

    if (!employees || employees.length === 0) {
        container.innerHTML = `
            <div class="text-center text-xs text-gray-400 py-16">
                У цьому магазині поки немає доданих співробітників
            </div>
        `;
        return;
    }

    const monthStr = String(month).padStart(2, '0');
    const viewMonthStr = `${year}-${monthStr}`;
    const activeStoreId = store?._id || terminalState.store?._id;
    const openTime = store?.openTime || terminalState.store?.openTime || "10:00";
    const closeTime = store?.closeTime || terminalState.store?.closeTime || "22:00";
    const lunchMins = (store && store.lunch_duration_minutes !== undefined) ? store.lunch_duration_minutes : 60;
    const monthNorm = (store?.normHours && store.normHours[viewMonthStr]) || 0;
    const storeFte = (store && store.fte !== undefined) ? store.fte : 1;

    // 1. Фільтрація та сортування користувачів так само, як для СЕ в додатку (getUsersForView)
    const filteredUsers = employees.filter(u => {
        if (u.status !== 'blocked') return true;
        return shifts.some(s => s.name === u.name && s.date && s.date.startsWith(viewMonthStr));
    });

    const roleWeights = { 'SM': 1, 'SSE': 2, 'SE': 3, 'RRP': 4, 'Intern': 5 };
    const usersToShow = filteredUsers.sort((a, b) => {
        const orderA = (a.sortOrder !== undefined && a.sortOrder !== null) ? a.sortOrder : 999;
        const orderB = (b.sortOrder !== undefined && b.sortOrder !== null) ? b.sortOrder : 999;
        if (orderA !== orderB) return orderA - orderB;

        const wA = roleWeights[a.position] || 99;
        const wB = roleWeights[b.position] || 99;
        if (wA !== wB) return wA - wB;

        return (a.name || '').localeCompare(b.name || '');
    });

    // Розділяємо співробітників на основний штат (homeUsers) та гостей на підміні (guestUsers)
    const homeUsers = [];
    const guestUsers = [];

    usersToShow.forEach(user => {
        const userHomeStoreId = user.storeId ? (user.storeId._id || user.storeId) : null;
        const isGuest = userHomeStoreId && activeStoreId && String(userHomeStoreId) !== String(activeStoreId);

        if (isGuest) {
            const hasShiftHere = shifts.some(s =>
                s.name === user.name &&
                s.date && s.date.startsWith(viewMonthStr) &&
                String(s.storeId?._id || s.storeId || s.substituteStoreId) === String(activeStoreId)
            );
            if (hasShiftHere) {
                guestUsers.push(user);
            }
        } else {
            homeUsers.push(user);
        }
    });

    // Підрахунок загальних годин та норми магазину
    let storeTotalHours = 0;
    let storeTotalDonorHours = 0;
    let totalMonthShifts = 0;

    usersToShow.forEach(user => {
        const userHomeStoreId = user.storeId ? (user.storeId._id || user.storeId) : null;
        for (let d = 1; d <= daysInMonth; d++) {
            const ds = `${year}-${monthStr}-${String(d).padStart(2, '0')}`;
            const shift = shifts.find(s => s.date === ds && s.name === user.name);
            if (shift) {
                const sStoreId = shift.storeId ? (shift.storeId._id || shift.storeId) : userHomeStoreId;
                const countsForStore = !activeStoreId || (String(sStoreId) === String(activeStoreId)) || (String(shift.substituteStoreId) === String(activeStoreId));
                if (countsForStore) {
                    if (shift.start === 'Донорство') {
                        storeTotalDonorHours += 8;
                    } else if (shift.start !== 'Відпустка' && shift.start !== 'Лікарняний' && shift.start !== 'DELETE') {
                        let rawDur = timeToDec(shift.end) - timeToDec(shift.start);
                        if (rawDur < 0) rawDur += 24;
                        let dur = rawDur - (lunchMins / 60);
                        if (dur < 0) dur = 0;
                        storeTotalHours += dur;
                        totalMonthShifts++;
                    }
                }
            }
        }
    });

    let storeTotalNorm = 0;
    if (monthNorm > 0) {
        if (storeFte > 0) {
            storeTotalNorm = Math.round(monthNorm * storeFte);
        } else {
            storeTotalNorm = monthNorm * homeUsers.length;
        }
    }

    const formattedStoreTotalHours = parseFloat(storeTotalHours.toFixed(1));
    let storeHoursText = `<span class="text-gray-600 dark:text-gray-300">${formattedStoreTotalHours}</span>`;
    if (storeTotalDonorHours > 0) storeHoursText += `<span class="text-indigo-500 text-[8px] ml-0.5">+${storeTotalDonorHours}</span>`;
    if (storeTotalNorm > 0) storeHoursText += `<span class="text-gray-400 font-normal mx-0.5">\\</span><span class="text-gray-500">${storeTotalNorm}</span>`;

    let html = '<table class="w-full text-xs border-collapse">';

    // ================= HEADER =================
    html += '<thead class="sticky top-0 z-40">';
    html += '<tr class="h-10 border-b border-gray-100 dark:border-gray-800">';
    html += '<th class="sticky left-0 z-40 bg-[#F2F2F7] dark:bg-[#1C1C1E] px-2 text-left font-bold min-w-[120px] border-r border-gray-200 dark:border-gray-700 shadow-sm">Співробітник</th>';

    for (let d = 1; d <= daysInMonth; d++) {
        const dStr = `${year}-${monthStr}-${String(d).padStart(2, '0')}`;
        const isToday = dStr === todayStr;
        const dateObj = new Date(year, month - 1, d);
        const dayName = dateObj.toLocaleDateString('uk-UA', { weekday: 'short' });
        const isWeekend = dateObj.getDay() === 0 || dateObj.getDay() === 6;
        const isPast = dStr < todayStr;

        let bgClass = 'bg-white dark:bg-[#1C1C1E] text-gray-500 dark:text-gray-400';
        if (isPast) bgClass = 'bg-gray-100 text-gray-300 dark:bg-[#151515] dark:text-gray-600';
        else if (isWeekend) bgClass = 'bg-red-50 dark:bg-red-900/20 text-red-500';

        let thAttr = '';
        if (isToday) {
            bgClass = 'bg-blue-500 text-white shadow-md shadow-blue-500/30 rounded-t-lg transform scale-105 z-30 ring-2 ring-blue-500';
            thAttr = 'data-sched-today="true"';
        }

        html += `<th ${thAttr} class="px-1 text-center min-w-[40px] font-normal ${bgClass} border-r border-gray-100 dark:border-gray-800 relative group cursor-default">
            <div class="font-bold text-[13px]">${d}</div>
            <div class="text-[9px] opacity-80 uppercase">${dayName}</div>
        </th>`;
    }

    html += `<th class="sticky right-0 z-40 bg-[#F2F2F7] dark:bg-[#1C1C1E] px-2 text-center font-bold min-w-[80px] border-l border-gray-200 dark:border-gray-700 shadow-sm">Години</th>`;
    html += '</tr>';

    // --- Рядок 2: Кількість людей ---
    html += '<tr class="h-6 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#202022]">';
    html += '<td class="sticky left-0 z-40 bg-[#F2F2F7] dark:bg-[#1C1C1E] px-2 text-[10px] text-gray-400 font-bold border-r border-gray-200 dark:border-gray-700 text-right">Людей:</td>';

    const openTimeDec = timeToDec(openTime);
    let closeTimeDec = timeToDec(closeTime);
    if (closeTimeDec <= 6) closeTimeDec += 24;

    for (let d = 1; d <= daysInMonth; d++) {
        const dStr = `${year}-${monthStr}-${String(d).padStart(2, '0')}`;
        const dayShifts = shifts.filter(s => s.date === dStr && s.start !== 'Відпустка' && s.start !== 'Лікарняний' && s.start !== 'Донорство' && s.start !== 'DELETE');

        const relevantShifts = activeStoreId
            ? dayShifts.filter(s => {
                let sStoreId = s.storeId?._id || s.storeId;
                if (!sStoreId) {
                    const u = employees.find(usr => usr.name === s.name);
                    sStoreId = u?.storeId?._id || u?.storeId;
                }
                return (sStoreId && String(sStoreId) === String(activeStoreId)) || (s.substituteStoreId && String(s.substituteStoreId) === String(activeStoreId));
            })
            : dayShifts;

        let openers = 0;
        let closers = 0;
        let shiftCountForValidation = 0;

        relevantShifts.forEach(s => {
            const startD = timeToDec(s.start);
            let endD = timeToDec(s.end);
            if (startD === 0 && endD === 0) return;

            shiftCountForValidation++;

            if (endD <= 6 && startD > endD) {
                endD += 24;
            } else if (endD === 0 && startD > 0) {
                endD = 24;
            }

            if (startD <= openTimeDec && endD > openTimeDec) openers++;
            if (endD >= closeTimeDec && startD < closeTimeDec) closers++;
        });

        const count = shiftCountForValidation > 0 ? shiftCountForValidation : relevantShifts.length;
        let badgeClass = "text-gray-500";
        let contentHtml = count > 0 ? count : '-';

        if (count > 0 && (openers < 1 || closers < 1)) {
            badgeClass = "bg-red-100 text-red-600 dark:bg-red-950/40 dark:text-red-400 font-bold";
            if (openers < 1 && closers < 1) {
                contentHtml = `<div class="flex items-center justify-center gap-0.5" title="Немає співробітників на відкриття (до ${openTime}) та закриття (після ${closeTime})"><span>${count}</span><span class="text-[8px]">⚠️</span></div>`;
            } else if (openers < 1) {
                contentHtml = `<div class="flex items-center justify-center gap-0.5" title="Немає співробітника на відкриття (до ${openTime})"><span>${count}</span><span class="text-[8px]">🌅</span></div>`;
            } else {
                contentHtml = `<div class="flex items-center justify-center gap-0.5" title="Немає співробітника на закриття (після ${closeTime})"><span>${count}</span><span class="text-[8px]">🌙</span></div>`;
            }
        } else if (count > 0) {
            badgeClass = "text-green-600 dark:text-green-400 font-medium";
            contentHtml = `<span title="Відкриття: ${openers}, Закриття: ${closers}">${count}</span>`;
        }

        html += `<td class="text-center border-r border-gray-100 dark:border-gray-800 text-[10px] ${badgeClass}">
            ${contentHtml}
        </td>`;
    }

    html += `<td class="sticky right-0 z-40 bg-[#F2F2F7] dark:bg-[#1C1C1E] border-l border-gray-200 dark:border-gray-700 text-center px-1 shadow-sm"><div class="flex items-center justify-center h-full text-[9px] font-bold whitespace-nowrap leading-tight">${storeHoursText}</div></td>`;
    html += '</tr>';
    html += '</thead>';

    // ================= BODY =================
    html += '<tbody>';

    homeUsers.forEach(user => {
        const shortName = getDisplayName(user);
        const safeUserFullName = (user.fullName || user.name || '').replace(/'/g, "\\'");
        const safeUserName = (user.name || '').replace(/'/g, "\\'");
        const safeAvatar = (user.avatar || '').replace(/'/g, "\\'");
        const blockedClass = user.status === 'blocked' ? 'opacity-50 grayscale' : '';
        const userHomeStoreId = user.storeId ? (user.storeId._id || user.storeId) : null;

        html += `<tr class="h-10 border-b border-gray-50 dark:border-gray-800/50 hover:bg-gray-50 dark:hover:bg-[#2C2C2E] transition-colors ${blockedClass}">`;
        html += `<td class="sticky left-0 z-30 bg-white dark:bg-[#1C1C1E] px-2 border-r border-gray-200 dark:border-gray-700 font-medium text-[11px] truncate max-w-[120px] shadow-sm" title="${user.fullName || user.name}">${shortName}</td>`;

        let totalHours = 0;
        let donorDays = 0;

        // Враховуємо години задач (як у таблиці СЕ)
        const userTasks = tasks.filter(t => t.name === user.name && t.includeHours && !t.isFullDay && t.date && t.date.startsWith(viewMonthStr));
        userTasks.forEach(t => {
            if (t.start && t.end) {
                let duration = timeToDec(t.end) - timeToDec(t.start);
                if (duration < 0) duration += 24;

                const shift = shifts.find(s => s.date === t.date && s.name === user.name);
                if (shift && shift.start !== 'Відпустка' && shift.start !== 'Лікарняний' && shift.start !== 'Донорство' && shift.start !== 'DELETE') {
                    let ts = timeToDec(t.start);
                    let te = timeToDec(t.end);
                    if (te < ts) te += 24;

                    let ss = timeToDec(shift.start);
                    let se = timeToDec(shift.end);
                    if (se < ss) se += 24;

                    const overlapStart = Math.max(ts, ss);
                    const overlapEnd = Math.min(te, se);
                    if (overlapEnd > overlapStart) {
                        duration -= (overlapEnd - overlapStart);
                    }
                }
                if (duration > 0) totalHours += duration;
            }
        });

        for (let d = 1; d <= daysInMonth; d++) {
            const ds = `${year}-${monthStr}-${String(d).padStart(2, '0')}`;
            const isToday = ds === todayStr;
            const isPast = ds < todayStr;

            const shift = shifts.find(s => s.date === ds && s.name === user.name);

            let sStart, sEnd;
            if (shift) {
                if (shift.start !== 'Відпустка' && shift.start !== 'Лікарняний' && shift.start !== 'Донорство' && shift.start !== 'DELETE') {
                    sStart = shift.start;
                    sEnd = shift.end;
                }
                if (shift.start === 'Донорство') donorDays++;
            }

            let duration = 0;
            let durStr = 0;
            if (sStart && sEnd) {
                let rawDur = timeToDec(sEnd) - timeToDec(sStart);
                if (rawDur < 0) rawDur += 24;
                duration = rawDur - (lunchMins / 60);
                if (duration < 0) duration = 0;
                totalHours += duration;
                durStr = parseFloat(duration.toFixed(1));
            }

            let badgeHtml = '';
            if (duration > 0) {
                badgeHtml = `<div class="absolute -top-1.5 -right-1.5 z-10 bg-white dark:bg-[#3A3A3C] text-black dark:text-white text-[8px] font-bold px-1 rounded-full shadow-sm border border-gray-200 dark:border-gray-600 flex items-center justify-center min-w-[14px] h-[14px] leading-none">${durStr}</div>`;
            }

            let cellClass = '';
            if (isPast) cellClass = 'bg-gray-50/50 dark:bg-[#121212] text-gray-300';
            if (isToday) cellClass = 'bg-blue-50/50 dark:bg-blue-900/20 border-x-2 border-blue-200 dark:border-blue-800 relative z-0';

            let content = '';
            if (shift) {
                const sStoreId = shift.storeId ? (shift.storeId._id || shift.storeId) : userHomeStoreId;
                const shouldRender = !activeStoreId || (String(sStoreId) === String(activeStoreId)) || (String(userHomeStoreId) === String(activeStoreId));

                if (shouldRender) {
                    const isSubstituteRender = activeStoreId && sStoreId && String(sStoreId) !== String(activeStoreId);
                    const isGuestRender = activeStoreId && String(sStoreId) === String(activeStoreId) && userHomeStoreId && String(userHomeStoreId) !== String(activeStoreId);

                    if (shift.start === 'Відпустка') {
                        content = `<div onclick="window.openShiftDetailsModal({ fullName: '${safeUserFullName}', userName: '${safeUserName}', avatar: '${safeAvatar}', date: '${ds}', start: 'Відпустка', shiftId: '${shift._id || ''}' })" class="cursor-pointer text-lg active:scale-95 transition-transform">🌴</div>`;
                    } else if (shift.start === 'Лікарняний') {
                        content = `<div onclick="window.openShiftDetailsModal({ fullName: '${safeUserFullName}', userName: '${safeUserName}', avatar: '${safeAvatar}', date: '${ds}', start: 'Лікарняний', shiftId: '${shift._id || ''}' })" class="cursor-pointer text-lg active:scale-95 transition-transform">💊</div>`;
                    } else if (shift.start === 'Донорство') {
                        content = `<div onclick="window.openShiftDetailsModal({ fullName: '${safeUserFullName}', userName: '${safeUserName}', avatar: '${safeAvatar}', date: '${ds}', start: 'Донорство', shiftId: '${shift._id || ''}' })" class="cursor-pointer text-lg active:scale-95 transition-transform">🩸</div>`;
                    } else {
                        const opacity = isPast ? 'opacity-50 grayscale' : '';

                        if (isSubstituteRender) {
                            const storeName = shift.storeId?.name || 'Інший магазин';
                            const safeStoreName = storeName.replace(/'/g, "\\'");
                            content = `<div onclick="window.openShiftDetailsModal({ fullName: '${safeUserFullName}', userName: '${safeUserName}', avatar: '${safeAvatar}', position: '${user.position || ''}', type: 'substitute', targetStoreName: '${safeStoreName}', date: '${ds}', start: '${shift.start}', end: '${shift.end}', duration: ${durStr}, lunchMins: ${lunchMins}, shiftId: '${shift._id || ''}' })" title="Підміна в магазині: ${storeName}" class="relative text-[9.5px] font-mono leading-tight bg-orange-100 dark:bg-orange-950/60 text-orange-800 dark:text-orange-200 rounded px-1 py-0.5 shadow-sm border border-orange-300 dark:border-orange-800 cursor-pointer active:scale-95 ${opacity}">
                                <div class="text-[7.5px] font-sans font-bold truncate text-orange-700 dark:text-orange-300 leading-none mb-0.5 flex items-center justify-center gap-0.5">
                                    <span class="text-[8px] leading-none">📍</span>
                                    <span class="truncate">${storeName}</span>
                                </div>
                                <div class="leading-none font-bold">${shift.start}<br>${shift.end}</div>
                                ${badgeHtml}
                            </div>`;
                        } else {
                            const colorClass = getTerminalShiftColorClass(shift.start, shift.end);
                            const guestIndicator = isGuestRender ? '<div class="absolute -top-1.5 -left-1.5 z-10 text-[10px] filter drop-shadow-md">📍</div>' : '';
                            content = `<div onclick="window.openShiftDetailsModal({ fullName: '${safeUserFullName}', userName: '${safeUserName}', avatar: '${safeAvatar}', position: '${user.position || ''}', type: 'regular', date: '${ds}', start: '${shift.start}', end: '${shift.end}', duration: ${durStr}, lunchMins: ${lunchMins}, shiftId: '${shift._id || ''}' })" title="${user.fullName || user.name}&#10;⏰ ${shift.start} - ${shift.end} (${durStr} год)" class="relative text-[10px] font-mono leading-tight ${colorClass} rounded px-1 py-0.5 ${opacity} cursor-pointer active:scale-95">
                                ${guestIndicator}
                                ${shift.start}<br>${shift.end}
                                ${badgeHtml}
                            </div>`;
                        }
                    }
                }
            }

            const hasTask = tasks.some(t => t.name === user.name && t.date === ds && t.status !== 'completed');
            const taskHtml = hasTask ? '<div class="absolute top-0 left-0 z-10 text-[11px] drop-shadow-sm pointer-events-none">📌</div>' : '';

            html += `<td data-date="${ds}" data-name="${user.name}" class="shift-cell relative text-center p-0.5 border-r border-gray-100 dark:border-gray-800 ${cellClass} cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">${taskHtml}${content}</td>`;
        }

        const formattedTotalHours = parseFloat(totalHours.toFixed(1));
        const donorHours = donorDays * 8;
        let hoursHtml = '';

        if (monthNorm > 0) {
            const diff = parseFloat((formattedTotalHours - monthNorm).toFixed(1));
            const diffClass = diff >= 0 ? "text-green-500" : "text-red-500";
            const diffSign = diff > 0 ? "+" : "";
            hoursHtml = `
                <div class="flex flex-col leading-none">
                    <span class="font-bold text-[11px]">${formattedTotalHours}${donorHours > 0 ? ` <span class="text-indigo-500">+${donorHours}</span>` : ''} <span class="text-gray-400 font-normal">/ ${monthNorm}</span></span>
                    <span class="text-[9px] ${diffClass} font-bold">${diffSign}${diff}</span>
                </div>
            `;
        } else if (donorHours > 0) {
            hoursHtml = `<div class="font-bold text-gray-500">${formattedTotalHours} <span class="text-indigo-500 text-[10px]">+${donorHours}</span></div>`;
        } else {
            hoursHtml = `<div class="font-bold text-gray-500">${formattedTotalHours}</div>`;
        }

        html += `<td class="sticky right-0 z-30 bg-white dark:bg-[#1C1C1E] border-l border-gray-200 dark:border-gray-700 text-center px-1 shadow-sm">${hoursHtml}</td>`;
        html += '</tr>';
    });

    // ================= UNIFIED GUESTS / SUBSTITUTES ROW =================
    if (guestUsers.length > 0) {
        let totalGuestsHours = 0;
        let totalGuestsShifts = 0;
        let guestCellsHtml = '';

        for (let d = 1; d <= daysInMonth; d++) {
            const ds = `${year}-${monthStr}-${String(d).padStart(2, '0')}`;
            const isToday = ds === todayStr;
            const isPast = ds < todayStr;

            let cellClass = '';
            if (isPast) cellClass = 'bg-gray-50/50 dark:bg-[#121212] text-gray-300';
            if (isToday) cellClass = 'bg-blue-50/50 dark:bg-blue-900/20 border-x-2 border-blue-200 dark:border-blue-800 relative z-0';

            const dayGuestItems = [];
            guestUsers.forEach(gUser => {
                const shift = shifts.find(s => s.date === ds && s.name === gUser.name);
                if (shift) {
                    const sStoreId = shift.storeId ? (shift.storeId._id || shift.storeId) : (gUser.storeId?._id || gUser.storeId);
                    if ((!activeStoreId || String(sStoreId) === String(activeStoreId) || String(shift.substituteStoreId) === String(activeStoreId)) && !['DELETE', 'Відпустка', 'Лікарняний', 'Донорство'].includes(shift.start)) {
                        dayGuestItems.push({ user: gUser, shift });
                    }
                }
            });

            if (dayGuestItems.length === 0) {
                guestCellsHtml += `<td data-date="${ds}" class="shift-cell relative text-center p-0.5 border-r border-gray-100 dark:border-gray-800/60 ${cellClass}"><span class="opacity-15 text-[8px] text-gray-400">·</span></td>`;
            } else {
                let badgesHtml = '<div class="flex flex-col gap-1 w-full justify-center">';
                dayGuestItems.forEach(item => {
                    let rawDur = timeToDec(item.shift.end) - timeToDec(item.shift.start);
                    if (rawDur < 0) rawDur += 24;
                    let dur = rawDur - (lunchMins / 60);
                    if (dur < 0) dur = 0;
                    totalGuestsHours += dur;
                    totalGuestsShifts++;

                    const durStr = parseFloat(dur.toFixed(1));
                    const gDisplayName = getDisplayName(item.user);
                    const parts = gDisplayName.split(' ');
                    const gShortName = parts.length > 1 ? `${parts[0]} ${parts[1][0]}.` : parts[0];
                    const gFullName = item.user.fullName || item.user.name;
                    const gHomeStoreName = item.user.storeId?.name || 'Інший магазин';

                    const opacity = isPast ? 'opacity-60 grayscale' : '';
                    const safeFullName = gFullName.replace(/'/g, "\\'");
                    const safeHomeStoreName = gHomeStoreName.replace(/'/g, "\\'");
                    const safeGUserName = (item.user.name || '').replace(/'/g, "\\'");
                    const safeGAvatar = (item.user.avatar || '').replace(/'/g, "\\'");

                    badgesHtml += `
                        <div data-date="${ds}"
                             data-name="${item.user.name}"
                             onclick="window.openShiftDetailsModal({
                                 fullName: '${safeFullName}',
                                 userName: '${safeGUserName}',
                                 shortName: '${gShortName}',
                                 avatar: '${safeGAvatar}',
                                 position: '${item.user.position || ''}',
                                 type: 'guest',
                                 homeStoreName: '${safeHomeStoreName}',
                                 date: '${ds}',
                                 start: '${item.shift.start}',
                                 end: '${item.shift.end}',
                                 duration: ${durStr},
                                 lunchMins: ${lunchMins},
                                 shiftId: '${item.shift._id || ''}'
                             })"
                             title="${gFullName}&#10;📍 Гість з: ${gHomeStoreName}&#10;⏰ ${item.shift.start} - ${item.shift.end} (${durStr} год)"
                             class="relative text-[9px] font-mono leading-tight bg-amber-100/90 dark:bg-amber-950/70 text-amber-900 dark:text-amber-200 rounded px-1 py-0.5 border border-amber-300 dark:border-amber-700/80 shadow-sm cursor-pointer hover:scale-105 active:scale-95 transition-transform ${opacity}">
                            <div class="text-[7.5px] font-sans font-bold truncate text-amber-800 dark:text-amber-300 leading-none mb-0.5 flex items-center justify-center">
                                <span class="truncate">${gShortName}</span>
                            </div>
                            <div class="leading-none font-bold">${item.shift.start}<br>${item.shift.end}</div>
                            <div class="absolute -top-1.5 -right-1.5 z-10 bg-amber-500 text-white text-[7.5px] font-bold px-1 rounded-full shadow-sm min-w-[13px] h-[13px] flex items-center justify-center leading-none">${durStr}</div>
                        </div>
                    `;
                });
                badgesHtml += '</div>';

                guestCellsHtml += `<td data-date="${ds}" class="shift-cell relative text-center p-0.5 border-r border-gray-100 dark:border-gray-800/60 ${cellClass}">${badgesHtml}</td>`;
            }
        }

        const guestHoursHtml = `
            <div class="flex flex-col items-center justify-center leading-tight">
                <span class="text-[7.5px] uppercase tracking-wider text-amber-700 dark:text-amber-400 font-bold">Підміни</span>
                <span class="font-bold text-amber-900 dark:text-amber-200 text-xs">${parseFloat(totalGuestsHours.toFixed(1))}</span>
                <span class="text-[8px] text-gray-400">${totalGuestsShifts} змін</span>
            </div>
        `;

        html += `<tr class="min-h-10 border-t-2 border-dashed border-amber-200 dark:border-amber-800/60 bg-[#FFFDF9] dark:bg-[#1A1816] transition-colors">`;
        html += `<td class="sticky left-0 z-30 bg-[#FFFDF9] dark:bg-[#1A1816] px-2 py-1.5 border-r border-amber-200 dark:border-amber-800/60 font-medium text-[11px] shadow-sm">
            <div class="flex items-center gap-1.5">
                <span class="text-sm">🤝</span>
                <div class="flex flex-col leading-tight">
                    <span class="font-bold text-amber-900 dark:text-amber-200">Підміни</span>
                    <span class="text-[8.5px] text-gray-400 font-normal">${guestUsers.length} співроб.</span>
                </div>
            </div>
        </td>`;
        html += guestCellsHtml;
        html += `<td class="sticky right-0 z-30 bg-[#FFFDF9] dark:bg-[#1A1816] border-l border-amber-200 dark:border-amber-800/60 text-center px-1 shadow-sm">${guestHoursHtml}</td>`;
        html += `</tr>`;
    }

    html += '</tbody></table>';
    container.innerHTML = html;

    // Оновлюємо статистику в підвалі
    const statsEl = document.getElementById('termSchedSummaryStats');
    if (statsEl) {
        statsEl.innerHTML = `Всього на місяць: <span class="text-blue-600 dark:text-blue-400 font-black">${totalMonthShifts}</span> змін • <span class="text-blue-600 dark:text-blue-400 font-black">${formattedStoreTotalHours}</span> год${storeTotalNorm > 0 ? ` / <span class="text-gray-500">${storeTotalNorm}</span> год` : ''}`;
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
        const shiftDetails = document.getElementById('shiftDetailsModal');
        if (shiftDetails) {
            if (window.closeShiftDetailsModal) window.closeShiftDetailsModal();
            return;
        }
        const schedModal = document.getElementById('terminalScheduleModal');
        if (schedModal && !schedModal.classList.contains('hidden')) {
            window.closeTerminalScheduleModal();
        }
    }
});

