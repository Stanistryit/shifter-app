const Agenda = require('agenda');
const { User, Shift, Task, PendingNotification, Store } = require('./models');
const { getBot, notifyUser } = require('./bot');
const { syncWithGoogleSheets } = require('./utils');

// Конфігурація
const GOOGLE_SHEET_URL = '';

let agenda;

const initScheduler = async (tgConfig) => {
    console.log("⏰ Scheduler: Initializing with Agenda...");

    agenda = new Agenda({ db: { address: process.env.MONGO_URI, collection: 'agendaJobs' } });

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
        const stores = await Store.find({ 'telegram.reportTime': timeString });

        if (stores.length > 0) {
            console.log(`⏰ Sending reports for ${stores.length} stores at ${timeString}`);
            await sendDailyReports(stores);
        }
    });

    // 2. ЩОГОДИННИЙ JOB (Sync + Reminders)
    agenda.define('hourly-jobs', async (job) => {
        if (GOOGLE_SHEET_URL) syncWithGoogleSheets(GOOGLE_SHEET_URL).catch(console.error);

        const uaDate = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Kiev" }));
        const currentUAHour = uaDate.getHours();
        const currentUADay = uaDate.toISOString().split('T')[0];
        const tomorrowDate = new Date(Date.now() + 86400000);
        const tomorrowStr = tomorrowDate.toISOString().split('T')[0];

        // Shift Reminders
        const shifts = await Shift.find({ date: { $in: [currentUADay, tomorrowStr] } });
        for (const s of shifts) {
            if (s.start === 'Відпустка') continue;
            const user = await User.findOne({ name: s.name });
            if (!user || !user.reminderTime || user.reminderTime === 'none') continue;

            const [sH, sM] = s.start.split(':').map(Number);
            let shouldNotify = false;

            if (user.reminderTime.includes(':')) {
                const [rH, rM] = user.reminderTime.split(':').map(Number);
                if (s.date > currentUADay && currentUAHour === rH) shouldNotify = true;
            }
            else if (s.date === currentUADay) {
                if (user.reminderTime === 'start' && currentUAHour === sH) shouldNotify = true;
                if (user.reminderTime === '1h' && currentUAHour === (sH - 1)) shouldNotify = true;
            }
            else if (s.date > currentUADay) {
                if (user.reminderTime === '12h' && currentUAHour === (sH + 12)) shouldNotify = true;
            }

            if (shouldNotify) notifyUser(s.name, `🔔 <b>Нагадування!</b>\n\nВ тебе зміна: <b>${s.date}</b>\n⏰ Час: <b>${s.start} - ${s.end}</b>`);
        }

        // Task Reminders
        let checkTaskHour = currentUAHour + 1;
        let checkTaskDate = currentUADay;
        if (checkTaskHour === 24) { checkTaskHour = 0; checkTaskDate = tomorrowStr; }

        const tasks = await Task.find({ date: checkTaskDate });
        for (const t of tasks) {
            if (t.isFullDay || !t.start) continue;
            const [tH, tM] = t.start.split(':').map(Number);
            if (tH === checkTaskHour) notifyUser(t.name, `📌 <b>Нагадування про задачу!</b>\n\n📝 ${t.title}\n⏰ Початок: ${t.start}`);
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

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().split('T')[0];
    const display = tomorrow.toLocaleDateString('uk-UA', { weekday: 'long', day: 'numeric', month: 'long' });

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