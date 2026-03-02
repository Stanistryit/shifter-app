const { User, Store } = require('../models');

// Головне меню
const handleStart = async (bot, msg, appUrl) => {
    // Встановлюємо кнопку меню (зліва від вводу тексту)
    try {
        await bot.setChatMenuButton({
            chat_id: msg.chat.id,
            menu_button: JSON.stringify({
                type: 'web_app',
                text: 'Графік',
                web_app: { url: appUrl }
            })
        });
    } catch (e) {
        console.error("Помилка встановлення MenuButton:", e.message);
    }

    const { User } = require('../models');
    // Check if user is registered to tailor the onboarding
    const user = await User.findOne({ telegramChatId: msg.chat.id });

    if (user) {
        const inlineMenuAuth = {
            inline_keyboard: [
                [{ text: "📋 Мої зміни", callback_data: "menu_my_shifts" }, { text: "🌴 Мої віхідні", callback_data: "menu_my_weekends" }],
                [{ text: "👀 Зараз на зміні", callback_data: "menu_who_is_working" }, { text: "⚙️ Налаштування", callback_data: "menu_settings" }],
                [{ text: "📅 Відкрити Графік", web_app: { url: appUrl } }]
            ]
        };
        const txtAuth = `👋 <b>Привіт, ${user.name}!</b>\n\nТвій акаунт синхронізовано.\n⬇️ Використовуй меню нижче для швидкого доступу або кнопку <b>Графік</b> зліва внизу для повноцінної роботи.`;
        bot.sendMessage(msg.chat.id, txtAuth, { reply_markup: inlineMenuAuth, parse_mode: 'HTML' });
    } else {
        const txtNew = `👋 <b>Привіт! Це бот Shifter.</b>\n\nДля початку роботи тобі потрібно авторизуватись у системі.\n\n👇 <b>Натисни кнопку "Графік"</b> зліва від поля вводу (як показано на фото), щоб відкрити додаток та увійти (або зареєструватись). Після входу бот автоматично прив'яжеться до твого профілю!`;
        const fs = require('fs');
        const photoPath = require('path').join(__dirname, '../../public/assets/onboarding_guide.png');

        const inlineMenuNew = {
            inline_keyboard: [
                [{ text: "📅 Відкрити Додаток", web_app: { url: appUrl } }]
            ]
        };

        if (fs.existsSync(photoPath)) {
            bot.sendPhoto(msg.chat.id, photoPath, { caption: txtNew, parse_mode: 'HTML', reply_markup: inlineMenuNew });
        } else {
            bot.sendMessage(msg.chat.id, txtNew, { parse_mode: 'HTML', reply_markup: inlineMenuNew });
        }
    }
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