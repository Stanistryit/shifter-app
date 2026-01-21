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

const app = express();
const PORT = process.env.PORT || 3000;

// --- GOOGLE SHEETS URL ---
const GOOGLE_SHEET_URL = ''; 

// --- CONFIG ---
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
    const APP_URL = 'https://shifter-app.onrender.com';
    bot.setWebHook(`${APP_URL}/bot${process.env.TELEGRAM_TOKEN}`);
    console.log("🤖 Telegram Bot: Webhook set");
}

// --- DB ---
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

const EventSchema = new mongoose.Schema({ date: String, title: String, repeat: { type: String, default: 'none' } });
const Event = mongoose.model('Event', EventSchema);

const TaskSchema = new mongoose.Schema({
    date: String, name: String, title: String, isFullDay: Boolean, start: String, end: String
});
const Task = mongoose.model('Task', TaskSchema);

const RequestSchema = new mongoose.Schema({
    type: String, data: Object, createdBy: String, createdAt: { type: Date, default: Date.now }
});
const Request = mongoose.model('Request', RequestSchema);

const ConfigSchema = new mongoose.Schema({ key: String, value: mongoose.Schema.Types.Mixed });
const Config = mongoose.model('Config', ConfigSchema);

// НОВА СХЕМА: Для зберігання постів і хто їх прочитав
const NewsPostSchema = new mongoose.Schema({
    messageId: Number,      // ID повідомлення в Telegram
    chatId: Number,         // ID чату/групи
    text: String,           // Текст новини (щоб не загубити при редагуванні)
    type: String,           // 'text' або 'photo'
    readBy: [String],       // Масив імен: ["Іван", "Петро"]
    createdAt: { type: Date, default: Date.now }
});
const NewsPost = mongoose.model('NewsPost', NewsPostSchema);

// --- NOTIFICATIONS ---
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

// --- GOOGLE SHEETS SYNC ---
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

// ============================================================
// --- ЩОДЕННИЙ ЗВІТ ---
// ============================================================
async function sendDailyBriefing() {
    if (!bot) return;
    const chatId = TG_CONFIG.groupId;
    const threadId = TG_CONFIG.topics.schedule;

    if (!chatId) { console.error("⚠️ TG_GROUP_ID missing"); return; }

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

// ============================================================

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
        let desc = "";
        if(type === 'add_shift') desc = `Додати зміну: ${data.date} для ${data.name}`;
        else if(type === 'del_shift') desc = `Видалити зміну: ${data.details}`;
        else if(type === 'add_task') desc = `Додати задачу: ${data.title}`;
        else desc = type;
        notifyRole('SM', `🔔 <b>Новий запит від SSE (${user.name})</b>\n\n${desc}\n\n👉 Зайдіть в панель "Запити", щоб підтвердити.`);
        return 'pending';
    }
    if (user.role === 'SM' || user.role === 'admin') return null;
    return 'forbidden';
}

