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
const ExcelJS = require('exceljs');

const app = express();
const PORT = process.env.PORT || 3000;

// --- CONFIG ---
const TG_CONFIG = {
    groupId: process.env.TG_GROUP_ID, 
    topics: { schedule: 36793, news: 36865 }
};
const GOOGLE_SHEET_URL = ''; 

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

app.set('trust proxy', 1);

let bot = null;
if (process.env.TELEGRAM_TOKEN) {
    bot = new TelegramBot(process.env.TELEGRAM_TOKEN);
    const APP_URL = 'https://shifter-app.onrender.com';
    bot.setWebHook(`${APP_URL}/bot${process.env.TELEGRAM_TOKEN}`);
    console.log("🤖 Telegram Bot: Webhook set");
    bot.setMyCommands([
        { command: '/start', description: '🏠 Головне меню' }, { command: '/now', description: '👀 Хто зараз на зміні' },
        { command: '/contacts', description: '📒 Контакти' }, { command: '/settings', description: '⚙️ Налаштування' },
        { command: '/login', description: '🔐 Авторизація' }, { command: '/stats', description: '📊 Табель (SM)' },
        { command: '/post', description: '📢 Новина (SM)' }, { command: '/addcontact', description: '➕ Контакт (SM)' },
        { command: '/delcontact', description: '➖ Контакт (SM)' }
    ]);
}

mongoose.connect(process.env.MONGO_URI).then(() => { console.log("✅ MongoDB OK"); initDB(); }).catch(e => console.error(e));

// --- SCHEMAS ---
const UserSchema = new mongoose.Schema({ username: String, password: {type:String,required:true}, role: {type:String,default:'user'}, name: String, telegramChatId: Number, reminderTime: {type:String,default:'20:00'}, avatar: String });
const User = mongoose.model('User', UserSchema);
const ShiftSchema = new mongoose.Schema({ date: String, name: String, start: String, end: String });
const Shift = mongoose.model('Shift', ShiftSchema);
const TaskSchema = new mongoose.Schema({ date: String, name: String, title: String, isFullDay: Boolean, start: String, end: String });
const Task = mongoose.model('Task', TaskSchema);
const EventSchema = new mongoose.Schema({ date: String, title: String });
const Event = mongoose.model('Event', EventSchema);
const RequestSchema = new mongoose.Schema({ type: String, data: Object, createdBy: String, createdAt: { type: Date, default: Date.now } });
const Request = mongoose.model('Request', RequestSchema);
const NewsPostSchema = new mongoose.Schema({ messageId: Number, chatId: Number, text: String, type: String, readBy: [String], createdAt: { type: Date, default: Date.now } });
const NewsPost = mongoose.model('NewsPost', NewsPostSchema);
const ContactSchema = new mongoose.Schema({ name: String, phone: String });
const Contact = mongoose.model('Contact', ContactSchema);
const NoteSchema = new mongoose.Schema({ date: String, text: String, type: {type:String,default:'private'}, author: String, createdAt: {type:Date,default:Date.now} });
const Note = mongoose.model('Note', NoteSchema);

// --- NEW: AUDIT LOG SCHEMA ---
const AuditLogSchema = new mongoose.Schema({
    action: String,     // 'add_shift', 'delete_shift', 'login', etc.
    performer: String,  // Хто зробив
    details: String,    // Що саме зробив
    timestamp: { type: Date, default: Date.now }
});
const AuditLog = mongoose.model('AuditLog', AuditLogSchema);

// --- MIDDLEWARE ---
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ limit: '10mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({ secret: 'supersecretkey', resave: false, saveUninitialized: false, store: MongoStore.create({ mongoUrl: process.env.MONGO_URI }), cookie: { maxAge: 1000*60*60*24*7, httpOnly:true, secure:true, sameSite:'none' } }));

// --- HELPERS ---
async function logAction(performer, action, details) {
    try { await AuditLog.create({ performer, action, details }); } catch(e){ console.error("Log error", e); }
}

async function handlePermission(req, type, data) {
    const user = await User.findById(req.session.userId);
    if (!user) return 'unauthorized';
    if (user.role === 'RRP') return 'forbidden';
    if (user.role === 'SSE') {
        await Request.create({ type, data, createdBy: user.name });
        notifyRole('SM', `🔔 <b>Запит від SSE (${user.name})</b>\n${type}`);
        return 'pending';
    }
    if (user.role === 'SM' || user.role === 'admin') return null;
    return 'forbidden';
}
async function notifyUser(name, msg) { if(!bot) return; try { const u = await User.findOne({name}); if(u?.telegramChatId) bot.sendMessage(u.telegramChatId, msg, {parse_mode:'HTML'}); } catch(e){} }
async function notifyRole(role, msg) { if(!bot) return; try { const us = await User.find({role}); for(const u of us) if(u.telegramChatId) bot.sendMessage(u.telegramChatId, msg, {parse_mode:'HTML'}); } catch(e){} }
async function notifyAll(msg) { if(!bot) return; try { const us = await User.find({telegramChatId:{$ne:null}}); for(const u of us) bot.sendMessage(u.telegramChatId, msg, {parse_mode:'HTML'}); } catch(e){} }

