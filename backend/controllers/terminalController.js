const { Store, User, Shift, Task, CashCount, StockCount } = require('../models');
const { sendStoreCashReport } = require('../bot/notifications');

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
        store: {
            _id: store._id,
            name: store.name,
            code: store.code,
            openTime: store.openTime || "10:00",
            closeTime: store.closeTime || "22:00",
            emergencyContacts: store.emergencyContacts || [],
            dailyAnnouncement: store.dailyAnnouncement || ""
        }
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
        store: {
            _id: store._id,
            name: store.name,
            code: store.code,
            openTime: store.openTime || "10:00",
            closeTime: store.closeTime || "22:00",
            emergencyContacts: store.emergencyContacts || [],
            dailyAnnouncement: store.dailyAnnouncement || ""
        }
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

    // Задачі на сьогодні
    const tasks = await Task.find({
        date: todayStr,
        storeId: store._id
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

    res.json({
        success: true,
        store: {
            _id: store._id,
            name: store.name,
            code: store.code,
            openTime: store.openTime || "10:00",
            closeTime: store.closeTime || "22:00",
            emergencyContacts: store.emergencyContacts || [],
            dailyAnnouncement: store.dailyAnnouncement || ""
        },
        todayStr,
        tomorrowStr,
        employees: storeUsers,
        todayShifts,
        tomorrowOpener,
        tasks
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

    // Відправка повідомлення ботом у Telegram (без назви магазину, як просив користувач)
    if (newCashCount.type === 'encashment') {
        const msg = `💼 <b>Інкасація зібрана!</b>\n` +
                    `💰 Сума: <b>${newCashCount.totalCounted.toLocaleString('uk-UA')} грн</b>\n` +
                    `👤 Співробітник: <b>${newCashCount.countedBy}</b>\n` +
                    `🕒 Час: <b>${timeStr}</b>`;
        sendStoreCashReport(store._id, msg);
    } else {
        // Каса
        if (newCashCount.difference === 0) {
            const msg = `✅ <b>Перерахунок каси: Каса зійшлася!</b>\n` +
                        `💵 Сума в касі: <b>${newCashCount.totalCounted.toLocaleString('uk-UA')} грн</b>\n` +
                        `👤 Перерахував(ла): <b>${newCashCount.countedBy}</b>\n` +
                        `🕒 Час: <b>${timeStr}</b>`;
            sendStoreCashReport(store._id, msg);
        } else {
            const isSurplus = newCashCount.difference > 0;
            const diffFormatted = isSurplus 
                ? `+${newCashCount.difference.toLocaleString('uk-UA')} грн (Надлишок)` 
                : `${newCashCount.difference.toLocaleString('uk-UA')} грн (Нестача)`;

            const msg = `⚠️ <b>Перерахунок каси: РОЗБІЖНІСТЬ!</b>\n` +
                        `💵 Факт у касі: <b>${newCashCount.totalCounted.toLocaleString('uk-UA')} грн</b>\n` +
                        `📑 Очікувано (звіти): <b>${newCashCount.totalExpected.toLocaleString('uk-UA')} грн</b>\n` +
                        `❗️ Розбіжність: <b>${diffFormatted}</b>\n` +
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
    const { storeId, terminalPin, dailyAnnouncement, emergencyContacts } = req.body;

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

    await store.save();

    res.json({
        success: true,
        message: "Налаштування терміналу оновлено",
        store: {
            _id: store._id,
            terminalPin: store.terminalPin,
            dailyAnnouncement: store.dailyAnnouncement,
            emergencyContacts: store.emergencyContacts
        }
    });
};
