require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const axios = require('axios'); // Переконася, що axios встановлено в package.json

const app = express();
const PORT = process.env.PORT || 3000;

// 1. НАЛАШТУВАННЯ
app.set('trust proxy', 1);

// --- TELEGRAM BOT INIT ---
let bot = null;
if (process.env.TELEGRAM_TOKEN) {
    bot = new TelegramBot(process.env.TELEGRAM_TOKEN);
    const APP_URL = 'https://shifter-app.onrender.com';
    bot.setWebHook(`${APP_URL}/bot${process.env.TELEGRAM_TOKEN}`);
    console.log("🤖 Telegram Bot: Webhook set");
}

// --- DB CONNECTION ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => { console.log("✅ Connected to MongoDB"); initDB(); })
    .catch(err => console.error("❌ MongoDB connection error:", err));

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

// --- NOTIFICATION HELPERS ---
async function notifyUser(name, message) {
    if (!bot) return;
    try {
        const user = await User.findOne({ name: name });
        if (user && user.telegramChatId) await bot.sendMessage(user.telegramChatId, message, { parse_mode: 'HTML' });
    } catch (e) { console.error(`Failed to notify ${name}:`, e.message); }
}

async function notifyRole(role, message) {
    if (!bot) return;
    try {
        const users = await User.find({ role: role });
        for (const user of users) {
            if (user.telegramChatId) await bot.sendMessage(user.telegramChatId, message, { parse_mode: 'HTML' });
        }
    } catch (e) { console.error(`Failed to notify role ${role}:`, e.message); }
}

async function notifyAll(message) {
    if (!bot) return;
    try {
        const users = await User.find({ telegramChatId: { $ne: null } });
        for (const user of users) await bot.sendMessage(user.telegramChatId, message, { parse_mode: 'HTML' });
    } catch (e) { console.error("Failed to notify all:", e.message); }
}

// ============================================================
// --- AIR RAID ALERTS SYSTEM (Джерело: єМапа) ---
// ============================================================

let isAlertActive = false;

// Функція пошуку людей на зміні ПРЯМО ЗАРАЗ
async function getWorkersOnShiftNow() {
    // Отримуємо час у Києві
    const kyivTimeStr = new Date().toLocaleString("en-US", {timeZone: "Europe/Kiev", hour12: false});
    const now = new Date(new Date().toLocaleString("en-US", {timeZone: "Europe/Kiev"}));
    
    // Формуємо дату YYYY-MM-DD
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const todayStr = `${year}-${month}-${day}`;
    
    // Парсимо час HH:MM у хвилини
    const [hStr, mStr] = kyivTimeStr.split(', ')[1].split(':');
    const currentMinutes = parseInt(hStr) * 60 + parseInt(mStr);

    const shifts = await Shift.find({ date: todayStr });
    let workers = [];

    for (const s of shifts) {
        const [startH, startM] = s.start.split(':').map(Number);
        const [endH, endM] = s.end.split(':').map(Number);
        
        const startMinutes = startH * 60 + startM;
        const endMinutes = endH * 60 + endM;

        // Чи потрапляє поточний час у проміжок зміни?
        if (currentMinutes >= startMinutes && currentMinutes < endMinutes) {
            workers.push(s.name);
        }
    }
    return workers;
}

// Перевірка тривоги
async function checkAirAlert() {
    if (!bot) return;
    try {
        // Стабільний JSON від єМапи
        const response = await axios.get('https://emapa.fra1.cdn.digitaloceanspaces.com/statuses.json'); 
        const data = response.data;
        
        const sumyOblast = data.states["Сумська область"];
        if (!sumyOblast) return;

        // Перевіряємо Область
        const isOblastAlert = sumyOblast.enabled === true;

        // Перевіряємо Район (Сумський)
        let isDistrictAlert = false;
        if (sumyOblast.districts && sumyOblast.districts["Сумський район"]) {
            isDistrictAlert = sumyOblast.districts["Сумський район"].enabled === true;
        }

        // Загальний статус тривоги (або область, або район)
        const isSumyAlert = isOblastAlert || isDistrictAlert;

        // --- ЛОГІКА ЗМІНИ СТАНУ ---
        if (isSumyAlert && !isAlertActive) {
            // ПОЧАТОК ТРИВОГИ
            isAlertActive = true;
            const workers = await getWorkersOnShiftNow();
            console.log(`🚨 ALERT START (SUMY)! Notifying: ${workers.length} workers.`);
            
            const locationText = isOblastAlert ? "ВСЯ СУМСЬКА ОБЛАСТЬ" : "СУМСЬКИЙ РАЙОН";
            
            for (const name of workers) {
                notifyUser(name, `🚨 <b>ПОВІТРЯНА ТРИВОГА!</b>\n📍 <b>${locationText}</b>\n\nТерміново пройдіть в укриття!`);
            }
        } 
        else if (!isSumyAlert && isAlertActive) {
            // ВІДБІЙ ТРИВОГИ
            isAlertActive = false;
            const workers = await getWorkersOnShiftNow();
            console.log(`✅ ALERT END (SUMY)!`);

            for (const name of workers) {
                notifyUser(name, `✅ <b>ВІДБІЙ ТРИВОГИ</b>\n\nМожна повертатись до роботи.`);
            }
        }

    } catch (e) {
        console.error("Alert Check Error:", e.message);
    }
}

