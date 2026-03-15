const { Task, User, Request } = require('../models');
const { logAction, handlePermission } = require('../utils');
const { notifyUser, sendRequestToSM } = require('../bot');

exports.getTasks = async (req, res) => {
    if (!req.session.userId) return res.status(403).json([]);

    const currentUser = await User.findById(req.session.userId);
    let query = {};

    // 🔥 ВИПРАВЛЕНО: Фільтруємо задачі по магазину, щоб не бачити чужі
    if (currentUser && currentUser.role !== 'admin') {
        query.storeId = currentUser.storeId;
    }

    const t = await Task.find(query);
    res.json(t);
};

exports.addTask = async (req, res) => {
    const perm = await handlePermission(req, req.session.userId);
    if (perm.status === 'pending') {
        const reqDoc = await Request.create({ type: 'add_task', data: req.body, createdBy: perm.user.name });
        sendRequestToSM(reqDoc);
        return res.json({ success: true, pending: true });
    }

    const sendTaskNotification = async (name, title, date, start, end, isFullDay, description) => {
        let dur = "Весь день"; let timeInfo = "Весь день";
        if (!isFullDay && start && end) {
            const [h1, m1] = start.split(':').map(Number); const [h2, m2] = end.split(':').map(Number);
            dur = `${((h2 + m2 / 60) - (h1 + m1 / 60)).toFixed(1)} год.`; timeInfo = `${start} - ${end}`;
        }
        let msg = `📌 <b>Нова задача!</b>\n\n📝 <b>${title}</b>\n📅 Дата: ${date}\n⏰ Час: ${timeInfo} (${dur})`;
        if (description) msg += `\n\nℹ️ <b>Опис:</b> ${description}`;
        // WEB PUSH Preference Check
        const pushController = require('./pushController');
        const user = await User.findOne({ name });
        const pref = user ? (user.notificationPreference || 'telegram') : 'telegram';

        if (pref === 'telegram' || pref === 'both') {
            notifyUser(name, msg);
        }

        if ((pref === 'push' || pref === 'both') && user && user.pushSubscriptions && user.pushSubscriptions.length > 0) {
            pushController.sendPushToUser(user, {
                title: '📌 Нова задача!',
                body: `${title}\nЧас: ${timeInfo}`,
                url: '/'
            });
        }
    };

    if (req.body.name === 'all') {
        let userQuery = { role: { $nin: ['admin', 'RRP'] } };

        // 🔥 ВИПРАВЛЕНО: Якщо це не Global Admin, беремо людей ТІЛЬКИ з його магазину
        if (perm.user.role !== 'admin') {
            userQuery.storeId = perm.user.storeId;
        }

        const users = await User.find(userQuery);
        const tasksToCreate = users.map(u => ({
            ...req.body,
            name: u.name,
            storeId: u.storeId // Зберігаємо прив'язку задачі до магазину
        }));

        if (tasksToCreate.length > 0) {
            await Task.insertMany(tasksToCreate);
            users.forEach(u => sendTaskNotification(u.name, req.body.title, req.body.date, req.body.start, req.body.end, req.body.isFullDay, req.body.description));
            logAction(perm.user.name, 'add_task_all', req.body.title);
        }
    } else {
        // 🔥 ВИПРАВЛЕНО: Для індивідуальної задачі теж проставляємо магазин
        const targetUser = await User.findOne({ name: req.body.name });
        const taskData = { ...req.body };

        if (targetUser && targetUser.storeId) {
            taskData.storeId = targetUser.storeId;
        } else if (perm.user.storeId) {
            taskData.storeId = perm.user.storeId;
        }

        await Task.create(taskData);
        sendTaskNotification(req.body.name, req.body.title, req.body.date, req.body.start, req.body.end, req.body.isFullDay, req.body.description);
        logAction(perm.user.name, 'add_task', req.body.title);
    }
    res.json({ success: true });
};

exports.deleteTask = async (req, res) => {
    const t = await Task.findById(req.body.id);
    if (!t) return res.json({ success: false, message: "Task not found" });
    const perm = await handlePermission(req, req.session.userId);
    if (perm.status === 'pending') {
        const reqDoc = await Request.create({ type: 'del_task', data: { id: t._id, title: t.title }, createdBy: perm.user.name });
        sendRequestToSM(reqDoc);
        return res.json({ success: true, pending: true });
    }
    await Task.findByIdAndDelete(req.body.id);
    res.json({ success: true });
};

exports.toggleTaskStatus = async (req, res) => {
    if (!req.session.userId) return res.status(403).json({ success: false });

    const u = await User.findById(req.session.userId);
    const t = await Task.findById(req.body.id);

    if (!t) return res.json({ success: false, message: "Task not found" });

    // Дозволяємо лише власнику задачі або SM/admin
    const isOwner = t.name === u?.name;
    const isManager = u?.role === 'SM' || u?.role === 'admin';
    if (!isOwner && !isManager) {
        return res.status(403).json({ success: false, message: 'Немає прав' });
    }

    t.status = t.status === 'completed' ? 'pending' : 'completed';
    await t.save();

    res.json({ success: true, status: t.status });
};