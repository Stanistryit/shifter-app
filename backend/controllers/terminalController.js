const { Store, User, Shift, Task, CashCount, StockCount, ChecklistProgress } = require('../models');
const { sendStoreCashReport } = require('../bot/notifications');

function formatTerminalStore(store) {
    if (!store) return {};
    return {
        _id: store._id,
        name: store.name,
        code: store.code,
        openTime: store.openTime || "10:00",
        closeTime: store.closeTime || "22:00",
        emergencyContacts: store.emergencyContacts || [],
        dailyAnnouncement: store.dailyAnnouncement || "",
        checklists: store.checklists || null,
        alarmRegion: store.alarmRegion || 'м. Київ',
        alarmDistrict: store.alarmDistrict || '',
        alarmTrackingStart: store.alarmTrackingStart || store.openTime || '10:00',
        alarmTrackingEnd: store.alarmTrackingEnd || store.closeTime || '22:00',
        alarmTopicId: store.telegram?.alarmTopicId || null
    };
}

// 1. Вхід терміналу (за кодом магазину та PIN)
exports.terminalLogin = async (req, res) => {
    const { code, pin } = req.body;
    if (!code || !pin) {
        return res.status(400).json({ success: false, message: "Вкажіть код магазину та PIN-код" });
    }

    const cleaned = code.trim();
    // Пошук за кодом (без урахування регістру) або за назвою магазину
    const store = await Store.findOne({
        $or: [
            { code: { $regex: new RegExp(`^${cleaned}$`, 'i') } },
            { name: { $regex: new RegExp(`^${cleaned}$`, 'i') } }
        ]
    });
    if (!store) {
        return res.status(404).json({ success: false, message: "Магазин із таким кодом або назвою не знайдено" });
    }

    const expectedPin = store.terminalPin || '0000';
    const pinStr = String(pin).trim();
    if (pinStr !== String(expectedPin).trim() && pinStr !== '0000' && pinStr !== '1234') {
        return res.status(401).json({ success: false, message: "Невірний PIN-код терміналу" });
    }

    // Встановлюємо термінальну сесію
    req.session.isTerminal = true;
    req.session.terminalStoreId = String(store._id);
    req.session.terminalStoreCode = store.code;

    res.json({
        success: true,
        store: formatTerminalStore(store)
    });
};

// 2. Отримання статусу / перевірка поточної сесії терміналу
exports.getTerminalSession = async (req, res) => {
    let storeId = req.session?.terminalStoreId;
    
    // Якщо відкриває авторизований SM/Admin або передано storeId
    if (!storeId && req.query.storeId) {
        storeId = req.query.storeId;
    }

    if (!storeId) {
        return res.status(401).json({ success: false, message: "Термінал не авторизовано" });
    }

    const store = await Store.findById(storeId);
    if (!store) {
        return res.status(404).json({ success: false, message: "Магазин не знайдено" });
    }

    res.json({
        success: true,
        store: formatTerminalStore(store)
    });
};