// --- ROUTES ---
app.post('/api/login', async (req, res) => { 
    try { const { username, password } = req.body; const user = await User.findOne({ username, password }); 
    if (user) { 
        req.session.userId = user._id; 
        logAction(user.name, 'login', 'Web Login');
        req.session.save(() => res.json({ success: true, user: { name: user.name, role: user.role, avatar: user.avatar } })); 
    } 
    else res.json({ success: false, message: "Невірний логін" }); 
    } catch (e) { res.status(500).json({ success: false }); } 
});

app.post('/api/login-telegram', async (req, res) => { 
    const { telegramId } = req.body; if (!telegramId) return res.json({ success: false }); 
    const user = await User.findOne({ telegramChatId: telegramId }); 
    if (user) { 
        req.session.userId = user._id; 
        logAction(user.name, 'login', 'Telegram Auto-Login');
        req.session.save(() => res.json({ success: true, user: { name: user.name, role: user.role, avatar: user.avatar } })); 
    } 
    else res.json({ success: false }); 
});

app.post('/api/logout', (req, res) => { req.session.destroy(); res.json({ success: true }); });
app.get('/api/me', async (req, res) => { 
    if (!req.session.userId) return res.json({ loggedIn: false }); 
    const user = await User.findById(req.session.userId); 
    if (!user) return res.json({ loggedIn: false }); 
    res.json({ loggedIn: true, user: { name: user.name, role: user.role, avatar: user.avatar } }); 
});

// User Avatar
app.post('/api/user/avatar', async (req, res) => {
    if (!req.session.userId) return;
    await User.findByIdAndUpdate(req.session.userId, { avatar: req.body.avatar });
    res.json({ success: true });
});

// Logs API (Для перегляду в майбутньому)
app.get('/api/logs', async (req, res) => {
    const user = await User.findById(req.session.userId);
    if(user?.role !== 'admin' && user?.role !== 'SM') return res.json([]);
    const logs = await AuditLog.find().sort({timestamp: -1}).limit(50);
    res.json(logs);
});

// Shifts with Logging
app.post('/api/shifts', async (req, res) => { 
    const u = await User.findById(req.session.userId);
    const c = await handlePermission(req,'add_shift', req.body); 
    if(c) return res.json({success:true, pending:c==='pending'}); 
    await Shift.create(req.body); 
    logAction(u.name, 'add_shift', `${req.body.date} for ${req.body.name}`);
    notifyUser(req.body.name, `📅 Зміна: ${req.body.date} (${req.body.start})`); 
    res.json({success:true}); 
});

app.post('/api/delete-shift', async (req, res) => { 
    const u = await User.findById(req.session.userId);
    const s = await Shift.findById(req.body.id); 
    if(s){ 
        const c=await handlePermission(req,'del_shift',{id:s.id,details:s.date}); 
        if(c) return res.json({success:true, pending:c==='pending'}); 
        await Shift.findByIdAndDelete(req.body.id); 
        logAction(u.name, 'delete_shift', `${s.date} for ${s.name}`);
        notifyUser(s.name, `❌ Скасовано: ${s.date}`); 
    } 
    res.json({success:true}); 
});

app.post('/api/shifts/bulk', async (req, res) => { 
    const u = await User.findById(req.session.userId);
    if(req.body.shifts?.length) {
        await Shift.insertMany(req.body.shifts); 
        logAction(u.name, 'bulk_import', `${req.body.shifts.length} shifts`);
    }
    res.json({success:true}); 
});

