const { Task, User, Request } = require('../models');
const { logAction, handlePermission } = require('../utils');
const { notifyUser, sendRequestToSM } = require('../bot');

exports.getTasks = async (req, res) => {
    const t = await Task.find();
    res.json(t);
};

exports.addTask = async (req, res) => {
    const perm = await handlePermission(req, req.session.userId);
    if (perm.status === 'pending') {
        const reqDoc = await Request.create({ type: 'add_task', data: req.body, createdBy: perm.user.name });
        sendRequestToSM(reqDoc);
        return res.json({ success: true, pending: true });
    }

    const sendTaskNotification = (name, title, date, start, end, isFullDay, description) => {
        let dur = "Весь день"; let timeInfo = "Весь день";
        if (!isFullDay && start && end) {
            const [h1, m1] = start.split(':').map(Number); const [h2, m2] = end.split(':').map(Number);
            dur = `${((h2 + m2 / 60) - (h1 + m1 / 60)).toFixed(1)} год.`; timeInfo = `${start} - ${end}`;
        }
        let msg = `📌 <b>Нова задача!</b>\n\n📝 <b>${title}</b>\n📅 Дата: ${date}\n⏰ Час: ${timeInfo} (${dur})`;
        if (description) msg += `\n\nℹ️ <b>Опис:</b> ${description}`;
        notifyUser(name, msg);
    };

    if (req.body.name === 'all') {
        const users = await User.find({ role: { $nin: ['admin', 'RRP'] } });
        const tasksToCreate = users.map(u => ({ ...req.body, name: u.name }));
        if (tasksToCreate.length > 0) {
            await Task.insertMany(tasksToCreate);
            users.forEach(u => sendTaskNotification(u.name, req.body.title, req.body.date, req.body.start, req.body.end, req.body.isFullDay, req.body.description));
            logAction(perm.user.name, 'add_task_all', req.body.title);
        }
    } else {
        await Task.create(req.body);
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