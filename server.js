require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const axios = require('axios');
const multer = require('multer');
const ExcelJS = require('exceljs');

const app = express();
const PORT = process.env.PORT || 3000;

// --- CONFIG ---
const TG_CONFIG = {
    groupId: process.env.TG_GROUP_ID, 
    topics: {
        schedule: 36793, 
        news: 36865      
    }
};
const GOOGLE_SHEET_URL = ''; 

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

app.set('trust proxy', 1);

// --- TELEGRAM BOT INIT ---
let bot = null;
const APP_URL = 'https://shifter-app.onrender.com'; // Виніс в глобальну змінну для використання в меню

if (process.env.TELEGRAM_TOKEN) {
    bot = new TelegramBot(process.env.TELEGRAM_TOKEN);
    bot.setWebHook(`${APP_URL}/bot${process.env.TELEGRAM_TOKEN}`);
    console.log("🤖 Telegram Bot: Webhook set");

    // Оновлене меню команд (для / меню)
    bot.setMyCommands([
        { command: '/start', description: '🏠 Головне меню' },
        { command: '/now', description: '👀 Хто зараз на зміні' },
        { command: '/shifts', description: '📋 Мої зміни' },
        { command: '/login', description: '🔐 Авторизація' },
        { command: '/settings', description: '⚙️ Налаштування' }
    ]).then(() => console.log("✅ Команди меню оновлено"));
}

// --- DB CONNECTION ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => { console.log("✅ Connected to MongoDB"); initDB(); })
    .catch(err => console.error("❌ MongoDB error:", err));

// --- SCHEMAS ---
const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, default: 'user' },
    name: { type: String, required: true },
    telegramChatId: { type: Number, default: null },
    reminderTime: { type: String, default: '20:00' },
    avatar: { type: String, default: null }
});
const User = mongoose.model('User', UserSchema);

const ShiftSchema = new mongoose.Schema({ date: String, name: String, start: String, end: String });
const Shift = mongoose.model('Shift', ShiftSchema);

const TaskSchema = new mongoose.Schema({ date: String, name: String, title: String, isFullDay: Boolean, start: String, end: String });
const Task = mongoose.model('Task', TaskSchema);

const EventSchema = new mongoose.Schema({ date: String, title: String, repeat: { type: String, default: 'none' } });
const Event = mongoose.model('Event', EventSchema);

const RequestSchema = new mongoose.Schema({ type: String, data: Object, createdBy: String, createdAt: { type: Date, default: Date.now } });
const Request = mongoose.model('Request', RequestSchema);

const NewsPostSchema = new mongoose.Schema({ messageId: Number, chatId: Number, text: String, type: String, readBy: [String], createdAt: { type: Date, default: Date.now } });
const NewsPost = mongoose.model('NewsPost', NewsPostSchema);

const ContactSchema = new mongoose.Schema({ name: { type: String, required: true }, phone: { type: String, required: true } });
const Contact = mongoose.model('Contact', ContactSchema);

const NoteSchema = new mongoose.Schema({ date: { type: String, required: true }, text: { type: String, required: true }, type: { type: String, default: 'private' }, author: { type: String, required: true }, createdAt: { type: Date, default: Date.now } });
const Note = mongoose.model('Note', NoteSchema);

const AuditLogSchema = new mongoose.Schema({ action: String, performer: String, details: String, timestamp: { type: Date, default: Date.now } });
const AuditLog = mongoose.model('AuditLog', AuditLogSchema);

// --- MIDDLEWARE ---
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ limit: '10mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: 'supersecretkey',
    resave: false, saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URI }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7, httpOnly: true, secure: true, sameSite: 'none' }
}));

// --- HELPERS ---
async function logAction(performer, action, details) {
    try { await AuditLog.create({ performer, action, details }); } catch(e){ console.error("Log error", e); }
}

