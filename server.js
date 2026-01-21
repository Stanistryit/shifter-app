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

const app = express();
const PORT = process.env.PORT || 3000;

// --- MULTER (Завантаження файлів в RAM) ---
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// --- CONFIG ---
const GOOGLE_SHEET_URL = ''; // Опціонально
const TG_CONFIG = {
    groupId: process.env.TG_GROUP_ID, 
    topics: {
        schedule: 36793, 
        news: 36865      
    }
};

app.set('trust proxy', 1);

// --- TELEGRAM BOT ---
let bot = null;
if (process.env.TELEGRAM_TOKEN) {
    bot = new TelegramBot(process.env.TELEGRAM_TOKEN);
    const APP_URL = 'https://shifter-app.onrender.com'; // Переконайся, що це твій актуальний URL
    bot.setWebHook(`${APP_URL}/bot${process.env.TELEGRAM_TOKEN}`);
    console.log("🤖 Telegram Bot: Webhook set");

    // Меню команд
    bot.setMyCommands([
        { command: '/start', description: '🏠 Головне меню' },
        { command: '/now', description: '👀 Хто зараз на зміні' },
        { command: '/contacts', description: '📒 Контакти' },
        { command: '/settings', description: '⚙️ Налаштування' },
        { command: '/login', description: '🔐 Авторизація' },
        { command: '/stats', description: '📊 Табель (SM)' },
        { command: '/post', description: '📢 Новина (SM)' },
        { command: '/addcontact', description: '➕ Контакт (SM)' },
        { command: '/delcontact', description: '➖ Контакт (SM)' }
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
    reminderTime: { type: String, default: '20:00' }
});
const User = mongoose.model('User', UserSchema);

const ShiftSchema = new mongoose.Schema({ date: String, name: String, start: String, end: String });
const Shift = mongoose.model('Shift', ShiftSchema);

const TaskSchema = new mongoose.Schema({
    date: String, name: String, title: String, isFullDay: Boolean, start: String, end: String
});
const Task = mongoose.model('Task', TaskSchema);

const EventSchema = new mongoose.Schema({ date: String, title: String, repeat: { type: String, default: 'none' } });
const Event = mongoose.model('Event', EventSchema);

const RequestSchema = new mongoose.Schema({
    type: String, data: Object, createdBy: String, createdAt: { type: Date, default: Date.now }
});
const Request = mongoose.model('Request', RequestSchema);

const NewsPostSchema = new mongoose.Schema({
    messageId: Number, chatId: Number, text: String, type: String, readBy: [String], createdAt: { type: Date, default: Date.now }
});
const NewsPost = mongoose.model('NewsPost', NewsPostSchema);

const ContactSchema = new mongoose.Schema({
    name: { type: String, required: true },
    phone: { type: String, required: true }
});
const Contact = mongoose.model('Contact', ContactSchema);

// --- HELPERS ---
async function notifyUser(name, message) {
    if (!bot) return;
    try {
        const user = await User.findOne({ name: name });
        if (user && user.telegramChatId) await bot.sendMessage(user.telegramChatId, message, { parse_mode: 'HTML' });
    } catch (e) {}
}
async function notifyRole(role, message) {
    if (!bot) return;
    try {
        const users = await User.find({ role: role });
        for (const user of users) if(user.telegramChatId) await bot.sendMessage(user.telegramChatId, message, { parse_mode: 'HTML' });
    } catch (e) {}
}
async function notifyAll(message) {
    if (!bot) return;
    try {
        const users = await User.find({ telegramChatId: { $ne: null } });
        for (const user of users) await bot.sendMessage(user.telegramChatId, message, { parse_mode: 'HTML' });
    } catch (e) {}
}

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
cron.schedule('0 * * * *', async () => { await syncWithGoogleSheets(); });

// --- BRIEFING ---
async function sendDailyBriefing() {
    if (!bot) return;
    const chatId = TG_CONFIG.groupId;
    const threadId = TG_CONFIG.topics.schedule;
    if (!chatId) return;

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().split('T')[0];
    const dateDisplay = tomorrow.toLocaleDateString('uk-UA', { weekday: 'long', day: 'numeric', month: 'long' });

    const shifts = await Shift.find({ date: dateStr }).sort({ start: 1 });
    const tasks = await Task.find({ date: dateStr });

    let msg = `🌙 <b>План на завтра (${dateDisplay}):</b>\n\n`;
    if (shifts.length > 0) {
        msg += `👷‍♂️ <b>На зміні:</b>\n`;
        shifts.forEach(s => msg += `🔹 <b>${s.name}</b>: ${s.start} - ${s.end}\n`);
    } else { msg += `🌴 <b>Завтра змін немає</b>\n`; }
    
    if (tasks.length > 0) {
        msg += `\n📌 <b>Задачі та тренінги:</b>\n`;
        tasks.forEach(t => { const time = t.isFullDay ? "Весь день" : `${t.start}-${t.end}`; msg += `🔸 <b>${t.name}</b>: ${t.title} (${time})\n`; });
    }
    msg += `\nGood luck! 🚀`;
    try { await bot.sendMessage(chatId, msg, { parse_mode: 'HTML', message_thread_id: threadId }); } catch (e) { console.error("Briefing Error:", e.message); }
}
cron.schedule('0 18 * * *', sendDailyBriefing);

// --- MIDDLEWARE ---
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: 'supersecretkey',
    resave: false, saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URI }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7, httpOnly: true, secure: true, sameSite: 'none' }
}));