// ROUTES
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
app.post('/api/shifts/clear-month', async (req, res) => { await Shift.deleteMany({ date: { $regex: `^${req.body.month}` } }); res.json({ success: true }); });
app.post('/api/sync-sheets', async (req, res) => { const user = await User.findById(req.session.userId); if (!user || (user.role !== 'admin' && user.role !== 'SM')) return res.status(403).json({ success: false }); const result = await syncWithGoogleSheets(); res.json(result); });
app.get('/api/tasks', async (req, res) => { const tasks = await Task.find(); res.json(tasks); });
app.post('/api/tasks', async (req, res) => { const c=await handlePermission(req,'add_task',req.body); if(c==='pending')return res.json({success:true,pending:true}); await Task.create(req.body); notifyUser(req.body.name, `📌 <b>Нова задача!</b>\n\n📝 Що: ${req.body.title}\n🗓 Коли: ${req.body.date}\n⏰ Час: ${req.body.isFullDay ? 'Весь день' : req.body.start + '-' + req.body.end}`); res.json({success:true}); });
app.post('/api/tasks/delete', async (req, res) => { const t=await Task.findById(req.body.id); if(!t)return res.json({success:false}); const c=await handlePermission(req,'del_task',{id:req.body.id,details:`${t.title} for ${t.name}`}); if(c==='pending')return res.json({success:true,pending:true}); await Task.findByIdAndDelete(req.body.id); res.json({success:true}); });
app.get('/api/events', async (req, res) => { const events = await Event.find(); res.json(events); });
app.post('/api/events', async (req, res) => { const c=await handlePermission(req,'add_event',req.body); if(c==='pending')return res.json({success:true,pending:true}); await Event.create(req.body); notifyAll(`📢 <b>Нова подія!</b>\n\n📌 ${req.body.title}\n🗓 Дата: ${req.body.date}`); res.json({success:true}); });
app.post('/api/events/delete', async (req, res) => { await Event.findByIdAndDelete(req.body.id); res.json({ success: true }); });
app.get('/api/requests', async (req, res) => { const u=await User.findById(req.session.userId); if(!u||(u.role!=='SM'&&u.role!=='admin'))return res.json([]); const r=await Request.find().sort({createdAt:-1}); res.json(r); });
app.post('/api/requests/action', async (req, res) => { const {id,action}=req.body; const r=await Request.findById(id); if(!r)return res.json({success:false}); if(action==='approve'){ if(r.type==='add_shift'){await Shift.create(r.data); notifyUser(r.data.name, `📅 <b>Зміна підтверджена!</b>\n${r.data.date}`);} if(r.type==='del_shift')await Shift.findByIdAndDelete(r.data.id); if(r.type==='add_task'){await Task.create(r.data); notifyUser(r.data.name, `📌 <b>Задача підтверджена!</b>\n${r.data.title}`);} if(r.type==='del_task')await Task.findByIdAndDelete(r.data.id); if(r.type==='add_event'){await Event.create(r.data); notifyAll(`📢 <b>Подія підтверджена!</b>\n${r.data.title}`);} } const sIcon=action==='approve'?'✅':'❌'; const sTxt=action==='approve'?'Схвалено':'Відхилено'; notifyUser(r.createdBy, `${sIcon} <b>Твій запит було ${sTxt}</b>\n\nТип: ${r.type}`); await Request.findByIdAndDelete(id); res.json({success:true}); });
app.post('/api/requests/approve-all', async (req, res) => { const rs=await Request.find(); for(const r of rs){ if(r.type==='add_shift')await Shift.create(r.data); if(r.type==='del_shift')await Shift.findByIdAndDelete(r.data.id); if(r.type==='add_task')await Task.create(r.data); if(r.type==='del_task')await Task.findByIdAndDelete(r.data.id); if(r.type==='add_event')await Event.create(r.data); notifyUser(r.createdBy, `✅ Твій запит (${r.type}) було схвалено масово.`); await Request.findByIdAndDelete(r._id); } res.json({success:true}); });
async function initDB() { try { if ((await User.countDocuments()) === 0) await User.create([{ username: "admin", password: "123", role: "admin", name: "Адмін" }]); const rrp=await User.findOne({role:'RRP'}); if(!rrp){await User.create({username:"rrp",password:"rrp",role:"RRP",name:"Регіональний Менеджер"});} } catch (e) { console.log(e); } }

