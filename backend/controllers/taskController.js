const { Task, User, Request, Store } = require('../models');
const { logAction, handlePermission } = require('../utils');
const { notifyUser, sendRequestToSM } = require('../bot');

exports.getTasks = async (req, res) => {
    if (!req.session.userId) return res.status(403).json([]);

    const currentUser = await User.findById(req.session.userId);
    let query = {};

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

    const { title, date, name, description, isFullDay, start, end, type, deadline, subtasks } = req.body;

    const sendTaskNotification = async (targetName, taskTitle, taskDate, tStart, tEnd, tIsFullDay, tDesc, tType, tDeadline, tSubtasks) => {
        let msg = '';
        if (tType === 'todo') {
            msg = `📌 <b>Нова ToDo задача!</b>\n\n📝 <b>${taskTitle}</b>`;
            if (tDeadline) msg += `\n⏳ Дедлайн: ${tDeadline}`;
            if (tSubtasks && tSubtasks.length > 0) msg += `\n📋 Підзадач: ${tSubtasks.length}`;
        } else {
            let dur = "Весь день"; let timeInfo = "Весь день";
            if (!tIsFullDay && tStart && tEnd) {
                const [h1, m1] = tStart.split(':').map(Number); const [h2, m2] = tEnd.split(':').map(Number);
                dur = `${((h2 + m2 / 60) - (h1 + m1 / 60)).toFixed(1)} год.`; timeInfo = `${tStart} - ${tEnd}`;
            }
            msg = `📌 <b>Нова задача!</b>\n\n📝 <b>${taskTitle}</b>\n📅 Дата: ${taskDate}\n⏰ Час: ${timeInfo} (${dur})`;
        }
        
        if (tDesc) msg += `\n\nℹ️ <b>Опис:</b> ${tDesc}`;
        
        const pushController = require('./pushController');
        const user = await User.findOne({ name: targetName });
        const pref = user ? (user.notificationPreference || 'telegram') : 'telegram';

        if (pref === 'telegram' || pref === 'both') {
            notifyUser(targetName, msg);
        }

        if ((pref === 'push' || pref === 'both') && user && user.pushSubscriptions && user.pushSubscriptions.length > 0) {
            pushController.sendPushToUser(user, {
                title: '📌 Нова задача!',
                body: `${taskTitle}`,
                url: '/'
            });
        }
    };

    if (req.body.name === 'all') {
        let userQuery = { role: { $nin: ['admin', 'RRP'] } };
        if (perm.user.role !== 'admin') {
            userQuery.storeId = perm.user.storeId;
        }

        const users = await User.find(userQuery);
        const tasksToCreate = users.map(u => ({
            ...req.body,
            name: u.name,
            storeId: u.storeId
        }));

        if (tasksToCreate.length > 0) {
            await Task.insertMany(tasksToCreate);
            users.forEach(u => sendTaskNotification(u.name, title, date, start, end, isFullDay, description, type, deadline, subtasks));
            logAction(perm.user.name, 'add_task_all', title);
        }
    } else {
        const targetUser = await User.findOne({ name: req.body.name });
        const taskData = { ...req.body };

        if (targetUser && targetUser.storeId) {
            taskData.storeId = targetUser.storeId;
        } else if (perm.user.storeId) {
            taskData.storeId = perm.user.storeId;
        }

        await Task.create(taskData);
        sendTaskNotification(name, title, date, start, end, isFullDay, description, type, deadline, subtasks);
        logAction(perm.user.name, 'add_task', title);
    }
    res.json({ success: true });
};

exports.editTask = async (req, res) => {
    if (!req.session.userId) return res.status(403).json({ success: false });
    const u = await User.findById(req.session.userId);
    if (!u || (u.role !== 'SM' && u.role !== 'admin')) {
        return res.status(403).json({ success: false, message: 'Тільки для SM та Admin' });
    }

    const { id, ...updateFields } = req.body;
    const task = await Task.findById(id);
    if (!task) return res.json({ success: false, message: 'Task not found' });

    Object.assign(task, updateFields);
    await task.save();

    notifyUser(task.name, `✏️ Задача змінена: <b>${task.title}</b>\n(Відредаговано ${u.name})`);
    res.json({ success: true, task });
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
    const { id, subtaskId } = req.body;
    const t = await Task.findById(id);

    if (!t) return res.json({ success: false, message: "Task not found" });

    const isOwner = t.name === u?.name;
    const isManager = u?.role === 'SM' || u?.role === 'admin';
    if (!isOwner && !isManager) {
        return res.status(403).json({ success: false, message: 'Немає прав' });
    }

    let actionMsg = '';

    if (subtaskId) {
        const st = t.subtasks.id(subtaskId); // Note: mongoose subdocument id search
        if (st) {
            st.completed = !st.completed;
            actionMsg = `Підзадачу "${st.title}" відмічено як ${st.completed ? 'виконану ✅' : 'невиконану ⏳'}`;
        } else {
            return res.json({ success: false, message: "Subtask not found" });
        }
    } else {
        t.status = t.status === 'completed' ? 'pending' : 'completed';
        actionMsg = `Задачу "${t.title}" відмічено як ${t.status === 'completed' ? 'виконану ✅' : 'невиконану ⏳'}`;
    }

    await t.save();

    // Сповіщення SM, якщо виконав працівник
    if (isOwner && !isManager && actionMsg.includes('виконану')) {
        const managers = await User.find({ role: { $in: ['SM', 'admin'] }, storeId: t.storeId });
        managers.forEach(m => {
            notifyUser(m.name, `✅ <b>${u.name}</b> оновив статус задачі:\n\n${actionMsg}\n(Основна задача: ${t.title})`);
        });
    }

    res.json({ success: true, status: t.status, task: t });
};

exports.forceRemind = async (req, res) => {
    if (!req.session.userId) return res.status(403).json({ success: false });
    const u = await User.findById(req.session.userId);
    const { id } = req.body;
    const t = await Task.findById(id);

    if (!t) return res.json({ success: false, message: "Task not found" });
    if (u.role !== 'SM' && u.role !== 'admin') return res.status(403).json({ success: false, message: 'Немає прав' });

    notifyUser(t.name, `‼️ <b>Нагадування від ${u.name}</b>\n\nНе забудь про задачу: 📝 <b>${t.title}</b>${t.deadline ? `\n⏳ Дедлайн: ${t.deadline}` : ''}`);
    res.json({ success: true });
};