async function handlePermission(req, type, data) {
    const user = await User.findById(req.session.userId);
    if (!user) return 'unauthorized';
    if (user.role === 'RRP') return 'forbidden';
    if (user.role === 'SSE') {
        await Request.create({ type, data, createdBy: user.name });
        notifyRole('SM', `🔔 <b>Новий запит від SSE (${user.name})</b>\n\n${type}\n\n👉 Зайдіть в панель "Запити".`);
        return 'pending';
    }
    if (user.role === 'SM' || user.role === 'admin') return null;
    return 'forbidden';
}

// --- API ROUTES ---
app.post('/api/login', async (req, res) => { try { const { username, password } = req.body; const user = await User.findOne({ username, password }); if (user) { req.session.userId = user._id; req.session.save(err => { if(err) return res.json({ success: false }); res.json({ success: true, user: { name: user.name, role: user.role } }); }); } else { res.json({ success: false, message: "Невірний логін" }); } } catch (e) { res.status(500).json({ success: false }); } });
app.post('/api/login-telegram', async (req, res) => { const { telegramId } = req.body; if (!telegramId) return res.json({ success: false }); const user = await User.findOne({ telegramChatId: telegramId }); if (user) { req.session.userId = user._id; req.session.save(err => { if(err) return res.json({ success: false }); res.json({ success: true, user: { name: user.name, role: user.role } }); }); } else { res.json({ success: false }); } });
app.post('/api/logout', (req, res) => { req.session.destroy(); res.json({ success: true }); });
app.get('/api/me', async (req, res) => { if (!req.session.userId) return res.json({ loggedIn: false }); const user = await User.findById(req.session.userId); if (!user) return res.json({ loggedIn: false }); res.json({ loggedIn: true, user: { name: user.name, role: user.role } }); });
app.get('/api/users', async (req, res) => { const users = await User.find({}, 'name role'); res.json(users); });

