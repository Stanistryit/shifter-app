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
    topics: {
        schedule: 36793, 
        news: 36865      
    }
};
const GOOGLE_SHEET_URL = ''; 

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

app.set('trust proxy', 1);

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
    reminderTime: { type: String, default: '20:00' },
    avatar: { type: String, default: null }
});
const User = mongoose.model('User', UserSchema);

const ShiftSchema = new mongoose.Schema({ date: String, name: String, start: String, end: String });
const Shift = mongoose.model('Shift', ShiftSchema);
const TaskSchema = new mongoose.Schema({ date: String, name: String, title: String, isFullDay: Boolean, start: String, end: String });
const Task = mongoose.model('Task', TaskSchema);
const EventSchema = new mongoose.Schema({ date: String, title: String, repeat: { type: String, default: 'none' } });
const Event = mongoose.model('Event', EventSchema);
const RequestSchema = new mongoose.Schema({ type: String, data: Object, createdBy: String, createdAt: { type: Date, default: Date.now } });
const Request = mongoose.model('Request', RequestSchema);
const NewsPostSchema = new mongoose.Schema({ messageId: Number, chatId: Number, text: String, type: String, readBy: [String], createdAt: { type: Date, default: Date.now } });
const NewsPost = mongoose.model('NewsPost', NewsPostSchema);
const ContactSchema = new mongoose.Schema({ name: { type: String, required: true }, phone: { type: String, required: true } });
const Contact = mongoose.model('Contact', ContactSchema);

// --- НОВА СХЕМА ДЛЯ НОТАТОК ---
const NoteSchema = new mongoose.Schema({
    date: { type: String, required: true }, // YYYY-MM-DD
    text: { type: String, required: true },
    type: { type: String, default: 'private' }, // 'private' або 'public'
    author: { type: String, required: true }, // Ім'я автора
    createdAt: { type: Date, default: Date.now }
});
const Note = mongoose.model('Note', NoteSchema);


// --- MIDDLEWARE ---
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ limit: '10mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: 'supersecretkey',
    resave: false, saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URI }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7, httpOnly: true, secure: true, sameSite: 'none' }
}));

// --- HELPERS ---
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

// --- SYNC ---
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
cron.schedule('0 * * * *', syncWithGoogleSheets);

async function sendDailyBriefing() {
    if (!bot || !TG_CONFIG.groupId) return;
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().split('T')[0];
    const display = tomorrow.toLocaleDateString('uk-UA', { weekday: 'long', day: 'numeric', month: 'long' });
    const shifts = await Shift.find({ date: dateStr }).sort({ start: 1 });
    const tasks = await Task.find({ date: dateStr });
    let msg = `🌙 <b>План на завтра (${display}):</b>\n\n`;
    if (shifts.length) { msg += `👷‍♂️ <b>На зміні:</b>\n`; shifts.forEach(s => msg += `🔹 <b>${s.name}</b>: ${s.start} - ${s.end}\n`); } 
    else { msg += `🌴 <b>Завтра змін немає</b>\n`; }
    if (tasks.length) { msg += `\n📌 <b>Задачі:</b>\n`; tasks.forEach(t => { const time = t.isFullDay ? "Весь день" : `${t.start}-${t.end}`; msg += `🔸 <b>${t.name}</b>: ${t.title} (${time})\n`; }); }
    msg += `\nGood luck! 🚀`;
    try { await bot.sendMessage(TG_CONFIG.groupId, msg, { parse_mode: 'HTML', message_thread_id: TG_CONFIG.topics.schedule }); } catch (e) {}
}
cron.schedule('0 18 * * *', sendDailyBriefing);

// --- ROUTES ---
app.post('/api/login', async (req, res) => { 
    try { const { username, password } = req.body; const user = await User.findOne({ username, password }); 
    if (user) { req.session.userId = user._id; req.session.save(() => res.json({ success: true, user: { name: user.name, role: user.role, avatar: user.avatar } })); } 
    else res.json({ success: false, message: "Невірний логін" }); 
    } catch (e) { res.status(500).json({ success: false }); } 
});

