const { Task, User, Request, Store } = require('../models');
const { logAction, handlePermission } = require('../utils');
const { notifyUser, sendRequestToSM } = require('../bot');

function decodeOriginalFilename(rawName) {
    if (!rawName) return 'file';
    try {
        if (!/[а-яА-ЯіїєґІЇЄҐ]/.test(rawName)) {
            const utf8 = Buffer.from(rawName, 'latin1').toString('utf8');
            if (/[а-яА-ЯіїєґІЇЄҐ]/.test(utf8) || !utf8.includes('\uFFFD')) {
                return utf8;
            }
        }
    } catch (e) {}
    return rawName;
}

function extractUploadedAttachments(req) {
    if (!req.files || !Array.isArray(req.files) || req.files.length === 0) return [];
    return req.files
        .filter(f => f && f.buffer && f.buffer.length > 0)
        .map(f => ({
            name: decodeOriginalFilename(f.originalname),
            mimeType: f.mimetype || 'application/octet-stream',
            size: Number(f.size || f.buffer.length || 0),
            data: f.buffer.toString('base64')
        }));
}

function sanitizeTaskForClient(taskDoc) {
    if (!taskDoc) return taskDoc;
    const obj = typeof taskDoc.toObject === 'function' ? taskDoc.toObject() : { ...taskDoc };
    if (Array.isArray(obj.attachments)) {
        obj.attachments = obj.attachments.map(att => ({
            _id: att._id,
            name: att.name,
            mimeType: att.mimeType,
            size: att.size
        }));
    }
    return obj;
}

exports.getTasks = async (req, res) => {
    if (!req.session.userId) return res.status(403).json([]);

    const currentUser = await User.findById(req.session.userId);
    let query = {};

    if (currentUser && currentUser.role !== 'admin') {
        query.storeId = currentUser.storeId;
    }

    const t = await Task.find(query).lean();
    res.json(t);
};

exports.getTaskAttachment = async (req, res) => {
    const isTerminal = Boolean(req.session?.isTerminal && req.session?.terminalStoreId);
    if (!req.session.userId && !isTerminal) {
        return res.status(403).send('Forbidden');
    }

    const { taskId, attId } = req.params;
    const task = await Task.findById(taskId).select('+attachments.data').lean();
    if (!task || !Array.isArray(task.attachments)) {
        return res.status(404).send('Attachment not found');
    }

    const att = task.attachments.find(a => String(a._id) === String(attId));
    if (!att || !att.data) {
        return res.status(404).send('Attachment not found');
    }

    const buffer = Buffer.from(att.data, 'base64');
    const mimeType = att.mimeType || 'application/octet-stream';
    const isDownload = req.query.download === '1';
    const isInlineType = !isDownload && (mimeType.startsWith('image/') || mimeType === 'application/pdf' || mimeType.startsWith('text/'));
    const dispositionType = isInlineType ? 'inline' : 'attachment';
    const encodedName = encodeURIComponent(att.name || 'file');

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Content-Disposition', `${dispositionType}; filename*=UTF-8''${encodedName}`);
    return res.send(buffer);
};