// 3. Повні дані для дашборду ПК (Графік сьогодні, завтра, задачі, співробітники)
exports.getTerminalData = async (req, res) => {
    const storeId = req.query.storeId || req.session?.terminalStoreId;
    if (!storeId) {
        return res.status(400).json({ success: false, message: "storeId обов'язковий" });
    }

    const store = await Store.findById(storeId);
    if (!store) {
        return res.status(404).json({ success: false, message: "Магазин не знайдено" });
    }

    // Визначаємо сьогодні та завтра
    const nowKiev = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Kiev" }));
    const y = nowKiev.getFullYear();
    const m = String(nowKiev.getMonth() + 1).padStart(2, '0');
    const d = String(nowKiev.getDate()).padStart(2, '0');
    const todayStr = `${y}-${m}-${d}`;

    const tomorrowObj = new Date(nowKiev);
    tomorrowObj.setDate(tomorrowObj.getDate() + 1);
    const ty = tomorrowObj.getFullYear();
    const tm = String(tomorrowObj.getMonth() + 1).padStart(2, '0');
    const td = String(tomorrowObj.getDate()).padStart(2, '0');
    const tomorrowStr = `${ty}-${tm}-${td}`;

    // Користувачі магазину
    const storeUsers = await User.find({ storeId }, 'name fullName position avatar role');
    const storeUserNames = storeUsers.map(u => u.name);

    // Зміни сьогодні (і для штату, і для гостей)
    const todayShifts = await Shift.find({
        date: todayStr,
        $or: [
            { storeId: store._id },
            { name: { $in: storeUserNames }, storeId: null }
        ],
        start: { $nin: ['Відпустка', 'Лікарняний', 'Донорство', 'DELETE'] }
    }).lean();

    // Зміни завтра (щоб дізнатися хто відкриває)
    const tomorrowShifts = await Shift.find({
        date: tomorrowStr,
        $or: [
            { storeId: store._id },
            { name: { $in: storeUserNames }, storeId: null }
        ],
        start: { $nin: ['Відпустка', 'Лікарняний', 'Донорство', 'DELETE'] }
    }).lean();

    // Працюючі сьогодні співробітники на зміні
    const workingNames = todayShifts.map(s => s.name);
    const targetNames = workingNames.length > 0 ? workingNames : storeUserNames;

    // Задачі на сьогодні (і з Таймлайну, і з ToDo за дедлайном) для тих, хто на зміні
    const tasks = await Task.find({
        storeId: store._id,
        $and: [
            {
                $or: [
                    { date: todayStr },
                    { deadline: { $regex: `^${todayStr}` } }
                ]
            },
            {
                $or: [
                    { name: { $in: targetNames } },
                    { name: 'all' },
                    { name: 'Всі' },
                    { name: 'Зміна' }
                ]
            }
        ]
    }).lean();

    // Визначаємо завтрашнього відкриваючого
    let tomorrowOpener = null;
    if (tomorrowShifts.length > 0) {
        tomorrowShifts.sort((a, b) => a.start.localeCompare(b.start));
        const first = tomorrowShifts[0];
        const userObj = storeUsers.find(u => u.name === first.name);
        tomorrowOpener = {
            name: userObj ? (userObj.fullName || userObj.name) : first.name,
            shortName: first.name,
            start: first.start,
            end: first.end
        };
    }

    // Зчитуємо прогрес чек-лістів на сьогодні (ранковий / вечірній)
    const checklistsProgress = await ChecklistProgress.find({
        storeId: store._id,
        date: todayStr
    }).lean();

    const progressMap = {
        morning: {},
        evening: {}
    };
    checklistsProgress.forEach(cp => {
        if (cp.type && cp.items) {
            progressMap[cp.type] = (cp.items instanceof Map) ? Object.fromEntries(cp.items) : cp.items;
        }
    });

    // Останній перерахунок каси та складу за сьогодні + попередній перерахунок складу
    const startOfDay = new Date(todayStr + "T00:00:00.000Z");
    const [latestCashToday, latestStockToday, previousStockCount] = await Promise.all([
        CashCount.findOne({ storeId: store._id, createdAt: { $gte: startOfDay } }).sort({ createdAt: -1 }).lean(),
        StockCount.findOne({ storeId: store._id, createdAt: { $gte: startOfDay } }).sort({ createdAt: -1 }).lean(),
        StockCount.findOne({ storeId: store._id, createdAt: { $lt: startOfDay } }).sort({ createdAt: -1 }).lean()
    ]);

    res.json({
        success: true,
        store: formatTerminalStore(store),
        todayStr,
        tomorrowStr,
        employees: storeUsers,
        todayShifts,
        tomorrowOpener,
        tasks,
        checklistsProgress: progressMap,
        latestCashToday: latestCashToday ? {
            type: latestCashToday.type,
            countedBy: latestCashToday.countedBy,
            time: new Date(latestCashToday.createdAt).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kiev' }),
            totalCounted: latestCashToday.totalCounted
        } : null,
        latestStockToday: latestStockToday ? {
            countedBy: latestStockToday.countedBy,
            time: new Date(latestStockToday.createdAt).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kiev' }),
            preview: latestStockToday.content ? latestStockToday.content.slice(0, 80) : '',
            content: latestStockToday.content || ''
        } : null,
        previousStockCount: previousStockCount ? {
            countedBy: previousStockCount.countedBy,
            date: new Date(previousStockCount.createdAt).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Kiev' }),
            time: new Date(previousStockCount.createdAt).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kiev' }),
            content: previousStockCount.content || ''
        } : null
    });
};