// Перевіряємо кожні 30 секунд
setInterval(checkAirAlert, 30000);

// ============================================================

// --- MIDDLEWARE ---
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: 'supersecretkey',
    resave: false, saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URI }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7, httpOnly: true, secure: true, sameSite: 'none' }
}));

// --- PERMISSIONS + NOTIFICATIONS ---
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

// --- API ROUTES ---

// LOGIN
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ username, password });
        if (user) { 
            req.session.userId = user._id; 
            req.session.save(err => {
                if(err) return res.json({ success: false });
                res.json({ success: true, user: { name: user.name, role: user.role } }); 
            });
        } else { res.json({ success: false, message: "Невірний логін" }); }
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post('/api/login-telegram', async (req, res) => {
    const { telegramId } = req.body;
    if (!telegramId) return res.json({ success: false });
    const user = await User.findOne({ telegramChatId: telegramId });
    if (user) {
        req.session.userId = user._id;
        req.session.save(err => {
            if(err) return res.json({ success: false });
            res.json({ success: true, user: { name: user.name, role: user.role } });
        });
    } else { res.json({ success: false }); }
});

app.post('/api/logout', (req, res) => { req.session.destroy(); res.json({ success: true }); });
app.get('/api/me', async (req, res) => {
    if (!req.session.userId) return res.json({ loggedIn: false });
    const user = await User.findById(req.session.userId);
    if (!user) return res.json({ loggedIn: false });
    res.json({ loggedIn: true, user: { name: user.name, role: user.role } });
});
app.get('/api/users', async (req, res) => { const users = await User.find({}, 'name role'); res.json(users); });

// --- DATA API ---

app.get('/api/shifts', async (req, res) => { if (!req.session.userId) return res.status(403).json({ error: "Auth required" }); const shifts = await Shift.find(); res.json(shifts); });

app.post('/api/shifts', async (req, res) => { 
    const c = await handlePermission(req, 'add_shift', req.body); 
    if(c === 'pending') return res.json({success: true, pending: true}); 
    if(c === 'forbidden') return res.status(403).json({}); 
    await Shift.create(req.body); 
    notifyUser(req.body.name, `📅 <b>Тобі додано зміну!</b>\n\n🗓 Дата: ${req.body.date}\n⏰ Час: ${req.body.start} - ${req.body.end}`);
    res.json({success: true}); 
});

app.post('/api/delete-shift', async (req, res) => { 
    const s = await Shift.findById(req.body.id); 
    if(!s) return res.json({success: false}); 
    const c = await handlePermission(req, 'del_shift', {id: req.body.id, details: `${s.date} (${s.name})`}); 
    if(c === 'pending') return res.json({success: true, pending: true}); 
    await Shift.findByIdAndDelete(req.body.id); 
    notifyUser(s.name, `❌ <b>Твою зміну скасовано</b>\n\n🗓 Дата: ${s.date}`);
    res.json({success: true}); 
});

app.post('/api/shifts/bulk', async (req, res) => { if (req.body.shifts?.length) await Shift.insertMany(req.body.shifts); res.json({ success: true }); });
app.post('/api/shifts/clear-day', async (req, res) => { await Shift.deleteMany({ date: req.body.date }); res.json({ success: true }); });
app.post('/api/shifts/clear-month', async (req, res) => { await Shift.deleteMany({ date: { $regex: `^${req.body.month}` } }); res.json({ success: true }); });

app.get('/api/tasks', async (req, res) => { const tasks = await Task.find(); res.json(tasks); });

app.post('/api/tasks', async (req, res) => { 
    const c = await handlePermission(req, 'add_task', req.body); 
    if(c === 'pending') return res.json({success: true, pending: true}); 
    await Task.create(req.body); 
    notifyUser(req.body.name, `📌 <b>Нова задача!</b>\n\n📝 Що: ${req.body.title}\n🗓 Коли: ${req.body.date}\n⏰ Час: ${req.body.isFullDay ? 'Весь день' : req.body.start + '-' + req.body.end}`);
    res.json({success: true}); 
});

