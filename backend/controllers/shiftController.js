const { Shift, User, Request, Store } = require('../models');
const { logAction, handlePermission } = require('../utils');
const { notifyUser, sendRequestToSM, getBot } = require('../bot');

const runMigrationIfNeeded = async () => {
    const count = await Shift.countDocuments({ storeId: null });
    if (count === 0) return;

    const shifts = await Shift.find({ storeId: null });
    const users = await User.find({}, 'name storeId');
    const userMap = {};
    users.forEach(u => { userMap[u.name] = u.storeId; });

    const bulkOps = [];
    for (const s of shifts) {
        if (userMap[s.name]) {
            bulkOps.push({
                updateOne: {
                    filter: { _id: s._id },
                    update: { $set: { storeId: userMap[s.name] } }
                }
            });
        }
    }

    if (bulkOps.length > 0) {
        await Shift.bulkWrite(bulkOps);
    }
};

exports.getShifts = async (req, res) => {
    if (!req.session.userId) return res.status(403).json({});
    
    await runMigrationIfNeeded();

    const currentUser = await User.findById(req.session.userId);
    let query = {};

    if (currentUser.role !== 'admin') {
        query.storeId = currentUser.storeId;
    } 
    
    const s = await Shift.find(query);
    res.json(s);
};

exports.addShift = async (req, res) => {
    const perm = await handlePermission(req, req.session.userId);
    if (perm === 'unauthorized' || perm === 'forbidden') return res.status(403).json({});
    const { user, status } = perm;

    if (status === 'pending') {
        // Додаємо storeId до запиту, щоб SM бачив, з якого магазину
        const targetUser = await User.findOne({ name: req.body.name });
        const storeId = targetUser ? targetUser.storeId : user.storeId;
        
        const reqDoc = await Request.create({ 
            type: 'add_shift', 
            data: { ...req.body, storeId }, 
            createdBy: user.name 
        });
        sendRequestToSM(reqDoc);
        return res.json({ success: true, pending: true });
    }

    const targetUser = await User.findOne({ name: req.body.name });
    const shiftData = { ...req.body };
    
    if (targetUser && targetUser.storeId) {
        shiftData.storeId = targetUser.storeId;
    } else if (user.storeId) {
        shiftData.storeId = user.storeId; 
    }

    await Shift.deleteOne({ date: req.body.date, name: req.body.name });
    await Shift.create(shiftData);
    logAction(user.name, 'add_shift', `${req.body.date} ${req.body.name}`);

    const todayStr = new Date().toISOString().split('T')[0];
    if (req.body.date >= todayStr) {
        const typeInfo = req.body.start === 'Відпустка' ? '🌴 <b>Відпустка</b>' : `⏰ Час: <b>${req.body.start} - ${req.body.end}</b>`;
        notifyUser(req.body.name, `📅 <b>Графік оновлено!</b>\n\n📆 Дата: <b>${req.body.date}</b>\n${typeInfo}`);
    }
    res.json({ success: true });
};