app.post('/api/login-telegram', async (req, res) => { 
    const { telegramId } = req.body; if (!telegramId) return res.json({ success: false }); 
    const user = await User.findOne({ telegramChatId: telegramId }); 
    if (user) { req.session.userId = user._id; req.session.save(() => res.json({ success: true, user: { name: user.name, role: user.role, avatar: user.avatar } })); } 
    else res.json({ success: false }); 
});

app.post('/api/logout', (req, res) => { req.session.destroy(); res.json({ success: true }); });
app.get('/api/me', async (req, res) => { 
    if (!req.session.userId) return res.json({ loggedIn: false }); 
    const user = await User.findById(req.session.userId); 
    if (!user) return res.json({ loggedIn: false }); 
    res.json({ loggedIn: true, user: { name: user.name, role: user.role, avatar: user.avatar } }); 
});

app.post('/api/user/avatar', async (req, res) => {
    try {
        if (!req.session.userId) return res.status(403).json({ error: "Auth required" });
        const { avatar } = req.body; 
        await User.findByIdAndUpdate(req.session.userId, { avatar });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- NOTES API ---
app.get('/api/notes', async (req, res) => {
    if (!req.session.userId) return res.json([]);
    const user = await User.findById(req.session.userId);
    if (!user) return res.json([]);

    // Отримуємо: Публічні нотатки + Приватні нотатки поточного юзера
    const notes = await Note.find({
        $or: [
            { type: 'public' },
            { type: 'private', author: user.name }
        ]
    });
    res.json(notes);
});

app.post('/api/notes', async (req, res) => {
    if (!req.session.userId) return res.status(403).json({});
    const user = await User.findById(req.session.userId);
    const { date, text, type } = req.body;

    // Тільки SM/Admin може постити публічні
    let finalType = 'private';
    if (type === 'public' && (user.role === 'SM' || user.role === 'admin')) {
        finalType = 'public';
    }

    await Note.create({
        date,
        text,
        type: finalType,
        author: user.name
    });
    
    // Якщо публічна - сповіщаємо в групу (опціонально, можна прибрати)
    if (finalType === 'public' && TG_CONFIG.groupId) {
        // notifyAll(`📌 <b>Нотатка на ${date}:</b>\n${text}`); // Можна розкоментувати, якщо треба
    }

    res.json({ success: true });
});

app.post('/api/notes/delete', async (req, res) => {
    if (!req.session.userId) return res.status(403).json({});
    const user = await User.findById(req.session.userId);
    const { id } = req.body;
    
    const note = await Note.findById(id);
    if (!note) return res.json({ success: false });

    // Видалити може автор АБО (якщо це публічна) Адмін/СМ
    if (note.author === user.name || ((user.role === 'SM' || user.role === 'admin') && note.type === 'public')) {
        await Note.findByIdAndDelete(id);
        res.json({ success: true });
    } else {
        res.status(403).json({ success: false });
    }
});

// --- BASIC API ---
app.get('/api/users', async (req, res) => { const users = await User.find({}, 'name role'); res.json(users); });
app.get('/api/shifts', async (req, res) => { if (!req.session.userId) return res.status(403).json({}); const s = await Shift.find(); res.json(s); });
app.post('/api/shifts', async (req, res) => { const c=await handlePermission(req,'add_shift',req.body); if(c) return res.json({success:true, pending:c==='pending'}); await Shift.create(req.body); notifyUser(req.body.name, `📅 Зміна: ${req.body.date}`); res.json({success:true}); });
app.post('/api/delete-shift', async (req, res) => { const s=await Shift.findById(req.body.id); if(s){ const c=await handlePermission(req,'del_shift',{id:s.id,details:s.date}); if(c) return res.json({success:true, pending:c==='pending'}); await Shift.findByIdAndDelete(req.body.id); notifyUser(s.name, `❌ Скасовано: ${s.date}`); } res.json({success:true}); });
app.post('/api/shifts/bulk', async (req, res) => { if(req.body.shifts?.length) await Shift.insertMany(req.body.shifts); res.json({success:true}); });
app.post('/api/shifts/clear-day', async (req, res) => { await Shift.deleteMany({date:req.body.date}); res.json({success:true}); });

app.get('/api/tasks', async (req, res) => { const t = await Task.find(); res.json(t); });
app.post('/api/tasks', async (req, res) => { const c=await handlePermission(req,'add_task',req.body); if(c) return res.json({success:true, pending:c==='pending'}); await Task.create(req.body); notifyUser(req.body.name, `📌 Задача: ${req.body.title}`); res.json({success:true}); });
app.post('/api/tasks/delete', async (req, res) => { const c=await handlePermission(req,'del_task',{id:req.body.id}); if(c) return res.json({success:true, pending:c==='pending'}); await Task.findByIdAndDelete(req.body.id); res.json({success:true}); });

app.get('/api/events', async (req, res) => { const e = await Event.find(); res.json(e); });
app.post('/api/events', async (req, res) => { const c=await handlePermission(req,'add_event',req.body); if(c) return res.json({success:true}); await Event.create(req.body); notifyAll(`📢 Подія: ${req.body.title}`); res.json({success:true}); });
app.post('/api/events/delete', async (req, res) => { await Event.findByIdAndDelete(req.body.id); res.json({success:true}); });

app.get('/api/requests', async (req, res) => { const u=await User.findById(req.session.userId); if(u?.role!=='SM'&&u?.role!=='admin') return res.json([]); const r=await Request.find().sort({createdAt:-1}); res.json(r); });
app.post('/api/requests/action', async (req, res) => { const {id,action}=req.body; const r=await Request.findById(id); if(!r) return res.json({}); 
    if(action==='approve'){
        if(r.type==='add_shift') await Shift.create(r.data);
        if(r.type==='del_shift') await Shift.findByIdAndDelete(r.data.id);
        if(r.type==='add_task') await Task.create(r.data);
        if(r.type==='del_task') await Task.findByIdAndDelete(r.data.id);
        if(r.type==='add_event') await Event.create(r.data);
        notifyUser(r.createdBy, `✅ Запит схвалено!`);
    } else { notifyUser(r.createdBy, `❌ Запит відхилено.`); }
    await Request.findByIdAndDelete(id); res.json({success:true});
});
app.post('/api/requests/approve-all', async (req, res) => { const rs=await Request.find(); for(const r of rs){
        if(r.type==='add_shift') await Shift.create(r.data);
        if(r.type==='del_shift') await Shift.findByIdAndDelete(r.data.id);
        if(r.type==='add_task') await Task.create(r.data);
        if(r.type==='del_task') await Task.findByIdAndDelete(r.data.id);
        if(r.type==='add_event') await Event.create(r.data);
        notifyUser(r.createdBy, `✅ Всі запити схвалено.`); await Request.findByIdAndDelete(r._id);
    } res.json({success:true});
});

app.post('/api/news/publish', upload.single('media'), async (req, res) => {
    try {
        if (!req.session.userId) return res.status(403).json({});
        const user = await User.findById(req.session.userId);
        if (user.role!=='SM'&&user.role!=='admin') return res.status(403).json({});
        
        const text = req.body.text || "";
        const file = req.file;
        const opts = { parse_mode: 'HTML', message_thread_id: TG_CONFIG.topics.news, reply_markup: { inline_keyboard: [[{ text: "✅ Ознайомлений", callback_data: 'read_news' }]] } };
        let sentMsg, postType='text';

        if (file) {
            const originalNameFixed = Buffer.from(file.originalname, 'latin1').toString('utf8');
            const fileOptions = { filename: originalNameFixed, contentType: file.mimetype };
            if (file.mimetype.startsWith('image/')) { sentMsg = await bot.sendPhoto(TG_CONFIG.groupId, file.buffer, {...opts, caption: `📢 <b>Новини:</b>\n\n${text}`}, fileOptions); postType='photo'; }
            else { sentMsg = await bot.sendDocument(TG_CONFIG.groupId, file.buffer, {...opts, caption: `📢 <b>Новини:</b>\n\n${text}`}, fileOptions); postType='document'; }
        } else { sentMsg = await bot.sendMessage(TG_CONFIG.groupId, `📢 <b>Новини:</b>\n\n${text}`, opts); }

        await NewsPost.create({ messageId: sentMsg.message_id, chatId: sentMsg.chat.id, text, type: postType, readBy: [] });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

async function initDB() { 
    if ((await User.countDocuments()) === 0) await User.create([{ username: "admin", password: "123", role: "admin", name: "Адмін" }]); 
    if(!(await User.findOne({role:'RRP'}))) await User.create({username:"rrp",password:"rrp",role:"RRP",name:"Регіональний Менеджер"});
    if((await Contact.countDocuments())===0) await Contact.create([{name: "RRP Наташа", phone: "+380954101682"}, {name: "AM Руслан", phone: "+380674652158"}]);
}

if (bot) {
    app.post(`/bot${process.env.TELEGRAM_TOKEN}`, (req, res) => { bot.processUpdate(req.body); res.sendStatus(200); });
    const mainMenu = { keyboard: [ [{ text: "📅 Відкрити Графік", web_app: { url: 'https://shifter-app.onrender.com' } }], [{ text: "📋 Мої зміни" }, { text: "🌴 Вихідні" }] ], resize_keyboard: true };

    bot.onText(/\/start/, (msg) => bot.sendMessage(msg.chat.id, "👋 Привіт!", { reply_markup: mainMenu }));
    bot.onText(/\/login (.+) (.+)/, async (msg, match) => { const u = await User.findOne({ username: match[1], password: match[2] }); if(u){ u.telegramChatId=msg.chat.id; await u.save(); bot.sendMessage(msg.chat.id, `✅ Привіт, ${u.name}!`); } else bot.sendMessage(msg.chat.id, "❌ Помилка"); });
    bot.onText(/\/settings/, (msg) => bot.sendMessage(msg.chat.id, "⚙️", {reply_markup:{inline_keyboard:[[{text:'🌙 Вечір (20:00)',callback_data:'set_remind_20'}],[{text:'☀️ Ранок (08:00)',callback_data:'set_remind_08'}],[{text:'🔕 Вимкнути',callback_data:'set_remind_none'}]]}}));
    bot.onText(/\/now/, async (msg) => {
        const now = new Date(new Date().toLocaleString("en-US", {timeZone: "Europe/Kiev"}));
        const shifts = await Shift.find({ date: now.toISOString().split('T')[0] });
        const curMin = now.getHours()*60 + now.getMinutes();
        let active = shifts.filter(s => { const [h1,m1]=s.start.split(':').map(Number); const [h2,m2]=s.end.split(':').map(Number); const start=h1*60+m1; const end=h2*60+m2; return curMin>=start && curMin<end; }).map(s=>`👤 <b>${s.name}</b> (до ${s.end})`).join('\n');
        bot.sendMessage(msg.chat.id, active ? `🟢 <b>Зараз:</b>\n\n${active}` : "zzz... Нікого немає", {parse_mode:'HTML', message_thread_id: msg.message_thread_id});
    });
    bot.onText(/\/contacts/, async (msg) => { const c = await Contact.find(); bot.sendMessage(msg.chat.id, `📒 <b>Контакти:</b>\n\n` + c.map(x=>`👤 <b>${x.name}:</b> ${x.phone}`).join('\n'), {parse_mode:'HTML', message_thread_id: msg.message_thread_id}); });
    bot.onText(/\/addcontact (.+)/, async (msg, match) => { const u = await User.findOne({ telegramChatId: msg.from.id }); if(u?.role!=='SM'&&u?.role!=='admin') return; const args=match[1].trim().split(' '); const phone=args.pop(); const name=args.join(' '); await Contact.create({name,phone}); bot.sendMessage(msg.chat.id, `✅ Додано: ${name}`); });
    bot.onText(/\/delcontact (.+)/, async (msg, match) => { const u = await User.findOne({ telegramChatId: msg.from.id }); if(u?.role!=='SM'&&u?.role!=='admin') return; await Contact.findOneAndDelete({name:match[1].trim()}); bot.sendMessage(msg.chat.id, `🗑 Видалено: ${match[1].trim()}`); });

    bot.onText(/\/stats/, async (msg) => {
        const u = await User.findOne({ telegramChatId: msg.from.id }); if(u?.role!=='SM'&&u?.role!=='admin') return;
        const now = new Date(); const mStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
        const shifts = await Shift.find({ date: { $regex: `^${mStr}` } });
        if(!shifts.length) return bot.sendMessage(msg.chat.id, "Пусто");
        
        const report = {}; shifts.forEach(s => { const [h1,m1]=s.start.split(':').map(Number); const [h2,m2]=s.end.split(':').map(Number); const h=(h2+m2/60)-(h1+m1/60); if(!report[s.name]) report[s.name]=0; report[s.name]+=h; });
        let txt = `📊 <b>Табель:</b>\n\n`; Object.entries(report).sort((a,b)=>b[1]-a[1]).forEach(([n,h],i)=> txt+=`${i<3?['🥇','🥈','🥉'][i]:'👤'} <b>${n}:</b> ${h.toFixed(1)} год.\n`);
        await bot.sendMessage(msg.chat.id, txt, {parse_mode:'HTML', message_thread_id: msg.message_thread_id});

        const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Табель');
        const dim = new Date(now.getFullYear(), now.getMonth()+1, 0).getDate();
        const cols = [{header:'Ім\'я', key:'name', width:20}]; for(let i=1; i<=dim; i++) cols.push({header:`${i}`, key:`d${i}`, width:10}); cols.push({header:'Всього', key:'total', width:12});
        ws.columns = cols; ws.getRow(1).font={bold:true};
        Object.keys(report).sort().forEach(n => {
            const row = {name:n, total:parseFloat(report[n].toFixed(1))};
            shifts.filter(s=>s.name===n).forEach(s=> row[`d${parseInt(s.date.split('-')[2])}`] = `${s.start}-${s.end}`);
            ws.addRow(row);
        });
        const buf = await wb.xlsx.writeBuffer();
        bot.sendDocument(msg.chat.id, buf, {caption:`📂 Табель_${mStr}.xlsx`, message_thread_id: msg.message_thread_id}, {filename:`Табель_${mStr}.xlsx`, contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    });

    bot.on('callback_query', async (q) => {
        const uid = q.from.id;
        if (q.data === 'read_news') {
            const u = await User.findOne({telegramChatId:uid});
            let name = u ? u.name : (q.from.first_name || 'User');
            const shortName = name.trim().split(' ').length > 1 ? name.trim().split(' ')[1] : name.trim().split(' ')[0];
            const p = await NewsPost.findOne({messageId:q.message.message_id});
            if(!p) return bot.answerCallbackQuery(q.id, {text:'❌ Старий пост'});
            if(p.readBy.includes(shortName)) return bot.answerCallbackQuery(q.id, {text:'ℹ️ Вже відмітились', show_alert:true});
            p.readBy.push(shortName); await p.save();
            const txt = `📢 <b>Новини:</b>\n\n${p.text}\n\n👀 <b>Ознайомились:</b>\n${p.readBy.join(', ')}`;
            const opts = {chat_id:q.message.chat.id, message_id:q.message.message_id, parse_mode:'HTML', reply_markup:q.message.reply_markup};
            if(p.type==='text') bot.editMessageText(txt, opts); else bot.editMessageCaption(txt, opts);
            bot.answerCallbackQuery(q.id, {text:`Дякую, ${shortName}! ✅`});
        }
        if (q.data.startsWith('set_remind_')) {
            const u = await User.findOne({telegramChatId:uid});
            if(u){ u.reminderTime = q.data.replace('set_remind_','').replace('none','none'); if(u.reminderTime!=='none') u.reminderTime+=':00'; await u.save(); bot.answerCallbackQuery(q.id); bot.sendMessage(q.message.chat.id, `Ок: ${u.reminderTime}`); }
        }
    });
}

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));