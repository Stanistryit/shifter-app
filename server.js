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

// 1. НАЛАШТУВАННЯ ДЛЯ RENDER
app.set('trust proxy', 1);

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

// --- MIDDLEWARE ---
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: 'supersecretkey',
    resave: false, 
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URI }),
    cookie: { 
        maxAge: 1000 * 60 * 60 * 24 * 7, // 7 днів
        httpOnly: true,
        secure: true,      
        sameSite: 'none'   
    }
}));

// --- PERMISSIONS HELPERS ---
async function handlePermission(req, type, data) {
    const user = await User.findById(req.session.userId);
    if (!user) return 'unauthorized';
    if (user.role === 'SSE') {
        await Request.create({ type, data, createdBy: user.name });
        return 'pending';
    }
    if (user.role === 'SM' || user.role === 'admin') return null;
    return 'forbidden';
}

// --- API ROUTES ---
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ username, password });
        if (user) { 
            req.session.userId = user._id;
            req.session.save(err => {
                if(err) return res.json({ success: false, message: "Session Error" });
                res.json({ success: true, user: { name: user.name, role: user.role } }); 
            });
        } 
        else { res.json({ success: false, message: "Невірний логін або пароль" }); }
    } catch (e) { res.status(500).json({ success: false, message: "Server Error" }); }
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

// SHIFTS
app.get('/api/shifts', async (req, res) => { if (!req.session.userId) return res.status(403).json({ error: "Unauthorized" }); const shifts = await Shift.find(); res.json(shifts); });
app.post('/api/shifts', async (req, res) => { const c=await handlePermission(req,'add_shift',req.body); if(c==='pending')return res.json({success:true,pending:true}); if(c==='forbidden')return res.status(403).json({}); await Shift.create(req.body); res.json({success:true}); });
app.post('/api/delete-shift', async (req, res) => { const s=await Shift.findById(req.body.id); if(!s)return res.json({success:false}); const c=await handlePermission(req,'del_shift',{id:req.body.id,details:`${s.date} (${s.name})`}); if(c==='pending')return res.json({success:true,pending:true}); await Shift.findByIdAndDelete(req.body.id); res.json({success:true}); });
app.post('/api/shifts/bulk', async (req, res) => { if (req.body.shifts?.length) await Shift.insertMany(req.body.shifts); res.json({ success: true }); });
app.post('/api/shifts/clear-day', async (req, res) => { await Shift.deleteMany({ date: req.body.date }); res.json({ success: true }); });
app.post('/api/shifts/clear-month', async (req, res) => { await Shift.deleteMany({ date: { $regex: `^${req.body.month}` } }); res.json({ success: true }); });

// TASKS
app.get('/api/tasks', async (req, res) => { const tasks = await Task.find(); res.json(tasks); });
app.post('/api/tasks', async (req, res) => { const c=await handlePermission(req,'add_task',req.body); if(c==='pending')return res.json({success:true,pending:true}); await Task.create(req.body); res.json({success:true}); });
app.post('/api/tasks/delete', async (req, res) => { const t=await Task.findById(req.body.id); if(!t)return res.json({success:false}); const c=await handlePermission(req,'del_task',{id:req.body.id,details:`${t.title} for ${t.name}`}); if(c==='pending')return res.json({success:true,pending:true}); await Task.findByIdAndDelete(req.body.id); res.json({success:true}); });

// EVENTS
app.get('/api/events', async (req, res) => { const events = await Event.find(); res.json(events); });
app.post('/api/events', async (req, res) => { const c=await handlePermission(req,'add_event',req.body); if(c==='pending')return res.json({success:true,pending:true}); await Event.create(req.body); res.json({success:true}); });
app.post('/api/events/delete', async (req, res) => { await Event.findByIdAndDelete(req.body.id); res.json({ success: true }); });

// REQUESTS
app.get('/api/requests', async (req, res) => { const u=await User.findById(req.session.userId); if(!u||(u.role!=='SM'&&u.role!=='admin'))return res.json([]); const r=await Request.find().sort({createdAt:-1}); res.json(r); });
app.post('/api/requests/action', async (req, res) => { const {id,action}=req.body; const r=await Request.findById(id); if(!r)return res.json({success:false}); if(action==='approve'){ if(r.type==='add_shift')await Shift.create(r.data); if(r.type==='del_shift')await Shift.findByIdAndDelete(r.data.id); if(r.type==='add_task')await Task.create(r.data); if(r.type==='del_task')await Task.findByIdAndDelete(r.data.id); if(r.type==='add_event')await Event.create(r.data); } await Request.findByIdAndDelete(id); res.json({success:true}); });
app.post('/api/requests/approve-all', async (req, res) => { const rs=await Request.find(); for(const r of rs){ if(r.type==='add_shift')await Shift.create(r.data); if(r.type==='del_shift')await Shift.findByIdAndDelete(r.data.id); if(r.type==='add_task')await Task.create(r.data); if(r.type==='del_task')await Task.findByIdAndDelete(r.data.id); if(r.type==='add_event')await Event.create(r.data); await Request.findByIdAndDelete(r._id); } res.json({success:true}); });