app.post('/api/tasks/delete', async (req, res) => { 
    const t = await Task.findById(req.body.id); 
    if(!t) return res.json({success: false}); 
    const c = await handlePermission(req, 'del_task', {id: req.body.id, details: `${t.title} for ${t.name}`}); 
    if(c === 'pending') return res.json({success: true, pending: true}); 
    await Task.findByIdAndDelete(req.body.id); 
    res.json({success: true}); 
});

app.get('/api/events', async (req, res) => { const events = await Event.find(); res.json(events); });

app.post('/api/events', async (req, res) => { 
    const c = await handlePermission(req, 'add_event', req.body); 
    if(c === 'pending') return res.json({success: true, pending: true}); 
    await Event.create(req.body); 
    notifyAll(`📢 <b>Нова подія!</b>\n\n📌 ${req.body.title}\n🗓 Дата: ${req.body.date}`);
    res.json({success: true}); 
});

app.post('/api/events/delete', async (req, res) => { await Event.findByIdAndDelete(req.body.id); res.json({ success: true }); });

app.get('/api/requests', async (req, res) => { const u = await User.findById(req.session.userId); if (!u || (u.role !== 'SM' && u.role !== 'admin')) return res.json([]); const r = await Request.find().sort({ createdAt: -1 }); res.json(r); });

app.post('/api/requests/action', async (req, res) => { 
    const { id, action } = req.body; 
    const r = await Request.findById(id); 
    if (!r) return res.json({ success: false }); 
    
    if (action === 'approve') { 
        if (r.type === 'add_shift') {
            await Shift.create(r.data);
            notifyUser(r.data.name, `📅 <b>Зміна підтверджена!</b> (запит SSE)\n${r.data.date}`);
        }
        if (r.type === 'del_shift') await Shift.findByIdAndDelete(r.data.id);
        if (r.type === 'add_task') {
            await Task.create(r.data);
            notifyUser(r.data.name, `📌 <b>Задача підтверджена!</b>\n${r.data.title}`);
        }
        if (r.type === 'del_task') await Task.findByIdAndDelete(r.data.id);
        if (r.type === 'add_event') {
            await Event.create(r.data);
            notifyAll(`📢 <b>Подія підтверджена!</b>\n${r.data.title}`);
        }
    } 
    
    const statusIcon = action === 'approve' ? '✅' : '❌';
    const statusText = action === 'approve' ? 'Схвалено' : 'Відхилено';
    
    notifyUser(r.createdBy, `${statusIcon} <b>Твій запит було ${statusText}</b>\n\nТип: ${r.type}`);

    await Request.findByIdAndDelete(id); 
    res.json({ success: true }); 
});

app.post('/api/requests/approve-all', async (req, res) => { 
    const rs = await Request.find(); 
    for (const r of rs) { 
        if (r.type === 'add_shift') await Shift.create(r.data); 
        if (r.type === 'del_shift') await Shift.findByIdAndDelete(r.data.id); 
        if (r.type === 'add_task') await Task.create(r.data); 
        if (r.type === 'del_task') await Task.findByIdAndDelete(r.data.id); 
        if (r.type === 'add_event') await Event.create(r.data); 
        notifyUser(r.createdBy, `✅ Твій запит (${r.type}) було схвалено масово.`);
        await Request.findByIdAndDelete(r._id); 
    } 
    res.json({ success: true }); 
});

async function initDB() { 
    try { 
        if ((await User.countDocuments()) === 0) await User.create([{ username: "admin", password: "123", role: "admin", name: "Адмін" }]); 
        const rrp = await User.findOne({ role: 'RRP' }); if (!rrp) { await User.create({ username: "rrp", password: "rrp", role: "RRP", name: "Регіональний Менеджер" }); }
    } catch (e) { console.log(e); } 
}

