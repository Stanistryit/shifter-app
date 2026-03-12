process.env.NTBA_FIX_350 = 1;
const TelegramBot = require('node-telegram-bot-api');
const commands = require('./commands');
const messages = require('./messages');
const callbacks = require('./callbacks');
const notifications = require('./notifications');

let bot = null;

// Функція для ініціалізації бота на Worker Service (БЕЗ webhook та слухачів)
const initBotClient = (token) => {
    if (!token) return null;
    bot = new TelegramBot(token, { polling: false });
    notifications.setBot(bot);
    console.log("🤖 Telegram Bot Client: Initialized for Worker");
    return bot;
};

const initBot = (token, appUrl) => {
    if (!token) return null;

    bot = new TelegramBot(token, { polling: false });

    // Передаємо інстанс бота в модуль нотифікацій
    notifications.setBot(bot);

    bot.setWebHook(`${appUrl}/bot${token}`)
        .then(() => console.log("🤖 Telegram Bot: Webhook set successfully"))
        .catch(err => console.error("⚠️ Telegram Bot: Webhook connection failed:", err.message));

    const botCommands = [
        { command: '/start', description: '🏠 Головне меню' },
        { command: '/now', description: '👀 Хто зараз на зміні' },
        { command: '/shifts', description: '📋 Мої зміни' },
        { command: '/login', description: '🔐 Авторизація' },
        { command: '/settings', description: '⚙️ Налаштування' },
        { command: '/my_id', description: '🆔 Мій Telegram ID' }
    ];
    bot.setMyCommands(botCommands).catch(e => { });

    // --- РОУТИНГ ПОДІЙ ---

    // Команди
    bot.onText(/\/start(.*)/, (msg, match) => commands.handleStart(bot, msg, match, appUrl));
    bot.onText(/\/login/, (msg) => commands.handleLogin(bot, msg));
    bot.onText(/\/link_store (.+)/, (msg, match) => commands.handleLinkStore(bot, msg, match));
    bot.onText(/\/set_news/, (msg) => commands.handleSetNews(bot, msg));
    bot.onText(/\/set_evening/, (msg) => commands.handleSetEvening(bot, msg));
    bot.onText(/\/set_time (.+)/, (msg, match) => commands.handleSetReportTime(bot, msg, match));
    bot.onText(/\/my_id/, (msg) => bot.sendMessage(msg.chat.id, `Ваш ID: <code>${msg.from.id}</code>`, { parse_mode: 'HTML' }));

    // Повідомлення (меню)
    bot.on('message', (msg) => messages.handleMessage(bot, msg));

    // Колбеки (кнопки)
    bot.on('callback_query', (q) => callbacks.handleCallback(bot, q));

    // Помилки
    bot.on('polling_error', (e) => console.log(`[Polling Error] ${e.message}`));
    bot.on('webhook_error', (e) => console.log(`[Webhook Error] ${e.message}`));
    bot.on('error', (e) => console.log(`[General Bot Error] ${e.message}`));

    return bot;
};

// Експортуємо functions, щоб їх могли використовувати контролери
module.exports = {
    initBot,
    initBotClient,
    notifyUser: notifications.notifyUser,
    notifyAll: notifications.notifyAll,
    sendRequestToSM: notifications.sendRequestToSM,
    getBot: () => bot
};