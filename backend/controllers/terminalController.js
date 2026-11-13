const ExcelJS = require('exceljs');
const { Store, User, Shift, Task, CashCount, StockCount, ChecklistProgress } = require('../models');
const { sendStoreCashReport } = require('../bot/notifications');

const DEFAULT_IGNORE_KEYWORDS = ['[MM]', '[ММ]', 'Апгрейд', 'Агрейд', 'Upgrade', 'Послуга', 'Сервіс'];

function getNormalizedStockTransferSettings(store) {
    const raw = store?.stockTransferSettings || {};
    return {
        defaultNorm: Number(raw.defaultNorm || 0),
        ignoreZeroPrice: raw.ignoreZeroPrice !== undefined ? Boolean(raw.ignoreZeroPrice) : true,
        ignoreKeywords: Array.isArray(raw.ignoreKeywords)
            ? raw.ignoreKeywords
            : [...DEFAULT_IGNORE_KEYWORDS],
        ignoredKeys: Array.isArray(raw.ignoredKeys) ? raw.ignoredKeys : [],
        norms: Array.isArray(raw.norms) ? raw.norms : []
    };
}

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
        alarmTopicId: store.telegram?.alarmTopicId || null,
        stockTransferSettings: getNormalizedStockTransferSettings(store)
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

    // Користувачі магазину (виключаємо звільнених / заблокованих)
    const allStoreUsers = await User.find({ storeId }, 'name fullName position avatar role status');
    const blockedNames = new Set(allStoreUsers.filter(u => u.status === 'blocked').map(u => u.name));
    const storeUsers = allStoreUsers.filter(u => u.status !== 'blocked');
    const storeUserNames = storeUsers.map(u => u.name);

    // Зміни сьогодні (і для штату, і для гостей, крім звільнених)
    const rawTodayShifts = await Shift.find({
        date: todayStr,
        $or: [
            { storeId: store._id },
            { name: { $in: storeUserNames }, storeId: null }
        ],
        start: { $nin: ['Відпустка', 'Лікарняний', 'Донорство', 'DELETE'] }
    }).lean();
    const todayShifts = rawTodayShifts.filter(s => !blockedNames.has(s.name));

    // Зміни завтра (щоб дізнатися хто відкриває, крім звільнених)
    const rawTomorrowShifts = await Shift.find({
        date: tomorrowStr,
        $or: [
            { storeId: store._id },
            { name: { $in: storeUserNames }, storeId: null }
        ],
        start: { $nin: ['Відпустка', 'Лікарняний', 'Донорство', 'DELETE'] }
    }).lean();
    const tomorrowShifts = rawTomorrowShifts.filter(s => !blockedNames.has(s.name));

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

// =========================================================
// 13. ПІДСОРТ ТОВАРУ ЗІ СКЛАДУ (ПОРІВНЯННЯ EXCEL МАГАЗИН ↔ СКЛАД)
// =========================================================

function cellToPrimitive(val) {
    if (val === null || val === undefined) return '';
    if (typeof val === 'object') {
        if (val.result !== undefined) return val.result;
        if (Array.isArray(val.richText)) return val.richText.map(t => t.text || '').join('');
        if (val.text !== undefined) return val.text;
    }
    return val;
}

function buildStockProductKey(title, color, code) {
    const baseCode = code ? String(code).split('.')[0].trim().toUpperCase() : '';
    const cleanColor = color ? String(color).trim().toLowerCase() : '';
    const cleanTitle = String(title || '').trim().replace(/\s+/g, ' ').toLowerCase();

    if (baseCode) {
        return cleanColor ? `${baseCode}__${cleanColor}` : baseCode;
    }
    return cleanColor ? `${cleanTitle}__${cleanColor}` : cleanTitle;
}

function shouldIgnoreStockItem(item, settings) {
    if (!item || !item.title) return { ignored: true, reason: 'empty' };

    if (Array.isArray(settings.ignoredKeys) && settings.ignoredKeys.includes(item.key)) {
        return { ignored: true, reason: 'manual' };
    }

    const lowerTitle = String(item.title || '').toLowerCase();
    const keywords = Array.isArray(settings.ignoreKeywords) ? settings.ignoreKeywords : DEFAULT_IGNORE_KEYWORDS;
    for (const kw of keywords) {
        const cleanKw = String(kw || '').trim().toLowerCase();
        if (cleanKw && lowerTitle.includes(cleanKw)) {
            return { ignored: true, reason: 'keyword', keyword: kw };
        }
    }

    if (settings.ignoreZeroPrice) {
        const priceNum = Number(item.price || 0);
        if (!Number.isFinite(priceNum) || priceNum <= 0) {
            return { ignored: true, reason: 'zero_price' };
        }
    }

    return { ignored: false };
}

