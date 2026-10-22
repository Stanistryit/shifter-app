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
    clockInterval: null,
    checklistState: {}
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
}

// 2. Живий годинник
function startLiveClock() {
    if (terminalState.clockInterval) clearInterval(terminalState.clockInterval);
    const update = () => {
        const el = document.getElementById('termLiveClock');
        if (el) {
            el.innerText = new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/Kiev' });
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

            localStorage.setItem('shifter_terminal_storeId', res.store._id);
            localStorage.setItem('shifter_terminal_storeCode', res.store.code);

            renderHeader(res.store);
            renderActiveShifts(res.todayShifts, res.employees);
            renderTomorrowOpener(res.tomorrowOpener);
            renderEmergencyContacts(res.store.emergencyContacts);
            renderTasks(res.tasks);
            renderChecklists(res.store);
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

// 5. Відображення співробітників на зміні (Зараз на зміні)
function renderActiveShifts(todayShifts, employees) {
    const listEl = document.getElementById('termActiveShiftsList');
    const badgeEl = document.getElementById('termActiveCountBadge');
    if (!listEl) return;

    if (!todayShifts || todayShifts.length === 0) {
        listEl.innerHTML = `<div class="p-3 text-center text-xs text-gray-400 bg-gray-50 dark:bg-[#2C2C2E] rounded-xl">Немає запланованих змін на сьогодні</div>`;
        if (badgeEl) badgeEl.innerText = '0 на зміні';
        return;
    }

    if (badgeEl) badgeEl.innerText = `${todayShifts.length} на зміні`;

    listEl.innerHTML = todayShifts.map(s => {
        const emp = employees ? employees.find(e => e.name === s.name) : null;
        const displayName = emp ? (emp.fullName || emp.name) : s.name;
        const pos = emp?.position ? `<span class="text-[9px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 font-bold ml-1">${emp.position}</span>` : '';

        return `
            <div class="p-2.5 rounded-xl bg-gray-50 dark:bg-[#2C2C2E] border border-gray-100 dark:border-gray-800 flex items-center justify-between">
                <div class="flex items-center gap-2">
                    <span class="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse"></span>
                    <div>
                        <div class="text-xs font-bold text-gray-900 dark:text-white flex items-center">
                            <span>${displayName}</span> ${pos}
                        </div>
                        <div class="text-[10px] text-gray-400 font-mono">Зміна: ${s.start} - ${s.end}</div>
                    </div>
                </div>
                <div class="text-right">
                    <span class="text-[10px] font-bold text-blue-500 font-mono bg-blue-50 dark:bg-blue-900/30 px-2 py-0.5 rounded-md">
                        до ${s.end}
                    </span>
                </div>
            </div>
        `;
    }).join('');
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

    if (!contacts || contacts.length === 0) {
        listEl.innerHTML = `
            <div class="p-2 rounded-lg bg-gray-50 dark:bg-[#2C2C2E] flex justify-between items-center text-xs">
                <span class="font-bold text-gray-600 dark:text-gray-300">Охорона точки</span>
                <span class="font-mono text-blue-500 font-bold">Вкажіть у налаштуваннях</span>
            </div>
            <div class="p-2 rounded-lg bg-gray-50 dark:bg-[#2C2C2E] flex justify-between items-center text-xs">
                <span class="font-bold text-gray-600 dark:text-gray-300">Інкасація / Банк</span>
                <span class="font-mono text-blue-500 font-bold">Вкажіть у налаштуваннях</span>
            </div>
        `;
        return;
    }

    listEl.innerHTML = contacts.map(c => `
        <div class="p-2 rounded-lg bg-gray-50 dark:bg-[#2C2C2E] border border-gray-100 dark:border-gray-800 flex justify-between items-center text-xs">
            <span class="font-bold text-gray-700 dark:text-gray-200">${c.title || 'Контакт'}</span>
            <a href="tel:${c.phone || ''}" class="font-mono text-blue-500 hover:underline font-bold">${c.phone || '---'}</a>
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

    const defaultItems = isMorning ? [
        { id: 'm_rro', text: 'Відкрити зміну РРО / роздрукувати X-звіт' },
        { id: 'm_terminal', text: 'Перевірити зв\'язок банківського терміналу' },
        { id: 'm_cash', text: 'Перерахувати та закласти розмінну монету' },
        { id: 'm_clean', text: 'Перевірити чистоту вітрин та порядок у залі' }
    ] : [
        { id: 'e_cash', text: 'Вечірній перерахунок каси (вкладка Каса)' },
        { id: 'e_encash', text: 'Підготувати та зібрати інкасацію' },
        { id: 'e_stock', text: 'Заповнити вечірній перерахунок складу' },
        { id: 'e_zreport', text: 'Зняти фіскальний Z-звіт на РРО' },
        { id: 'e_safe', text: 'Сховати виручку в сейф та зачинити' },
        { id: 'e_lights', text: 'Вимкнути світло, вивіску та закрити ролети' }
    ];

    // Зчитуємо локальний стан виконання чек-ліста за сьогодні
    const todayStr = new Date().toISOString().split('T')[0];
    const savedKey = `shifter_checklist_${store._id}_${todayStr}_${isMorning ? 'm' : 'e'}`;
    let savedState = {};
    try {
        savedState = JSON.parse(localStorage.getItem(savedKey) || '{}');
    } catch (e) { }

    terminalState.checklistState = savedState;

    container.innerHTML = defaultItems.map(item => {
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
    const expectedSec = document.getElementById('termCashExpectedSection');
    const submitBtn = document.getElementById('termSubmitCashBtn');

    if (tab === 'cash') {
        cashBtn.className = "flex-1 py-1.5 text-xs font-extrabold rounded-lg transition-all shadow-sm bg-white dark:bg-[#1C1C1E] text-blue-600 dark:text-blue-400";
        encashBtn.className = "flex-1 py-1.5 text-xs font-extrabold rounded-lg transition-all text-gray-500 hover:text-gray-900 dark:hover:text-white";
        expectedSec?.classList.remove('hidden');
        if (submitBtn) submitBtn.innerHTML = `<span>💾</span> <span>Зберегти касу та в TG</span>`;
    } else {
        encashBtn.className = "flex-1 py-1.5 text-xs font-extrabold rounded-lg transition-all shadow-sm bg-white dark:bg-[#1C1C1E] text-blue-600 dark:text-blue-400";
        cashBtn.className = "flex-1 py-1.5 text-xs font-extrabold rounded-lg transition-all text-gray-500 hover:text-gray-900 dark:hover:text-white";
        expectedSec?.classList.add('hidden');
        if (submitBtn) submitBtn.innerHTML = `<span>💼</span> <span>Зберегти інкасацію та в TG</span>`;
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

    // Якщо це Каса — рахуємо очікувану суму та різницю
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
    terminalState.expectedAmounts.forEach(r => totalExpected += (Number(r.amount) || 0));
    const difference = totalCounted - totalExpected;

    const payload = {
        storeId: store._id,
        type: terminalState.activeTab,
        countedBy,
        denominations: terminalState.denominationsCount,
        totalCounted,
        expectedAmounts: terminalState.activeTab === 'cash' ? terminalState.expectedAmounts : [],
        totalExpected: terminalState.activeTab === 'cash' ? totalExpected : 0,
        difference: terminalState.activeTab === 'cash' ? difference : 0
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
    }
};

window.cancelTerminalLogin = function () {
    triggerHaptic();
    document.getElementById('terminalLoginModal')?.classList.add('hidden');
    localStorage.removeItem('shifter_viewMode');
    window.location.href = '/';
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
    localStorage.removeItem('shifter_viewMode');
    if (state.currentUser && state.currentUser.role && state.currentUser.role !== 'Terminal' && state.currentUser.role !== 'Guest') {
        if (window.setMode) {
            window.setMode('list');
        } else {
            window.location.href = '/';
        }
    } else {
        window.location.href = '/';
    }
};