app.get('/api/shifts', async (req, res) => { if (!req.session.userId) return res.status(403).json({ error: "Auth required" }); const shifts = await Shift.find(); res.json(shifts); });
app.post('/api/shifts', async (req, res) => { const c=await handlePermission(req,'add_shift',req.body); if(c==='pending')return res.json({success:true,pending:true}); if(c==='forbidden')return res.status(403).json({}); await Shift.create(req.body); notifyUser(req.body.name, `📅 <b>Тобі додано зміну!</b>\n\n🗓 Дата: ${req.body.date}\n⏰ Час: ${req.body.start} - ${req.body.end}`); res.json({success:true}); });
app.post('/api/delete-shift', async (req, res) => { const s=await Shift.findById(req.body.id); if(!s)return res.json({success:false}); const c=await handlePermission(req,'del_shift',{id:req.body.id,details:`${s.date} (${s.name})`}); if(c==='pending')return res.json({success:true,pending:true}); await Shift.findByIdAndDelete(req.body.id); notifyUser(s.name, `❌ <b>Твою зміну скасовано</b>\n\n🗓 Дата: ${s.date}`); res.json({success:true}); });
app.post('/api/shifts/bulk', async (req, res) => { if (req.body.shifts?.length) await Shift.insertMany(req.body.shifts); res.json({ success: true }); });
app.post('/api/shifts/clear-day', async (req, res) => { await Shift.deleteMany({ date: req.body.date }); res.json({ success: true }); });

app.get('/api/tasks', async (req, res) => { const tasks = await Task.find(); res.json(tasks); });
app.post('/api/tasks', async (req, res) => { const c=await handlePermission(req,'add_task',req.body); if(c==='pending')return res.json({success:true,pending:true}); await Task.create(req.body); notifyUser(req.body.name, `📌 <b>Нова задача!</b>\n\n📝 Що: ${req.body.title}\n🗓 Коли: ${req.body.date}\n⏰ Час: ${req.body.isFullDay ? 'Весь день' : req.body.start + '-' + req.body.end}`); res.json({success:true}); });
app.post('/api/tasks/delete', async (req, res) => { const t=await Task.findById(req.body.id); if(!t)return res.json({success:false}); const c=await handlePermission(req,'del_task',{id:req.body.id,details:`${t.title} for ${t.name}`}); if(c==='pending')return res.json({success:true,pending:true}); await Task.findByIdAndDelete(req.body.id); res.json({success:true}); });

app.get('/api/events', async (req, res) => { const events = await Event.find(); res.json(events); });
app.post('/api/events', async (req, res) => { const c=await handlePermission(req,'add_event',req.body); if(c==='pending')return res.json({success:true,pending:true}); await Event.create(req.body); notifyAll(`📢 <b>Нова подія!</b>\n\n📌 ${req.body.title}\n🗓 Дата: ${req.body.date}`); res.json({success:true}); });
app.post('/api/events/delete', async (req, res) => { await Event.findByIdAndDelete(req.body.id); res.json({ success: true }); });

app.get('/api/requests', async (req, res) => { const u=await User.findById(req.session.userId); if(!u||(u.role!=='SM'&&u.role!=='admin'))return res.json([]); const r=await Request.find().sort({createdAt:-1}); res.json(r); });
app.post('/api/requests/action', async (req, res) => { const {id,action}=req.body; const r=await Request.findById(id); if(!r)return res.json({success:false}); if(action==='approve'){ if(r.type==='add_shift'){await Shift.create(r.data); notifyUser(r.data.name, `📅 <b>Зміна підтверджена!</b>\n${r.data.date}`);} if(r.type==='del_shift')await Shift.findByIdAndDelete(r.data.id); if(r.type==='add_task'){await Task.create(r.data); notifyUser(r.data.name, `📌 <b>Задача підтверджена!</b>\n${r.data.title}`);} if(r.type==='del_task')await Task.findByIdAndDelete(r.data.id); if(r.type==='add_event'){await Event.create(r.data); notifyAll(`📢 <b>Подія підтверджена!</b>\n${r.data.title}`);} } const sIcon=action==='approve'?'✅':'❌'; const sTxt=action==='approve'?'Схвалено':'Відхилено'; notifyUser(r.createdBy, `${sIcon} <b>Твій запит було ${sTxt}</b>\n\nТип: ${r.type}`); await Request.findByIdAndDelete(id); res.json({success:true}); });
app.post('/api/requests/approve-all', async (req, res) => { const rs=await Request.find(); for(const r of rs){ if(r.type==='add_shift')await Shift.create(r.data); if(r.type==='del_shift')await Shift.findByIdAndDelete(r.data.id); if(r.type==='add_task')await Task.create(r.data); if(r.type==='del_task')await Task.findByIdAndDelete(r.data.id); if(r.type==='add_event')await Event.create(r.data); notifyUser(r.createdBy, `✅ Твій запит (${r.type}) було схвалено масово.`); await Request.findByIdAndDelete(r._id); } res.json({success:true}); });

