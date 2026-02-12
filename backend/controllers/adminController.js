const { User, Request, Shift, Task, NewsPost, AuditLog, Store } = require('../models');
const { logAction } = require('../utils');
const { notifyUser, notifyRole, getBot } = require('../bot');

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
        const { reportTime, openTime, closeTime } = req.body; // Отримуємо нові параметри
        const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;

        // Валідація часу звіту
        if (reportTime && !timeRegex.test(reportTime)) {
            return res.json({ success: false, message: "Невірний формат часу звіту (HH:MM)" });
        }

        // Валідація часу відкриття/закриття
        if ((openTime && !timeRegex.test(openTime)) || (closeTime && !timeRegex.test(closeTime))) {
            return res.json({ success: false, message: "Невірний формат часу роботи (HH:MM)" });
        }

        const store = await Store.findById(u.storeId);
        if (!store) return res.json({ success: false, message: "Магазин не знайдено" });

        if (reportTime) store.telegram.reportTime = reportTime;
        if (openTime) store.openTime = openTime;
        if (closeTime) store.closeTime = closeTime;

        await store.save();

        logAction(u.name, 'update_settings', `Settings updated: Report=${reportTime}, Open=${openTime}, Close=${closeTime}`);
        res.json({ success: true });

    } catch (e) {
        console.error(e);
        res.status(500).json({ success: false, message: e.message });
    }
};

// --- LOGS ---
exports.getLogs = async (req, res) => {
    const u = await User.findById(req.session.userId);
    
    // Тільки Global Admin бачить логи
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
    
    notifyRole('SSE', '✅ Всі запити схвалено', u.role === 'admin' ? null : u.storeId);
    res.json({ success: true });
};

exports.publishNews = async (req, res) => {
    const u = await User.findById(req.session.userId);
    if (u.role !== 'SM' && u.role !== 'admin') return res.status(403).json({});
    
    const bot = getBot();
    const { text, requestRead } = req.body; 
    const files = req.files || [];
    
    const store = await Store.findById(u.storeId);
    
    if (!store || !store.telegram.chatId) return res.json({success: false, message: "Telegram не налаштовано"});

    const chatId = store.telegram.chatId;
    const topicId = store.telegram.newsTopicId;
    
    const opts = { parse_mode: 'HTML' };
    if (topicId) opts.message_thread_id = topicId;

    const shouldRequestRead = requestRead === 'true'; 
    const btn = { inline_keyboard: [[{ text: "✅ Ознайомлений", callback_data: 'read_news' }]] };
    const replyMarkup = shouldRequestRead ? btn : undefined;
    
    let sentMsg;
    
    try {
        if (!files.length) {
            sentMsg = await bot.sendMessage(chatId, `📢 <b>Новини:</b>\n\n${text}`, { ...opts, reply_markup: replyMarkup });
        } else if (files.length === 1) {
            const f = files[0];
            const fOpt = { filename: Buffer.from(f.originalname, 'latin1').toString('utf8'), contentType: f.mimetype };
            
            if (f.mimetype.startsWith('image/')) {
                sentMsg = await bot.sendPhoto(chatId, f.buffer, { ...opts, caption: `📢 <b>Новини:</b>\n\n${text}`, reply_markup: replyMarkup }, fOpt);
            } else {
                sentMsg = await bot.sendDocument(chatId, f.buffer, { ...opts, caption: `📢 <b>Новини:</b>\n\n${text}`, reply_markup: replyMarkup }, fOpt);
            }
        } else {
            const media = files.map((f, i) => ({
                type: f.mimetype.startsWith('image/') ? 'photo' : 'document',
                media: f.buffer,
                caption: i === 0 ? `📢 <b>Новини:</b>\n\n${text}` : '',
                parse_mode: 'HTML'
            }));
            const msgs = await bot.sendMediaGroup(chatId, media, opts);
            
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
        res.json({ success: false, message: "Помилка відправки в Telegram" });
    }
};