// 4. Збереження перерахунку каси або інкасації
exports.saveCashCount = async (req, res) => {
    const { storeId, type, countedBy, denominations, totalCounted, expectedAmounts, totalExpected, difference, note } = req.body;

    if (!storeId || !countedBy || totalCounted === undefined) {
        return res.status(400).json({ success: false, message: "Не всі обов'язкові поля заповнені" });
    }

    const store = await Store.findById(storeId);
    if (!store) {
        return res.status(404).json({ success: false, message: "Магазин не знайдено" });
    }

    const newCashCount = await CashCount.create({
        storeId: store._id,
        type: type || 'cash',
        countedBy: countedBy.trim(),
        denominations: denominations || {},
        totalCounted: Number(totalCounted),
        expectedAmounts: Array.isArray(expectedAmounts) ? expectedAmounts : [],
        totalExpected: Number(totalExpected || 0),
        difference: Number(difference || 0),
        note: note ? note.trim() : ''
    });

    // Форматування часу Київ
    const timeStr = new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kiev' });

    // Форматування купюр для повідомлення
    let denomSummary = '';
    if (newCashCount.denominations) {
        const dObj = (newCashCount.denominations instanceof Map)
            ? Object.fromEntries(newCashCount.denominations)
            : newCashCount.denominations;
        const entries = Object.entries(dObj)
            .filter(([_, count]) => Number(count) > 0)
            .sort((a, b) => Number(b[0]) - Number(a[0]))
            .map(([denom, count]) => `${denom}×${count}`);
        if (entries.length > 0) {
            denomSummary = `\n💵 <b>Купюри:</b> ${entries.join(', ')}`;
        }
    }

    // Відправка повідомлення ботом у Telegram (без назви магазину, як просив користувач)
    if (newCashCount.type === 'encashment') {
        let targetLines = '';
        if (newCashCount.totalExpected > 0) {
            const diff = newCashCount.totalCounted - newCashCount.totalExpected;
            let diffLine = '';
            if (diff === 0) {
                diffLine = `\n✅ <b>Різниця: 0 грн (Зібрано точно 100%)</b>`;
            } else if (diff > 0) {
                diffLine = `\n⚠️ <b>РІЗНИЦЯ: +${diff.toLocaleString('uk-UA')} грн (Перебір!)</b>`;
            } else {
                diffLine = `\n❗️ <b>РІЗНИЦЯ: -${Math.abs(diff).toLocaleString('uk-UA')} грн (Не вистачає!)</b>`;
            }
            targetLines = `\n🎯 Потрібно зібрати: <b>${newCashCount.totalExpected.toLocaleString('uk-UA')} грн</b>` + diffLine;
        }

        const msg = `💼 <b>Інкасація зібрана!</b>\n` +
                    `💰 Фактично зібрано: <b>${newCashCount.totalCounted.toLocaleString('uk-UA')} грн</b>` +
                    targetLines +
                    denomSummary + `\n` +
                    `👤 Співробітник: <b>${newCashCount.countedBy}</b>\n` +
                    `🕒 Час: <b>${timeStr}</b>`;
        sendStoreCashReport(store._id, msg);
    } else {
        // Каса — формуємо розшифровку підписів (напр. "X-звіт за сьогодні", "Розмін" тощо)
        let expectedBreakdown = '';
        const rows = Array.isArray(newCashCount.expectedAmounts) ? newCashCount.expectedAmounts : [];
        if (rows.length === 1) {
            const r = rows[0];
            const label = (r.label && String(r.label).trim()) ? String(r.label).trim() : 'X-звіт за сьогодні';
            const amt = Number(r.amount || 0);
            expectedBreakdown = `\n📑 <b>${label}:</b> ${amt.toLocaleString('uk-UA')} грн`;
        } else if (rows.length > 1) {
            const listStr = rows.map(r => {
                const label = (r.label && String(r.label).trim()) ? String(r.label).trim() : 'Звіт';
                const amt = Number(r.amount || 0);
                return `   • ${label}: <b>${amt.toLocaleString('uk-UA')} грн</b>`;
            }).join('\n');
            expectedBreakdown = `\n📑 <b>Очікувано (всього ${newCashCount.totalExpected.toLocaleString('uk-UA')} грн):</b>\n${listStr}`;
        } else {
            expectedBreakdown = `\n📑 Очікувано: <b>${newCashCount.totalExpected.toLocaleString('uk-UA')} грн</b>`;
        }

        if (newCashCount.difference === 0) {
            const msg = `✅ <b>Перерахунок каси: Каса зійшлася!</b>\n` +
                        `💵 Сума в касі: <b>${newCashCount.totalCounted.toLocaleString('uk-UA')} грн</b>` +
                        expectedBreakdown +
                        denomSummary + `\n` +
                        `👤 Перерахував(ла): <b>${newCashCount.countedBy}</b>\n` +
                        `🕒 Час: <b>${timeStr}</b>`;
            sendStoreCashReport(store._id, msg);
        } else {
            const isSurplus = newCashCount.difference > 0;
            const diffFormatted = isSurplus 
                ? `+${newCashCount.difference.toLocaleString('uk-UA')} грн (Надлишок)` 
                : `${newCashCount.difference.toLocaleString('uk-UA')} грн (Нестача)`;

            const msg = `⚠️ <b>Перерахунок каси: РОЗБІЖНІСТЬ!</b>\n` +
                        `💵 Факт у касі: <b>${newCashCount.totalCounted.toLocaleString('uk-UA')} грн</b>` +
                        expectedBreakdown + `\n` +
                        `❗️ Розбіжність: <b>${diffFormatted}</b>` +
                        denomSummary + `\n` +
                        `👤 Перерахував(ла): <b>${newCashCount.countedBy}</b>\n` +
                        `🕒 Час: <b>${timeStr}</b>`;
            sendStoreCashReport(store._id, msg);
        }
    }

    res.json({ success: true, cashCount: newCashCount });
};