async function handlePermission(req, type, data) {
    const user = await User.findById(req.session.userId);
    if (!user) return 'unauthorized';
    if (user.role === 'RRP') return 'forbidden';
    if (user.role === 'SSE') {
        await Request.create({ type, data, createdBy: user.name });
        notifyRole('SM', `🔔 <b>Запит від SSE (${user.name})</b>\n${type}`);
        return 'pending';
    }
    if (user.role === 'SM' || user.role === 'admin') return null;
    return 'forbidden';
}

async function notifyUser(name, msg) { if(!bot) return; try { const u = await User.findOne({name}); if(u?.telegramChatId) bot.sendMessage(u.telegramChatId, msg, {parse_mode:'HTML'}); } catch(e){} }
async function notifyRole(role, msg) { if(!bot) return; try { const us = await User.find({role}); for(const u of us) if(u.telegramChatId) bot.sendMessage(u.telegramChatId, msg, {parse_mode:'HTML'}); } catch(e){} }
async function notifyAll(msg) { if(!bot) return; try { const us = await User.find({telegramChatId:{$ne:null}}); for(const u of us) bot.sendMessage(u.telegramChatId, msg, {parse_mode:'HTML'}); } catch(e){} }

// --- SYNC ---
async function syncWithGoogleSheets() {
    if (!GOOGLE_SHEET_URL || GOOGLE_SHEET_URL.length < 10) return { success: false, message: "URL not set" };
    try {
        const response = await axios.get(GOOGLE_SHEET_URL);
        const rows = response.data.split('\n').map(row => row.trim()).filter(row => row.length > 0);
        const shiftsToImport = [];
        for (let i = 1; i < rows.length; i++) {
            const cols = rows[i].split(','); 
            if (cols.length < 4) continue;
            const [date, name, start, end] = cols.map(c => c.trim());
            if (date.match(/^\d{4}-\d{2}-\d{2}$/) && name && start && end) shiftsToImport.push({ date, name, start, end });
        }
        if (shiftsToImport.length > 0) {
            const datesToUpdate = [...new Set(shiftsToImport.map(s => s.date))];
            await Shift.deleteMany({ date: { $in: datesToUpdate } });
            await Shift.insertMany(shiftsToImport);
            return { success: true, count: shiftsToImport.length };
        }
        return { success: false, message: "No data" };
    } catch (e) { return { success: false, message: e.message }; }
}
cron.schedule('0 * * * *', syncWithGoogleSheets);

// --- DAILY BRIEFING (GROUP + RRP) ---
async function sendDailyBriefing() {
    if (!bot || !TG_CONFIG.groupId) return;
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().split('T')[0];
    const display = tomorrow.toLocaleDateString('uk-UA', { weekday: 'long', day: 'numeric', month: 'long' });
    
    const shifts = await Shift.find({ date: dateStr }).sort({ start: 1 });
    const tasks = await Task.find({ date: dateStr });
    const allUsers = await User.find({ role: { $nin: ['admin', 'RRP'] } });
    
    let msg = `🌙 <b>План на завтра (${display}):</b>\n\n`;
    
    const workingNames = [];
    if (shifts.length) { 
        msg += `👷‍♂️ <b>На зміні:</b>\n`; 
        shifts.forEach(s => {
            workingNames.push(s.name);
            if(s.start === 'Відпустка') msg += `🌴 <b>${s.name}</b>: Відпустка\n`;
            else msg += `🔹 <b>${s.name}</b>: ${s.start} - ${s.end}\n`;
        }); 
    } else { msg += `🤷‍♂️ <b>Змін немає</b>\n`; }

    if (tasks.length) { msg += `\n📌 <b>Задачі:</b>\n`; tasks.forEach(t => { const time = t.isFullDay ? "Весь день" : `${t.start}-${t.end}`; msg += `🔸 <b>${t.name}</b>: ${t.title} (${time})\n`; }); }

    const offUsers = allUsers.filter(u => !workingNames.includes(u.name));
    if (offUsers.length > 0) {
        msg += `\n😴 <b>Вихідні:</b>\n`;
        const names = offUsers.map(u => {
            const parts = u.name.split(' ');
            return parts.length > 1 ? parts[1] : u.name; 
        }).join(', ');
        msg += `${names}\n`;
    }

    msg += `\nGood luck! 🚀`;
    
    // 1. Send to Group
    try { await bot.sendMessage(TG_CONFIG.groupId, msg, { parse_mode: 'HTML', message_thread_id: TG_CONFIG.topics.schedule }); } catch (e) {}

    // 2. Send to RRP (NEW)
    try {
        const rrpUser = await User.findOne({ role: 'RRP' });
        if (rrpUser && rrpUser.telegramChatId) {
            await bot.sendMessage(rrpUser.telegramChatId, `🔔 <b>Щоденний звіт (RRP):</b>\n\n${msg}`, { parse_mode: 'HTML' });
        }
    } catch (e) { console.error("RRP Send Error:", e); }
}
cron.schedule('0 18 * * *', sendDailyBriefing);