// 🔥 ОНОВЛЕНО: Масове збереження графіку (з підтримкою Requests для SSE)
exports.saveSchedule = async (req, res) => {
    const u = await User.findById(req.session.userId);
    if (!u || (u.role !== 'SM' && u.role !== 'admin' && u.role !== 'SSE')) {
        return res.status(403).json({ success: false, message: "Немає прав" });
    }

    const updates = req.body.updates || []; // Масив [{ date, name, start, end }]
    if (updates.length === 0) return res.json({ success: true });

    try {
        // --- 1. ЛОГІКА ДЛЯ SSE (СТВОРЮЄМО ЗАПИТИ) ---
        if (u.role === 'SSE') {
            let reqCount = 0;
            
            for (const item of updates) {
                // Знаходимо target user щоб взяти storeId
                const targetUser = await User.findOne({ name: item.name });
                const storeId = targetUser ? targetUser.storeId : u.storeId;

                if (item.start === 'DELETE') {
                    // Для видалення нам потрібен ID існуючої зміни
                    const s = await Shift.findOne({ date: item.date, name: item.name });
                    if (s) {
                        await Request.create({
                            type: 'del_shift',
                            data: { id: s._id, date: s.date, name: s.name },
                            createdBy: u.name
                        });
                        reqCount++;
                    }
                } else {
                    // Додавання/Редагування
                    await Request.create({
                        type: 'add_shift',
                        data: { ...item, storeId },
                        createdBy: u.name
                    });
                    reqCount++;
                }
            }

            // Сповіщаємо SM/Admin про пакет запитів
            const bot = getBot();
            if (bot && u.storeId) {
                const managers = await User.find({ storeId: u.storeId, role: { $in: ['SM', 'admin'] } });
                managers.forEach(m => {
                    if (m.telegramChatId) {
                         bot.sendMessage(m.telegramChatId, `✏️ <b>Редактор Графіку</b>\n👤 ${u.name} надіслав зміни (${reqCount} шт.) на підтвердження.`, { parse_mode: 'HTML' });
                    }
                });
            }

            return res.json({ success: true, isRequest: true, count: reqCount });
        }

        // --- 2. ЛОГІКА ДЛЯ ADMIN/SM (ПРЯМЕ ЗБЕРЕЖЕННЯ) ---
        
        // Кешуємо storeId користувачів
        const names = [...new Set(updates.map(x => x.name))];
        const users = await User.find({ name: { $in: names } }, 'name storeId');
        const userStoreMap = {};
        users.forEach(us => userStoreMap[us.name] = us.storeId);

        const bulkOps = [];

        for (const upd of updates) {
            const targetStoreId = userStoreMap[upd.name] || u.storeId;

            // Безпека: SM не редагує чужий магазин
            if (u.role !== 'admin' && String(targetStoreId) !== String(u.storeId)) {
                continue; 
            }

            // Видаляємо стару (щоб уникнути дублів або якщо це DELETE)
            bulkOps.push({
                deleteOne: { filter: { date: upd.date, name: upd.name } }
            });

            // Якщо не DELETE - додаємо нову
            if (upd.start && upd.end && upd.start !== 'DELETE') {
                bulkOps.push({
                    insertOne: {
                        document: {
                            date: upd.date,
                            name: upd.name,
                            start: upd.start,
                            end: upd.end,
                            storeId: targetStoreId
                        }
                    }
                });
            }
        }

        if (bulkOps.length > 0) {
            await Shift.bulkWrite(bulkOps);
        }

        logAction(u.name, 'bulk_save', `Updated ${updates.length} items via Editor`);
        res.json({ success: true, count: updates.length });

    } catch (e) {
        console.error(e);
        res.status(500).json({ success: false, message: e.message });
    }
};

exports.deleteShift = async (req, res) => {
    const s = await Shift.findById(req.body.id);
    if (!s) return res.json({});
    const perm = await handlePermission(req, req.session.userId);

    if (perm.status === 'pending') {
        const reqDoc = await Request.create({ type: 'del_shift', data: { id: s.id, date: s.date }, createdBy: perm.user.name });
        sendRequestToSM(reqDoc);
        return res.json({ success: true, pending: true });
    }
    await Shift.findByIdAndDelete(req.body.id);
    logAction(perm.user.name, 'delete_shift', `${s.date} ${s.name}`);

    const todayStr = new Date().toISOString().split('T')[0];
    if (s.date >= todayStr) {
        notifyUser(s.name, `❌ <b>Зміну скасовано</b>\n\n📅 Дата: <b>${s.date}</b>\n⏰ Було: ${s.start} - ${s.end}`);
    }
    res.json({ success: true });
};

exports.bulkImport = async (req, res) => {
    const u = await User.findById(req.session.userId);
    if (u.role !== 'SM' && u.role !== 'admin') return res.status(403).json({});
    
    if (req.body.shifts?.length) {
        const shiftsToImport = [];
        
        const allUsers = await User.find({}, 'name storeId');
        const userMap = {};
        allUsers.forEach(user => { userMap[user.name] = user.storeId; });

        for (const s of req.body.shifts) {
            let storeId = null;
            if (userMap[s.name]) {
                storeId = userMap[s.name];
            } else if (u.storeId) {
                storeId = u.storeId;
            }
            shiftsToImport.push({ ...s, storeId });
        }

        await Shift.insertMany(shiftsToImport);
        logAction(u.name, 'bulk_import', `${shiftsToImport.length} shifts`);
    }
    res.json({ success: true });
};

exports.clearDay = async (req, res) => {
    const u = await User.findById(req.session.userId);
    
    let query = { date: req.body.date };
    if (u.role !== 'admin') {
        query.storeId = u.storeId;
    }
    
    await Shift.deleteMany(query);
    logAction(u.name, 'clear_day', req.body.date);
    res.json({ success: true });
};

exports.clearMonth = async (req, res) => {
    const u = await User.findById(req.session.userId);
    if (u.role !== 'SM' && u.role !== 'admin') return res.status(403).json({});
    
    let query = { date: { $regex: `^${req.body.month}` } };
    if (u.role !== 'admin') {
        query.storeId = u.storeId;
    }

    await Shift.deleteMany(query);
    logAction(u.name, 'clear_month', req.body.month);
    res.json({ success: true });
};