// --- BOT LOGIC ---
if (bot) {
    app.post(`/bot${process.env.TELEGRAM_TOKEN}`, (req, res) => { bot.processUpdate(req.body); res.sendStatus(200); });

    const mainMenu = {
        keyboard: [ [{ text: "📅 Відкрити Графік", web_app: { url: 'https://shifter-app.onrender.com' } }], [{ text: "📋 Мої зміни" }, { text: "🌴 Вихідні" }] ],
        resize_keyboard: true
    };

    bot.onText(/\/start/, (msg) => { bot.sendMessage(msg.chat.id, "👋 Привіт! Я Shifter Bot.", { reply_markup: mainMenu }); });
    bot.onText(/\/login (.+) (.+)/, async (msg, match) => { const u = await User.findOne({ username: match[1], password: match[2] }); if (u) { u.telegramChatId = msg.chat.id; await u.save(); bot.sendMessage(msg.chat.id, `✅ Привіт, ${u.name}! Акаунт прив'язано.`, { reply_markup: mainMenu }); } else { bot.sendMessage(msg.chat.id, "❌ Помилка."); } });
    
    // Settings виправлено (приймає і /setting, і /settings)
    bot.onText(/\/settings?/, async (msg) => { 
        const u = await User.findOne({ telegramChatId: msg.chat.id }); 
        if(!u) return bot.sendMessage(msg.chat.id, "Спершу увійди: /login логін пароль");
        bot.sendMessage(msg.chat.id, `⚙️ Налаштування сповіщень`, {
            reply_markup: {
                inline_keyboard: [
                    [{text:'🌙 Вечір (20:00)',callback_data:'set_remind_20'}],
                    [{text:'☀️ Ранок (08:00)',callback_data:'set_remind_08'}],
                    [{text:'🔕 Вимкнути',callback_data:'set_remind_none'}]
                ]
            }
        }); 
    });

    bot.on('message', async (msg) => {
        if (!msg.text) return;
        if (msg.text === '📋 Мої зміни') {
            const u = await User.findOne({ telegramChatId: msg.chat.id }); if (!u) return bot.sendMessage(msg.chat.id, "🔴 Авторизуйся: /login");
            const t = new Date().toISOString().split('T')[0];
            const s = await Shift.find({ name: u.name, date: { $gte: t } }).sort({ date: 1 }).limit(5);
            const tk = await Task.find({ name: u.name, date: { $gte: t } }).sort({ date: 1 });
            let r = "📋 <b>Твої найближчі події:</b>\n"; 
            s.forEach(x => r+=`🔹 ${x.date.slice(5)}: ${x.start}-${x.end}\n`); 
            tk.forEach(x => r+=`🔸 ${x.date.slice(5)}: ${x.title}\n`);
            bot.sendMessage(msg.chat.id, s.length || tk.length ? r : "Пусто", { parse_mode: 'HTML' });
        }
        if (msg.text === '🌴 Вихідні') {
            const u = await User.findOne({ telegramChatId: msg.chat.id }); if (!u) return;
            const d = new Date(); const m = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
            const s = await Shift.find({ name: u.name, date: { $regex: `^${m}` } });
            const dim = new Date(d.getFullYear(), d.getMonth()+1, 0).getDate();
            const wd = s.map(x => parseInt(x.date.split('-')[2]));
            let off = []; for(let i=d.getDate(); i<=dim; i++) if(!wd.includes(i)) off.push(i);
            bot.sendMessage(msg.chat.id, `🌴 Вихідні: ${off.join(', ')}`);
        }
    });

    bot.on('callback_query', async (q) => { 
        const u = await User.findOne({ telegramChatId: q.message.chat.id });
        if(!u) return; 
        if(q.data.startsWith('set_remind_')){
            u.reminderTime = q.data.replace('set_remind_','').replace('none','none'); 
            if(u.reminderTime==='20') u.reminderTime='20:00'; 
            if(u.reminderTime==='08') u.reminderTime='08:00'; 
            await u.save(); 
            bot.sendMessage(q.message.chat.id, `✅ Нагадування: ${u.reminderTime === 'none' ? 'Вимкнено' : u.reminderTime}`); 
            bot.answerCallbackQuery(q.id);
        } 
    });

    cron.schedule('0 18 * * *', async () => { 
        const t = new Date(); t.setDate(t.getDate() + 1); const d = t.toISOString().split('T')[0];
        const s = await Shift.find({ date: d }); const tasks = await Task.find({ date: d });
        for(const x of s){ const u=await User.findOne({name:x.name}); if(u?.telegramChatId && u.reminderTime==='20:00') bot.sendMessage(u.telegramChatId, `🌙 Завтра: ${x.start}-${x.end}`); }
        for(const x of tasks){ const u=await User.findOne({name:x.name}); if(u?.telegramChatId && u.reminderTime==='20:00') bot.sendMessage(u.telegramChatId, `📌 Завтра задача: ${x.title}`); }
    });
    cron.schedule('0 6 * * *', async () => { 
        const d = new Date().toISOString().split('T')[0];
        const s = await Shift.find({ date: d }); const tasks = await Task.find({ date: d });
        for(const x of s){ const u=await User.findOne({name:x.name}); if(u?.telegramChatId && u.reminderTime==='08:00') bot.sendMessage(u.telegramChatId, `☀️ Сьогодні: ${x.start}-${x.end}`); }
        for(const x of tasks){ const u=await User.findOne({name:x.name}); if(u?.telegramChatId && u.reminderTime==='08:00') bot.sendMessage(u.telegramChatId, `📌 Сьогодні задача: ${x.title}`); }
    });
}

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));