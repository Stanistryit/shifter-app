const express = require('express');
const router = express.Router();
const { User, Shift, Task, Event, Request, NewsPost, Note, AuditLog } = require('./models');
const { logAction, handlePermission } = require('./utils');
const { notifyUser, notifyRole, notifyAll, sendRequestToSM, getBot } = require('./bot');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });
const bcrypt = require('bcryptjs'); 
const axios = require('axios');

// --- Auth & User ---

router.post('/login', async (req, res) => {
    try { 
        const { username, password } = req.body; 
        const user = await User.findOne({ username });
        
        if (user && (await user.comparePassword(password))) { 
            req.session.userId = user._id; 
            logAction(user.name, 'login', 'Web Login'); 
            req.session.save(() => res.json({ success: true, user: { name: user.name, role: user.role, avatar: user.avatar } })); 
        } 
        else {
            res.json({ success: false, message: "Невірний логін або пароль" });
        }
    } catch (e) { 
        console.error(e);
        res.status(500).json({ success: false }); 
    }
});

router.post('/user/change-password', async (req, res) => {
    if (!req.session.userId) return res.status(403).json({});
    try {
        const { oldPassword, newPassword } = req.body;
        const user = await User.findById(req.session.userId);
        if (!user) return res.json({ success: false, message: "User not found" });

        const isMatch = await user.comparePassword(oldPassword);
        if (!isMatch) return res.json({ success: false, message: "Старий пароль невірний" });

        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(newPassword, salt);
        await user.save();
        
        logAction(user.name, 'change_password', 'Password updated');
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

router.post('/login-telegram', async (req, res) => { const { telegramId } = req.body; const user = await User.findOne({ telegramChatId: telegramId }); if (user) { req.session.userId = user._id; logAction(user.name, 'login', 'Tg Login'); req.session.save(() => res.json({ success: true, user: { name: user.name, role: user.role, avatar: user.avatar } })); } else res.json({ success: false }); });
router.post('/logout', (req, res) => { req.session.destroy(); res.json({ success: true }); });
router.get('/me', async (req, res) => { if (!req.session.userId) return res.json({ loggedIn: false }); const user = await User.findById(req.session.userId); res.json({ loggedIn: !!user, user: user ? { name: user.name, role: user.role, avatar: user.avatar } : null }); });
router.get('/users', async (req, res) => { const users = await User.find({}, 'name role avatar'); res.json(users); });
router.post('/user/avatar', async (req, res) => { if (!req.session.userId) return res.status(403).json({}); await User.findByIdAndUpdate(req.session.userId, { avatar: req.body.avatar }); res.json({ success: true }); });
router.get('/shifts', async (req, res) => { if (!req.session.userId) return res.status(403).json({}); const s = await Shift.find(); res.json(s); });

// SHIFTS: Create
router.post('/shifts', async (req, res) => { 
    const perm = await handlePermission(req, req.session.userId); 
    if(perm === 'unauthorized' || perm === 'forbidden') return res.status(403).json({}); 
    const { user, status } = perm; 

    const existing = await Shift.findOne({ date: req.body.date, name: req.body.name });
    if (existing) return res.json({ success: false, message: "Зміна вже існує!" });

    if (status === 'pending') { 
        const reqDoc = await Request.create({ type: 'add_shift', data: req.body, createdBy: user.name }); 
        sendRequestToSM(reqDoc); 
        return res.json({ success: true, pending: true }); 
    } 
    await Shift.create(req.body); 
    logAction(user.name, 'add_shift', `${req.body.date} ${req.body.name}`); 
    notifyUser(req.body.name, `📅 Зміна: ${req.body.date} (${req.body.start === 'Відпустка' ? 'Відпустка' : req.body.start + '-' + req.body.end})`); 
    res.json({ success: true }); 
});

// SHIFTS: Delete
router.post('/delete-shift', async (req, res) => { 
    const s = await Shift.findById(req.body.id); 
    if(!s) return res.json({}); 
    const perm = await handlePermission(req, req.session.userId); 
    
    if(perm.status === 'pending') { 
        const reqDoc = await Request.create({ type: 'del_shift', data: { id: s.id, date: s.date }, createdBy: perm.user.name }); 
        sendRequestToSM(reqDoc); 
        return res.json({ success: true, pending: true }); 
    } 
    await Shift.findByIdAndDelete(req.body.id); 
    logAction(perm.user.name, 'delete_shift', `${s.date} ${s.name}`); 
    notifyUser(s.name, `❌ Скасовано: ${s.date}`); 
    res.json({ success: true }); 
});

router.post('/shifts/bulk', async (req, res) => { const u = await User.findById(req.session.userId); if (req.body.shifts?.length) { await Shift.insertMany(req.body.shifts); logAction(u.name, 'bulk_import', `${req.body.shifts.length} shifts`); } res.json({ success: true }); });
router.post('/shifts/clear-day', async (req, res) => { const u = await User.findById(req.session.userId); await Shift.deleteMany({date:req.body.date}); logAction(u.name, 'clear_day', req.body.date); res.json({success:true}); });
router.post('/shifts/clear-month', async (req, res) => { const u = await User.findById(req.session.userId); if(u.role!=='SM'&&u.role!=='admin') return res.status(403).json({}); await Shift.deleteMany({date: { $regex: `^${req.body.month}` } }); logAction(u.name, 'clear_month', req.body.month); res.json({success:true}); });

// TASKS: Read & Create (ОНОВЛЕНО)
router.get('/tasks', async (req, res) => { const t = await Task.find(); res.json(t); });

router.post('/tasks', async (req, res) => { 
    const perm = await handlePermission(req, req.session.userId); 
    if(perm.status === 'pending') { 
        const reqDoc = await Request.create({type:'add_task', data:req.body, createdBy:perm.user.name}); 
        sendRequestToSM(reqDoc); 
        return res.json({success:true, pending:true}); 
    }

    // Оновлена функція сповіщення з описом
    const sendTaskNotification = (name, title, date, start, end, isFullDay, description) => {
        let dur = "Весь день"; 
        if (!isFullDay && start && end) { 
            const [h1, m1] = start.split(':').map(Number); 
            const [h2, m2] = end.split(':').map(Number); 
            dur = `${((h2 + m2/60) - (h1 + m1/60)).toFixed(1)} год.`; 
        } 
        
        let msg = `📌 <b>Задача:</b> ${title}\n📅 ${date}\n⏳ ${dur}`;
        if(description) msg += `\n\nℹ️ <b>Опис:</b> ${description}`;

        notifyUser(name, msg);
    };

    // 1. Логіка для "Всіх"
    if (req.body.name === 'all') {
        const users = await User.find({ role: { $nin: ['admin', 'RRP'] } }); // Всі крім адмінів
        const tasksToCreate = users.map(u => ({
            ...req.body,
            name: u.name
        }));
        
        if (tasksToCreate.length > 0) {
            await Task.insertMany(tasksToCreate);
            users.forEach(u => sendTaskNotification(u.name, req.body.title, req.body.date, req.body.start, req.body.end, req.body.isFullDay, req.body.description));
            logAction(perm.user.name, 'add_task_all', req.body.title);
        }
    } 
    // 2. Логіка для однієї людини
    else {
        await Task.create(req.body); 
        sendTaskNotification(req.body.name, req.body.title, req.body.date, req.body.start, req.body.end, req.body.isFullDay, req.body.description);
        logAction(perm.user.name, 'add_task', req.body.title); 
    }

    res.json({ success: true }); 
});

// TASKS: Delete
router.post('/tasks/delete', async (req, res) => { 
    const t = await Task.findById(req.body.id);
    if(!t) return res.json({ success: false, message: "Task not found" });

    const perm = await handlePermission(req, req.session.userId); 

    if(perm.status === 'pending') { 
        const reqDoc = await Request.create({
            type: 'del_task',
            data: { id: t._id, title: t.title }, 
            createdBy: perm.user.name
        }); 
        sendRequestToSM(reqDoc); 
        return res.json({ success: true, pending: true }); 
    } 
    
    await Task.findByIdAndDelete(req.body.id); 
    res.json({ success: true }); 
});

router.get('/logs', async (req, res) => { const u = await User.findById(req.session.userId); if(u?.role!=='SM'&&u?.role!=='admin') return res.json([]); const l = await AuditLog.find().sort({timestamp:-1}).limit(50); res.json(l); });
router.get('/notes', async (req, res) => { if(!req.session.userId)return res.json([]); const u=await User.findById(req.session.userId); const n=await Note.find({$or:[{type:'public'},{type:'private',author:u.name}]}); res.json(n); });
router.post('/notes', async (req, res) => { const u=await User.findById(req.session.userId); let t='private'; if(req.body.type==='public'&&(u.role==='SM'||u.role==='admin')) t='public'; await Note.create({...req.body, author:u.name, type:t}); logAction(u.name,'add_note',t); res.json({success:true}); });
router.post('/notes/delete', async (req, res) => { const u=await User.findById(req.session.userId); const n=await Note.findById(req.body.id); if(n && (n.author===u.name || (u.role==='SM' && n.type==='public'))) { await Note.findByIdAndDelete(req.body.id); res.json({success:true}); } else res.status(403).json({}); });

router.get('/requests', async (req, res) => { const u=await User.findById(req.session.userId); if(u?.role!=='SM'&&u?.role!=='admin') return res.json([]); const r=await Request.find().sort({createdAt:-1}); res.json(r); });

// REQUESTS ACTION
router.post('/requests/action', async (req, res) => { 
    const {id, action} = req.body; 
    const r = await Request.findById(id); 
    if(!r) return res.json({success:false});

    if(action === 'approve'){ 
        if(r.type === 'add_shift') await Shift.create(r.data); 
        if(r.type === 'del_shift') await Shift.findByIdAndDelete(r.data.id);
        if(r.type === 'del_task') await Task.findByIdAndDelete(r.data.id);
        
        if(r.type === 'add_task') {
            if (r.data.name === 'all') {
                const users = await User.find({ role: { $nin: ['admin', 'RRP'] } });
                const tasksToCreate = users.map(u => ({ ...r.data, name: u.name }));
                await Task.insertMany(tasksToCreate);
                users.forEach(u => notifyUser(u.name, `✅ Задача схвалена: ${r.data.title}`));
            } else {
                await Task.create(r.data); 
                notifyUser(r.data.name, `✅ Задача схвалена: ${r.data.title}`);
            }
        }

        notifyUser(r.createdBy, `✅ Ваш запит (${r.type}) схвалено`); 
    } else {
        notifyUser(r.createdBy, `❌ Ваш запит (${r.type}) відхилено`); 
    }
    
    await Request.findByIdAndDelete(id); 
    res.json({success:true}); 
});

router.post('/requests/approve-all', async (req, res) => { 
    const rs = await Request.find(); 
    for(const r of rs) { 
        if(r.type === 'add_shift') await Shift.create(r.data);
        if(r.type === 'del_shift') await Shift.findByIdAndDelete(r.data.id);
        if(r.type === 'del_task') await Task.findByIdAndDelete(r.data.id);
        if(r.type === 'add_task') {
            if (r.data.name === 'all') {
                const users = await User.find({ role: { $nin: ['admin', 'RRP'] } });
                const tasksToCreate = users.map(u => ({ ...r.data, name: u.name }));
                await Task.insertMany(tasksToCreate);
            } else {
                await Task.create(r.data);
            }
        }
        await Request.findByIdAndDelete(r._id); 
    } 
    notifyRole('SSE', '✅ Всі запити схвалено'); 
    res.json({success:true}); 
});

router.post('/news/publish', upload.array('media', 10), async (req, res) => { const u = await User.findById(req.session.userId); if (u.role !== 'SM' && u.role !== 'admin') return res.status(403).json({}); const bot = getBot(); const { text } = req.body; const files = req.files || []; const tgConfig = req.app.get('tgConfig'); const chatId = tgConfig.groupId; const topicId = tgConfig.topics.news; const opts = { parse_mode: 'HTML', message_thread_id: topicId }; const btn = { inline_keyboard: [[{ text: "✅ Ознайомлений", callback_data: 'read_news' }]] }; let sentMsg; if (!files.length) sentMsg = await bot.sendMessage(chatId, `📢 <b>Новини:</b>\n\n${text}`, { ...opts, reply_markup: btn }); else if (files.length === 1) { const f = files[0]; const fOpt = { filename: Buffer.from(f.originalname, 'latin1').toString('utf8'), contentType: f.mimetype }; if (f.mimetype.startsWith('image/')) sentMsg = await bot.sendPhoto(chatId, f.buffer, { ...opts, caption: `📢 <b>Новини:</b>\n\n${text}`, reply_markup: btn }, fOpt); else sentMsg = await bot.sendDocument(chatId, f.buffer, { ...opts, caption: `📢 <b>Новини:</b>\n\n${text}`, reply_markup: btn }, fOpt); } else { const allImg = files.every(f=>f.mimetype.startsWith('image/')); if(allImg) { const media = files.map((f,i)=>({type:'photo', media:f.buffer, caption: i===0?`📢 <b>Новини:</b>\n\n${text}`:'', parse_mode:'HTML'})); const msgs = await bot.sendMediaGroup(chatId, media, opts); sentMsg = msgs[0]; await bot.sendMessage(chatId, "👇 Підтвердити:", { ...opts, reply_to_message_id: sentMsg.message_id, reply_markup: btn }); } else { if(files[0].mimetype.startsWith('image/')) sentMsg = await bot.sendPhoto(chatId, files[0].buffer, {...opts, caption: `📢 <b>Новини:</b>\n\n${text}`, reply_markup: btn}); else sentMsg = await bot.sendDocument(chatId, files[0].buffer, {...opts, caption: `📢 <b>Новини:</b>\n\n${text}`, reply_markup: btn}, {filename: Buffer.from(files[0].originalname, 'latin1').toString('utf8')}); for(let i=1; i<files.length; i++) { const f=files[i]; const name=Buffer.from(f.originalname, 'latin1').toString('utf8'); if(f.mimetype.startsWith('image/')) await bot.sendPhoto(chatId, f.buffer, opts); else await bot.sendDocument(chatId, f.buffer, opts, {filename:name}); } } } await NewsPost.create({ messageId: sentMsg.message_id, chatId: sentMsg.chat.id, text, type: files.length?'file':'text', readBy:[] }); logAction(u.name, 'publish_news', 'Posted'); res.json({ success: true }); });

module.exports = router;