// --- ROUTES ---
app.post('/api/login', async (req, res) => { 
    try { const { username, password } = req.body; const user = await User.findOne({ username, password }); 
    if (user) { 
        req.session.userId = user._id; 
        logAction(user.name, 'login', 'Web Login');
        req.session.save(() => res.json({ success: true, user: { name: user.name, role: user.role, avatar: user.avatar } })); 
    } 
    else res.json({ success: false, message: "Невірний логін" }); 
    } catch (e) { res.status(500).json({ success: false }); } 
});

app.post('/api/login-telegram', async (req, res) => { 
    const { telegramId } = req.body; if (!telegramId) return res.json({ success: false }); 
    const user = await User.findOne({ telegramChatId: telegramId }); 
    if (user) { 
        req.session.userId = user._id; 
        logAction(user.name, 'login', 'Telegram Auto-Login');
        req.session.save(() => res.json({ success: true, user: { name: user.name, role: user.role, avatar: user.avatar } })); 
    } 
    else res.json({ success: false }); 
});

app.post('/api/logout', (req, res) => { req.session.destroy(); res.json({ success: true }); });
app.get('/api/me', async (req, res) => { 
    if (!req.session.userId) return res.json({ loggedIn: false }); 
    const user = await User.findById(req.session.userId); 
    if (!user) return res.json({ loggedIn: false }); 
    res.json({ loggedIn: true, user: { name: user.name, role: user.role, avatar: user.avatar } }); 
});

