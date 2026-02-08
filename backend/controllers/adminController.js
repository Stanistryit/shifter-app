const { User, Request, Shift, Task, NewsPost, AuditLog } = require('../models');
const { logAction } = require('../utils');
const { notifyUser, notifyRole, getBot } = require('../bot');

// --- LOGS ---
exports.getLogs = async (req, res) => {
    const u = await User.findById(req.session.userId);
    if (u?.role !== 'SM' && u?.role !== 'admin') return res.json([]);
    const l = await AuditLog.find().sort({ timestamp: -1 }).limit(50);
    res.json(l);
};

// --- REQUESTS ---
exports.getRequests = async (req, res) => {
    const u = await User.findById(req.session.userId);
    if (u?.role !== 'SM' && u?.role !== 'admin') return res.json([]);
    const r = await Request.find().sort({ createdAt: -1 });
    res.json(r);
};

exports.handleRequestAction = async (req, res) => {
    const { id, action } = req.body;
    const r = await Request.findById(id);
    if (!r) return res.json({ success: false });

    if (action === 'approve') {
        if (r.type === 'add_shift') { await Shift.deleteOne({ date: r.data.date, name: r.data.name }); await Shift.create(r.data); }
        if (r.type === 'del_shift') await Shift.findByIdAndDelete(r.data.id);
        if (r.type === 'del_task') await Task.findByIdAndDelete(r.data.id);
        if (r.type === 'add_task') {
            if (r.data.name === 'all') {
                const users = await User.find({ role: { $nin: ['admin', 'RRP'] } });
                const tasksToCreate = users.map(u => ({ ...r.data, name: u.name }));
                await Task.insertMany(tasksToCreate);
                users.forEach(u => notifyUser(u.name, `✅ Задача схвалена: ${r.data.title}`));
            } else { await Task.create(r.data); notifyUser(r.data.name, `✅ Задача схвалена: ${r.data.title}`); }
        }
        notifyUser(r.createdBy, `✅ Ваш запит (${r.type}) схвалено`);
    } else { notifyUser(r.createdBy, `❌ Ваш запит (${r.type}) відхилено`); }
    await Request.findByIdAndDelete(id);
    res.json({ success: true });
};

exports.approveAllRequests = async (req, res) => {
    const rs = await Request.find();
    for (const r of rs) {
        if (r.type === 'add_shift') { await Shift.deleteOne({ date: r.data.date, name: r.data.name }); await Shift.create(r.data); }
        if (r.type === 'del_shift') await Shift.findByIdAndDelete(r.data.id);
        if (r.type === 'del_task') await Task.findByIdAndDelete(r.data.id);
        if (r.type === 'add_task') {
            if (r.data.name === 'all') {
                const users = await User.find({ role: { $nin: ['admin', 'RRP'] } });
                const tasksToCreate = users.map(u => ({ ...r.data, name: u.name }));
                await Task.insertMany(tasksToCreate);
            } else { await Task.create(r.data); }
        }
        await Request.findByIdAndDelete(r._id);
    }
    notifyRole('SSE', '✅ Всі запити схвалено');
    res.json({ success: true });
};

// --- NEWS ---
exports.publishNews = async (req, res) => {
    const u = await User.findById(req.session.userId);
    if (u.role !== 'SM' && u.role !== 'admin') return res.status(403).json({});
    
    const bot = getBot();
    const { text } = req.body;
    const files = req.files || [];
    
    // Отримуємо налаштування з app (req.app.get) або через user/store
    // Тут припускаємо, що новина йде в основний канал або прив'язаний топік
    // Для універсальності візьмемо storeId користувача і знайдемо topicId
    // Або використаємо tgConfig (якщо він ще актуальний)
    
    // Спрощена логіка: відправляємо в Store News Topic
    const store = await require('../models').Store.findById(u.storeId);
    if (!store || !store.telegram.chatId) return res.json({success: false, message: "Telegram не налаштовано"});

    const chatId = store.telegram.chatId;
    const topicId = store.telegram.newsTopicId;
    
    const opts = { parse_mode: 'HTML', message_thread_id: topicId };
    const btn = { inline_keyboard: [[{ text: "✅ Ознайомлений", callback_data: 'read_news' }]] };
    
    let sentMsg;
    
    if (!files.length) {
        sentMsg = await bot.sendMessage(chatId, `📢 <b>Новини:</b>\n\n${text}`, { ...opts, reply_markup: btn });
    } else if (files.length === 1) {
        const f = files[0];
        const fOpt = { filename: Buffer.from(f.originalname, 'latin1').toString('utf8'), contentType: f.mimetype };
        if (f.mimetype.startsWith('image/')) sentMsg = await bot.sendPhoto(chatId, f.buffer, { ...opts, caption: `📢 <b>Новини:</b>\n\n${text}`, reply_markup: btn }, fOpt);
        else sentMsg = await bot.sendDocument(chatId, f.buffer, { ...opts, caption: `📢 <b>Новини:</b>\n\n${text}`, reply_markup: btn }, fOpt);
    } else {
        // Media Group logic (спрощено)
        // Для групи файлів кнопки зазвичай додають окремим повідомленням
        const media = files.map((f, i) => ({
            type: f.mimetype.startsWith('image/') ? 'photo' : 'document',
            media: f.buffer,
            caption: i === 0 ? `📢 <b>Новини:</b>\n\n${text}` : '',
            parse_mode: 'HTML'
        }));
        const msgs = await bot.sendMediaGroup(chatId, media, opts);
        sentMsg = msgs[0];
        await bot.sendMessage(chatId, "👇 Підтвердити:", { ...opts, reply_to_message_id: sentMsg.message_id, reply_markup: btn });
    }

    await NewsPost.create({ messageId: sentMsg.message_id, chatId: sentMsg.chat.id, text, type: files.length ? 'file' : 'text', readBy: [] });
    logAction(u.name, 'publish_news', 'Posted');
    res.json({ success: true });
};