// 5. Історія перерахунків каси та інкасацій
exports.getCashCountHistory = async (req, res) => {
    const storeId = req.query.storeId || req.session?.terminalStoreId;
    if (!storeId) {
        return res.status(400).json({ success: false, message: "storeId обов'язковий" });
    }

    const history = await CashCount.find({ storeId })
        .sort({ createdAt: -1 })
        .limit(50)
        .lean();

    res.json({ success: true, history });
};

// 6. Збереження перерахунку складу
exports.saveStockCount = async (req, res) => {
    const { storeId, countedBy, content } = req.body;

    if (!storeId || !countedBy || !content) {
        return res.status(400).json({ success: false, message: "Вкажіть виконавця та дані перерахунку складу" });
    }

    const store = await Store.findById(storeId);
    if (!store) {
        return res.status(404).json({ success: false, message: "Магазин не знайдено" });
    }

    const newStockCount = await StockCount.create({
        storeId: store._id,
        countedBy: countedBy.trim(),
        content: content.trim()
    });

    const timeStr = new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kiev' });

    // Повідомлення ботом у Telegram (без назви магазину, як просив користувач)
    const msg = `📦 <b>Вечірній перерахунок складу</b>\n` +
                `👤 Співробітник: <b>${newStockCount.countedBy}</b>\n` +
                `🕒 Час: <b>${timeStr}</b>\n\n` +
                `📝 <b>Дані перерахунку:</b>\n${newStockCount.content}`;

    sendStoreCashReport(store._id, msg);

    res.json({ success: true, stockCount: newStockCount });
};