async function initDB() { try { if ((await User.countDocuments()) === 0) await User.create([{ username: "admin", password: "123", role: "admin", name: "Адмін" }]); } catch (e) { console.log(e); } }

// ============================================================
// --- TELEGRAM BOT (WEBHOOK + MENU BUTTONS) ---
// ============================================================
if (process.env.TELEGRAM_TOKEN) {
    const bot = new TelegramBot(process.env.TELEGRAM_TOKEN); 
    const APP_URL = 'https://shifter-app.onrender.com'; // Твій URL на Render

    bot.setWebHook(`${APP_URL}/bot${process.env.TELEGRAM_TOKEN}`);
    console.log("🤖 Telegram Bot: Webhook set");

    app.post(`/bot${process.env.TELEGRAM_TOKEN}`, (req, res) => {
        bot.processUpdate(req.body);
        res.sendStatus(200);
    });

    // --- КЛАВІАТУРА ---
    const mainMenu = {
        keyboard: [
            [{ text: "📅 Відкрити Графік", web_app: { url: APP_URL } }],
            [{ text: "📋 Мої зміни" }, { text: "🌴 Вихідні" }]
        ],
        resize_keyboard: true
    };

    // --- КОМАНДИ ---
    bot.onText(/\/start/, (msg) => { 
        bot.sendMessage(msg.chat.id, "👋 Привіт! Я Shifter Bot.\n\nТисни кнопки внизу для керування 👇", { 
            parse_mode: 'Markdown',
            reply_markup: mainMenu
        }); 
    });

    bot.onText(/\/login (.+) (.+)/, async (msg, match) => { 
        const u = await User.findOne({ username: match[1], password: match[2] }); 
        if (u) { 
            u.telegramChatId = msg.chat.id; 
            await u.save(); 
            bot.sendMessage(msg.chat.id, `✅ Привіт, ${u.name}! Акаунт прив'язано.`, { reply_markup: mainMenu }); 
        } else { 
            bot.sendMessage(msg.chat.id, "❌ Помилка. Невірний логін або пароль."); 
        } 
    });

    bot.onText(/\/settings/, async (msg) => { 
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

    // --- ОБРОБКА КНОПОК МЕНЮ ТА ТЕКСТУ ---
    bot.on('message', async (msg) => {
        if (!msg.text) return;
        
        // Кнопка "📋 Мої зміни" (Аналог /me)
        if (msg.text === '📋 Мої зміни' || msg.text === '/me') {
            const u = await User.findOne({ telegramChatId: msg.chat.id }); 
            if (!u) return bot.sendMessage(msg.chat.id, "🔴 Ти не авторизований. Напиши: `/login логін пароль`", {parse_mode: 'Markdown'}); 
            
            const t = new Date().toISOString().split('T')[0];
            const s = await Shift.find({ name: u.name, date: { $gte: t } }).sort({ date: 1 }).limit(5); 
            const tk = await Task.find({ name: u.name, date: { $gte: t } }).sort({ date: 1 });
            
            let r = "📋 **Твої найближчі події:**\n"; 
            s.forEach(x => r+=`🔹 ${x.date.slice(5)}: ${x.start}-${x.end}\n`); 
            tk.forEach(x => r+=`🔸 ${x.date.slice(5)}: ${x.title}\n`); 
            
            bot.sendMessage(msg.chat.id, s.length || tk.length ? r : "На найближчий час змін немає 🌴", { parse_mode: 'Markdown' });
        }

        // Кнопка "🌴 Вихідні" (Аналог /off)
        if (msg.text === '🌴 Вихідні' || msg.text === '/off') {
            const u = await User.findOne({ telegramChatId: msg.chat.id });
            if (!u) return bot.sendMessage(msg.chat.id, "🔴 Авторизуйся: `/login логін пароль`", {parse_mode: 'Markdown'});
            
            const d = new Date();
            const m = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
            const dim = new Date(d.getFullYear(), d.getMonth()+1, 0).getDate();
            const s = await Shift.find({ name: u.name, date: { $regex: `^${m}` } });
            
            const wd = s.map(x => parseInt(x.date.split('-')[2])); // Робочі дні
            let off = [];
            for(let i = d.getDate(); i <= dim; i++){
                if(!wd.includes(i)) off.push(i);
            }
            bot.sendMessage(msg.chat.id, `🌴 Твої вихідні до кінця місяця:\n${off.join(', ')}`);
        }
    });

    // Callbacks для налаштувань
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

    // --- CRON JOBS ---
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