// --- ПУБЛІКАЦІЯ НОВИН (САЙТ) ---
app.post('/api/news/publish', upload.single('media'), async (req, res) => {
    try {
        if (!req.session.userId) return res.status(403).json({ error: "No auth" });
        const user = await User.findById(req.session.userId);
        if (!user || (user.role !== 'SM' && user.role !== 'admin')) return res.status(403).json({ error: "Forbidden" });

        const rawText = req.body.text || "";
        const text = rawText; 
        const file = req.file;

        if (!text && !file) return res.status(400).json({ error: "Empty" });
        if (!TG_CONFIG.groupId) return res.status(500).json({ error: "No Group ID" });

        const opts = {
            parse_mode: 'HTML',
            message_thread_id: TG_CONFIG.topics.news,
            reply_markup: { inline_keyboard: [[{ text: "✅ Ознайомлений", callback_data: 'read_news' }]] }
        };

        let sentMsg;
        let postType = 'text';

        if (file) {
            // FIX: Виправлення кирилиці в назвах файлів (Latin1 -> UTF8)
            const originalNameFixed = Buffer.from(file.originalname, 'latin1').toString('utf8');
            const isImage = file.mimetype.startsWith('image/');
            const fileOptions = { filename: originalNameFixed, contentType: file.mimetype };
            
            if (isImage) {
                opts.caption = `📢 <b>Новини:</b>\n\n${text}`;
                sentMsg = await bot.sendPhoto(TG_CONFIG.groupId, file.buffer, opts, fileOptions);
                postType = 'photo';
            } else {
                opts.caption = `📢 <b>Новини:</b>\n\n${text}`;
                sentMsg = await bot.sendDocument(TG_CONFIG.groupId, file.buffer, opts, fileOptions);
                postType = 'document';
            }
        } else {
            sentMsg = await bot.sendMessage(TG_CONFIG.groupId, `📢 <b>Новини:</b>\n\n${text}`, opts);
        }

        await NewsPost.create({
            messageId: sentMsg.message_id, chatId: sentMsg.chat.id, text: text,
            type: postType, readBy: []
        });

        res.json({ success: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

// --- INIT DB ---
async function initDB() { try { if ((await User.countDocuments()) === 0) await User.create([{ username: "admin", password: "123", role: "admin", name: "Адмін" }]); const rrp=await User.findOne({role:'RRP'}); if(!rrp){await User.create({username:"rrp",password:"rrp",role:"RRP",name:"Регіональний Менеджер"});} 
const c = await Contact.countDocuments(); if(c === 0) { await Contact.create([{name: "RRP Наташа", phone: "+380954101682"}, {name: "AM Руслан", phone: "+380674652158"}]); }
} catch (e) { console.log(e); } }

// --- BOT LOGIC ---
if (bot) {
    app.post(`/bot${process.env.TELEGRAM_TOKEN}`, (req, res) => { bot.processUpdate(req.body); res.sendStatus(200); });
    const mainMenu = { keyboard: [ [{ text: "📅 Відкрити Графік", web_app: { url: 'https://shifter-app.onrender.com' } }], [{ text: "📋 Мої зміни" }, { text: "🌴 Вихідні" }] ], resize_keyboard: true };

    bot.onText(/\/start/, (msg) => { bot.sendMessage(msg.chat.id, "👋 Привіт! Я Shifter Bot.", { reply_markup: mainMenu }); });
    bot.onText(/\/login (.+) (.+)/, async (msg, match) => { const u = await User.findOne({ username: match[1], password: match[2] }); if (u) { u.telegramChatId = msg.chat.id; await u.save(); bot.sendMessage(msg.chat.id, `✅ Привіт, ${u.name}! Акаунт прив'язано.`, { reply_markup: mainMenu }); } else { bot.sendMessage(msg.chat.id, "❌ Помилка."); } });
    bot.onText(/\/settings?/, async (msg) => { const u = await User.findOne({ telegramChatId: msg.chat.id }); if(!u) return bot.sendMessage(msg.chat.id, "Спершу увійди: /login"); bot.sendMessage(msg.chat.id, `⚙️ Налаштування сповіщень`, { reply_markup: { inline_keyboard: [ [{text:'🌙 Вечір (20:00)',callback_data:'set_remind_20'}], [{text:'☀️ Ранок (08:00)',callback_data:'set_remind_08'}], [{text:'🔕 Вимкнути',callback_data:'set_remind_none'}] ] } }); });
    bot.onText(/\/setgroup/, async (msg) => { bot.sendMessage(msg.chat.id, "⚙️ ID групи налаштовано."); });

    // /now
    bot.onText(/\/now/, async (msg) => {
        const kyivTimeStr = new Date().toLocaleString("en-US", {timeZone: "Europe/Kiev", hour12: false});
        const now = new Date(new Date().toLocaleString("en-US", {timeZone: "Europe/Kiev"}));
        const todayStr = now.toISOString().split('T')[0];
        const [hStr, mStr] = kyivTimeStr.split(', ')[1].split(':'); const currentMinutes = parseInt(hStr) * 60 + parseInt(mStr);
        const shifts = await Shift.find({ date: todayStr });
        let activeWorkers = [];
        shifts.forEach(s => {
            const [sH, sM] = s.start.split(':').map(Number); const [eH, eM] = s.end.split(':').map(Number);
            const startMin = sH * 60 + sM; const endMin = eH * 60 + eM;
            if (currentMinutes >= startMin && currentMinutes < endMin) activeWorkers.push(`👤 <b>${s.name}</b> (до ${s.end})`);
        });
        if (activeWorkers.length > 0) bot.sendMessage(msg.chat.id, `🟢 <b>Зараз працюють:</b>\n\n${activeWorkers.join('\n')}`, { parse_mode: 'HTML', message_thread_id: msg.message_thread_id });
        else bot.sendMessage(msg.chat.id, "zzz... Зараз нікого немає на зміні 😴", { message_thread_id: msg.message_thread_id });
    });

    // Контакти
    bot.onText(/\/contacts?/, async (msg) => {
        try {
            const contacts = await Contact.find();
            if (contacts.length === 0) return bot.sendMessage(msg.chat.id, "📭 Список контактів поки порожній.", { message_thread_id: msg.message_thread_id });
            let text = `📒 <b>Корисні контакти:</b>\n\n`;
            contacts.forEach(c => { text += `👤 <b>${c.name}:</b> ${c.phone}\n`; });
            bot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML', message_thread_id: msg.message_thread_id });
        } catch(e) { console.error(e); }
    });
    bot.onText(/\/addcontact (.+)/, async (msg, match) => {
        const userId = msg.from.id;
        try {
            const user = await User.findOne({ telegramChatId: userId });
            if (!user || (user.role !== 'SM' && user.role !== 'admin')) return bot.sendMessage(msg.chat.id, "⛔ Тільки для SM.", { message_thread_id: msg.message_thread_id });
            const args = match[1].trim().split(' ');
            if (args.length < 2) return bot.sendMessage(msg.chat.id, "⚠️ Формат: /addcontact Ім'я Номер", { message_thread_id: msg.message_thread_id });
            const phone = args.pop(); const name = args.join(' '); 
            await Contact.create({ name, phone });
            bot.sendMessage(msg.chat.id, `✅ Додано контакт:\n${name}: ${phone}`, { message_thread_id: msg.message_thread_id });
        } catch (e) { bot.sendMessage(msg.chat.id, "❌ Помилка.", { message_thread_id: msg.message_thread_id }); }
    });
    bot.onText(/\/delcontact (.+)/, async (msg, match) => {
        const userId = msg.from.id;
        try {
            const user = await User.findOne({ telegramChatId: userId });
            if (!user || (user.role !== 'SM' && user.role !== 'admin')) return bot.sendMessage(msg.chat.id, "⛔ Тільки для SM.", { message_thread_id: msg.message_thread_id });
            const nameToDelete = match[1].trim();
            const res = await Contact.findOneAndDelete({ name: nameToDelete });
            if(res) bot.sendMessage(msg.chat.id, `🗑 Контакт "${nameToDelete}" видалено.`, { message_thread_id: msg.message_thread_id });
            else bot.sendMessage(msg.chat.id, `⚠️ Контакт "${nameToDelete}" не знайдено.`, { message_thread_id: msg.message_thread_id });
        } catch (e) { bot.sendMessage(msg.chat.id, "❌ Помилка.", { message_thread_id: msg.message_thread_id }); }
    });

    // Stats
    bot.onText(/\/stats/, async (msg) => {
        const userId = msg.from.id;
        try {
            const user = await User.findOne({ telegramChatId: userId });
            if (!user || (user.role !== 'SM' && user.role !== 'admin')) return bot.sendMessage(msg.chat.id, "⛔ Тільки для SM.", { message_thread_id: msg.message_thread_id });
            const now = new Date();
            const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
            const monthName = new Date(now.getFullYear(), now.getMonth(), 1).toLocaleDateString('uk-UA', { month: 'long', year: 'numeric' });
            const shifts = await Shift.find({ date: { $regex: `^${monthStr}` } });
            if (shifts.length === 0) return bot.sendMessage(msg.chat.id, `📊 <b>Табель за ${monthName}:</b>\n\nДаних немає.`, { message_thread_id: msg.message_thread_id });
            const report = {};
            shifts.forEach(s => {
                const [h1, m1] = s.start.split(':').map(Number); const [h2, m2] = s.end.split(':').map(Number);
                const hours = (h2 + m2/60) - (h1 + m1/60);
                if (!report[s.name]) report[s.name] = { totalHours: 0, shifts: 0 };
                report[s.name].totalHours += hours;
                report[s.name].shifts += 1;
            });
            let response = `📊 <b>Табель за ${monthName}:</b>\n\n`;
            Object.entries(report).sort((a, b) => b[1].totalHours - a[1].totalHours).forEach(([name, data], index) => {
                const medal = index === 0 ? '🥇' : (index === 1 ? '🥈' : (index === 2 ? '🥉' : '👤'));
                response += `${medal} <b>${name}:</b> ${parseFloat(data.totalHours.toFixed(1))} год. (${data.shifts} зм.)\n`;
            });
            bot.sendMessage(msg.chat.id, response, { parse_mode: 'HTML', message_thread_id: msg.message_thread_id });
        } catch (e) { bot.sendMessage(msg.chat.id, "❌ Помилка.", { message_thread_id: msg.message_thread_id }); }
    });

    // /post (через чат, legacy)
    bot.on('message', async (msg) => {
        const content = msg.text || msg.caption || "";
        if (content.trim().startsWith('/post')) {
            const userId = msg.from.id; const chatId = msg.chat.id; const threadId = msg.message_thread_id;
            try {
                const user = await User.findOne({ telegramChatId: userId });
                if (!user || (user.role !== 'SM' && user.role !== 'admin')) return bot.sendMessage(chatId, "⛔ Тільки для SM.", { message_thread_id: threadId });
                const cleanText = content.replace('/post', '').trim();
                if (!cleanText && !msg.photo && !msg.document) return bot.sendMessage(chatId, "ℹ️ Напиши текст.", { message_thread_id: threadId });
                if (!TG_CONFIG.groupId) return bot.sendMessage(chatId, "❌ Не задано ID групи.", { message_thread_id: threadId });

                const opts = { parse_mode: 'HTML', message_thread_id: TG_CONFIG.topics.news, reply_markup: { inline_keyboard: [[{ text: "✅ Ознайомлений", callback_data: 'read_news' }]] } };
                let sentMsg, postType = 'text';

                if (msg.photo) {
                    const fileId = msg.photo[msg.photo.length - 1].file_id;
                    opts.caption = `📢 <b>Новини:</b>\n\n${cleanText}`;
                    sentMsg = await bot.sendPhoto(TG_CONFIG.groupId, fileId, opts);
                    postType = 'photo';
                } else if (msg.document) {
                    const fileId = msg.document.file_id;
                    opts.caption = `📢 <b>Новини:</b>\n\n${cleanText}`;
                    sentMsg = await bot.sendDocument(TG_CONFIG.groupId, fileId, opts);
                    postType = 'document';
                } else {
                    sentMsg = await bot.sendMessage(TG_CONFIG.groupId, `📢 <b>Новини:</b>\n\n${cleanText}`, opts);
                }
                await NewsPost.create({ messageId: sentMsg.message_id, chatId: sentMsg.chat.id, text: cleanText, type: postType, readBy: [] });
                bot.sendMessage(chatId, "✅ Новину опубліковано!", { message_thread_id: threadId });
            } catch (e) { bot.sendMessage(chatId, "❌ Помилка: " + e.message, { message_thread_id: threadId }); }
            return;
        }

        if (msg.text === '📋 Мої зміни') {
            const u = await User.findOne({ telegramChatId: msg.chat.id }); if (!u) return bot.sendMessage(msg.chat.id, "🔴 Авторизуйся: /login");
            const t = new Date().toISOString().split('T')[0];
            const s = await Shift.find({ name: u.name, date: { $gte: t } }).sort({ date: 1 }).limit(5); const tk = await Task.find({ name: u.name, date: { $gte: t } }).sort({ date: 1 });
            let r = "📋 <b>Твої найближчі події:</b>\n"; s.forEach(x => r+=`🔹 ${x.date.slice(5)}: ${x.start}-${x.end}\n`); tk.forEach(x => r+=`🔸 ${x.date.slice(5)}: ${x.title}\n`);
            bot.sendMessage(msg.chat.id, s.length || tk.length ? r : "Пусто", { parse_mode: 'HTML' });
        }
        if (msg.text === '🌴 Вихідні') {
            const u = await User.findOne({ telegramChatId: msg.chat.id }); if (!u) return;
            const d = new Date(); const m = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; const s = await Shift.find({ name: u.name, date: { $regex: `^${m}` } }); const dim = new Date(d.getFullYear(), d.getMonth()+1, 0).getDate(); const wd = s.map(x => parseInt(x.date.split('-')[2])); let off = []; for(let i=d.getDate(); i<=dim; i++) if(!wd.includes(i)) off.push(i);
            bot.sendMessage(msg.chat.id, `🌴 Вихідні: ${off.join(', ')}`);
        }
    });

    // Callback Query (Кнопки)
    bot.on('callback_query', async (q) => {
        const chatId = q.message.chat.id; 
        const msgId = q.message.message_id; 
        const userId = q.from.id;

        // --- ОБРОБКА КНОПКИ "ОЗНАЙОМЛЕНИЙ" ---
        if (q.data === 'read_news') {
            try {
                // 1. Отримуємо користувача і скорочуємо ім'я
                const user = await User.findOne({ telegramChatId: userId });
                let rawName = user ? user.name : (q.from.first_name || 'User');
                const shortName = rawName.split(' ')[0]; // "Стас Петров" -> "Стас"

                const post = await NewsPost.findOne({ messageId: msgId });
                if (!post) return bot.answerCallbackQuery(q.id, { text: "❌ Пост застарів.", show_alert: true });

                // 2. Перевірка на дублікат
                if (post.readBy.includes(shortName)) {
                    // Alert: показує вікно
                    return bot.answerCallbackQuery(q.id, { text: "ℹ️ Ви вже відмітились!", show_alert: true });
                }

                // 3. Додаємо
                post.readBy.push(shortName); 
                await post.save();

                // 4. Оновлюємо пост
                const readList = post.readBy.join(', ');
                const fullText = `📢 <b>Новини:</b>\n\n${post.text}\n\n👀 <b>Ознайомились:</b>\n${readList}`;

                if (post.type === 'photo' || post.type === 'document') {
                    await bot.editMessageCaption(fullText, { 
                        chat_id: chatId, 
                        message_id: msgId, 
                        parse_mode: 'HTML', 
                        reply_markup: q.message.reply_markup 
                    });
                } else {
                    await bot.editMessageText(fullText, { 
                        chat_id: chatId, 
                        message_id: msgId, 
                        parse_mode: 'HTML', 
                        reply_markup: q.message.reply_markup 
                    });
                }
                
                // 5. Успіх: Toast (спливаюча плашка)
                bot.answerCallbackQuery(q.id, { text: `Дякую, ${shortName}, зафіксовано! ✅` });

            } catch (e) { 
                console.error(e); 
                bot.answerCallbackQuery(q.id, { text: "Помилка." }); 
            }
        }

        // --- НАЛАШТУВАННЯ ---
        if (q.data.startsWith('set_remind_')) {
            const u = await User.findOne({ telegramChatId: userId }); 
            if(u) {
                u.reminderTime = q.data.replace('set_remind_','').replace('none','none'); 
                if(u.reminderTime!=='none' && !u.reminderTime.includes(':')) u.reminderTime+=':00'; 
                await u.save(); 
                bot.sendMessage(chatId, `✅ Нагадування: ${u.reminderTime === 'none' ? 'Вимкнено' : u.reminderTime}`); 
                bot.answerCallbackQuery(q.id);
            }
        }
    });

    // Reminders
    cron.schedule('0 18 * * *', async () => { const t = new Date(); t.setDate(t.getDate() + 1); const d = t.toISOString().split('T')[0]; const s = await Shift.find({ date: d }); const tasks = await Task.find({ date: d }); for(const x of s){ const u=await User.findOne({name:x.name}); if(u?.telegramChatId && u.reminderTime==='20:00') bot.sendMessage(u.telegramChatId, `🌙 Завтра: ${x.start}-${x.end}`); } for(const x of tasks){ const u=await User.findOne({name:x.name}); if(u?.telegramChatId && u.reminderTime==='20:00') bot.sendMessage(u.telegramChatId, `📌 Завтра задача: ${x.title}`); } });
    cron.schedule('0 6 * * *', async () => { const d = new Date().toISOString().split('T')[0]; const s = await Shift.find({ date: d }); const tasks = await Task.find({ date: d }); for(const x of s){ const u=await User.findOne({name:x.name}); if(u?.telegramChatId && u.reminderTime==='08:00') bot.sendMessage(u.telegramChatId, `☀️ Сьогодні: ${x.start}-${x.end}`); } for(const x of tasks){ const u=await User.findOne({name:x.name}); if(u?.telegramChatId && u.reminderTime==='08:00') bot.sendMessage(u.telegramChatId, `📌 Сьогодні задача: ${x.title}`); } });
}

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));