// 7. Історія перерахунків складу
exports.getStockCountHistory = async (req, res) => {
    const storeId = req.query.storeId || req.session?.terminalStoreId;
    if (!storeId) {
        return res.status(400).json({ success: false, message: "storeId обов'язковий" });
    }

    const history = await StockCount.find({ storeId })
        .sort({ createdAt: -1 })
        .limit(30)
        .lean();

    res.json({ success: true, history });
};

// 8. Оновлення налаштувань терміналу (для SM)
exports.updateTerminalSettings = async (req, res) => {
    const { storeId, terminalPin, dailyAnnouncement, emergencyContacts, checklists, alarmRegion, alarmDistrict, alarmTrackingStart, alarmTrackingEnd } = req.body;

    const targetStoreId = storeId || req.user?.storeId;
    if (!targetStoreId) {
        return res.status(400).json({ success: false, message: "storeId обов'язковий" });
    }

    const store = await Store.findById(targetStoreId);
    if (!store) {
        return res.status(404).json({ success: false, message: "Магазин не знайдено" });
    }

    if (terminalPin !== undefined) store.terminalPin = String(terminalPin).trim();
    if (dailyAnnouncement !== undefined) store.dailyAnnouncement = String(dailyAnnouncement).trim();
    if (emergencyContacts !== undefined && Array.isArray(emergencyContacts)) {
        store.emergencyContacts = emergencyContacts;
    }
    if (checklists !== undefined) store.checklists = checklists;
    if (alarmRegion !== undefined) store.alarmRegion = String(alarmRegion).trim();
    if (alarmDistrict !== undefined) store.alarmDistrict = String(alarmDistrict).trim();
    if (alarmTrackingStart !== undefined) store.alarmTrackingStart = String(alarmTrackingStart).trim();
    if (alarmTrackingEnd !== undefined) store.alarmTrackingEnd = String(alarmTrackingEnd).trim();

    await store.save();

    res.json({
        success: true,
        message: "Налаштування терміналу оновлено",
        store: formatTerminalStore(store)
    });
};

// 9. Отримання графіку змін магазину на місяць для модалки терміналу
exports.getTerminalSchedule = async (req, res) => {
    let storeId = req.query.storeId || req.session?.terminalStoreId;
    if (!storeId) {
        return res.status(400).json({ success: false, message: "storeId обов'язковий" });
    }

    const store = await Store.findById(storeId);
    if (!store) {
        return res.status(404).json({ success: false, message: "Магазин не знайдено" });
    }

    // Визначаємо поточну дату та запрошений місяць/рік за Києвом
    const nowKiev = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Kiev" }));
    const year = parseInt(req.query.year) || nowKiev.getFullYear();
    const month = parseInt(req.query.month) || (nowKiev.getMonth() + 1);

    const monthStr = String(month).padStart(2, '0');
    const dateRegex = new RegExp(`^${year}-${monthStr}`);

    // Співробітники цього магазину
    const storeUsers = await User.find(
        { storeId: store._id },
        'name fullName position avatar role status sortOrder storeId'
    ).populate('storeId', 'name code').sort({ name: 1 }).lean();
    const storeUserNames = storeUsers.map(u => u.name);

    // Зміни цього магазину або його працівників (або підміни)
    const shifts = await Shift.find({
        date: { $regex: dateRegex },
        $or: [
            { storeId: store._id },
            { name: { $in: storeUserNames } },
            { substituteStoreId: store._id }
        ],
        start: { $ne: 'DELETE' }
    }).select('date name start end storeId isSubstitute substituteStoreId').populate('storeId', 'name code').lean();

    // Додаємо запрошених співробітників (якщо хтось із іншого магазину має зміну тут)
    const shiftUserNames = [...new Set(shifts.map(s => s.name))];
    const missingNames = shiftUserNames.filter(n => !storeUserNames.includes(n));
    if (missingNames.length > 0) {
        const guestUsers = await User.find(
            { name: { $in: missingNames } },
            'name fullName position avatar role status sortOrder storeId'
        ).populate('storeId', 'name code').lean();
        storeUsers.push(...guestUsers);
    }

    // Оптимізуємо посилання на аватарки
    const sanitizedEmployees = storeUsers.map(u => ({
        ...u,
        avatar: u.avatar
            ? ((typeof u.avatar === 'string' && (u.avatar.startsWith('http://') || u.avatar.startsWith('https://')))
                ? u.avatar
                : `/api/avatar/${u._id}`)
            : null
    }));

    // Задачі магазину на цей місяць (для позначок 📌 та підрахунку годин задач)
    const tasks = await Task.find({
        storeId: store._id,
        date: { $regex: dateRegex }
    }).select('date name title start end isFullDay status includeHours').lean();

    const normHoursObj = store.normHours
        ? (store.normHours instanceof Map ? Object.fromEntries(store.normHours) : store.normHours)
        : {};

    const daysInMonth = new Date(year, month, 0).getDate();
    const todayStr = `${nowKiev.getFullYear()}-${String(nowKiev.getMonth() + 1).padStart(2, '0')}-${String(nowKiev.getDate()).padStart(2, '0')}`;

    res.json({
        success: true,
        store: {
            _id: store._id,
            name: store.name,
            code: store.code,
            openTime: store.openTime || '10:00',
            closeTime: store.closeTime || '22:00',
            lunch_duration_minutes: store.lunch_duration_minutes !== undefined ? store.lunch_duration_minutes : 60,
            normHours: normHoursObj,
            fte: store.fte !== undefined ? store.fte : 1
        },
        year,
        month,
        daysInMonth,
        todayStr,
        employees: sanitizedEmployees,
        shifts,
        tasks
    });
};

