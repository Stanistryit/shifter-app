const { Shift, User, Request } = require('../models');
const { logAction, handlePermission } = require('../utils');
const { notifyUser, sendRequestToSM } = require('../bot');

// 🔥 Хелпер для міграції
const runMigrationIfNeeded = async () => {
    // Перевіряємо, чи є зміни без магазину
    const count = await Shift.countDocuments({ storeId: null });
    if (count === 0) return;

    console.log(`⚠️ Знайдено ${count} змін без прив'язки. Починаю міграцію...`);
    const shifts = await Shift.find({ storeId: null });
    
    // Кешуємо юзерів для швидкості
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
        console.log(`✅ Міграцію завершено. Оновлено ${bulkOps.length} змін.`);
    }
};

exports.getShifts = async (req, res) => {
    if (!req.session.userId) return res.status(403).json({});
    
    // Запускаємо міграцію (один раз спрацює, далі буде пропускати)
    await runMigrationIfNeeded();

    const currentUser = await User.findById(req.session.userId);
    let query = {};

    // Якщо це SM або звичайний юзер з магазином — фільтруємо графік
    if (currentUser.storeId) {
        query.storeId = currentUser.storeId;
    } 
    // Якщо це Global Admin без магазину — він побачить ВСЕ (або можна додати ?storeId=...)
    
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

    // 🔥 Знаходимо магазин співробітника, якому ставимо зміну
    const targetUser = await User.findOne({ name: req.body.name });
    const shiftData = { ...req.body };
    
    if (targetUser && targetUser.storeId) {
        shiftData.storeId = targetUser.storeId;
    } else if (user.storeId) {
        // Якщо не знайшли юзера, ставимо магазин того, хто створює (SM)
        shiftData.storeId = user.storeId; 
    }

    // Видаляємо дублікати на цю дату для цієї людини (в межах магазину бажано, але поки ім'я унікальне)
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
        
        // Оптимізація: завантажуємо всіх юзерів магазину (або всіх), щоб не робити запит на кожну зміну
        const allUsers = await User.find({}, 'name storeId');
        const userMap = {};
        allUsers.forEach(user => { userMap[user.name] = user.storeId; });

        for (const s of req.body.shifts) {
            let storeId = null;
            
            // 1. Пробуємо взяти магазин юзера
            if (userMap[s.name]) {
                storeId = userMap[s.name];
            } 
            // 2. Якщо юзера немає або це новий, беремо магазин того, хто імпортує
            else if (u.storeId) {
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
    // 🔥 Видаляємо тільки в межах свого магазину
    if (u.storeId) {
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
    // 🔥 Видаляємо тільки в межах свого магазину
    if (u.storeId) {
        query.storeId = u.storeId;
    }

    await Shift.deleteMany(query);
    logAction(u.name, 'clear_month', req.body.month);
    res.json({ success: true });
};