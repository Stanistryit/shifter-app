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

// --- ПІДКЛЮЧЕННЯ ДО БД ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => {
        console.log("✅ Connected to MongoDB");
        initDB();
    })
    .catch(err => console.error("❌ MongoDB connection error:", err));

// --- МОДЕЛІ ---
const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, default: 'user' }, 
    name: { type: String, required: true },
    telegramChatId: { type: Number, default: null } // Нове поле для ID телеграма
});
const User = mongoose.model('User', UserSchema);

const ShiftSchema = new mongoose.Schema({
    date: String, // YYYY-MM-DD
    name: String,
    start: String,
    end: String
});
const Shift = mongoose.model('Shift', ShiftSchema);

const EventSchema = new mongoose.Schema({
    date: String,
    title: String,
    repeat: { type: String, default: 'none' }
});
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

// --- API ---
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await User.findOne({ username, password });
    if (user) {
        req.session.userId = user._id;
        res.json({ success: true, user: { name: user.name, role: user.role } });
    } else {
        res.json({ success: false, message: "Невірний логін або пароль" });
    }
});

app.post('/api/logout', (req, res) => { req.session.destroy(); res.json({ success: true }); });

app.get('/api/me', async (req, res) => {
    if (!req.session.userId) return res.json({ loggedIn: false });
    const user = await User.findById(req.session.userId);
    if (!user) return res.json({ loggedIn: false });
    res.json({ loggedIn: true, user: { name: user.name, role: user.role } });
});

app.get('/api/users', async (req, res) => { const users = await User.find({}, 'name role'); res.json(users); });

app.get('/api/shifts', async (req, res) => {
    if (!req.session.userId) return res.status(403).json({ error: "Unauthorized" });
    const shifts = await Shift.find();
    res.json(shifts);
});
app.post('/api/shifts', async (req, res) => { await Shift.create(req.body); res.json({ success: true }); });
app.post('/api/delete-shift', async (req, res) => { await Shift.findByIdAndDelete(req.body.id); res.json({ success: true }); });
app.post('/api/shifts/bulk', async (req, res) => { if (req.body.shifts?.length) await Shift.insertMany(req.body.shifts); res.json({ success: true }); });
app.post('/api/shifts/clear-day', async (req, res) => { await Shift.deleteMany({ date: req.body.date }); res.json({ success: true }); });
app.post('/api/shifts/clear-month', async (req, res) => { await Shift.deleteMany({ date: { $regex: `^${req.body.month}` } }); res.json({ success: true }); });

app.get('/api/events', async (req, res) => { const events = await Event.find(); res.json(events); });
app.post('/api/events', async (req, res) => { await Event.create(req.body); res.json({ success: true }); });
app.post('/api/events/delete', async (req, res) => { await Event.findByIdAndDelete(req.body.id); res.json({ success: true }); });

// --- INIT DB ---
async function initDB() {
    try {
        const count = await User.countDocuments();
        if (count === 0) {
            await User.create([{ username: "admin", password: "123", role: "admin", name: "Адмін" }]);
        }
    } catch (e) { console.log("Init DB error", e); }
}

// ============================================================
// --- TELEGRAM BOT LOGIC ---
// ============================================================
if (process.env.TELEGRAM_TOKEN) {
    const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
    console.log("🤖 Telegram Bot Started!");

    // 1. Команда /start
    bot.onText(/\/start/, (msg) => {
        bot.sendMessage(msg.chat.id, "Привіт! Я бот Shifter.\nЩоб підключити свій акаунт, напиши:\n`/login логін пароль`\nНаприклад: `/login alex 123`", { parse_mode: 'Markdown' });
    });

    // 2. Команда /login user pass
    bot.onText(/\/login (.+) (.+)/, async (msg, match) => {
        const chatId = msg.chat.id;
        const username = match[1];
        const password = match[2];

        const user = await User.findOne({ username, password });
        if (user) {
            user.telegramChatId = chatId;
            await user.save();
            bot.sendMessage(chatId, `✅ Успішно! Привіт, ${user.name}. Тепер я буду надсилати тобі нагадування.`);
        } else {
            bot.sendMessage(chatId, "❌ Невірний логін або пароль. Спробуй ще раз.");
        }
    });

    // 3. Команда /me (Моя наступна зміна)
    bot.onText(/\/me/, async (msg) => {
        const user = await User.findOne({ telegramChatId: msg.chat.id });
        if (!user) return bot.sendMessage(msg.chat.id, "Спочатку увійди через /login");

        const today = new Date().toISOString().split('T')[0];
        // Шукаємо зміни починаючи з сьогодні, сортуємо за датою
        const shifts = await Shift.find({ name: user.name, date: { $gte: today } }).sort({ date: 1 }).limit(5);

        if (shifts.length === 0) {
            bot.sendMessage(msg.chat.id, "У тебе поки немає змін у графіку 🌴");
        } else {
            let response = "📋 **Твої найближчі зміни:**\n";
            shifts.forEach(s => {
                response += `📅 ${s.date}: ${s.start} - ${s.end}\n`;
            });
            bot.sendMessage(msg.chat.id, response);
        }
    });

    // 4. ЩОДЕННИЙ НАГАДУВАЧ (CRON)
    // Запускається щодня о 20:00 за часом сервера (UTC). 
    // Увага: Render працює в UTC (це -2 або -3 години від Києва).
    // '0 18 * * *' означає 18:00 UTC = 20:00 або 21:00 Київ.
    cron.schedule('0 18 * * *', async () => {
        console.log("⏰ Checking shifts for tomorrow...");
        
        // Визначаємо дату "Завтра"
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = tomorrow.toISOString().split('T')[0];

        const shifts = await Shift.find({ date: tomorrowStr });

        for (const shift of shifts) {
            const user = await User.findOne({ name: shift.name });
            if (user && user.telegramChatId) {
                bot.sendMessage(user.telegramChatId, `🔔 **Нагадування!**\nЗавтра (${shift.date}) у тебе зміна:\n⏰ ${shift.start} - ${shift.end}`);
            }
        }
    });
    
    // Обробка помилок бота (щоб не падав сервер)
    bot.on("polling_error", (err) => console.log(err));
}

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));