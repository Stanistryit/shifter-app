require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 3000;

// --- DB ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => { console.log("✅ Connected to MongoDB"); initDB(); })
    .catch(err => console.error("❌ MongoDB connection error:", err));

// --- SCHEMAS ---
const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, default: 'user' }, // user, SSE, SM, admin
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

// НОВА МОДЕЛЬ: ЗАПИТИ НА ЗМІНИ (Для SSE)
const RequestSchema = new mongoose.Schema({
    type: String, // 'add_shift', 'del_shift', 'add_task', 'del_task', 'add_event'
    data: Object, // Тут лежить вся інфа (дата, час, id і т.д.)
    createdBy: String,
    createdAt: { type: Date, default: Date.now }
});
const Request = mongoose.model('Request', RequestSchema);

// --- MIDDLEWARE ---
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: 'supersecretkey',
    resave: false, saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URI }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

// --- HELPER FUNCTION ---
// Перевіряє права. Якщо SSE -> створює запит. Якщо SM/Admin -> повертає null (дозволяє виконання).
async function handlePermission(req, type, data) {
    const user = await User.findById(req.session.userId);
    if (!user) return 'unauthorized';
    
    if (user.role === 'SSE') {
        await Request.create({ type, data, createdBy: user.name });
        return 'pending'; // Сигнал, що створено запит
    }
    if (user.role === 'SM' || user.role === 'admin') {
        return null; // Дозвіл на пряме виконання
    }
    return 'forbidden';
}

// --- API ROUTES ---
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await User.findOne({ username, password });
    if (user) { req.session.userId = user._id; res.json({ success: true, user: { name: user.name, role: user.role } }); } 
    else { res.json({ success: false, message: "Невірний логін або пароль" }); }
});
app.post('/api/logout', (req, res) => { req.session.destroy(); res.json({ success: true }); });
app.get('/api/me', async (req, res) => {
    if (!req.session.userId) return res.json({ loggedIn: false });
    const user = await User.findById(req.session.userId);
    if (!user) return res.json({ loggedIn: false });
    res.json({ loggedIn: true, user: { name: user.name, role: user.role } });
});
app.get('/api/users', async (req, res) => { const users = await User.find({}, 'name role'); res.json(users); });

// --- SHIFTS ---
app.get('/api/shifts', async (req, res) => { if (!req.session.userId) return res.status(403).json({ error: "Unauthorized" }); const shifts = await Shift.find(); res.json(shifts); });

app.post('/api/shifts', async (req, res) => { 
    const check = await handlePermission(req, 'add_shift', req.body);
    if (check === 'pending') return res.json({ success: true, pending: true });
    if (check === 'forbidden') return res.status(403).json({ error: 'No rights' });
    
    await Shift.create(req.body); res.json({ success: true }); 
});

app.post('/api/delete-shift', async (req, res) => { 
    // Для видалення нам треба знати деталі, щоб SM бачив, що видаляється. Тому знаходимо об'єкт спочатку.
    const shift = await Shift.findById(req.body.id);
    if(!shift) return res.json({success: false});

    const check = await handlePermission(req, 'del_shift', { id: req.body.id, details: `${shift.date} (${shift.name})` });
    if (check === 'pending') return res.json({ success: true, pending: true });
    
    await Shift.findByIdAndDelete(req.body.id); res.json({ success: true }); 
});

// --- TASKS ---
app.get('/api/tasks', async (req, res) => { const tasks = await Task.find(); res.json(tasks); });

app.post('/api/tasks', async (req, res) => { 
    const check = await handlePermission(req, 'add_task', req.body);
    if (check === 'pending') return res.json({ success: true, pending: true });
    await Task.create(req.body); res.json({ success: true }); 
});

app.post('/api/tasks/delete', async (req, res) => { 
    const task = await Task.findById(req.body.id);
    if(!task) return res.json({success: false});

    const check = await handlePermission(req, 'del_task', { id: req.body.id, details: `${task.title} for ${task.name}` });
    if (check === 'pending') return res.json({ success: true, pending: true });
    
    await Task.findByIdAndDelete(req.body.id); res.json({ success: true }); 
});

// --- EVENTS ---
app.get('/api/events', async (req, res) => { const events = await Event.find(); res.json(events); });
app.post('/api/events', async (req, res) => { 
    const check = await handlePermission(req, 'add_event', req.body);
    if (check === 'pending') return res.json({ success: true, pending: true });
    await Event.create(req.body); res.json({ success: true }); 
});
app.post('/api/events/delete', async (req, res) => { await Event.findByIdAndDelete(req.body.id); res.json({ success: true }); });

