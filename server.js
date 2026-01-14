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
    // НОВЕ ПОЛЕ: Час нагадування ('20:00' - вечір напередодні, '08:00' - ранок у день зміни, 'none' - вимкнено)
    reminderTime: { type: String, default: '20:00' }
});
const User = mongoose.model('User', UserSchema);

const ShiftSchema = new mongoose.Schema({ date: String, name: String, start: String, end: String });
const Shift = mongoose.model('Shift', ShiftSchema);

const EventSchema = new mongoose.Schema({ date: String, title: String, repeat: { type: String, default: 'none' } });
const Event = mongoose.model('Event', EventSchema);

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
app.get('/api/shifts', async (req, res) => { if (!req.session.userId) return res.status(403).json({ error: "Unauthorized" }); const shifts = await Shift.find(); res.json(shifts); });
app.post('/api/shifts', async (req, res) => { await Shift.create(req.body); res.json({ success: true }); });
app.post('/api/delete-shift', async (req, res) => { await Shift.findByIdAndDelete(req.body.id); res.json({ success: true }); });
app.post('/api/shifts/bulk', async (req, res) => { if (req.body.shifts?.length) await Shift.insertMany(req.body.shifts); res.json({ success: true }); });
app.post('/api/shifts/clear-day', async (req, res) => { await Shift.deleteMany({ date: req.body.date }); res.json({ success: true }); });
app.post('/api/shifts/clear-month', async (req, res) => { await Shift.deleteMany({ date: { $regex: `^${req.body.month}` } }); res.json({ success: true }); });
app.get('/api/events', async (req, res) => { const events = await Event.find(); res.json(events); });
app.post('/api/events', async (req, res) => { await Event.create(req.body); res.json({ success: true }); });
app.post('/api/events/delete', async (req, res) => { await Event.findByIdAndDelete(req.body.id); res.json({ success: true }); });

async function initDB() {
    try { if ((await User.countDocuments()) === 0) await User.create([{ username: "admin", password: "123", role: "admin", name: "Адмін" }]); } catch (e) { console.log(e); }
}