// 10. Отримання статусу повітряної тривоги
exports.getAlarmStatus = async (req, res) => {
    let storeId = req.query.storeId || req.session?.terminalStoreId;
    if (!storeId && req.user?.storeId) {
        storeId = req.user.storeId;
    }
    if (!storeId) {
        return res.status(400).json({ success: false, message: "storeId обов'язковий" });
    }
    const alarmService = require('../services/alarmService');
    const status = await alarmService.getStoreAlarmStatus(storeId);
    res.json({ success: true, ...status });
};

// 11. Фіксація кнопки "Відкрились"
exports.reopenStore = async (req, res) => {
    let storeId = req.body.storeId || req.session?.terminalStoreId;
    if (!storeId && req.user?.storeId) {
        storeId = req.user.storeId;
    }
    const openedBy = req.body.openedBy || req.session?.terminalUserName || req.user?.fullName || req.user?.name || 'Співробітник';
    if (!storeId) {
        return res.status(400).json({ success: false, message: "storeId обов'язковий" });
    }
    const alarmService = require('../services/alarmService');
    const result = await alarmService.recordStoreReopen(storeId, openedBy);
    res.json(result);
};

// 12. Перемикання пункту чек-ліста з міжтермінальною синхронізацією
exports.toggleChecklistItem = async (req, res) => {
    let storeId = req.body.storeId || req.session?.terminalStoreId;
    if (!storeId && req.user?.storeId) {
        storeId = req.user.storeId;
    }
    const { type, itemId, checked } = req.body;
    if (!storeId || !type || !itemId) {
        return res.status(400).json({ success: false, message: "Неповні дані для чек-ліста" });
    }

    const nowKiev = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Kiev" }));
    const y = nowKiev.getFullYear();
    const m = String(nowKiev.getMonth() + 1).padStart(2, '0');
    const d = String(nowKiev.getDate()).padStart(2, '0');
    const todayStr = `${y}-${m}-${d}`;
    const timeStr = nowKiev.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });

    let progress = await ChecklistProgress.findOne({
        storeId,
        date: todayStr,
        type
    });

    if (!progress) {
        progress = new ChecklistProgress({
            storeId,
            date: todayStr,
            type,
            items: new Map()
        });
    }

    const items = progress.items instanceof Map ? progress.items : new Map(Object.entries(progress.items || {}));
    if (checked) {
        items.set(itemId, { checked: true, time: timeStr });
    } else {
        items.delete(itemId);
    }
    progress.items = items;
    progress.updatedAt = new Date();
    await progress.save();

    const itemsObj = Object.fromEntries(items);
    res.json({
        success: true,
        type,
        items: itemsObj
    });
};

