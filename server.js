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

// НОВА МОДЕЛЬ: ЗАДАЧІ
const TaskSchema = new mongoose.Schema({
    date: String,
    name: String,     // Кому призначено
    title: String,    // Що робити (напр. Тренінг)
    isFullDay: Boolean, 
    start: String,    // Якщо не весь день
    end: String       // Якщо не весь день
});
const Task = mongoose.model('Task', TaskSchema);

// --- MIDDLEWARE ---
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: 'supersecretkey',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URI }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

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

// Shifts
app.get('/api/shifts', async (req, res) => { if (!req.session.userId) return res.status(403).json({ error: "Unauthorized" }); const shifts = await Shift.find(); res.json(shifts); });
app.post('/api/shifts', async (req, res) => { await Shift.create(req.body); res.json({ success: true }); });
app.post('/api/delete-shift', async (req, res) => { await Shift.findByIdAndDelete(req.body.id); res.json({ success: true }); });
app.post('/api/shifts/bulk', async (req, res) => { if (req.body.shifts?.length) await Shift.insertMany(req.body.shifts); res.json({ success: true }); });
app.post('/api/shifts/clear-day', async (req, res) => { await Shift.deleteMany({ date: req.body.date }); res.json({ success: true }); });
app.post('/api/shifts/clear-month', async (req, res) => { await Shift.deleteMany({ date: { $regex: `^${req.body.month}` } }); res.json({ success: true }); });

// Events
app.get('/api/events', async (req, res) => { const events = await Event.find(); res.json(events); });
app.post('/api/events', async (req, res) => { await Event.create(req.body); res.json({ success: true }); });
app.post('/api/events/delete', async (req, res) => { await Event.findByIdAndDelete(req.body.id); res.json({ success: true }); });

// TASKS (НОВІ API)
app.get('/api/tasks', async (req, res) => { const tasks = await Task.find(); res.json(tasks); });
app.post('/api/tasks', async (req, res) => { await Task.create(req.body); res.json({ success: true }); });
app.post('/api/tasks/delete', async (req, res) => { await Task.findByIdAndDelete(req.body.id); res.json({ success: true }); });


async function initDB() {
    try { if ((await User.countDocuments()) === 0) await User.create([{ username: "admin", password: "123", role: "admin", name: "Адмін" }]); } catch (e) { console.log(e); }
}

