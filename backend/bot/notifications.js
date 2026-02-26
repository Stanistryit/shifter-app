const { User, Store, PendingNotification } = require('../models');

let botInstance = null;

const setBot = (bot) => { botInstance = bot; };

// Логіка "Тихих годин"
const sendMessageWithQuietHours = async (chatId, text, options = {}) => {
    if (!botInstance) return;
    const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Kiev" }));
    const hours = now.getHours();

    // Тиха година: з 22:00 до 08:00
    const isQuietHour = hours >= 22 || hours < 8;

    // Якщо це тиха година і немає явної вказівки "ігнорувати",
    // відправляємо повідомлення "Без звуку" (disable_notification: true)
    if (isQuietHour && !options.ignoreQuietHours) {
        options.disable_notification = true;
    }

    try {
        await botInstance.sendMessage(chatId, text, options);
    } catch (e) {
        console.error(`Error sending message to ${chatId}:`, e.message);
    }
};

// 🔥 ОНОВЛЕНО: Тепер приймає options для кнопок
const notifyUser = async (name, msg, options = {}) => {
    if (!botInstance) return;
    try {
        const u = await User.findOne({ name });
        // Об'єднуємо дефолтні налаштування з переданими
        const finalOptions = { parse_mode: 'HTML', ...options };

        if (u?.telegramChatId) {
            await sendMessageWithQuietHours(u.telegramChatId, msg, finalOptions);
        }
    } catch (e) {
        console.error("NotifyUser Error:", e.message);
    }
};

// Сповіщення в новини магазинів
const notifyAll = async (msg) => {
    if (!botInstance) return;
    try {
        const stores = await Store.find({ 'telegram.chatId': { $ne: null } });
        for (const store of stores) {
            const opts = { parse_mode: 'HTML' };
            if (store.telegram.newsTopicId) opts.message_thread_id = store.telegram.newsTopicId;
            await sendMessageWithQuietHours(store.telegram.chatId, msg, opts);
        }
    } catch (e) { }
};

// ВІДПРАВКА ЗАПИТУ SM
const sendRequestToSM = async (requestDoc) => {
    if (!botInstance) return;
    try {
        let storeId = null;
        if (requestDoc.data && requestDoc.data.storeId) {
            storeId = requestDoc.data.storeId;
        } else {
            const creator = await User.findOne({ name: requestDoc.createdBy });
            if (creator) storeId = creator.storeId;
        }

        if (!storeId) return console.log("⚠️ Магазин не визначено для запиту");

        const smUser = await User.findOne({ storeId: storeId, role: 'SM' });

        if (!smUser || !smUser.telegramChatId) return console.log(`⚠️ SM не знайдено або немає ID (Store: ${storeId})`);

        let details = "";
        let typeIcon = "🔔";

        if (requestDoc.type === 'add_shift') {
            typeIcon = "➕";
            if (requestDoc.data.start === 'Лікарняний') {
                details = `📅 <b>Дата:</b> ${requestDoc.data.date}\n💊 <b>Статус:</b> Лікарняний`;
            } else if (requestDoc.data.start === 'Відпустка') {
                details = `📅 <b>Дата:</b> ${requestDoc.data.date}\n🌴 <b>Статус:</b> Відпустка`;
            } else {
                details = `📅 <b>Зміна:</b> ${requestDoc.data.date}\n⏰ <b>Час:</b> ${requestDoc.data.start} - ${requestDoc.data.end}`;
            }
        }
        if (requestDoc.type === 'del_shift') {
            typeIcon = "🗑";
            details = `❌ <b>Видалення зміни:</b> ${requestDoc.data.date}`;
        }
        if (requestDoc.type === 'add_task') {
            typeIcon = "📌";
            details = `📝 <b>Задача:</b> ${requestDoc.data.title}`;
            if (requestDoc.data.description) details += `\nℹ️ ${requestDoc.data.description}`;
        }

        const txt = `${typeIcon} <b>Новий запит</b>\n\n👤 <b>Від:</b> ${requestDoc.createdBy}\n${details}`;

        const opts = {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: "✅ Підтвердити", callback_data: `approve_req_${requestDoc._id}` },
                        { text: "⛔️ Відхилити", callback_data: `reject_req_${requestDoc._id}` }
                    ]
                ]
            }
        };

        await sendMessageWithQuietHours(smUser.telegramChatId, txt, opts);

    } catch (e) {
        console.error("Error sending request to SM:", e.message);
    }
};

module.exports = { setBot, notifyUser, notifyAll, sendRequestToSM };