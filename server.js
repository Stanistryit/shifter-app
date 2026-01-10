const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const mongoose = require('mongoose');
const app = express();
const PORT = process.env.PORT || 3000;

// Отримуємо посилання на базу з налаштувань Render
const MONGO_URI = process.env.MONGO_URI; 

app.use(bodyParser.json({ limit: '10mb' }));
app.use(express.static('public'));
app.use(session({
    secret: 'shifter-secret-key',
    resave: false,
    saveUninitialized: true
}));

// Підключення до бази
mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ Connected to MongoDB'))
    .catch(err => console.error('❌ MongoDB connection error:', err));

// Схеми даних
const UserSchema = new mongoose.Schema({
    username: { type: String, required: true },
    password: { type: String, required: true },
    role: { type: String, default: 'user' },
    name: String
});
const ShiftSchema = new mongoose.Schema({
    date: String,
    name: String,
    start: String,
    end: String
});

const User = mongoose.model('User', UserSchema);
const Shift = mongoose.model('Shift', ShiftSchema);

// Створення дефолтних юзерів (якщо база пуста)
async function initDB() {
    try {
        const count = await User.countDocuments();
        if (count === 0) {
            await User.create([
                { username: "admin", password: "123", role: "admin", name: "Бос" },
                { username: "user1", password: "111", role: "user", name: "Олексій" },
                { username: "user2", password: "222", role: "user", name: "Марина" }
            ]);
            console.log("⚠️ Створено тестових користувачів!");
        }
    } catch (e) { console.log("Init DB error", e); }
}
initDB();

// API
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await User.findOne({ username, password });
    if (user) { req.session.user = user; res.json({ success: true, user }); } 
    else { res.status(401).json({ success: false, message: "Невірні дані" }); }
});

app.get('/api/me', (req, res) => {
    if (req.session.user) res.json({ loggedIn: true, user: req.session.user });
    else res.json({ loggedIn: false });
});

app.post('/api/logout', (req, res) => { req.session.destroy(); res.json({ success: true }); });

app.get('/api/users', async (req, res) => {
    if (!req.session.user) return res.status(403).json([]);
    const workers = await User.find({ role: 'user' }, 'name');
    res.json(workers);
});

app.get('/api/shifts', async (req, res) => {
    if (!req.session.user) return res.status(403).json([]);
    const shifts = await Shift.find().sort({ date: 1, start: 1 });
    res.json(shifts);
});

app.post('/api/shifts', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.status(403);
    await Shift.create(req.body);
    res.json({ success: true });
});

app.post('/api/shifts/bulk', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.status(403);
    await Shift.insertMany(req.body.shifts);
    res.json({ success: true });
});

// Видалення (тепер по ID)
app.post('/api/delete-shift', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.status(403);
    const { id } = req.body;
    if(id) await Shift.findByIdAndDelete(id);
    res.json({ success: true });
});

// Очищення
app.post('/api/shifts/clear-day', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.status(403);
    await Shift.deleteMany({ date: req.body.date });
    res.json({ success: true });
});
app.post('/api/shifts/clear-month', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.status(403);
    await Shift.deleteMany({ date: { $regex: `^${req.body.month}` } });
    res.json({ success: true });
});
app.post('/api/shifts/clear-all', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.status(403);
    await Shift.deleteMany({});
    res.json({ success: true });
});

app.listen(PORT, () => { console.log(`Server running on port ${PORT}`); });