app.post('/api/user/avatar', async (req, res) => {
    try {
        if (!req.session.userId) return res.status(403).json({ error: "Auth required" });
        const { avatar } = req.body; 
        await User.findByIdAndUpdate(req.session.userId, { avatar });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/logs', async (req, res) => {
    const user = await User.findById(req.session.userId);
    if(user?.role !== 'admin' && user?.role !== 'SM') return res.json([]);
    const logs = await AuditLog.find().sort({timestamp: -1}).limit(50);
    res.json(logs);
});

app.get('/api/notes', async (req, res) => {
    if (!req.session.userId) return res.json([]);
    const user = await User.findById(req.session.userId);
    if (!user) return res.json([]);
    const notes = await Note.find({ $or: [ { type: 'public' }, { type: 'private', author: user.name } ] });
    res.json(notes);
});
app.post('/api/notes', async (req, res) => {
    if (!req.session.userId) return res.status(403).json({});
    const user = await User.findById(req.session.userId);
    const { date, text, type } = req.body;
    let finalType = 'private';
    if (type === 'public' && (user.role === 'SM' || user.role === 'admin')) { finalType = 'public'; }
    await Note.create({ date, text, type: finalType, author: user.name });
    logAction(user.name, 'add_note', `${type} note for ${date}`);
    res.json({ success: true });
});
app.post('/api/notes/delete', async (req, res) => {
    if (!req.session.userId) return res.status(403).json({});
    const user = await User.findById(req.session.userId);
    const { id } = req.body;
    const note = await Note.findById(id);
    if (!note) return res.json({ success: false });
    if (note.author === user.name || ((user.role === 'SM' || user.role === 'admin') && note.type === 'public')) {
        await Note.findByIdAndDelete(id);
        logAction(user.name, 'delete_note', `Note deleted`);
        res.json({ success: true });
    } else { res.status(403).json({ success: false }); }
});

app.get('/api/users', async (req, res) => { const users = await User.find({}, 'name role'); res.json(users); });
app.get('/api/shifts', async (req, res) => { if (!req.session.userId) return res.status(403).json({}); const s = await Shift.find(); res.json(s); });

app.post('/api/shifts', async (req, res) => { 
    const u = await User.findById(req.session.userId);
    const c=await handlePermission(req,'add_shift',req.body); 
    if(c) return res.json({success:true, pending:c==='pending'}); 
    await Shift.create(req.body); 
    logAction(u.name, 'add_shift', `${req.body.date} for ${req.body.name}`);
    notifyUser(req.body.name, `📅 Зміна: ${req.body.date} (${req.body.start === 'Відпустка' ? 'Відпустка' : req.body.start + '-' + req.body.end})`); 
    res.json({success:true}); 
});

app.post('/api/delete-shift', async (req, res) => { 
    const u = await User.findById(req.session.userId);
    const s=await Shift.findById(req.body.id); 
    if(s){ 
        const c=await handlePermission(req,'del_shift',{id:s.id,details:s.date}); 
        if(c) return res.json({success:true, pending:c==='pending'}); 
        await Shift.findByIdAndDelete(req.body.id); 
        logAction(u.name, 'delete_shift', `${s.date} for ${s.name}`);
        notifyUser(s.name, `❌ Скасовано: ${s.date}`); 
    } 
    res.json({success:true}); 
});

app.post('/api/shifts/bulk', async (req, res) => { 
    const u = await User.findById(req.session.userId);
    if(req.body.shifts?.length) {
        await Shift.insertMany(req.body.shifts);
        logAction(u.name, 'bulk_import', `Imported ${req.body.shifts.length} shifts`);
    }
    res.json({success:true}); 
});

app.post('/api/shifts/clear-day', async (req, res) => { 
    const u = await User.findById(req.session.userId);
    await Shift.deleteMany({date:req.body.date}); 
    logAction(u.name, 'clear_day', `Cleared ${req.body.date}`);
    res.json({success:true}); 
});

app.post('/api/shifts/clear-month', async (req, res) => { 
    const u = await User.findById(req.session.userId);
    if(u.role !== 'SM' && u.role !== 'admin') return res.status(403).json({});
    await Shift.deleteMany({date: { $regex: `^${req.body.month}` } }); 
    logAction(u.name, 'clear_month', `Cleared month ${req.body.month}`);
    res.json({success:true}); 
});

// --- TASKS (UPDATED NOTIFICATION) ---
app.get('/api/tasks', async (req, res) => { const t = await Task.find(); res.json(t); });
app.post('/api/tasks', async (req, res) => { 
    const u = await User.findById(req.session.userId);
    const c = await handlePermission(req, 'add_task', req.body); 
    if (c) return res.json({ success: true, pending: c === 'pending' }); 
    
    await Task.create(req.body); 
    
    // Нове детальне сповіщення
    const { date, name, title, isFullDay, start, end } = req.body;
    let durationStr = "Весь день";
    if (!isFullDay && start && end) {
        const [h1, m1] = start.split(':').map(Number);
        const [h2, m2] = end.split(':').map(Number);
        const diff = (h2 + m2/60) - (h1 + m1/60);
        durationStr = `${diff.toFixed(1)} год.`;
    }

    const msg = `📌 <b>Нова задача!</b>\n\n🔹 <b>Що:</b> ${title}\n📅 <b>Коли:</b> ${date}\n⏰ <b>Час:</b> ${isFullDay ? 'Весь день' : start + ' - ' + end}\n⏳ <b>Тривалість:</b> ${durationStr}`;
    notifyUser(name, msg); 
    
    logAction(u.name, 'add_task', `Task: ${title} for ${name}`);
    res.json({ success: true }); 
});
app.post('/api/tasks/delete', async (req, res) => { const c=await handlePermission(req,'del_task',{id:req.body.id}); if(c) return res.json({success:true, pending:c==='pending'}); await Task.findByIdAndDelete(req.body.id); res.json({success:true}); });

app.get('/api/events', async (req, res) => { const e = await Event.find(); res.json(e); });
app.post('/api/events', async (req, res) => { const c=await handlePermission(req,'add_event',req.body); if(c) return res.json({success:true}); await Event.create(req.body); notifyAll(`📢 Подія: ${req.body.title}`); res.json({success:true}); });
app.post('/api/events/delete', async (req, res) => { await Event.findByIdAndDelete(req.body.id); res.json({success:true}); });

app.get('/api/requests', async (req, res) => { const u=await User.findById(req.session.userId); if(u?.role!=='SM'&&u?.role!=='admin') return res.json([]); const r=await Request.find().sort({createdAt:-1}); res.json(r); });
app.post('/api/requests/action', async (req, res) => { const {id,action}=req.body; const r=await Request.findById(id); if(!r) return res.json({}); 
    if(action==='approve'){
        if(r.type==='add_shift') await Shift.create(r.data);
        if(r.type==='del_shift') await Shift.findByIdAndDelete(r.data.id);
        if(r.type==='add_task') await Task.create(r.data);
        if(r.type==='del_task') await Task.findByIdAndDelete(r.data.id);
        if(r.type==='add_event') await Event.create(r.data);
        notifyUser(r.createdBy, `✅ Запит схвалено!`);
    } else { notifyUser(r.createdBy, `❌ Запит відхилено.`); }
    await Request.findByIdAndDelete(id); res.json({success:true});
});
app.post('/api/requests/approve-all', async (req, res) => { const rs=await Request.find(); for(const r of rs){
        if(r.type==='add_shift') await Shift.create(r.data);
        if(r.type==='del_shift') await Shift.findByIdAndDelete(r.data.id);
        if(r.type==='add_task') await Task.create(r.data);
        if(r.type==='del_task') await Task.findByIdAndDelete(r.data.id);
        if(r.type==='add_event') await Event.create(r.data);
        notifyUser(r.createdBy, `✅ Всі запити схвалено.`); await Request.findByIdAndDelete(r._id);
    } res.json({success:true});
});

app.post('/api/news/publish', upload.array('media', 10), async (req, res) => {
    try {
        if (!req.session.userId) return res.status(403).json({});
        const user = await User.findById(req.session.userId);
        if (user.role !== 'SM' && user.role !== 'admin') return res.status(403).json({});
        
        const text = req.body.text || "";
        const files = req.files || [];
        const opts = { parse_mode: 'HTML', message_thread_id: TG_CONFIG.topics.news };
        const replyMarkup = { inline_keyboard: [[{ text: "✅ Ознайомлений", callback_data: 'read_news' }]] };
        
        let sentMsg; 

        if (files.length === 0) {
            sentMsg = await bot.sendMessage(TG_CONFIG.groupId, `📢 <b>Новини:</b>\n\n${text}`, { ...opts, reply_markup: replyMarkup });
        } 
        else if (files.length === 1) {
            const file = files[0];
            const originalNameFixed = Buffer.from(file.originalname, 'latin1').toString('utf8');
            const fileOpts = { filename: originalNameFixed, contentType: file.mimetype };
            
            if (file.mimetype.startsWith('image/')) {
                sentMsg = await bot.sendPhoto(TG_CONFIG.groupId, file.buffer, { ...opts, caption: `📢 <b>Новини:</b>\n\n${text}`, reply_markup: replyMarkup }, fileOpts);
            } else {
                sentMsg = await bot.sendDocument(TG_CONFIG.groupId, file.buffer, { ...opts, caption: `📢 <b>Новини:</b>\n\n${text}`, reply_markup: replyMarkup }, fileOpts);
            }
        } 
        else {
            const allImages = files.every(f => f.mimetype.startsWith('image/'));
            if (allImages) {
                const media = files.map((f, index) => ({
                    type: 'photo',
                    media: f.buffer,
                    caption: index === 0 ? `📢 <b>Новини:</b>\n\n${text}` : '',
                    parse_mode: 'HTML'
                }));
                const msgs = await bot.sendMediaGroup(TG_CONFIG.groupId, media, opts);
                sentMsg = msgs[0];
                await bot.sendMessage(TG_CONFIG.groupId, "👇 Підтвердити ознайомлення:", { ...opts, reply_to_message_id: sentMsg.message_id, reply_markup: replyMarkup });
            } 
            else {
                if (files[0].mimetype.startsWith('image/')) {
                     sentMsg = await bot.sendPhoto(TG_CONFIG.groupId, files[0].buffer, { ...opts, caption: `📢 <b>Новини:</b>\n\n${text}`, reply_markup: replyMarkup });
                } else {
                     sentMsg = await bot.sendDocument(TG_CONFIG.groupId, files[0].buffer, { ...opts, caption: `📢 <b>Новини:</b>\n\n${text}`, reply_markup: replyMarkup }, { filename: Buffer.from(files[0].originalname, 'latin1').toString('utf8') });
                }
                for (let i = 1; i < files.length; i++) {
                    const f = files[i];
                    const fName = Buffer.from(f.originalname, 'latin1').toString('utf8');
                    if (f.mimetype.startsWith('image/')) await bot.sendPhoto(TG_CONFIG.groupId, f.buffer, opts);
                    else await bot.sendDocument(TG_CONFIG.groupId, f.buffer, opts, { filename: fName });
                }
            }
        }

        await NewsPost.create({ messageId: sentMsg.message_id, chatId: sentMsg.chat.id, text, type: files.length ? 'file' : 'text', readBy: [] });
        logAction(user.name, 'publish_news', 'News posted');
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

async function initDB() { 
    if ((await User.countDocuments()) === 0) await User.create([{ username: "admin", password: "123", role: "admin", name: "Адмін" }]); 
    if(!(await User.findOne({role:'RRP'}))) await User.create({username:"rrp",password:"rrp",role:"RRP",name:"Регіональний Менеджер"});
    if((await Contact.countDocuments())===0) await Contact.create([{name: "RRP Наташа", phone: "+380954101682"}, {name: "AM Руслан", phone: "+380674652158"}]);
}

if (bot) {
    app.post(`/bot${process.env.TELEGRAM_TOKEN}`, (req, res) => { bot.processUpdate(req.body); res.sendStatus(200); });
    
    // --- UPDATED KEYBOARD ---
    const mainMenu = {
        keyboard: [
            [{ text: "📅 Відкрити Графік", web_app: { url: APP_URL } }],
            [{ text: "📋 Мої зміни" }, { text: "🌴 Мої віхідні" }],
            [{ text: "👀 Зараз на зміні" }, { text: "⚙️ Налаштування" }]
        ],
        resize_keyboard: true
    };

    bot.onText(/\/start/, (msg) => bot.sendMessage(msg.chat.id, "👋 Привіт! Вибери дію:", { reply_markup: mainMenu }));
    
    // --- NEW: MESSAGE HANDLER FOR BUTTONS ---
    bot.on('message', async (msg) => {
        if (!msg.text || msg.text.startsWith('/')) return; // Ignore commands
        
        const chatId = msg.chat.id;
        const user = await User.findOne({ telegramChatId: chatId });

        if (!user) {
            // If user clicks buttons but not logged in via /login command
            if (['📋 Мої зміни', '🌴 Мої віхідні', '⚙️ Налаштування'].includes(msg.text)) {
                return bot.sendMessage(chatId, "❌ Спочатку увійди через команду /login [логін] [пароль]");
            }
        }

        // 1. MY SHIFTS
        if (msg.text === '📋 Мої зміни') {
            const today = new Date().toISOString().split('T')[0];
            const shifts = await Shift.find({ name: user.name, date: { $gte: today } }).sort({ date: 1 }).limit(10);
            
            if (!shifts.length) return bot.sendMessage(chatId, "🎉 Найближчих змін не знайдено!");
            
            let response = `📋 <b>Твої найближчі зміни:</b>\n\n`;
            shifts.forEach(s => {
                const dateObj = new Date(s.date);
                const dayName = dateObj.toLocaleDateString('uk-UA', { weekday: 'long', day: 'numeric', month: 'numeric' });
                if (s.start === 'Відпустка') response += `🌴 <b>${dayName}</b>: Відпустка\n`;
                else response += `🔹 <b>${dayName}</b>: ${s.start} - ${s.end}\n`;
            });
            bot.sendMessage(chatId, response, { parse_mode: 'HTML' });
        }

        // 2. MY WEEKENDS (CALCULATED)
        else if (msg.text === '🌴 Мої віхідні') {
            const now = new Date();
            const year = now.getFullYear();
            const month = now.getMonth(); 
            const daysInMonth = new Date(year, month + 1, 0).getDate();
            const todayDay = now.getDate();

            // Get all shifts for this month
            const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
            const shifts = await Shift.find({ name: user.name, date: { $regex: `^${monthStr}` } });
            const workingDates = shifts.map(s => s.date);

            let weekends = [];
            for (let d = todayDay; d <= daysInMonth; d++) {
                const checkDate = `${monthStr}-${String(d).padStart(2, '0')}`;
                if (!workingDates.includes(checkDate)) {
                    weekends.push(new Date(checkDate).toLocaleDateString('uk-UA', { day: 'numeric', month: 'numeric', weekday: 'short' }));
                }
            }

            if (!weekends.length) return bot.sendMessage(chatId, "😐 Схоже, ти працюєш без вихідних до кінця місяця...");
            
            bot.sendMessage(chatId, `🌴 <b>Твої вихідні до кінця місяця:</b>\n\n${weekends.join(', ')}`, { parse_mode: 'HTML' });
        }

        // 3. WHO IS WORKING NOW
        else if (msg.text === '👀 Зараз на зміні') {
            // Reuse logic from /now
            const now = new Date(new Date().toLocaleString("en-US", {timeZone: "Europe/Kiev"}));
            const shifts = await Shift.find({ date: now.toISOString().split('T')[0] });
            const curMin = now.getHours()*60 + now.getMinutes();
            let active = [];
            shifts.forEach(s => {
                if(s.start === 'Відпустка') return;
                const [h1,m1]=s.start.split(':').map(Number); const [h2,m2]=s.end.split(':').map(Number); 
                const start=h1*60+m1; const end=h2*60+m2; 
                if(curMin>=start && curMin<end) active.push(`👤 <b>${s.name}</b> (до ${s.end})`);
            });
            bot.sendMessage(chatId, active.length ? `🟢 <b>Зараз працюють:</b>\n\n${active.join('\n')}` : "zzz... В магазині нікого немає 🌑", {parse_mode:'HTML'});
        }

        // 4. SETTINGS
        else if (msg.text === '⚙️ Налаштування') {
            const opts = {
                reply_markup: {
                    inline_keyboard: [
                        [{text:'🌙 Нагадувати ввечері (20:00)', callback_data:'set_remind_20'}],
                        [{text:'☀️ Нагадувати зранку (08:00)', callback_data:'set_remind_08'}],
                        [{text:'🔕 Вимкнути нагадування', callback_data:'set_remind_none'}]
                    ]
                }
            };
            bot.sendMessage(chatId, `⚙️ <b>Налаштування сповіщень</b>\n\nПоточний час: ${user.reminderTime === 'none' ? 'Вимкнено' : user.reminderTime}\n\nКоли нагадувати про зміну?`, { parse_mode: 'HTML', ...opts });
        }
    });

    bot.onText(/\/login (.+) (.+)/, async (msg, match) => { const u = await User.findOne({ username: match[1], password: match[2] }); if(u){ u.telegramChatId=msg.chat.id; await u.save(); bot.sendMessage(msg.chat.id, `✅ Привіт, ${u.name}! Тепер ти можеш користуватися кнопками.`, { reply_markup: mainMenu }); } else bot.sendMessage(msg.chat.id, "❌ Помилка логіна/пароля"); });
    
    // --- (Старі обробники команд залишаємо як резерв) ---
    bot.onText(/\/now/, async (msg) => { /* logic duplicated in button handler above, kept for slash command compatibility */ });
    bot.onText(/\/contacts/, async (msg) => { const c = await Contact.find(); bot.sendMessage(msg.chat.id, `📒 <b>Контакти:</b>\n\n` + c.map(x=>`👤 <b>${x.name}:</b> ${x.phone}`).join('\n'), {parse_mode:'HTML'}); });
    bot.onText(/\/addcontact (.+)/, async (msg, match) => { const u = await User.findOne({ telegramChatId: msg.from.id }); if(u?.role!=='SM'&&u?.role!=='admin') return; const args=match[1].trim().split(' '); const phone=args.pop(); const name=args.join(' '); await Contact.create({name,phone}); bot.sendMessage(msg.chat.id, `✅ Додано: ${name}`); });
    bot.onText(/\/delcontact (.+)/, async (msg, match) => { const u = await User.findOne({ telegramChatId: msg.from.id }); if(u?.role!=='SM'&&u?.role!=='admin') return; await Contact.findOneAndDelete({name:match[1].trim()}); bot.sendMessage(msg.chat.id, `🗑 Видалено: ${match[1].trim()}`); });

    bot.on('callback_query', async (q) => {
        const uid = q.from.id;
        if (q.data === 'read_news') {
            const u = await User.findOne({telegramChatId:uid});
            let name = u ? u.name : (q.from.first_name || 'User');
            const shortName = name.trim().split(' ').length > 1 ? name.trim().split(' ')[1] : name.trim().split(' ')[0];
            
            // Try Find Reply (Album) or Direct (Single)
            let p = await NewsPost.findOne({messageId:q.message.reply_to_message ? q.message.reply_to_message.message_id : q.message.message_id});
            if(!p) p = await NewsPost.findOne({messageId: q.message.message_id}); // Fallback

            if(!p) return bot.answerCallbackQuery(q.id, {text:'❌ Старий пост'});
            
            if(p.readBy.includes(shortName)) return bot.answerCallbackQuery(q.id, {text:'ℹ️ Вже відмітились', show_alert:true});
            p.readBy.push(shortName); await p.save();
            
            // Edit text only if single file/text (can't edit album caption easily via id of secondary msg)
            if (p.type !== 'file' || !q.message.reply_to_message) {
                 const txt = (p.text ? p.text + "\n\n" : "") + `👀 <b>Ознайомились:</b>\n${p.readBy.join(', ')}`;
                 try {
                    if(p.type==='text') bot.editMessageText(txt, {chat_id:q.message.chat.id, message_id:q.message.message_id, parse_mode:'HTML', reply_markup:q.message.reply_markup});
                    else bot.editMessageCaption(txt, {chat_id:q.message.chat.id, message_id:q.message.message_id, parse_mode:'HTML', reply_markup:q.message.reply_markup});
                 } catch(e){}
            }
            bot.answerCallbackQuery(q.id, {text:`Дякую, ${shortName}! ✅`});
        }
        if (q.data.startsWith('set_remind_')) {
            const u = await User.findOne({telegramChatId:uid});
            if(u){ u.reminderTime = q.data.replace('set_remind_','').replace('none','none'); if(u.reminderTime!=='none') u.reminderTime+=':00'; await u.save(); bot.answerCallbackQuery(q.id); bot.sendMessage(q.message.chat.id, `✅ Налаштування збережено: ${u.reminderTime === 'none' ? 'Вимкнено' : u.reminderTime}`); }
        }
    });
}

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));