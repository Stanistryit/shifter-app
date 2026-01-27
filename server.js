require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const path = require('path');
const cron = require('node-cron');

// Imports
const { initBot, notifyAll } = require('./backend/bot');
const { initDB, syncWithGoogleSheets } = require('./backend/utils');
const { Shift, Task, User } = require('./backend/models');
const routes = require('./backend/routes');

const app = express();
const PORT = process.env.PORT || 3000;

// Config
const TG_CONFIG = {
    groupId: process.env.TG_GROUP_ID,
    topics: { schedule: 36793, news: 36865 }
};
app.set('tgConfig', TG_CONFIG); // Share config with routes
app.set('trust proxy', 1);

// Middleware
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ limit: '10mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: 'supersecretkey',
    resave: false, saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URI }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7, httpOnly: true, secure: true, sameSite: 'none' }
}));

// Routes
app.use('/api', routes);

// Database & Bot
mongoose.connect(process.env.MONGO_URI)
    .then(() => { 
        console.log("✅ MongoDB OK"); 
        initDB(); 
        const bot = initBot(process.env.TELEGRAM_TOKEN, 'https://shifter-app.onrender.com', TG_CONFIG);
    })
    .catch(console.error);

// Cron Jobs
const GOOGLE_SHEET_URL = '';
cron.schedule('0 * * * *', () => syncWithGoogleSheets(GOOGLE_SHEET_URL));

cron.schedule('0 18 * * *', async () => {
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().split('T')[0];
    const display = tomorrow.toLocaleDateString('uk-UA', { weekday: 'long', day: 'numeric', month: 'long' });
    
    const shifts = await Shift.find({ date: dateStr }).sort({ start: 1 });
    const tasks = await Task.find({ date: dateStr });
    const allUsers = await User.find({ role: { $nin: ['admin', 'RRP'] } });
    
    let msg = `🌙 <b>План на завтра (${display}):</b>\n\n`;
    const workingNames = [];
    
    if (shifts.length) { 
        msg += `👷‍♂️ <b>На зміні:</b>\n`; 
        shifts.forEach(s => {
            workingNames.push(s.name);
            if(s.start === 'Відпустка') msg += `🌴 <b>${s.name}</b>: Відпустка\n`;
            else msg += `🔹 <b>${s.name}</b>: ${s.start} - ${s.end}\n`;
        }); 
    } else { msg += `🤷‍♂️ <b>Змін немає</b>\n`; }

    if (tasks.length) { msg += `\n📌 <b>Задачі:</b>\n`; tasks.forEach(t => { const time = t.isFullDay ? "Весь день" : `${t.start}-${t.end}`; msg += `🔸 <b>${t.name}</b>: ${t.title} (${time})\n`; }); }

    const offUsers = allUsers.filter(u => !workingNames.includes(u.name));
    if (offUsers.length > 0) {
        msg += `\n😴 <b>Вихідні:</b>\n`;
        const names = offUsers.map(u => { const parts = u.name.split(' '); return parts.length > 1 ? parts[1] : u.name; }).join(', ');
        msg += `${names}\n`;
    }
    msg += `\nGood luck! 🚀`;

    // Send via Bot
    const bot = require('./backend/bot').getBot();
    if(bot) {
        try { await bot.sendMessage(TG_CONFIG.groupId, msg, { parse_mode: 'HTML', message_thread_id: TG_CONFIG.topics.schedule }); } catch (e) {}
        try { const rrp = await User.findOne({ role: 'RRP' }); if (rrp?.telegramChatId) await bot.sendMessage(rrp.telegramChatId, `🔔 <b>Звіт (RRP):</b>\n\n${msg}`, { parse_mode: 'HTML' }); } catch (e) {}
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));