exports.parseStockExcel = async (req, res) => {
    let storeId = req.body?.storeId || req.query?.storeId || req.session?.terminalStoreId;
    if (!storeId && req.user?.storeId) {
        storeId = req.user.storeId;
    }
    if (!storeId) {
        return res.status(400).json({ success: false, message: "storeId обов'язковий" });
    }
    if (!req.file || !req.file.buffer) {
        return res.status(400).json({ success: false, message: "Файл Excel не передано" });
    }

    const store = await Store.findById(storeId);
    if (!store) {
        return res.status(404).json({ success: false, message: "Магазин не знайдено" });
    }

    const settings = getNormalizedStockTransferSettings(store);

    const wb = new ExcelJS.Workbook();
    try {
        await wb.xlsx.load(req.file.buffer);
    } catch (err) {
        return res.status(400).json({
            success: false,
            message: "Не вдалося прочитати файл Excel (.xlsx). Перевірте формат файлу."
        });
    }

    const ws = wb.worksheets[0];
    if (!ws || ws.rowCount < 1) {
        return res.status(400).json({ success: false, message: "Файл порожній" });
    }

    // Визначаємо колонки за заголовками 1-го рядка (або використовуємо стандартні 1..9)
    const colMap = {
        title: 1,
        color: 2,
        code: 3,
        barcode: 4,
        batch: 5,
        qty: 6,
        warehouse: 7,
        sold: 8,
        price: 9
    };

    const headerRow = ws.getRow(1);
    headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        const h = String(cellToPrimitive(cell.value) || '').trim().toLowerCase();
        if (h.includes('назва')) colMap.title = colNumber;
        else if (h.includes('колір')) colMap.color = colNumber;
        else if (h.includes('код товару') || h === 'код') colMap.code = colNumber;
        else if (h.includes('штрих')) colMap.barcode = colNumber;
        else if (h.includes('партія')) colMap.batch = colNumber;
        else if (h.includes('кількість') || h.includes('залишок')) colMap.qty = colNumber;
        else if (h.includes('склад')) colMap.warehouse = colNumber;
        else if (h.includes('ціна')) colMap.price = colNumber;
    });

    const groupedMap = new Map();
    let detectedWarehouse = '';

    for (let r = 2; r <= ws.rowCount; r++) {
        const row = ws.getRow(r);
        const rawTitle = String(cellToPrimitive(row.getCell(colMap.title).value) || '').trim();
        if (!rawTitle) continue;
        // Пропускаємо можливий підсумковий рядок "Всього" / "Разом"
        if (/^(всього|разом|итого|total)\b/i.test(rawTitle)) continue;

        const rawColor = String(cellToPrimitive(row.getCell(colMap.color).value) || '').trim();
        const rawCode = String(cellToPrimitive(row.getCell(colMap.code).value) || '').trim();
        const rawBarcode = String(cellToPrimitive(row.getCell(colMap.barcode).value) || '').trim();
        const rawBatch = String(cellToPrimitive(row.getCell(colMap.batch).value) || rawCode || '').trim();
        const rawQty = parseFloat(String(cellToPrimitive(row.getCell(colMap.qty).value) || '0').replace(',', '.')) || 0;
        const rawWarehouse = String(cellToPrimitive(row.getCell(colMap.warehouse).value) || '').trim();
        const rawPrice = parseFloat(String(cellToPrimitive(row.getCell(colMap.price).value) || '0').replace(',', '.')) || 0;

        if (rawWarehouse && !detectedWarehouse) {
            detectedWarehouse = rawWarehouse;
        }

        const baseCode = rawCode ? rawCode.split('.')[0].trim().toUpperCase() : '';
        const key = buildStockProductKey(rawTitle, rawColor, rawCode);

        if (!groupedMap.has(key)) {
            groupedMap.set(key, {
                key,
                title: rawTitle,
                color: rawColor,
                baseCode,
                code: rawCode,
                barcode: rawBarcode,
                qty: 0,
                price: rawPrice,
                warehouse: rawWarehouse,
                batches: []
            });
        }

        const entry = groupedMap.get(key);
        entry.qty += rawQty;
        if (rawPrice > entry.price) entry.price = rawPrice;
        if (!entry.barcode && rawBarcode) entry.barcode = rawBarcode;
        if (!entry.baseCode && baseCode) entry.baseCode = baseCode;
        if (rawBatch) {
            const existingBatch = entry.batches.find(b => b.batch === rawBatch);
            if (existingBatch) {
                existingBatch.qty += rawQty;
            } else {
                entry.batches.push({ batch: rawBatch, qty: rawQty });
            }
        }
    }

    const validItems = [];
    const ignoredItems = [];

    for (const item of groupedMap.values()) {
        const check = shouldIgnoreStockItem(item, settings);
        if (check.ignored) {
            ignoredItems.push({
                key: item.key,
                title: item.title,
                price: item.price,
                qty: item.qty,
                reason: check.reason,
                keyword: check.keyword || null
            });
        } else {
            validItems.push(item);
        }
    }

    // Оновлюємо довідник норм магазину (додаємо нові валідні товари та очищуємо ігноровані за правилами)
    const existingNorms = Array.isArray(settings.norms) ? settings.norms : [];
    const cleanedNormsMap = new Map();

    for (const n of existingNorms) {
        if (!n || !n.key) continue;
        // Якщо товар потрапив під правило ігнору за ключовим словом чи ціною 0 — прибираємо з норм
        const check = shouldIgnoreStockItem(n, settings);
        if (check.ignored && check.reason !== 'manual') continue;
        cleanedNormsMap.set(n.key, { ...n });
    }

    let normsChanged = cleanedNormsMap.size !== existingNorms.length;

    for (const item of validItems) {
        if (!cleanedNormsMap.has(item.key)) {
            cleanedNormsMap.set(item.key, {
                key: item.key,
                title: item.title,
                color: item.color || '',
                baseCode: item.baseCode || '',
                barcode: item.barcode || '',
                price: item.price || 0,
                targetQty: Number(settings.defaultNorm || 0)
            });
            normsChanged = true;
        } else {
            const normEntry = cleanedNormsMap.get(item.key);
            if (item.price > 0 && normEntry.price !== item.price) {
                normEntry.price = item.price;
                normsChanged = true;
            }
            if (item.barcode && !normEntry.barcode) {
                normEntry.barcode = item.barcode;
                normsChanged = true;
            }
            if (item.baseCode && !normEntry.baseCode) {
                normEntry.baseCode = item.baseCode;
                normsChanged = true;
            }
        }
    }

    if (normsChanged || !store.stockTransferSettings) {
        const sortedNorms = Array.from(cleanedNormsMap.values()).sort((a, b) =>
            String(a.title || '').localeCompare(String(b.title || ''), 'uk')
        );
        store.stockTransferSettings = {
            ...settings,
            norms: sortedNorms
        };
        store.markModified('stockTransferSettings');
        await store.save();
    }

    // Декодуємо ім'я файлу з latin1 в utf8 за потреби (особливість multer)
    let fileName = req.file.originalname || 'file.xlsx';
    try {
        const decoded = Buffer.from(fileName, 'latin1').toString('utf8');
        if (!decoded.includes('\ufffd')) fileName = decoded;
    } catch (e) { }

    res.json({
        success: true,
        fileName,
        warehouseName: detectedWarehouse || fileName.replace(/\.xlsx?$/i, ''),
        items: validItems,
        ignoredCount: ignoredItems.length,
        ignoredItems: ignoredItems.slice(0, 30),
        stockTransferSettings: getNormalizedStockTransferSettings(store)
    });
};