if (bot) {
    app.post(`/bot${process.env.TELEGRAM_TOKEN}`, (req, res) => { bot.processUpdate(req.body); res.sendStatus(200); });
    const mainMenu = { keyboard: [ [{ text: "📅 Відкрити Графік", web_app: { url: 'https://shifter-app.onrender.com' } }], [{ text: "📋 Мої зміни" }, { text: "🌴 Вихідні" }] ], resize_keyboard: true };

    bot.onText(/\/start/, (msg) => { bot.sendMessage(msg.chat.id, "👋 Привіт! Я Shifter Bot.", { reply_markup: mainMenu }); });
    bot.onText(/\/login (.+) (.+)/, async (msg, match) => { const u = await User.findOne({ username: match[1], password: match[2] }); if (u) { u.telegramChatId = msg.chat.id; await u.save(); bot.sendMessage(msg.chat.id, `✅ Привіт, ${u.name}! Акаунт прив'язано.`, { reply_markup: mainMenu }); } else { bot.sendMessage(msg.chat.id, "❌ Помилка."); } });
    bot.onText(/\/settings?/, async (msg) => { const u = await User.findOne({ telegramChatId: msg.chat.id }); if(!u) return bot.sendMessage(msg.chat.id, "Спершу увійди: /login"); bot.sendMessage(msg.chat.id, `⚙️ Налаштування сповіщень`, { reply_markup: { inline_keyboard: [ [{text:'🌙 Вечір (20:00)',callback_data:'set_remind_20'}], [{text:'☀️ Ранок (08:00)',callback_data:'set_remind_08'}], [{text:'🔕 Вимкнути',callback_data:'set_remind_none'}] ] } }); });
    bot.onText(/\/setgroup/, async (msg) => { bot.sendMessage(msg.chat.id, "⚙️ ID групи налаштовано."); });

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

    bot.onText(/\/contacts?/, (msg) => {
        const text = `📒 <b>Корисні контакти:</b>\n\n` + `👨‍💼 <b>RRP:</b> +380954101682 (Наташа)\n` + `🧑‍💻 <b>AM:</b> +380674652158 (Руслан)\n`;
        bot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML', message_thread_id: msg.message_thread_id });
    });

    // ===========================================
    // /stats (Тільки SM)
    // ===========================================
    bot.onText(/\/stats/, async (msg) => {
        const userId = msg.from.id;
        try {
            const user = await User.findOne({ telegramChatId: userId });
            if (!user || (user.role !== 'SM' && user.role !== 'admin')) {
                return bot.sendMessage(msg.chat.id, "⛔ Тільки для SM.", { message_thread_id: msg.message_thread_id });
            }
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

    // ===========================================
    // УНІВЕРСАЛЬНИЙ /post (ТЕКСТ + ФОТО + ОЗНАЙОМЛЕННЯ)
    // ===========================================
    bot.on('message', async (msg) => {
        const content = msg.text || msg.caption || "";
        
        // --- ОБРОБКА КОМАНДИ /post ---
        if (content.trim().startsWith('/post')) {
            const userId = msg.from.id;
            const chatId = msg.chat.id;
            const threadId = msg.message_thread_id;

            try {
                // Перевірка прав
                const user = await User.findOne({ telegramChatId: userId });
                if (!user || (user.role !== 'SM' && user.role !== 'admin')) {
                    return bot.sendMessage(chatId, "⛔ Ця команда доступна тільки для SM.", { message_thread_id: threadId });
                }

                // Очищаємо текст
                const cleanText = content.replace('/post', '').trim();
                if (!cleanText && !msg.photo) return bot.sendMessage(chatId, "ℹ️ Напиши текст новини.", { message_thread_id: threadId });
                if (!TG_CONFIG.groupId) return bot.sendMessage(chatId, "❌ Не задано ID групи (env).", { message_thread_id: threadId });

                // Підготовка кнопки
                const opts = {
                    parse_mode: 'HTML',
                    message_thread_id: TG_CONFIG.topics.news,
                    reply_markup: {
                        inline_keyboard: [[{ text: "✅ Ознайомлений", callback_data: 'read_news' }]]
                    }
                };

                let sentMsg;
                if (msg.photo) {
                    const fileId = msg.photo[msg.photo.length - 1].file_id;
                    opts.caption = `📢 <b>Новини:</b>\n\n${cleanText}`;
                    sentMsg = await bot.sendPhoto(TG_CONFIG.groupId, fileId, opts);
                } else {
                    sentMsg = await bot.sendMessage(TG_CONFIG.groupId, `📢 <b>Новини:</b>\n\n${cleanText}`, opts);
                }

                // Збереження в базу для трекінгу переглядів
                await NewsPost.create({
                    messageId: sentMsg.message_id,
                    chatId: sentMsg.chat.id,
                    text: cleanText,
                    type: msg.photo ? 'photo' : 'text',
                    readBy: []
                });

                bot.sendMessage(chatId, "✅ Новину опубліковано з кнопкою контролю!", { message_thread_id: threadId });

            } catch (e) {
                console.error(e);
                bot.sendMessage(chatId, "❌ Помилка: " + e.message, { message_thread_id: threadId });
            }
            return;
        }

        // ... Інші обробники повідомлень (меню) ...
        if (!msg.text) return;
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

    // --- CALLBACK QUERIES (КНОПКИ) ---
    bot.on('callback_query', async (q) => {
        const chatId = q.message.chat.id;
        const msgId = q.message.message_id;
        const userId = q.from.id;

        // 1. Обробка кнопки "Ознайомлений"
        if (q.data === 'read_news') {
            try {
                // Знаходимо користувача в базі, щоб отримати нормальне ім'я
                const user = await User.findOne({ telegramChatId: userId });
                const userName = user ? user.name : (q.from.first_name + (q.from.last_name ? ' ' + q.from.last_name : ''));

                // Знаходимо пост в базі
                const post = await NewsPost.findOne({ messageId: msgId });
                
                if (!post) {
                    return bot.answerCallbackQuery(q.id, { text: "❌ Пост застарів або не знайдено в базі.", show_alert: true });
                }

                // Перевіряємо, чи вже читав
                if (post.readBy.includes(userName)) {
                    return bot.answerCallbackQuery(q.id, { text: "✅ Ви вже відмітились!", show_alert: false });
                }

                // Додаємо в список
                post.readBy.push(userName);
                await post.save();

                // Формуємо новий текст
                const readList = post.readBy.join(', ');
                const baseText = `📢 <b>Новини:</b>\n\n${post.text}`;
                const footer = `\n\n👀 <b>Ознайомились:</b>\n${readList}`;
                const newText = baseText + footer;

                // Редагуємо повідомлення
                if (post.type === 'photo') {
                    await bot.editMessageCaption(newText, {
                        chat_id: chatId,
                        message_id: msgId,
                        parse_mode: 'HTML',
                        reply_markup: q.message.reply_markup
                    });
                } else {
                    await bot.editMessageText(newText, {
                        chat_id: chatId,
                        message_id: msgId,
                        parse_mode: 'HTML',
                        reply_markup: q.message.reply_markup
                    });
                }

                bot.answerCallbackQuery(q.id, { text: "Зараховано!" });

            } catch (e) {
                console.error(e);
                bot.answerCallbackQuery(q.id, { text: "Помилка при оновленні." });
            }
        }

        // 2. Обробка налаштувань (Старе)
        if (q.data.startsWith('set_remind_')) {
            const u = await User.findOne({ telegramChatId: userId }); 
            if(!u) return;
            u.reminderTime = q.data.replace('set_remind_','').replace('none','none'); 
            if(u.reminderTime==='20') u.reminderTime='20:00'; 
            if(u.reminderTime==='08') u.reminderTime='08:00'; 
            await u.save(); 
            bot.sendMessage(chatId, `✅ Нагадування: ${u.reminderTime === 'none' ? 'Вимкнено' : u.reminderTime}`); 
            bot.answerCallbackQuery(q.id);
        }
    });

    cron.schedule('0 18 * * *', async () => { const t = new Date(); t.setDate(t.getDate() + 1); const d = t.toISOString().split('T')[0]; const s = await Shift.find({ date: d }); const tasks = await Task.find({ date: d }); for(const x of s){ const u=await User.findOne({name:x.name}); if(u?.telegramChatId && u.reminderTime==='20:00') bot.sendMessage(u.telegramChatId, `🌙 Завтра: ${x.start}-${x.end}`); } for(const x of tasks){ const u=await User.findOne({name:x.name}); if(u?.telegramChatId && u.reminderTime==='20:00') bot.sendMessage(u.telegramChatId, `📌 Завтра задача: ${x.title}`); } });
    cron.schedule('0 6 * * *', async () => { const d = new Date().toISOString().split('T')[0]; const s = await Shift.find({ date: d }); const tasks = await Task.find({ date: d }); for(const x of s){ const u=await User.findOne({name:x.name}); if(u?.telegramChatId && u.reminderTime==='08:00') bot.sendMessage(u.telegramChatId, `☀️ Сьогодні: ${x.start}-${x.end}`); } for(const x of tasks){ const u=await User.findOne({name:x.name}); if(u?.telegramChatId && u.reminderTime==='08:00') bot.sendMessage(u.telegramChatId, `📌 Сьогодні задача: ${x.title}`); } });
}

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));