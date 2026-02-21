const { User, Store } = require('../models');

// Головне меню
const handleStart = (bot, msg, appUrl) => {
    const mainMenu = {
        keyboard: [
            [{ text: "📅 Відкрити Графік", web_app: { url: appUrl } }],
            [{ text: "📋 Мої зміни" }, { text: "🌴 Мої віхідні" }],
            [{ text: "👀 Зараз на зміні" }, { text: "⚙️ Налаштування" }]
        ],
        resize_keyboard: true
    };
    const txt = `👋 <b>Привіт! Це бот Shifter.</b>\n\nТут ти можеш:\n📅 Дивитись графік роботи\n👀 Бачити, хто зараз працює\n🔔 Отримувати нагадування про зміни\n\n🔐 <b>Авторизація:</b>\nНатисни кнопку <b>"📅 Відкрити Графік"</b> вище та увійди в додаток. Твій акаунт буде автоматично прив'язано до Telegram.`;
    bot.sendMessage(msg.chat.id, txt, { reply_markup: mainMenu, parse_mode: 'HTML' });
};

// Авторизація 
const handleLogin = async (bot, msg) => {
    const txt = `💡 <b>Більше не потрібно вводити пароль в чаті!</b>\n\nДля авторизації просто натисни кнопку <b>"📅 Відкрити Графік"</b> в меню та увійди зі своїм логіном і паролем прямо в додатку.\n\nПісля входу твій Telegram буде автоматично прив'язано до акаунту! 🔐`;
    bot.sendMessage(msg.chat.id, txt, { parse_mode: 'HTML' });
};

// Прив'язка магазину
const handleLinkStore = async (bot, msg, match) => {
    const code = match[1].trim();
    const chatId = msg.chat.id;
    try {
        const store = await Store.findOne({ code });
        if (!store) return bot.sendMessage(chatId, `❌ Магазин з кодом <b>${code}</b> не знайдено.`, { parse_mode: 'HTML' });

        store.telegram.chatId = chatId;
        await store.save();
        bot.sendMessage(chatId, `✅ <b>Чат прив'язано до магазину: ${store.name}</b>\n\nТепер зайдіть у відповідні гілки (Topics) і напишіть:\n/set_news — для новин\n/set_evening — для звітів`, { parse_mode: 'HTML' });
    } catch (e) { console.error(e); }
};

// Топік новин
const handleSetNews = async (bot, msg) => {
    const chatId = msg.chat.id;
    const threadId = msg.message_thread_id;
    const store = await Store.findOne({ 'telegram.chatId': chatId });
    if (!store) return bot.sendMessage(chatId, '❌ Спочатку прив\'яжіть магазин командою /link_store КОД', { message_thread_id: threadId });

    store.telegram.newsTopicId = threadId;
    await store.save();
    bot.sendMessage(chatId, `📢 Цей топік встановлено для <b>Новин</b>.`, { parse_mode: 'HTML', message_thread_id: threadId });
};

// Топік звітів
const handleSetEvening = async (bot, msg) => {
    const chatId = msg.chat.id;
    const threadId = msg.message_thread_id;
    const store = await Store.findOne({ 'telegram.chatId': chatId });
    if (!store) return bot.sendMessage(chatId, '❌ Спочатку прив\'яжіть магазин командою /link_store КОД', { message_thread_id: threadId });

    store.telegram.eveningTopicId = threadId;
    await store.save();
    bot.sendMessage(chatId, `🌙 Цей топік встановлено для <b>Звітів</b>.`, { parse_mode: 'HTML', message_thread_id: threadId });
};

// Час звіту
const handleSetReportTime = async (bot, msg, match) => {
    const chatId = msg.chat.id;
    const timeStr = match[1].trim();
    const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
    if (!timeRegex.test(timeStr)) return bot.sendMessage(chatId, "⚠️ Формат: ГГ:ХХ (напр. 21:30)");

    const user = await User.findOne({ telegramChatId: chatId });
    if (!user || (user.role !== 'SM' && user.role !== 'admin')) return bot.sendMessage(chatId, "⛔️ Тільки SM/Admin");
    if (!user.storeId) return bot.sendMessage(chatId, "❌ Немає магазину");

    try {
        const store = await Store.findById(user.storeId);
        store.telegram.reportTime = timeStr;
        await store.save();
        bot.sendMessage(chatId, `✅ Час звіту: <b>${timeStr}</b>`, { parse_mode: 'HTML' });
    } catch (e) { bot.sendMessage(chatId, "❌ Помилка"); }
};

module.exports = { handleStart, handleLogin, handleLinkStore, handleSetNews, handleSetEvening, handleSetReportTime };