exports.updateStockTransferSettings = async (req, res) => {
    let storeId = req.body?.storeId || req.query?.storeId || req.session?.terminalStoreId;
    if (!storeId && req.user?.storeId) {
        storeId = req.user.storeId;
    }
    if (!storeId) {
        return res.status(400).json({ success: false, message: "storeId обов'язковий" });
    }

    const store = await Store.findById(storeId);
    if (!store) {
        return res.status(404).json({ success: false, message: "Магазин не знайдено" });
    }

    const settings = getNormalizedStockTransferSettings(store);
    const {
        defaultNorm,
        ignoreZeroPrice,
        ignoreKeywords,
        ignoredKeys,
        normUpdate,
        bulkNormUpdates,
        removeNormKey
    } = req.body;

    if (defaultNorm !== undefined) {
        settings.defaultNorm = Math.max(0, Number(defaultNorm) || 0);
    }
    if (ignoreZeroPrice !== undefined) {
        settings.ignoreZeroPrice = Boolean(ignoreZeroPrice);
    }
    if (Array.isArray(ignoreKeywords)) {
        settings.ignoreKeywords = ignoreKeywords
            .map(k => String(k || '').trim())
            .filter(Boolean);
    }
    if (Array.isArray(ignoredKeys)) {
        settings.ignoredKeys = [...new Set(ignoredKeys.map(k => String(k || '').trim()).filter(Boolean))];
    }

    const normsMap = new Map();
    for (const n of (settings.norms || [])) {
        if (n && n.key) normsMap.set(n.key, { ...n });
    }

    if (removeNormKey && normsMap.has(removeNormKey)) {
        normsMap.delete(removeNormKey);
    }

    if (normUpdate && normUpdate.key) {
        const existing = normsMap.get(normUpdate.key) || {
            key: normUpdate.key,
            title: normUpdate.title || normUpdate.key,
            color: normUpdate.color || '',
            baseCode: normUpdate.baseCode || '',
            barcode: normUpdate.barcode || '',
            price: Number(normUpdate.price || 0)
        };
        existing.targetQty = Math.max(0, Number(normUpdate.targetQty) || 0);
        if (normUpdate.title) existing.title = normUpdate.title;
        if (normUpdate.color !== undefined) existing.color = normUpdate.color;
        if (normUpdate.baseCode) existing.baseCode = normUpdate.baseCode;
        if (normUpdate.price) existing.price = Number(normUpdate.price);
        normsMap.set(normUpdate.key, existing);
    }

    if (Array.isArray(bulkNormUpdates)) {
        for (const u of bulkNormUpdates) {
            if (!u || !u.key) continue;
            const existing = normsMap.get(u.key) || {
                key: u.key,
                title: u.title || u.key,
                color: u.color || '',
                baseCode: u.baseCode || '',
                barcode: u.barcode || '',
                price: Number(u.price || 0)
            };
            existing.targetQty = Math.max(0, Number(u.targetQty) || 0);
            normsMap.set(u.key, existing);
        }
    }

    // Очищуємо довідник норм від позицій, які тепер підпадають під стоп-слова або ціну 0
    for (const [k, n] of normsMap.entries()) {
        const check = shouldIgnoreStockItem(n, settings);
        if (check.ignored && check.reason !== 'manual') {
            normsMap.delete(k);
        }
    }

    settings.norms = Array.from(normsMap.values()).sort((a, b) =>
        String(a.title || '').localeCompare(String(b.title || ''), 'uk')
    );

    store.stockTransferSettings = settings;
    store.markModified('stockTransferSettings');
    await store.save();

    res.json({
        success: true,
        stockTransferSettings: getNormalizedStockTransferSettings(store)
    });
};

