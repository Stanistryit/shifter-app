const Agenda = require('agenda');
const { User, Shift, Task, PendingNotification, Store } = require('./models');
const { getBot, notifyUser } = require('./bot');

// Видалили глобальну константу GOOGLE_SHEET_URL

let agenda;

const initScheduler = async (tgConfig) => {
    console.log("⏰ Scheduler: Initializing with Agenda...");

    agenda = new Agenda({ db: { address: process.env.MONGO_URI, collection: 'agendaJobs' } });

    // --- LOGGING LIFECYCLE FOR AGENDA ---
    agenda.on('ready', () => console.log('✅ Agenda successfully connected to MongoDB!'));
    agenda.on('error', (err) => console.error('❌ Agenda connection error:', err));

    agenda.on('start', (job) => {
        console.log(`▶️ Job starting: ${job.attrs.name}`);
    });

    agenda.on('complete', (job) => {
        console.log(`✅ Job finished: ${job.attrs.name}`);
    });

    agenda.on('fail', (err, job) => {
        console.error(`❌ Job failed: ${job.attrs.name}. Error: ${err.message}`);
    });
    // ------------------------------------

    // 1. ХВИЛИННИЙ JOB (Тиха година + 🔥 ВЕЧІРНІ ЗВІТИ)
    agenda.define('minute-jobs', async (job) => {
        const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Kiev" }));
        const hours = now.getHours();
        const minutes = now.getMinutes();

        // Форматуємо поточний час (наприклад "20:00")
        const timeString = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;

        // --- A. Тиха година (Черга) ---
        // Відправка черги дозволена з 08:00 до 21:59
        if (hours >= 8 && hours < 22) {
            const pending = await PendingNotification.find().sort({ createdAt: 1 });
            if (pending.length > 0) {
                const bot = getBot();
                if (bot) {
                    for (const p of pending) {
                        try {
                            await bot.sendMessage(p.chatId, p.text, { parse_mode: 'HTML' });
                            await PendingNotification.findByIdAndDelete(p._id);
                            await new Promise(r => setTimeout(r, 100));
                        } catch (e) { console.error(e.message); }
                    }
                }
            }
        }

        // --- B. 🔥 ПЕРСОНАЛІЗОВАНИЙ ВЕЧІРНІЙ ЗВІТ ---
        // Шукаємо магазини, у яких reportTime співпадає з поточною хвилиною
        const storeQuery = {
            $or: [
                { 'telegram.reportTime': timeString }
            ]
        };
        // Для старих магазинів без вказаного часу розсилка йде о 20:00 по замовчуванню
        if (timeString === '20:00') {
            storeQuery.$or.push({ 'telegram.reportTime': { $exists: false } });
            storeQuery.$or.push({ telegram: { $exists: false } });
        }

        const stores = await Store.find(storeQuery);

        if (stores.length > 0) {
            console.log(`⏰ Sending reports for ${stores.length} stores at ${timeString}`);
            await sendDailyReports(stores);
        }

        // --- C. TODO REMINDERS ---
        const todoTasks = await Task.find({ type: 'todo', status: 'pending', deadline: { $ne: '' } });
        for (const t of todoTasks) {
            if (!t.reminders || t.reminders.length === 0) continue;
            
            const deadlineTime = new Date(t.deadline).getTime();
            if (isNaN(deadlineTime)) continue;

            const nowTime = now.getTime();
            const diffMinutes = Math.floor((deadlineTime - nowTime) / 60000);

            for (const r of t.reminders) {
                if (t.notifiedReminders && t.notifiedReminders.includes(r)) continue;

                let reminderMinutes = 0;
                if (r === '1h') reminderMinutes = 60;
                if (r === '3h') reminderMinutes = 180;
                if (r === '1d') reminderMinutes = 1440;
                if (r === '1w') reminderMinutes = 10080;

                if (reminderMinutes > 0 && diffMinutes <= reminderMinutes && diffMinutes >= 0) {
                    const user = await User.findOne({ name: t.name });
                    if (user) {
                        notifyUser(t.name, `⏳ <b>Нагадування!</b>\n\nДедлайн задачі <b>${t.title}</b> вже скоро: ${t.deadline}`);
                    }
                    if (!t.notifiedReminders) t.notifiedReminders = [];
                    t.notifiedReminders.push(r);
                    await t.save();
                }
            }
        }
    });

    // 2. ЩОГОДИННИЙ JOB (Reminders)
    agenda.define('hourly-jobs', async (job) => {
        const uaDate = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Kiev" }));
        const currentUAHour = uaDate.getHours();

        const yToday = uaDate.getFullYear();
        const mToday = String(uaDate.getMonth() + 1).padStart(2, '0');
        const dToday = String(uaDate.getDate()).padStart(2, '0');
        const currentUADay = `${yToday}-${mToday}-${dToday}`;

        const tomorrowDate = new Date(uaDate);
        tomorrowDate.setDate(tomorrowDate.getDate() + 1);
        const yTom = tomorrowDate.getFullYear();
        const mTom = String(tomorrowDate.getMonth() + 1).padStart(2, '0');
        const dTom = String(tomorrowDate.getDate()).padStart(2, '0');
        const tomorrowStr = `${yTom}-${mTom}-${dTom}`;

        // Shift Reminders
        const shifts = await Shift.find({ date: { $in: [currentUADay, tomorrowStr] } });
        for (const s of shifts) {
            if (s.start === 'Відпустка') continue;
            const user = await User.findOne({ name: s.name });
            if (!user || !user.reminderTime || user.reminderTime === 'none') continue;

            const [sH, sM] = s.start.split(':').map(Number);
            let shouldNotify = false;

            let hoursUntilShift = -1;
            if (s.date === tomorrowStr) {
                hoursUntilShift = (24 - currentUAHour) + sH;
            } else if (s.date === currentUADay) {
                hoursUntilShift = sH - currentUAHour;
            }

            if (user.reminderTime.includes(':')) {
                const [rH, rM] = user.reminderTime.split(':').map(Number);
                if (s.date === tomorrowStr && currentUAHour === rH) shouldNotify = true;
            } else if (user.reminderTime === 'start' && hoursUntilShift === 0) {
                shouldNotify = true;
            } else if (user.reminderTime === '1h' && hoursUntilShift === 1) {
                shouldNotify = true;
            } else if (user.reminderTime === '12h' && hoursUntilShift === 12) {
                shouldNotify = true;
            }

            if (shouldNotify) {
                const opts = {
                    ignoreQuietHours: true,
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "📋 Мої зміни", callback_data: "menu_my_shifts" }, { text: "🌴 Мої віхідні", callback_data: "menu_my_weekends" }],
                            [{ text: "👀 Зараз на зміні", callback_data: "menu_who_is_working" }, { text: "⚙️ Налаштування", callback_data: "menu_settings" }]
                        ]
                    }
                };
                const pref = user.notificationPreference || 'telegram';

                if (pref === 'telegram' || pref === 'both') {
                    notifyUser(s.name, `🔔 <b>Нагадування!</b>\n\nВ тебе зміна: <b>${s.date}</b>\n⏰ Час: <b>${s.start} - ${s.end}</b>`, opts);
                }

                // ВЕБ-ПУШ
                if ((pref === 'push' || pref === 'both') && user.pushSubscriptions && user.pushSubscriptions.length > 0) {
                    try {
                        const pushController = require('./controllers/pushController');
                        pushController.sendPushToUser(user, {
                            title: '🔔 Нагадування про зміну!',
                            body: `Зміна: ${s.date}\nЧас: ${s.start} - ${s.end}`,
                            url: '/'
                        });
                    } catch (e) {
                        console.error('Push error:', e);
                    }
                }
            }
        }

        // Task Reminders
        let checkTaskHour = currentUAHour + 1;
        let checkTaskDate = currentUADay;
        if (checkTaskHour === 24) { checkTaskHour = 0; checkTaskDate = tomorrowStr; }

        const tasks = await Task.find({ date: checkTaskDate });
        for (const t of tasks) {
            if (t.isFullDay || !t.start) continue;
            const [tH, tM] = t.start.split(':').map(Number);
            if (tH === checkTaskHour) {
                const opts = {
                    ignoreQuietHours: true,
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "📋 Мої зміни", callback_data: "menu_my_shifts" }, { text: "🌴 Мої віхідні", callback_data: "menu_my_weekends" }],
                            [{ text: "👀 Зараз на зміні", callback_data: "menu_who_is_working" }, { text: "⚙️ Налаштування", callback_data: "menu_settings" }]
                        ]
                    }
                };
                const user = await User.findOne({ name: t.name });
                const pref = user ? (user.notificationPreference || 'telegram') : 'telegram';

                if (pref === 'telegram' || pref === 'both') {
                    notifyUser(t.name, `📌 <b>Нагадування про задачу!</b>\n\n📝 ${t.title}\n⏰ Початок: ${t.start}`, opts);
                }

                // ВЕБ-ПУШ
                if ((pref === 'push' || pref === 'both') && user && user.pushSubscriptions && user.pushSubscriptions.length > 0) {
                    try {
                        const pushController = require('./controllers/pushController');
                        pushController.sendPushToUser(user, {
                            title: '📌 Нагадування про задачу!',
                            body: `${t.title}\nПочаток: ${t.start}`,
                            url: '/'
                        });
                    } catch (e) {
                        console.error('Push error:', e);
                    }
                }
            }
        }
    });

    await agenda.start();
    await agenda.every('* * * * *', 'minute-jobs');
    await agenda.every('0 * * * *', 'hourly-jobs');
    console.log("⏰ Agenda Started and Jobs Scheduled");

    // Граційне завершення роботи
    const graceful = async () => {
        await agenda.stop();
        process.exit(0);
    };

    process.on('SIGTERM', graceful);
    process.on('SIGINT', graceful);
};