exports.addTask = async (req, res) => {
    const perm = await handlePermission(req, req.session.userId);
    
    if (perm === 'unauthorized' || perm === 'forbidden') {
        return res.status(403).json({ success: false, message: "Немає прав" });
    }

    const uploadedAttachments = extractUploadedAttachments(req);

    if (perm.status === 'pending') {
        const reqData = { ...req.body };
        if (uploadedAttachments.length > 0) {
            reqData.attachments = uploadedAttachments;
        }
        const reqDoc = await Request.create({ type: 'add_task', data: reqData, createdBy: perm.user.name });
        sendRequestToSM(reqDoc);
        return res.json({ success: true, pending: true });
    }

    const { title, date, name, description, isFullDay, start, end, type, deadline, subtasks, recurrence } = req.body;

    const sendTaskNotification = async (targetName, taskTitle, taskDate, tStart, tEnd, tIsFullDay, tDesc, tType, tDeadline, tSubtasks, attCount = 0) => {
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
        if (attCount > 0) msg += `\n📎 <b>Прикріплено файлів:</b> ${attCount}`;
        
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

    const applyAutoComplete = (t) => {
        if (t.requireCompletion === false) {
            let isDeadlineReached = false;
            const now = new Date();
            if (t.type === 'todo') {
                if (t.deadline) {
                    const dTime = new Date(t.deadline).getTime();
                    if (!isNaN(dTime) && dTime <= now.getTime()) isDeadlineReached = true;
                }
            } else {
                if (t.date) {
                    if (t.isFullDay) {
                        const dTime = new Date(`${t.date}T23:59:00`).getTime();
                        if (!isNaN(dTime) && dTime <= now.getTime()) isDeadlineReached = true;
                    } else if (t.end) {
                        const dTime = new Date(`${t.date}T${t.end}:00`).getTime();
                        if (!isNaN(dTime) && dTime <= now.getTime()) isDeadlineReached = true;
                    }
                }
            }
            if (isDeadlineReached) {
                t.status = 'completed';
            }
        }
    };

    if (req.body.name === 'all') {
        let userQuery = { role: { $nin: ['admin', 'RRP'] } };
        if (perm.user.role !== 'admin') {
            userQuery.storeId = perm.user.storeId;
        }

        const users = await User.find(userQuery);
        const tasksToCreate = users.map(u => {
            const tData = {
                ...req.body,
                name: u.name,
                storeId: u.storeId,
                attachments: uploadedAttachments
            };
            applyAutoComplete(tData);
            return tData;
        });

        if (tasksToCreate.length > 0) {
            await Task.insertMany(tasksToCreate);
            users.forEach(u => sendTaskNotification(u.name, title, date, start, end, isFullDay, description, type, deadline, subtasks, uploadedAttachments.length));
            logAction(perm.user.name, 'add_task_all', title);
        }
    } else {
        const targetUser = await User.findOne({ name: req.body.name });
        const taskData = {
            ...req.body,
            attachments: uploadedAttachments
        };

        if (targetUser && targetUser.storeId) {
            taskData.storeId = targetUser.storeId;
        } else if (perm.user.storeId) {
            taskData.storeId = perm.user.storeId;
        }

        applyAutoComplete(taskData);
        await Task.create(taskData);
        sendTaskNotification(name, title, date, start, end, isFullDay, description, type, deadline, subtasks, uploadedAttachments.length);
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

    const { id, keepAttachmentIds, ...updateFields } = req.body;
    const task = await Task.findById(id).select('+attachments.data');
    if (!task) return res.json({ success: false, message: 'Task not found' });

    Object.assign(task, updateFields);

    const uploadedAttachments = extractUploadedAttachments(req);
    if (Array.isArray(keepAttachmentIds)) {
        const keepSet = new Set(keepAttachmentIds.map(String));
        task.attachments = (task.attachments || []).filter(att => keepSet.has(String(att._id)));
    }
    if (uploadedAttachments.length > 0) {
        if (!Array.isArray(task.attachments)) task.attachments = [];
        task.attachments.push(...uploadedAttachments);
    }

    if (task.requireCompletion === false && task.status !== 'completed') {
        let isDeadlineReached = false;
        const now = new Date();
        if (task.type === 'todo') {
            if (task.deadline) {
                const dTime = new Date(task.deadline).getTime();
                if (!isNaN(dTime) && dTime <= now.getTime()) isDeadlineReached = true;
            }
        } else {
            if (task.date) {
                if (task.isFullDay) {
                    const dTime = new Date(`${task.date}T23:59:00`).getTime();
                    if (!isNaN(dTime) && dTime <= now.getTime()) isDeadlineReached = true;
                } else if (task.end) {
                    const dTime = new Date(`${task.date}T${task.end}:00`).getTime();
                    if (!isNaN(dTime) && dTime <= now.getTime()) isDeadlineReached = true;
                }
            }
        }
        if (isDeadlineReached) {
            task.status = 'completed';
        }
    }

    await task.save();

    notifyUser(task.name, `✏️ Задача змінена: <b>${task.title}</b>\n(Відредаговано ${u.name})`);
    res.json({ success: true, task: sanitizeTaskForClient(task) });
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
    const isTerminal = Boolean(req.session?.isTerminal && req.session?.terminalStoreId);
    if (!req.session.userId && !isTerminal) return res.status(403).json({ success: false, message: "Немає авторизації" });

    const u = req.session.userId ? await User.findById(req.session.userId) : null;
    const { id, subtaskId } = req.body;
    const t = await Task.findById(id);

    if (!t) return res.json({ success: false, message: "Task not found" });

    const isTerminalForStore = isTerminal && String(t.storeId) === String(req.session.terminalStoreId);
    const isStoreMember = u && u.storeId && String(u.storeId) === String(t.storeId) && ['all', 'Всі', 'Зміна', ''].includes(t.name);
    const isOwner = t.name === u?.name;
    const isManager = u?.role === 'SM' || u?.role === 'admin';
    if (!isOwner && !isManager && !isTerminalForStore && !isStoreMember) {
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

        // 🔁 Якщо задача повторювана і щойно виконана — створюємо наступну
        if (t.status === 'completed' && t.recurrence && t.recurrence !== 'none' && t.deadline) {
            try {
                const nextDeadline = new Date(t.deadline);
                if (!isNaN(nextDeadline.getTime())) {
                    if (t.recurrence === 'weekly')  nextDeadline.setDate(nextDeadline.getDate() + 7);
                    if (t.recurrence === 'monthly') nextDeadline.setMonth(nextDeadline.getMonth() + 1);
                    if (t.recurrence === 'yearly')  nextDeadline.setFullYear(nextDeadline.getFullYear() + 1);

                    const pad = n => String(n).padStart(2, '0');
                    const dl = `${nextDeadline.getFullYear()}-${pad(nextDeadline.getMonth()+1)}-${pad(nextDeadline.getDate())} ${pad(nextDeadline.getHours())}:${pad(nextDeadline.getMinutes())}`;

                    await Task.create({
                        title: t.title,
                        name: t.name,
                        storeId: t.storeId,
                        type: 'todo',
                        description: t.description,
                        date: new Date().toISOString().split('T')[0],
                        deadline: dl,
                        reminders: t.reminders,
                        recurrence: t.recurrence,
                        recurrenceParentId: t._id,
                        subtasks: (t.subtasks || []).map(s => ({ title: s.title, completed: false })),
                        status: 'pending'
                    });
                }
            } catch(e) {
                console.error('Recurrence task creation error:', e.message);
            }
        }
    }

    await t.save();

    // Сповіщення SM, якщо виконав працівник або термінал
    if ((isOwner || isTerminalForStore) && !isManager && actionMsg.includes('виконану')) {
        const performer = u ? u.name : (req.body.completedBy || 'Термінал магазину');
        const managers = await User.find({ role: { $in: ['SM', 'admin'] }, storeId: t.storeId });
        managers.forEach(m => {
            notifyUser(m.name, `✅ <b>${performer}</b> оновив статус задачі:\n\n${actionMsg}\n(Основна задача: ${t.title})`);
        });
    }

    res.json({ 
        success: true, 
        status: t.status, 
        task: t, 
        subtaskStatus: subtaskId ? t.subtasks?.id(subtaskId)?.completed : undefined, 
        taskStatus: t.status 
    });
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