exports.sendStockTransferTelegram = async (req, res) => {
    let storeId = req.body?.storeId || req.session?.terminalStoreId;
    if (!storeId && req.user?.storeId) {
        storeId = req.user.storeId;
    }
    const { author, shopWarehouseName, sourceWarehouseName, items } = req.body;

    if (!storeId || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ success: false, message: "Список товарів для відправки порожній" });
    }

    const store = await Store.findById(storeId);
    if (!store) {
        return res.status(404).json({ success: false, message: "Магазин не знайдено" });
    }

    const timeStr = new Date().toLocaleTimeString('uk-UA', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/Kiev'
    });

    let totalUnits = 0;
    const lines = items.map((item, idx) => {
        const toBring = Number(item.toBring || 0);
        totalUnits += toBring;
        const colorPart = item.color ? ` (${item.color})` : '';
        const batchPart = item.batchesText ? ` | 🏷 <code>${item.batchesText}</code>` : (item.baseCode ? ` | <code>${item.baseCode}</code>` : '');
        const stockDetails = `(Маг: ${Number(item.shopQty || 0)} / Норма: ${Number(item.targetQty || 0)} / Склад: ${Number(item.whQty || 0)})`;
        return `${idx + 1}. <b>${item.title}${colorPart}</b>\n   👉 Принести: <b>${toBring} шт</b> ${stockDetails}${batchPart}`;
    });

    const header =
        `🚚 <b>Список на підсорт зі складу</b>\n` +
        (sourceWarehouseName || shopWarehouseName
            ? `🏭 <code>${sourceWarehouseName || 'Склад'}</code> ➔ 🏪 <code>${shopWarehouseName || store.name}</code>\n`
            : '') +
        `👤 Сформував(ла): <b>${author || 'Співробітник'}</b> | 🕒 <b>${timeStr}</b>\n` +
        `📦 Всього позицій: <b>${items.length}</b> (на <b>${totalUnits} шт</b>)\n\n`;

    // Якщо список дуже великий, розбиваємо на частини до 3800 символів
    let currentMsg = header;
    for (const line of lines) {
        if ((currentMsg + line + '\n\n').length > 3800) {
            await sendStoreCashReport(store._id, currentMsg.trim());
            currentMsg = `🚚 <b>Продовження списку на підсорт:</b>\n\n` + line + '\n';
        } else {
            currentMsg += line + '\n';
        }
    }
    if (currentMsg.trim()) {
        await sendStoreCashReport(store._id, currentMsg.trim());
    }

    res.json({ success: true });
};


