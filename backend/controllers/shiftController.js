const { Shift, User, Request } = require('../models');
const { logAction, handlePermission } = require('../utils');
const { notifyUser, sendRequestToSM } = require('../bot');

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
        const reqDoc = await Request.create({ type: 'add_shift', data: req.body, createdBy: user.name });
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

// 🔥 НОВЕ: Масове збереження графіку (для редактора)
exports.saveSchedule = async (req, res) => {
    const u = await User.findById(req.session.userId);
    if (!u || (u.role !== 'SM' && u.role !== 'admin' && u.role !== 'SSE')) {
        return res.status(403).json({ success: false, message: "Немає прав" });
    }

    const updates = req.body.updates || []; // Очікуємо масив [{ date, name, start, end }]
    if (updates.length === 0) return res.json({ success: true });

    // Кешуємо storeId користувачів, щоб правильно прив'язати зміни
    const names = [...new Set(updates.map(x => x.name))];
    const users = await User.find({ name: { $in: names } }, 'name storeId');
    const userStoreMap = {};
    users.forEach(us => userStoreMap[us.name] = us.storeId);

    const bulkOps = [];

    for (const upd of updates) {
        // Визначаємо магазин: або з юзера, або з того, хто редагує
        const targetStoreId = userStoreMap[upd.name] || u.storeId;

        // Перевірка безпеки: SM не може редагувати чужий магазин
        if (u.role !== 'admin' && String(targetStoreId) !== String(u.storeId)) {
            continue; 
        }

        // 1. Спочатку видаляємо стару зміну на цей день (щоб не було дублів)
        bulkOps.push({
            deleteOne: {
                filter: { date: upd.date, name: upd.name }
            }
        });

        // 2. Якщо це не "гумка" (start !== null/DELETE), додаємо нову зміну
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
    res.json({ success: true });
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