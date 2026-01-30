require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const path = require('path');
const cron = require('node-cron');

// 1. Додали getBot в імпорт
const { initBot, notifyUser, getBot } = require('./backend/bot'); 
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
app.set('tgConfig', TG_CONFIG); 
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

// Routes API
app.use('/api', routes);

// 2. ВАЖЛИВО: Маршрут для Webhook Телеграма
app.post(`/bot${process.env.TELEGRAM_TOKEN}`, (req, res) => {
    const bot = getBot();
    if (bot) {
        bot.processUpdate(req.body);
    }
    res.sendStatus(200);
});

// Database & Bot Init
mongoose.connect(process.env.MONGO_URI)
    .then(() => { 
        console.log("✅ MongoDB OK"); 
        initDB(); 
        initBot(process.env.TELEGRAM_TOKEN, 'https://shifter-app.onrender.com', TG_CONFIG);
    })
    .catch(console.error);

// Cron Jobs
const GOOGLE_SHEET_URL = '';
cron.schedule('0 * * * *', () => syncWithGoogleSheets(GOOGLE_SHEET_URL));

// DAILY BRIEFING (18:00)
cron.schedule('0 18 * * *', async () => {
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().split('T')[0];
    const display = tomorrow.toLocaleDateString('uk-UA', { weekday: 'long', day: 'numeric', month: 'long' });
    
    const shifts = await Shift.find({ date: dateStr }).sort({ start: 1 });
    const tasks = await Task.find({ date: dateStr });
    const allUsers = await User.find({ role: { $nin: ['admin', 'RRP'] } });
    
    let msg = `🌙 <b>План на завтра (${display}):</b>\n\n`;
    
    // Розділяємо зміни на робочі та відпустки
    const workingShifts = [];
    const vacationShifts = [];
    const scheduledNames = []; // Список всіх, хто є в графіку (робота + відпустка)

    shifts.forEach(s => {
        scheduledNames.push(s.name);
        if (s.start === 'Відпустка') {
            vacationShifts.push(s);
        } else {
            workingShifts.push(s);
        }
    });

    // 1. Блок "На зміні"
    if (workingShifts.length > 0) {
        msg += `👷‍♂️ <b>На зміні:</b>\n`;
        workingShifts.forEach(s => {
            msg += `🔹 <b>${s.name}</b>: ${s.start} - ${s.end}\n`;
        });
    } else {
        // Пишемо "Змін немає" тільки якщо і відпусток немає, або можна залишити як є
        if (vacationShifts.length === 0) msg += `🤷‍♂️ <b>Змін немає</b>\n`;
    }

    // 2. Блок "Відпустка" (ОКРЕМО)
    if (vacationShifts.length > 0) {
        msg += `\n🌴 <b>Відпустка:</b>\n`;
        vacationShifts.forEach(s => {
            msg += `🔸 <b>${s.name}</b>\n`;
        });
    }

    // 3. Блок "Задачі"
    if (tasks.length) { 
        msg += `\n📌 <b>Задачі:</b>\n`; 
        tasks.forEach(t => { 
            const time = t.isFullDay ? "Весь день" : `${t.start}-${t.end}`; 
            msg += `▫️ <b>${t.name}</b>: ${t.title} (${time})\n`; 
        }); 
    }

    // 4. Блок "Вихідні"
    const offUsers = allUsers.filter(u => !scheduledNames.includes(u.name));
    if (offUsers.length > 0) { 
        msg += `\n😴 <b>Вихідні:</b>\n`; 
        const names = offUsers.map(u => { 
            const parts = u.name.split(' '); 
            const shortName = parts.length > 1 ? parts[1] : parts[0];
            return `🏠 ${shortName}`; 
        }).join('\n'); 
        msg += `${names}\n`; 
    }

    msg += `\nGood luck! 🚀`;

    const bot = getBot(); 
    if(bot) {
        try { await bot.sendMessage(TG_CONFIG.groupId, msg, { parse_mode: 'HTML', message_thread_id: TG_CONFIG.topics.schedule }); } catch (e) {}
        try { const rrp = await User.findOne({ role: 'RRP' }); if (rrp?.telegramChatId) await bot.sendMessage(rrp.telegramChatId, `🔔 <b>Звіт (RRP):</b>\n\n${msg}`, { parse_mode: 'HTML' }); } catch (e) {}
    }
});

// HOURLY REMINDERS (Shift + Task)
cron.schedule('0 * * * *', async () => {
    const now = new Date();
    // Use UA time for checks
    const uaDate = new Date(new Date().toLocaleString("en-US", {timeZone: "Europe/Kiev"}));
    const currentUAHour = uaDate.getHours();
    const currentUADay = uaDate.toISOString().split('T')[0];
    
    // We get ALL shifts for today and tomorrow
    const tomorrowDate = new Date(Date.now() + 86400000);
    const tomorrowStr = tomorrowDate.toISOString().split('T')[0]; 
    
    // --- 1. SHIFT REMINDERS ---
    const shifts = await Shift.find({ date: { $in: [currentUADay, tomorrowStr] } });
    
    for (const s of shifts) {
        if(s.start === 'Відпустка') continue;
        
        const user = await User.findOne({name: s.name});
        if(!user || !user.reminderTime || user.reminderTime === 'none') continue;

        const [sH, sM] = s.start.split(':').map(Number);
        let shouldNotify = false;
        
        // 1. Fixed Time (e.g. 20:00) - Only for tomorrow shifts
        if (user.reminderTime.includes(':')) {
            const [rH, rM] = user.reminderTime.split(':').map(Number);
            if (s.date > currentUADay && currentUAHour === rH) shouldNotify = true;
        }
        // 2. Relative (1h, 12h, start)
        else if (s.date === currentUADay) {
            if (user.reminderTime === 'start' && currentUAHour === sH) shouldNotify = true;
            if (user.reminderTime === '1h' && currentUAHour === (sH - 1)) shouldNotify = true;
        }
        else if (s.date > currentUADay) {
             if (user.reminderTime === '12h' && currentUAHour === (sH + 12)) shouldNotify = true; 
        }

        if (shouldNotify) {
            notifyUser(s.name, `🔔 <b>Нагадування!</b>\n\nВ тебе зміна: <b>${s.date}</b>\n⏰ Час: <b>${s.start} - ${s.end}</b>`);
        }
    }

    // --- 2. TASK REMINDERS (За 1 годину) ---
    // Визначаємо "наступну годину" для перевірки
    let checkTaskHour = currentUAHour + 1;
    let checkTaskDate = currentUADay;
    
    // Перехід через північ (якщо зараз 23:00, перевіряємо задачі на 00:00 завтра)
    if (checkTaskHour === 24) {
        checkTaskHour = 0;
        checkTaskDate = tomorrowStr;
    }

    const tasks = await Task.find({ date: checkTaskDate });

    for (const t of tasks) {
        if (t.isFullDay || !t.start) continue;

        const [tH, tM] = t.start.split(':').map(Number);
        
        // Якщо задача стартує в наступній годині
        if (tH === checkTaskHour) {
            // ОНОВЛЕНО: Додаємо опис до нагадування
            let msg = `📌 <b>Нагадування про задачу!</b>\n\n📝 ${t.title}\n⏰ Початок: ${t.start}`;
            if (t.description) msg += `\n\nℹ️ <b>Опис:</b> ${t.description}`;
            
            notifyUser(t.name, msg);
        }
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));