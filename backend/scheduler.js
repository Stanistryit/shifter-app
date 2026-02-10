const cron = require('node-cron');
const { User, Shift, Task, PendingNotification, Store } = require('./models');
const { getBot, notifyUser } = require('./bot');
const { syncWithGoogleSheets } = require('./utils');

// Конфігурація
const GOOGLE_SHEET_URL = ''; 

const initScheduler = (tgConfig) => {
    console.log("⏰ Scheduler: Initialized");

    // 1. ХВИЛИННИЙ CRON (Тиха година + Черга)
    cron.schedule('* * * * *', async () => {
        const now = new Date(new Date().toLocaleString("en-US", {timeZone: "Europe/Kiev"}));
        const hours = now.getHours();
        
        // Відправка дозволена з 08:00 до 21:59
        if (hours >= 8 && hours < 22) {
            const pending = await PendingNotification.find().sort({ createdAt: 1 });
            if (pending.length > 0) {
                const bot = getBot();
                if (!bot) return;

                console.log(`📨 Scheduler: Sending ${pending.length} pending messages...`);
                for (const p of pending) {
                    try {
                        await bot.sendMessage(p.chatId, p.text, {parse_mode: 'HTML'});
                        await PendingNotification.findByIdAndDelete(p._id);
                        await new Promise(r => setTimeout(r, 100)); 
                    } catch (e) {
                        console.error(`Error sending pending msg: ${e.message}`);
                    }
                }
            }
        }
    });

    // 2. ЩОГОДИННИЙ CRON (Sync + Reminders)
    cron.schedule('0 * * * *', async () => {
        console.log("⏰ Scheduler: Hourly tasks...");
        
        // A. Sync
        if (GOOGLE_SHEET_URL) {
            syncWithGoogleSheets(GOOGLE_SHEET_URL).catch(console.error);
        }

        // B. Reminders Logic
        const now = new Date();
        const uaDate = new Date(new Date().toLocaleString("en-US", {timeZone: "Europe/Kiev"}));
        const currentUAHour = uaDate.getHours();
        const currentUADay = uaDate.toISOString().split('T')[0];
        const tomorrowDate = new Date(Date.now() + 86400000);
        const tomorrowStr = tomorrowDate.toISOString().split('T')[0]; 
        
        // --- Shift Reminders ---
        const shifts = await Shift.find({ date: { $in: [currentUADay, tomorrowStr] } });
        for (const s of shifts) {
            if(s.start === 'Відпустка') continue;
            
            const user = await User.findOne({name: s.name});
            if(!user || !user.reminderTime || user.reminderTime === 'none') continue;

            const [sH, sM] = s.start.split(':').map(Number);
            let shouldNotify = false;
            
            // Fixed Time (tomorrow)
            if (user.reminderTime.includes(':')) {
                const [rH, rM] = user.reminderTime.split(':').map(Number);
                if (s.date > currentUADay && currentUAHour === rH) shouldNotify = true;
            }
            // Relative (today/tomorrow)
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

        // --- Task Reminders ---
        let checkTaskHour = currentUAHour + 1;
        let checkTaskDate = currentUADay;
        if (checkTaskHour === 24) { checkTaskHour = 0; checkTaskDate = tomorrowStr; }

        const tasks = await Task.find({ date: checkTaskDate });
        for (const t of tasks) {
            if (t.isFullDay || !t.start) continue;
            const [tH, tM] = t.start.split(':').map(Number);
            if (tH === checkTaskHour) {
                let msg = `📌 <b>Нагадування про задачу!</b>\n\n📝 ${t.title}\n⏰ Початок: ${t.start}`;
                if (t.description) msg += `\n\nℹ️ <b>Опис:</b> ${t.description}`;
                notifyUser(t.name, msg);
            }
        }
    });

    // 3. ЩОДЕННИЙ БРИФІНГ (20:00 за Києвом / 18:00 UTC)
    // Єдине місце, яке формує звіт!
    cron.schedule('0 18 * * *', async () => {
        console.log("⏰ Scheduler: Daily Briefing (20:00 UA)");
        const bot = getBot();
        if (!bot) return;

        const tomorrow = new Date(); 
        tomorrow.setDate(tomorrow.getDate() + 1);
        const dateStr = tomorrow.toISOString().split('T')[0];
        const display = tomorrow.toLocaleDateString('uk-UA', { weekday: 'long', day: 'numeric', month: 'long' });

        // Отримуємо всі магазини
        const stores = await Store.find();

        for (const store of stores) {
            if (!store.telegram.chatId) continue;

            // 🔥 ВИПРАВЛЕНО: Виключаємо тільки RRP. Admin (якщо він прив'язаний до стору) тепер потрапляє у вибірку.
            const storeUsers = await User.find({ storeId: store._id, role: { $ne: 'RRP' } });
            const userNames = storeUsers.map(u => u.name);

            // Отримуємо зміни та задачі тільки для цього магазину
            const shifts = await Shift.find({ date: dateStr, name: { $in: userNames } }).sort({ start: 1 });
            const tasks = await Task.find({ date: dateStr, name: { $in: userNames } });

            // Формуємо красиве повідомлення
            let msg = `🌙 <b>План на завтра (${display}):</b>\n\n`;

            const workingShifts = [];
            const vacationShifts = [];
            const scheduledNames = [];

            shifts.forEach(s => {
                scheduledNames.push(s.name);
                if (s.start === 'Відпустка') vacationShifts.push(s);
                else workingShifts.push(s);
            });

            // 1. На зміні
            if (workingShifts.length > 0) {
                msg += `👷‍♂️ <b>На зміні:</b>\n`;
                workingShifts.forEach(s => msg += `🔹 <b>${s.name}</b>: ${s.start} - ${s.end}\n`);
            } else if (vacationShifts.length === 0) {
                msg += `🤷‍♂️ <b>Змін немає</b>\n`;
            }

            // 2. Відпустка
            if (vacationShifts.length > 0) {
                msg += `\n🌴 <b>Відпустка:</b>\n`;
                vacationShifts.forEach(s => msg += `🔸 <b>${s.name}</b>\n`);
            }

            // 3. Задачі
            if (tasks.length) { 
                msg += `\n📌 <b>Задачі:</b>\n`; 
                tasks.forEach(t => { 
                    const time = t.isFullDay ? "Весь день" : `${t.start}-${t.end}`; 
                    msg += `▫️ <b>${t.name}</b>: ${t.title} (${time})\n`; 
                }); 
            }

            // 4. Вихідні
            const offUsers = storeUsers.filter(u => !scheduledNames.includes(u.name));
            if (offUsers.length > 0) { 
                msg += `\n😴 <b>Вихідні:</b>\n`; 
                const names = offUsers.map(u => { 
                    const parts = u.name.split(' '); 
                    return `🏠 ${parts.length > 1 ? parts[1] : parts[0]}`; 
                }).join('\n'); 
                msg += `${names}\n`; 
            }

            msg += `\nGood luck! 🚀`;

            // Відправка
            try {
                const opts = { parse_mode: 'HTML' };
                if (store.telegram.eveningTopicId) opts.message_thread_id = store.telegram.eveningTopicId;
                
                await bot.sendMessage(store.telegram.chatId, msg, opts);
                console.log(`✅ Вечірній звіт відправлено для ${store.name}`);
            } catch (e) {
                console.error(`❌ Помилка звіту для ${store.name}:`, e.message);
            }
        }
    });
};

module.exports = { initScheduler };