// ============================================================
// --- TELEGRAM BOT PRO ---
// ============================================================
if (process.env.TELEGRAM_TOKEN) {
    const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
    console.log("🤖 Telegram Bot Started!");

    // Меню команд
    bot.setMyCommands([
        { command: '/me', description: '📅 Найближчі зміни' },
        { command: '/month', description: '📆 Графік на цей місяць' },
        { command: '/off', description: '🌴 Мої вихідні' },
        { command: '/settings', description: '⚙️ Налаштування нагадувань' },
        { command: '/login', description: '🔐 Вхід' }
    ]);

    // 1. START
    bot.onText(/\/start/, (msg) => {
        bot.sendMessage(msg.chat.id, "Привіт! Щоб почати, увійди в систему:\n`/login логін пароль`", { parse_mode: 'Markdown' });
    });

    // 2. LOGIN
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

    // 3. ME (Найближчі 5 змін)
    bot.onText(/\/me/, async (msg) => {
        const user = await User.findOne({ telegramChatId: msg.chat.id });
        if (!user) return bot.sendMessage(msg.chat.id, "Спершу увійди через /login");
        const today = new Date().toISOString().split('T')[0];
        const shifts = await Shift.find({ name: user.name, date: { $gte: today } }).sort({ date: 1 }).limit(5);
        if (shifts.length === 0) return bot.sendMessage(msg.chat.id, "Графік пустий 🤷‍♂️");
        let res = "📋 **Найближчі зміни:**\n";
        shifts.forEach(s => res += `🔹 ${s.date}: ${s.start}-${s.end}\n`);
        bot.sendMessage(msg.chat.id, res);
    });

    // 4. MONTH (Весь місяць)
    bot.onText(/\/month/, async (msg) => {
        const user = await User.findOne({ telegramChatId: msg.chat.id });
        if (!user) return bot.sendMessage(msg.chat.id, "Спершу увійди через /login");
        
        const now = new Date();
        const monthStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
        const shifts = await Shift.find({ name: user.name, date: { $regex: `^${monthStr}` } }).sort({ date: 1 });
        
        if (shifts.length === 0) return bot.sendMessage(msg.chat.id, "У цьому місяці змін немає.");
        
        let res = `📆 **Графік на ${monthStr}:**\n`;
        shifts.forEach(s => res += `${s.date.slice(8)}го: ${s.start}-${s.end}\n`); // Показуємо тільки день (slice)
        bot.sendMessage(msg.chat.id, res);
    });

    // 5. OFF (Вихідні у цьому місяці)
    bot.onText(/\/off/, async (msg) => {
        const user = await User.findOne({ telegramChatId: msg.chat.id });
        if (!user) return bot.sendMessage(msg.chat.id, "Спершу увійди через /login");

        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const todayDay = now.getDate();

        // Беремо всі зміни за місяць
        const monthStr = `${year}-${String(month+1).padStart(2,'0')}`;
        const shifts = await Shift.find({ name: user.name, date: { $regex: `^${monthStr}` } });
        const workDays = shifts.map(s => parseInt(s.date.split('-')[2])); // Отримуємо числа (1, 5, 12...)

        let offDays = [];
        for(let d = todayDay; d <= daysInMonth; d++) {
            if (!workDays.includes(d)) offDays.push(d);
        }

        if (offDays.length === 0) return bot.sendMessage(msg.chat.id, "Ого, ти працюєш без вихідних до кінця місяця! 😱");
        bot.sendMessage(msg.chat.id, `🌴 **Твої вихідні (залишок місяця):**\n${offDays.join(', ')} числа.`);
    });

    // 6. SETTINGS (Налаштування нагадувань)
    bot.onText(/\/settings/, async (msg) => {
        const user = await User.findOne({ telegramChatId: msg.chat.id });
        if (!user) return bot.sendMessage(msg.chat.id, "Спершу увійди через /login");

        const current = user.reminderTime === '20:00' ? 'Вечір (20:00)' : 
                        user.reminderTime === '08:00' ? 'Ранок (08:00)' : 'Вимкнено';

        bot.sendMessage(msg.chat.id, `⚙️ **Налаштування нагадувань**\nЗараз встановлено: ${current}\n\nКоли нагадувати про зміну?`, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🌙 Увечері напередодні (20:00)', callback_data: 'set_remind_20' }],
                    [{ text: '☀️ Вранці в день зміни (08:00)', callback_data: 'set_remind_08' }],
                    [{ text: '🔕 Не нагадувати', callback_data: 'set_remind_none' }]
                ]
            }
        });
    });

    // ОБРОБКА КНОПОК
    bot.on('callback_query', async (query) => {
        const chatId = query.message.chat.id;
        const user = await User.findOne({ telegramChatId: chatId });
        if (!user) return;

        let text = "";
        if (query.data === 'set_remind_20') {
            user.reminderTime = '20:00';
            text = "✅ Нагадування приходитимуть о 20:00 (за день до зміни).";
        } else if (query.data === 'set_remind_08') {
            user.reminderTime = '08:00';
            text = "✅ Нагадування приходитимуть о 08:00 (у день зміни).";
        } else if (query.data === 'set_remind_none') {
            user.reminderTime = 'none';
            text = "🔕 Нагадування вимкнено.";
        }

        await user.save();
        bot.sendMessage(chatId, text);
        bot.answerCallbackQuery(query.id); // Прибираємо часіки завантаження на кнопці
    });

    // --- CRON JOBS (БУДИЛЬНИКИ) ---
    
    // 1. Вечірнє нагадування (18:00 UTC = 20:00 Київ) -> Про ЗАВТРА
    cron.schedule('0 18 * * *', async () => {
        const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
        const dateStr = tomorrow.toISOString().split('T')[0];
        const shifts = await Shift.find({ date: dateStr });

        for (const shift of shifts) {
            const user = await User.findOne({ name: shift.name });
            // Перевіряємо, чи юзер хоче нагадування саме ВВЕЧЕРІ ('20:00')
            if (user && user.telegramChatId && user.reminderTime === '20:00') {
                bot.sendMessage(user.telegramChatId, `🌙 **Нагадування!**\nЗавтра (${shift.date}) зміна:\n⏰ ${shift.start} - ${shift.end}`);
            }
        }
    });

    // 2. Ранкове нагадування (06:00 UTC = 08:00 Київ) -> Про СЬОГОДНІ
    cron.schedule('0 6 * * *', async () => {
        const today = new Date().toISOString().split('T')[0];
        const shifts = await Shift.find({ date: today });

        for (const shift of shifts) {
            const user = await User.findOne({ name: shift.name });
            // Перевіряємо, чи юзер хоче нагадування ВРАНЦІ ('08:00')
            if (user && user.telegramChatId && user.reminderTime === '08:00') {
                bot.sendMessage(user.telegramChatId, `☀️ **Доброго ранку!**\nСьогодні у тебе зміна:\n⏰ ${shift.start} - ${shift.end}`);
            }
        }
    });

    bot.on("polling_error", (err) => console.log("Telegram Error:", err.message));
}

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));