// 🔥 Функція розсилки (викликається коли настав час магазину)
async function sendDailyReports(stores) {
    const bot = getBot();
    if (!bot) return;

    const tomorrow = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Kiev" }));
    tomorrow.setDate(tomorrow.getDate() + 1);

    const y = tomorrow.getFullYear();
    const m = String(tomorrow.getMonth() + 1).padStart(2, '0');
    const d = String(tomorrow.getDate()).padStart(2, '0');
    const dateStr = `${y}-${m}-${d}`;

    const display = tomorrow.toLocaleDateString('uk-UA', { timeZone: 'Europe/Kiev', weekday: 'long', day: 'numeric', month: 'long' });

    for (const store of stores) {
        if (!store.telegram.chatId) continue;

        const storeUsers = await User.find({ storeId: store._id, role: { $ne: 'RRP' } });
        const userNames = storeUsers.map(u => u.name);

        const shifts = await Shift.find({ date: dateStr, name: { $in: userNames } }).sort({ start: 1 });
        const tasks = await Task.find({ date: dateStr, name: { $in: userNames } });

        let msg = `🌙 <b>План на завтра (${display}):</b>\n\n`;

        const workingShifts = [];
        const vacationShifts = [];
        const scheduledNames = [];

        shifts.forEach(s => {
            scheduledNames.push(s.name);
            if (s.start === 'Відпустка') vacationShifts.push(s);
            else workingShifts.push(s);
        });

        if (workingShifts.length > 0) {
            msg += `👷‍♂️ <b>На зміні:</b>\n`;
            workingShifts.forEach(s => msg += `🔹 <b>${s.name}</b>: ${s.start} - ${s.end}\n`);
        } else if (vacationShifts.length === 0) {
            msg += `🤷‍♂️ <b>Змін немає</b>\n`;
        }

        if (vacationShifts.length > 0) {
            msg += `\n🌴 <b>Відпустка:</b>\n`;
            vacationShifts.forEach(s => msg += `🔸 <b>${s.name}</b>\n`);
        }

        if (tasks.length) {
            msg += `\n📌 <b>Задачі:</b>\n`;
            tasks.forEach(t => {
                const time = t.isFullDay ? "Весь день" : `${t.start}-${t.end}`;
                msg += `▫️ <b>${t.name}</b>: ${t.title} (${time})\n`;
            });
        }

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

        try {
            const opts = { parse_mode: 'HTML' };
            if (store.telegram.eveningTopicId) opts.message_thread_id = store.telegram.eveningTopicId;

            await bot.sendMessage(store.telegram.chatId, msg, opts);
            console.log(`✅ Вечірній звіт відправлено для ${store.name}`);
        } catch (e) {
            console.error(`❌ Помилка звіту для ${store.name}:`, e.message);
        }
    }
}

module.exports = { initScheduler };