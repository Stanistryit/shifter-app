const { User, Request, Shift, Task, NewsPost, AuditLog, Store, SalaryMatrix } = require('../models');
const { logAction } = require('../utils');
// 👇 Видалив notifyRole з імпорту, бо його немає в експорті bot.js
const { notifyUser, getBot } = require('../bot');

// --- STORES (Global Admin) ---
exports.createStore = async (req, res) => {
    const u = await User.findById(req.session.userId);
    if (u?.role !== 'admin') return res.status(403).json({ success: false, message: "Тільки для Global Admin" });

    try {
        const { name, code, type } = req.body;
        if (!name || !code || !type) return res.json({ success: false, message: "Заповніть всі поля" });

        const existing = await Store.findOne({ code });
        if (existing) return res.json({ success: false, message: "Код магазину вже зайнятий" });

        await Store.create({ name, code, type });
        logAction(u.name, 'create_store', `Created ${name} (${code})`);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
};

exports.getAllStores = async (req, res) => {
    const u = await User.findById(req.session.userId);
    if (u?.role !== 'admin') return res.status(403).json([]);

    const stores = await Store.find().sort({ createdAt: -1 });
    res.json(stores);
};

exports.deleteStore = async (req, res) => {
    const u = await User.findById(req.session.userId);
    if (u?.role !== 'admin') return res.status(403).json({ success: false, message: "Тільки для Global Admin" });

    try {
        await Store.findByIdAndDelete(req.body.id);
        logAction(u.name, 'delete_store', req.body.id);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
};

exports.updateStoreSettings = async (req, res) => {
    const u = await User.findById(req.session.userId);
    if (!u || (u.role !== 'SM' && u.role !== 'admin')) {
        return res.status(403).json({ success: false, message: "Тільки для SM" });
    }

    try {
        const { reportTime, openTime, closeTime, lunch_duration_minutes, kpi_enabled } = req.body;
        const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;

        if (reportTime && !timeRegex.test(reportTime)) {
            return res.json({ success: false, message: "Невірний формат часу звіту (HH:MM)" });
        }

        if ((openTime && !timeRegex.test(openTime)) || (closeTime && !timeRegex.test(closeTime))) {
            return res.json({ success: false, message: "Невірний формат часу роботи (HH:MM)" });
        }

        const store = await Store.findById(u.storeId);
        if (!store) return res.json({ success: false, message: "Магазин не знайдено" });

        if (reportTime) store.telegram.reportTime = reportTime;
        if (openTime) store.openTime = openTime;
        if (closeTime) store.closeTime = closeTime;
        if (lunch_duration_minutes !== undefined) {
            const parsedLunch = parseInt(lunch_duration_minutes, 10);
            if (!isNaN(parsedLunch) && parsedLunch >= 0) {
                store.lunch_duration_minutes = parsedLunch;
            }
        }
        if (kpi_enabled !== undefined) store.kpi_enabled = kpi_enabled;

        await store.save();

        logAction(u.name, 'update_settings', `Settings updated: Report=${reportTime}, Open=${openTime}, Close=${closeTime}, Lunch=${store.lunch_duration_minutes}, KPI=${store.kpi_enabled}`);
        res.json({ success: true });

    } catch (e) {
        console.error(e);
        res.status(500).json({ success: false, message: e.message });
    }
};

// --- SALARY MATRIX (Global Admin) ---
exports.getSalaryMatrix = async (req, res) => {
    const u = await User.findById(req.session.userId);
    if (u?.role !== 'admin') return res.status(403).json([]);

    try {
        const matrix = await SalaryMatrix.find();
        res.json(matrix);
    } catch (e) {
        res.status(500).json([]);
    }
};

exports.saveSalaryMatrix = async (req, res) => {
    const u = await User.findById(req.session.userId);
    if (u?.role !== 'admin') return res.status(403).json({ success: false, message: "Тільки для Global Admin" });

    try {
        const { matrix } = req.body;
        if (!matrix || !Array.isArray(matrix)) return res.json({ success: false, message: "Невірний формат даних" });

        const bulkOps = matrix.map(item => ({
            updateOne: {
                filter: { storeType: item.storeType, position: item.position, grade: item.grade },
                update: { $set: { rate: item.rate, updatedAt: Date.now() } },
                upsert: true
            }
        }));

        if (bulkOps.length > 0) {
            await SalaryMatrix.bulkWrite(bulkOps);
        }

        logAction(u.name, 'update_salary_matrix', `Updated ${bulkOps.length} rates`);
        res.json({ success: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ success: false, message: e.message });
    }
};

// --- LOGS ---
exports.getLogs = async (req, res) => {
    const u = await User.findById(req.session.userId);
    if (u?.role !== 'admin') return res.json([]);
    const l = await AuditLog.find().sort({ timestamp: -1 }).limit(50);
    res.json(l);
};

// --- REQUESTS ---
exports.getRequests = async (req, res) => {
    const u = await User.findById(req.session.userId);
    if (u?.role !== 'SM' && u?.role !== 'admin') return res.json([]);

    let r = await Request.find().sort({ createdAt: -1 });

    if (u.role !== 'admin') {
        const storeUsers = await User.find({ storeId: u.storeId }, 'name');
        const storeUserNames = storeUsers.map(user => user.name);
        r = r.filter(req => storeUserNames.includes(req.createdBy));
    }

    res.json(r);
};

exports.handleRequestAction = async (req, res) => {
    const u = await User.findById(req.session.userId);
    const { id, action } = req.body;
    const r = await Request.findById(id);
    if (!r) return res.json({ success: false });

    const creator = await User.findOne({ name: r.createdBy });
    const storeId = creator ? creator.storeId : (u ? u.storeId : null);

    if (action === 'approve') {
        if (r.type === 'add_shift') {
            await Shift.deleteOne({ date: r.data.date, name: r.data.name });
            r.data.storeId = storeId;
            await Shift.create(r.data);
        }
        if (r.type === 'del_shift') await Shift.findByIdAndDelete(r.data.id);
        if (r.type === 'del_task') await Task.findByIdAndDelete(r.data.id);
        if (r.type === 'add_task') {
            if (r.data.name === 'all') {
                const users = await User.find({ role: { $nin: ['admin', 'RRP'] }, storeId: storeId });
                const tasksToCreate = users.map(userObj => ({ ...r.data, name: userObj.name, storeId: userObj.storeId }));
                await Task.insertMany(tasksToCreate);
                users.forEach(userObj => notifyUser(userObj.name, `✅ Задача схвалена: ${r.data.title}`));
            } else {
                const targetUser = await User.findOne({ name: r.data.name });
                r.data.storeId = targetUser ? targetUser.storeId : storeId;
                await Task.create(r.data);
                notifyUser(r.data.name, `✅ Задача схвалена: ${r.data.title}`);
            }
        }
        notifyUser(r.createdBy, `✅ Ваш запит (${r.type}) схвалено`);
    } else {
        notifyUser(r.createdBy, `❌ Ваш запит (${r.type}) відхилено`);
    }
    await Request.findByIdAndDelete(id);
    res.json({ success: true });
};

exports.approveAllRequests = async (req, res) => {
    const u = await User.findById(req.session.userId);
    let rs = await Request.find();

    if (u.role !== 'admin') {
        const storeUsers = await User.find({ storeId: u.storeId }, 'name');
        const storeUserNames = storeUsers.map(user => user.name);
        rs = rs.filter(req => storeUserNames.includes(req.createdBy));
    }

    for (const r of rs) {
        const creator = await User.findOne({ name: r.createdBy });
        const storeId = creator ? creator.storeId : (u ? u.storeId : null);

        if (r.type === 'add_shift') {
            await Shift.deleteOne({ date: r.data.date, name: r.data.name });
            r.data.storeId = storeId;
            await Shift.create(r.data);
        }
        if (r.type === 'del_shift') await Shift.findByIdAndDelete(r.data.id);
        if (r.type === 'del_task') await Task.findByIdAndDelete(r.data.id);
        if (r.type === 'add_task') {
            if (r.data.name === 'all') {
                const users = await User.find({ role: { $nin: ['admin', 'RRP'] }, storeId: storeId });
                const tasksToCreate = users.map(userObj => ({ ...r.data, name: userObj.name, storeId: userObj.storeId }));
                await Task.insertMany(tasksToCreate);
            } else {
                const targetUser = await User.findOne({ name: r.data.name });
                r.data.storeId = targetUser ? targetUser.storeId : storeId;
                await Task.create(r.data);
            }
        }
        await Request.findByIdAndDelete(r._id);
    }

    // 🔥 ВИПРАВЛЕНО: Замість notifyRole вручну шукаємо SSE і відправляємо повідомлення
    const query = { role: 'SSE' };
    if (u.role !== 'admin') query.storeId = u.storeId;

    const sses = await User.find(query);
    sses.forEach(sse => notifyUser(sse.name, '✅ Всі запити схвалено'));

    res.json({ success: true });
};

exports.publishNews = async (req, res) => {
    const u = await User.findById(req.session.userId);
    if (u.role !== 'SM' && u.role !== 'admin') return res.status(403).json({});

    const bot = getBot();
    const { text, requestRead } = req.body;
    const files = req.files || [];

    const store = await Store.findById(u.storeId);

    if (!store || !store.telegram.chatId) return res.json({ success: false, message: "Telegram не налаштовано" });

    const chatId = store.telegram.chatId;
    const topicId = store.telegram.newsTopicId;

    const opts = { parse_mode: 'HTML' };
    if (topicId) opts.message_thread_id = topicId;

    const shouldRequestRead = requestRead === 'true';
    const btn = { inline_keyboard: [[{ text: "✅ Ознайомлений", callback_data: 'read_news' }]] };
    const replyMarkup = shouldRequestRead ? btn : undefined;

    // 🔥 Визначаємо тип файлу за мімтайпом АБО розширенням (PDF може прийти як application/octet-stream)
    const isImageFile = (f) => {
        if (f.mimetype && f.mimetype.startsWith('image/')) return true;
        const ext = (f.originalname || '').split('.').pop().toLowerCase();
        return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext);
    };

    let sentMsg;

    try {
        if (!files.length) {
            sentMsg = await bot.sendMessage(chatId, `📢 <b>Новини:</b>\n\n${text}`, { ...opts, reply_markup: replyMarkup });
        } else if (files.length === 1) {
            const f = files[0];
            const filename = Buffer.from(f.originalname, 'latin1').toString('utf8');

            if (isImageFile(f)) {
                sentMsg = await bot.sendPhoto(
                    chatId,
                    f.buffer,
                    { ...opts, caption: `📢 <b>Новини:</b>\n\n${text}`, reply_markup: replyMarkup },
                    { filename, contentType: f.mimetype }
                );
            } else {
                sentMsg = await bot.sendDocument(
                    chatId,
                    f.buffer,
                    { ...opts, caption: `📢 <b>Новини:</b>\n\n${text}`, reply_markup: replyMarkup },
                    { filename, contentType: f.mimetype }
                );
            }
        } else {
            // Кілька файлів: відправляємо по одному (sendMediaGroup з буферами ненадійний)
            const msgs = [];
            for (let i = 0; i < files.length; i++) {
                const f = files[i];
                const filename = Buffer.from(f.originalname, 'latin1').toString('utf8');
                const caption = i === 0 ? `📢 <b>Новини:</b>\n\n${text}` : '';
                const fileOpts = { ...opts, caption, reply_markup: i === files.length - 1 && !shouldRequestRead ? undefined : undefined };

                let msg;
                const tgFileOpts = { filename, contentType: f.mimetype };
                if (isImageFile(f)) {
                    msg = await bot.sendPhoto(chatId, f.buffer, { ...opts, caption }, tgFileOpts);
                } else {
                    msg = await bot.sendDocument(chatId, f.buffer, { ...opts, caption }, tgFileOpts);
                }
                msgs.push(msg);
            }

            if (shouldRequestRead) {
                sentMsg = await bot.sendMessage(chatId, "👇 Підтвердити:", { ...opts, reply_to_message_id: msgs[0].message_id, reply_markup: btn });
            } else {
                sentMsg = msgs[0];
            }
        }

        await NewsPost.create({ messageId: sentMsg.message_id, chatId: sentMsg.chat.id, text, type: files.length ? 'file' : 'text', readBy: [] });
        logAction(u.name, 'publish_news', 'Posted');
        res.json({ success: true });

    } catch (error) {
        console.error("News Error:", error.message);
        res.json({ success: false, message: `Помилка відправки в Telegram: ${error.message}` });
    }
};


// --- Експорт графіку в CSV ---
exports.exportSchedule = async (req, res) => {
    const u = await User.findById(req.session.userId);
    if (!u || (u.role !== 'SM' && u.role !== 'admin')) {
        return res.status(403).json({ success: false, message: "Тільки для SM" });
    }

    try {
        const { month, year } = req.query; // example: month=05, year=2024
        if (!month || !year) {
            return res.status(400).json({ success: false, message: "Не вказано місяць та рік" });
        }

        const m = month.padStart(2, '0');
        const prefix = `${year}-${m}-`; // "2024-05-"

        const shifts = await Shift.find({ storeId: u.storeId, date: { $regex: `^${prefix}` } });

        if (shifts.length === 0) {
            // Порожній файл з повідомленням або 404
            return res.status(404).json({ success: false, message: "Немає даних за цей місяць" });
        }

        // Збираємо унікальні дати (колонки) та імена (рядки)
        const dateSet = new Set();
        const namesSet = new Set();
        const matrix = {}; // matrix[name][date] = "start-end" | "status"

        shifts.forEach(s => {
            dateSet.add(s.date);
            namesSet.add(s.name);

            if (!matrix[s.name]) matrix[s.name] = {};

            if (s.end) {
                matrix[s.name][s.date] = `${s.start}-${s.end}`;
            } else {
                matrix[s.name][s.date] = s.start;
            }
        });

        // Сортуємо дати та імена
        const dates = Array.from(dateSet).sort();
        const names = Array.from(namesSet).sort();

        // Формуємо CSV-рядки
        let csvLines = [];

        // Рядок 1 (Заголовки): "Ім'я / Дата", "2024-05-01", "2024-05-02"...
        const headers = ["Ім'я / Дата", ...dates];
        csvLines.push(headers.join(','));

        // Рядки працівників
        names.forEach(name => {
            const row = [name];
            dates.forEach(date => {
                row.push(matrix[name][date] || "-");
            });
            csvLines.push(row.join(','));
        });

        const csvContent = "\uFEFF" + csvLines.join('\n'); // \uFEFF - BOM (щоб Excel розумів UTF-8)

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="shifter_schedule_${year}_${m}.csv"`);
        res.send(csvContent);

    } catch (e) {
        console.error("Export Error:", e.message);
        res.status(500).json({ success: false, message: "Server Error" });
    }
};

const pdfService = require('../services/pdfService');

exports.exportSchedulePdf = async (req, res) => {
    const u = await User.findById(req.session.userId);
    if (!u || (u.role !== 'SM' && u.role !== 'admin')) {
        return res.status(403).json({ success: false, message: "Тільки для SM" });
    }

    try {
        const { month, year } = req.query;
        if (!month || !year) {
            return res.status(400).json({ success: false, message: "Не вказано місяць та рік" });
        }

        const m = month.padStart(2, '0');
        const prefix = `${year}-${m}-`;

        const store = await Store.findById(u.storeId);
        const storeName = store ? store.name : "Невідомий магазин";
        const lunchMins = store?.lunch_duration_minutes ? store.lunch_duration_minutes : 0;

        const shifts = await Shift.find({ storeId: u.storeId, date: { $regex: `^${prefix}` } });
        if (shifts.length === 0) {
            return res.status(404).json({ success: false, message: "Немає даних за цей місяць" });
        }

        const dateSet = new Set();
        const namesSet = new Set();
        const matrix = {};
        const totals = {}; // Зберігатиме суму годин: totals[name] = number

        shifts.forEach(s => {
            dateSet.add(s.date);
            namesSet.add(s.name);

            if (!matrix[s.name]) {
                matrix[s.name] = {};
                totals[s.name] = 0;
            }

            if (s.end) {
                matrix[s.name][s.date] = `${s.start}-${s.end}`;

                // Розрахунок годин
                if (typeof s.start === 'string' && s.start.includes(':') && typeof s.end === 'string' && s.end.includes(':')) {
                    const parseTime = (t) => {
                        const [h, m] = t.split(':').map(Number);
                        return (h || 0) + ((m || 0) / 60);
                    };

                    let startD = parseTime(s.start);
                    let endD = parseTime(s.end);

                    // Обробка нічних змін
                    if (endD <= 6 && startD > endD) {
                        endD += 24;
                    } else if (endD === 0 && startD > 0) {
                        endD = 24;
                    }

                    let duration = endD - startD - (lunchMins / 60);
                    if (duration < 0) duration = 0;
                    totals[s.name] += duration;
                }

            } else {
                matrix[s.name][s.date] = s.start;
            }
        });

        const dates = Array.from(dateSet).sort();
        const names = Array.from(namesSet).sort((a, b) => a.localeCompare(b));

        // Округлення годин
        Object.keys(totals).forEach(name => {
            totals[name] = parseFloat(totals[name].toFixed(1));
        });

        // Генеруємо PDF через сервіс (додаємо параметр totals)
        const pdfBuffer = await pdfService.generateSchedulePdf(storeName, m, year, dates, names, matrix, totals);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="shifter_schedule_${year}_${m}.pdf"`);
        res.send(pdfBuffer);

    } catch (e) {
        console.error("PDF Export Error:", e.message);
        res.status(500).json({ success: false, message: "Server Error" });
    }
};