// Other APIs (Tasks, Events, Notes - Simplified for brevity but assume same logic)
app.get('/api/shifts', async (req, res) => { const s = await Shift.find(); res.json(s); });
app.get('/api/tasks', async (req, res) => { const t = await Task.find(); res.json(t); });
app.post('/api/tasks', async (req, res) => { await Task.create(req.body); res.json({success:true}); });
app.post('/api/tasks/delete', async (req, res) => { await Task.findByIdAndDelete(req.body.id); res.json({success:true}); });
app.get('/api/notes', async (req, res) => { 
    if(!req.session.userId) return res.json([]); 
    const u = await User.findById(req.session.userId);
    const n = await Note.find({ $or: [{type:'public'}, {type:'private', author:u.name}] }); 
    res.json(n); 
});
app.post('/api/notes', async (req, res) => { 
    const u = await User.findById(req.session.userId);
    let type = 'private'; if(req.body.type==='public' && (u.role==='SM'||u.role==='admin')) type='public';
    await Note.create({ ...req.body, author: u.name, type });
    res.json({success:true});
});
app.post('/api/notes/delete', async (req, res) => { await Note.findByIdAndDelete(req.body.id); res.json({success:true}); });
app.get('/api/users', async (req, res) => { const u = await User.find({}, 'name role'); res.json(u); });
app.get('/api/requests', async (req, res) => { const r = await Request.find().sort({createdAt:-1}); res.json(r); });
app.post('/api/requests/action', async (req, res) => { 
    const {id,action} = req.body; const r = await Request.findById(id); 
    if(action==='approve') {
        if(r.type==='add_shift') await Shift.create(r.data);
        if(r.type==='del_shift') await Shift.findByIdAndDelete(r.data.id);
        // ... add other types if needed
    }
    await Request.findByIdAndDelete(id); res.json({success:true}); 
});
app.post('/api/requests/approve-all', async (req, res) => { 
    const rs = await Request.find(); 
    for(const r of rs) { if(r.type==='add_shift') await Shift.create(r.data); await Request.findByIdAndDelete(r._id); }
    res.json({success:true}); 
});

// News
app.post('/api/news/publish', upload.single('media'), async (req, res) => {
    try {
        const u = await User.findById(req.session.userId);
        if(u.role!=='SM' && u.role!=='admin') return res.status(403).json({});
        const text = req.body.text || ""; const file = req.file;
        const opts = { parse_mode: 'HTML', message_thread_id: TG_CONFIG.topics.news, reply_markup: { inline_keyboard: [[{ text: "✅ Ознайомлений", callback_data: 'read_news' }]] } };
        let sentMsg;
        if(file) {
            const originalNameFixed = Buffer.from(file.originalname, 'latin1').toString('utf8');
            if(file.mimetype.startsWith('image/')) sentMsg = await bot.sendPhoto(TG_CONFIG.groupId, file.buffer, {...opts, caption: text}, {filename:originalNameFixed});
            else sentMsg = await bot.sendDocument(TG_CONFIG.groupId, file.buffer, {...opts, caption: text}, {filename:originalNameFixed});
        } else { sentMsg = await bot.sendMessage(TG_CONFIG.groupId, text, opts); }
        await NewsPost.create({ messageId: sentMsg.message_id, chatId: sentMsg.chat.id, text, type: file?'file':'text', readBy: [] });
        logAction(u.name, 'publish_news', 'News posted');
        res.json({success:true});
    } catch(e) { res.status(500).json({}); }
});

// Init & Cron
async function initDB() { if(!(await User.countDocuments())) await User.create({username:"admin",password:"123",role:"admin",name:"Admin"}); }
cron.schedule('0 18 * * *', async () => { /* Daily briefing code */ });

// Bot Logic (Minimal for context)
if(bot) {
    app.post(`/bot${process.env.TELEGRAM_TOKEN}`, (req,res)=>{bot.processUpdate(req.body); res.sendStatus(200);});
    bot.onText(/\/now/, async (msg) => { /* ... */ });
    bot.on('callback_query', async (q) => { 
        if(q.data==='read_news') {
            const u = await User.findOne({telegramChatId:q.from.id});
            let name = u ? u.name : q.from.first_name;
            const shortName = name.split(' ')[1] || name.split(' ')[0];
            const p = await NewsPost.findOne({messageId:q.message.message_id});
            if(p && !p.readBy.includes(shortName)) {
                p.readBy.push(shortName); await p.save();
                const txt = (p.text ? p.text + "\n\n" : "") + `👀 <b>Ознайомились:</b>\n${p.readBy.join(', ')}`;
                if(p.type==='text') bot.editMessageText(txt, {chat_id:q.message.chat.id, message_id:q.message.message_id, parse_mode:'HTML', reply_markup:q.message.reply_markup});
                else bot.editMessageCaption(txt, {chat_id:q.message.chat.id, message_id:q.message.message_id, parse_mode:'HTML', reply_markup:q.message.reply_markup});
                bot.answerCallbackQuery(q.id, {text:`Дякую, ${shortName}! ✅`});
            } else bot.answerCallbackQuery(q.id, {text:'Вже є', show_alert:true});
        }
    });
}

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));