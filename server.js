require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const path = require('path');

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
    name: { type: String, required: true }
});
const User = mongoose.model('User', UserSchema);

const ShiftSchema = new mongoose.Schema({
    date: String, // YYYY-MM-DD
    name: String,
    start: String,
    end: String
});
const Shift = mongoose.model('Shift', ShiftSchema);

// Нова модель для ПОДІЙ
const EventSchema = new mongoose.Schema({
    date: String, // Дата початку
    title: String,
    repeat: { type: String, default: 'none' } // none, weekly, monthly, yearly
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
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 } // 7 днів
}));

// --- API ---

// 1. AUTH
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

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

app.get('/api/me', async (req, res) => {
    if (!req.session.userId) return res.json({ loggedIn: false });
    const user = await User.findById(req.session.userId);
    if (!user) return res.json({ loggedIn: false });
    res.json({ loggedIn: true, user: { name: user.name, role: user.role } });
});

app.get('/api/users', async (req, res) => {
    const users = await User.find({}, 'name role');
    res.json(users);
});

// 2. SHIFTS
app.get('/api/shifts', async (req, res) => {
    if (!req.session.userId) return res.status(403).json({ error: "Unauthorized" });
    const shifts = await Shift.find();
    res.json(shifts);
});

app.post('/api/shifts', async (req, res) => {
    const { date, name, start, end } = req.body;
    await Shift.create({ date, name, start, end });
    res.json({ success: true });
});

app.post('/api/delete-shift', async (req, res) => {
    await Shift.findByIdAndDelete(req.body.id);
    res.json({ success: true });
});

app.post('/api/shifts/bulk', async (req, res) => {
    const { shifts } = req.body;
    if (shifts && shifts.length > 0) {
        await Shift.insertMany(shifts);
    }
    res.json({ success: true });
});

app.post('/api/shifts/clear-day', async (req, res) => {
    const { date } = req.body;
    await Shift.deleteMany({ date });
    res.json({ success: true });
});

app.post('/api/shifts/clear-month', async (req, res) => {
    const { month } = req.body; // "2024-05"
    await Shift.deleteMany({ date: { $regex: `^${month}` } });
    res.json({ success: true });
});

// 3. EVENTS (ПОДІЇ) - НОВЕ
app.get('/api/events', async (req, res) => {
    const events = await Event.find();
    res.json(events);
});

app.post('/api/events', async (req, res) => {
    const { date, title, repeat } = req.body;
    await Event.create({ date, title, repeat });
    res.json({ success: true });
});

app.post('/api/events/delete', async (req, res) => {
    await Event.findByIdAndDelete(req.body.id);
    res.json({ success: true });
});

// --- INIT ---
async function initDB() {
    try {
        const count = await User.countDocuments();
        if (count === 0) {
            await User.create([
                { username: "admin", password: "123", role: "admin", name: "Адмін" }
            ]);
            console.log("⚠️ Створено користувача admin/123");
        }
    } catch (e) { console.log("Init DB error", e); }
}

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));