// ============================================================
// --- TELEGRAM BOT ---
// ============================================================
if (process.env.TELEGRAM_TOKEN) {
    const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
    console.log("🤖 Telegram Bot Started!");

    bot.setMyCommands([
        { command: '/me', description: '📅 Найближчі зміни' },
        { command: '/month', description: '📆 Графік на цей місяць' },
        { command: '/off', description: '🌴 Мої вихідні' },
        { command: '/settings', description: '⚙️ Налаштування нагадувань' },
        { command: '/login', description: '🔐 Вхід' }
    ]);

    bot.onText(/\/start/, (msg) => { bot.sendMessage(msg.chat.id, "Привіт! Щоб почати, увійди в систему:\n`/login логін пароль`", { parse_mode: 'Markdown' }); });

    bot.onText(/\/login (.+) (.+)/, async (msg, match) => {
        const chatId = msg.chat.id;
        const user = await User.findOne({ username: match[1], password: match[2] });
        if (user) {
            user.telegramChatId = chatId;
            await user.save();
            bot.sendMessage(chatId, `✅ Привіт, ${user.name}! Акаунт підключено.`);
        } else {
            bot.sendMessage(chatId, "❌ Помилка входу.");
        }
    });

    bot.onText(/\/me/, async (msg) => {
        const user = await User.findOne({ telegramChatId: msg.chat.id });
        if (!user) return bot.sendMessage(msg.chat.id, "Спершу увійди через /login");
        const today = new Date().toISOString().split('T')[0];
        const shifts = await Shift.find({ name: user.name, date: { $gte: today } }).sort({ date: 1 }).limit(5);
        // Також шукаємо задачі
        const tasks = await Task.find({ name: user.name, date: { $gte: today } });

        if (shifts.length === 0 && tasks.length === 0) return bot.sendMessage(msg.chat.id, "Графік пустий 🤷‍♂️");
        
        let res = "📋 **Найближчі події:**\n";
        // Об'єднуємо і сортуємо (спрощено показуємо зміни, можна додати задачі окремо)
        shifts.forEach(s => res += `🔹 ${s.date}: Зміна ${s.start}-${s.end}\n`);
        
        if(tasks.length > 0) {
            res += "\n📌 **Твої задачі:**\n";
            tasks.forEach(t => {
                const time = t.isFullDay ? "Весь день" : `${t.start}-${t.end}`;
                res += `🔸 ${t.date}: ${t.title} (${time})\n`;
            });
        }
        bot.sendMessage(msg.chat.id, res);
    });

    bot.onText(/\/month/, async (msg) => {
        const user = await User.findOne({ telegramChatId: msg.chat.id });
        if (!user) return bot.sendMessage(msg.chat.id, "Спершу увійди через /login");
        const now = new Date();
        const monthStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
        const shifts = await Shift.find({ name: user.name, date: { $regex: `^${monthStr}` } }).sort({ date: 1 });
        if (shifts.length === 0) return bot.sendMessage(msg.chat.id, "У цьому місяці змін немає.");
        let res = `📆 **Графік на ${monthStr}:**\n`;
        shifts.forEach(s => res += `${s.date.slice(8)}го: ${s.start}-${s.end}\n`);
        bot.sendMessage(msg.chat.id, res);
    });

    bot.onText(/\/off/, async (msg) => {
        const user = await User.findOne({ telegramChatId: msg.chat.id });
        if (!user) return bot.sendMessage(msg.chat.id, "Спершу увійди через /login");
        const now = new Date();
        const year = now.getFullYear(); const month = now.getMonth();
        const daysInMonth = new Date(year, month + 1, 0).getDate(); const todayDay = now.getDate();
        const monthStr = `${year}-${String(month+1).padStart(2,'0')}`;
        const shifts = await Shift.find({ name: user.name, date: { $regex: `^${monthStr}` } });
        const workDays = shifts.map(s => parseInt(s.date.split('-')[2]));
        let offDays = [];
        for(let d = todayDay; d <= daysInMonth; d++) { if (!workDays.includes(d)) offDays.push(d); }
        if (offDays.length === 0) return bot.sendMessage(msg.chat.id, "Ого, ти працюєш без вихідних до кінця місяця! 😱");
        bot.sendMessage(msg.chat.id, `🌴 **Твої вихідні:**\n${offDays.join(', ')} числа.`);
    });

    bot.onText(/\/settings/, async (msg) => {
        const user = await User.findOne({ telegramChatId: msg.chat.id });
        if (!user) return bot.sendMessage(msg.chat.id, "Спершу увійди через /login");
        const current = user.reminderTime === '20:00' ? 'Вечір (20:00)' : user.reminderTime === '08:00' ? 'Ранок (08:00)' : 'Вимкнено';
        bot.sendMessage(msg.chat.id, `⚙️ **Налаштування**\nЗараз: ${current}`, {
            reply_markup: { inline_keyboard: [[{ text: '🌙 Вечір (20:00)', callback_data: 'set_remind_20' }], [{ text: '☀️ Ранок (08:00)', callback_data: 'set_remind_08' }], [{ text: '🔕 Вимкнути', callback_data: 'set_remind_none' }]] }
        });
    });

    bot.on('callback_query', async (query) => {
        const chatId = query.message.chat.id;
        const user = await User.findOne({ telegramChatId: chatId });
        if (!user) return;
        if (query.data === 'set_remind_20') user.reminderTime = '20:00';
        else if (query.data === 'set_remind_08') user.reminderTime = '08:00';
        else if (query.data === 'set_remind_none') user.reminderTime = 'none';
        await user.save();
        bot.sendMessage(chatId, "✅ Налаштування збережено.");
        bot.answerCallbackQuery(query.id);
    });

    // Нагадування (перевіряємо і зміни, і задачі)
    cron.schedule('0 18 * * *', async () => {
        const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
        const dateStr = tomorrow.toISOString().split('T')[0];
        const shifts = await Shift.find({ date: dateStr });
        const tasks = await Task.find({ date: dateStr });

        // Спочатку зміни
        for (const shift of shifts) {
            const user = await User.findOne({ name: shift.name });
            if (user && user.telegramChatId && user.reminderTime === '20:00') {
                bot.sendMessage(user.telegramChatId, `🌙 **Нагадування!**\nЗавтра (${shift.date}) зміна:\n⏰ ${shift.start} - ${shift.end}`);
            }
        }
        // Потім задачі
        for (const task of tasks) {
            const user = await User.findOne({ name: task.name });
            if (user && user.telegramChatId && user.reminderTime === '20:00') {
                const timeInfo = task.isFullDay ? "Весь день" : `${task.start}-${task.end}`;
                bot.sendMessage(user.telegramChatId, `📌 **Задача на завтра:**\n${task.title} (${timeInfo})`);
            }
        }
    });

    cron.schedule('0 6 * * *', async () => {
        const today = new Date().toISOString().split('T')[0];
        const shifts = await Shift.find({ date: today });
        const tasks = await Task.find({ date: today });

        for (const shift of shifts) {
            const user = await User.findOne({ name: shift.name });
            if (user && user.telegramChatId && user.reminderTime === '08:00') {
                bot.sendMessage(user.telegramChatId, `☀️ **Сьогодні зміна:**\n⏰ ${shift.start} - ${shift.end}`);
            }
        }
        for (const task of tasks) {
            const user = await User.findOne({ name: task.name });
            if (user && user.telegramChatId && user.reminderTime === '08:00') {
                const timeInfo = task.isFullDay ? "Весь день" : `${task.start}-${task.end}`;
                bot.sendMessage(user.telegramChatId, `📌 **Задача на сьогодні:**\n${task.title} (${timeInfo})`);
            }
        }
    });
    
    bot.on("polling_error", (err) => console.log("Telegram Error:", err.message));
}

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));