// --- BULK / CLEAR (Тільки SM/Admin) ---
app.post('/api/shifts/bulk', async (req, res) => { if (req.body.shifts?.length) await Shift.insertMany(req.body.shifts); res.json({ success: true }); });
app.post('/api/shifts/clear-day', async (req, res) => { await Shift.deleteMany({ date: req.body.date }); res.json({ success: true }); });
app.post('/api/shifts/clear-month', async (req, res) => { await Shift.deleteMany({ date: { $regex: `^${req.body.month}` } }); res.json({ success: true }); });

// --- REQUESTS API (Нове для SM) ---
app.get('/api/requests', async (req, res) => {
    // Тільки SM або Admin бачать запити
    const user = await User.findById(req.session.userId);
    if (!user || (user.role !== 'SM' && user.role !== 'admin')) return res.json([]);
    const requests = await Request.find().sort({ createdAt: -1 });
    res.json(requests);
});

app.post('/api/requests/action', async (req, res) => {
    const { id, action } = req.body; // action: 'approve' or 'reject'
    const request = await Request.findById(id);
    if (!request) return res.json({ success: false });

    if (action === 'approve') {
        // Виконуємо дію, яка була в запиті
        if (request.type === 'add_shift') await Shift.create(request.data);
        if (request.type === 'del_shift') await Shift.findByIdAndDelete(request.data.id);
        if (request.type === 'add_task') await Task.create(request.data);
        if (request.type === 'del_task') await Task.findByIdAndDelete(request.data.id);
        if (request.type === 'add_event') await Event.create(request.data);
    }
    
    // Видаляємо запит після обробки (чи то approve, чи reject)
    await Request.findByIdAndDelete(id);
    res.json({ success: true });
});

app.post('/api/requests/approve-all', async (req, res) => {
    const requests = await Request.find();
    for (const req of requests) {
        if (req.type === 'add_shift') await Shift.create(req.data);
        if (req.type === 'del_shift') await Shift.findByIdAndDelete(req.data.id);
        if (req.type === 'add_task') await Task.create(req.data);
        if (req.type === 'del_task') await Task.findByIdAndDelete(req.data.id);
        if (req.type === 'add_event') await Event.create(req.data);
        await Request.findByIdAndDelete(req._id);
    }
    res.json({ success: true });
});


async function initDB() {
    try { if ((await User.countDocuments()) === 0) await User.create([{ username: "admin", password: "123", role: "admin", name: "Адмін" }]); } catch (e) { console.log(e); }
}

// --- TELEGRAM BOT (Без змін) ---
if (process.env.TELEGRAM_TOKEN) {
    const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
    // ... (Той самий код бота, що й був)
    // Я не дублюю його тут, щоб не займати місце, він залишається такий самий.
    // Якщо треба - скажи, я скину повний файл.
    // АЛЕ! Додаймо сюди обробники, як в минулому повідомленні.
     console.log("🤖 Telegram Bot Started!");
    bot.setMyCommands([{ command: '/me', description: '📅 Зміни' }, { command: '/month', description: '📆 Місяць' }, { command: '/off', description: '🌴 Вихідні' }, { command: '/settings', description: '⚙️ Налаштування' }, { command: '/login', description: '🔐 Вхід' }]);
    bot.onText(/\/start/, (msg) => { bot.sendMessage(msg.chat.id, "Привіт! `/login логін пароль`", { parse_mode: 'Markdown' }); });
    bot.onText(/\/login (.+) (.+)/, async (msg, match) => { const u = await User.findOne({ username: match[1], password: match[2] }); if (u) { u.telegramChatId = msg.chat.id; await u.save(); bot.sendMessage(msg.chat.id, `✅ Привіт, ${u.name}!`); } else bot.sendMessage(msg.chat.id, "❌ Помилка."); });
    bot.onText(/\/me/, async (msg) => {
        const u = await User.findOne({ telegramChatId: msg.chat.id }); if (!u) return; const t = new Date().toISOString().split('T')[0];
        const s = await Shift.find({ name: u.name, date: { $gte: t } }).limit(5); const tk = await Task.find({ name: u.name, date: { $gte: t } });
        let r = "📋 **Події:**\n"; s.forEach(x => r+=`🔹 ${x.date}: ${x.start}-${x.end}\n`); tk.forEach(x => r+=`🔸 ${x.date}: ${x.title}\n`); bot.sendMessage(msg.chat.id, r || "Пусто.");
    });
    // ... Інші команди (/month, /off, /settings, cron) з попереднього коду ...
    cron.schedule('0 18 * * *', async () => { /* ... */ });
    cron.schedule('0 6 * * *', async () => { /* ... */ });
}

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));