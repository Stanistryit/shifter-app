const { User, Shift } = require('../models');

// Винесено в окремі функції для повторного використання (з /commands та callback_query)
const handleMyShifts = async (bot, chatId, user, messageId = null) => {
    const today = new Date().toISOString().split('T')[0];
    const shifts = await Shift.find({ name: user.name, date: { $gte: today } }).sort({ date: 1 }).limit(10);

    if (!shifts.length) {
        const txt = "🎉 Змін немає!";
        const opts = { reply_markup: { inline_keyboard: [[{ text: '🔙 Назад у меню', callback_data: 'menu_back' }]] } };
        return messageId ? bot.editMessageText(txt, { chat_id: chatId, message_id: messageId, ...opts }) : bot.sendMessage(chatId, txt, opts);
    }

    let r = `📋 <b>Твої зміни:</b>\n<blockquote expandable>`;
    shifts.forEach(s => {
        const d = new Date(s.date).toLocaleDateString('uk-UA', { weekday: 'long', day: 'numeric', month: 'numeric' });
        r += s.start === 'Відпустка' ? `🌴 <b>${d}</b>: Відпустка\n` : `🔹 <b>${d}</b>: ${s.start} - ${s.end}\n`;
    });
    r += `</blockquote>`;

    const opts = { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🔙 Назад у меню', callback_data: 'menu_back' }]] } };

    return messageId
        ? bot.editMessageText(r, { chat_id: chatId, message_id: messageId, ...opts })
        : bot.sendMessage(chatId, r, opts);
};

const handleMyWeekends = async (bot, chatId, user, messageId = null) => {
    const now = new Date();
    const mStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const shifts = await Shift.find({ name: user.name, date: { $regex: `^${mStr}` } });
    const wDates = shifts.map(s => s.date);
    let weekends = [];
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

    for (let d = now.getDate(); d <= daysInMonth; d++) {
        const cD = `${mStr}-${String(d).padStart(2, '0')}`;
        if (!wDates.includes(cD)) weekends.push(new Date(cD).toLocaleDateString('uk-UA', { day: 'numeric', month: 'numeric', weekday: 'short' }));
    }

    if (!weekends.length) {
        const txt = "😐 Без вихідних...";
        const opts = { reply_markup: { inline_keyboard: [[{ text: '🔙 Назад у меню', callback_data: 'menu_back' }]] } };
        return messageId ? bot.editMessageText(txt, { chat_id: chatId, message_id: messageId, ...opts }) : bot.sendMessage(chatId, txt, opts);
    }

    const txt = `🌴 <b>Вихідні до кінця місяця:</b>\n<blockquote expandable>${weekends.join(', ')}</blockquote>`;
    const opts = { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🔙 Назад у меню', callback_data: 'menu_back' }]] } };

    return messageId
        ? bot.editMessageText(txt, { chat_id: chatId, message_id: messageId, ...opts })
        : bot.sendMessage(chatId, txt, opts);
};

const handleWhoIsWorking = async (bot, chatId, user, messageId = null) => {
    const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Kiev" }));
    const shifts = await Shift.find({ date: now.toISOString().split('T')[0] });
    const curMin = now.getHours() * 60 + now.getMinutes();
    let active = [];
    let storeUserNames = [];

    if (user.storeId) {
        const colleagues = await User.find({ storeId: user.storeId });
        storeUserNames = colleagues.map(c => c.name);
    }

    for (const s of shifts) {
        if (user.storeId && !storeUserNames.includes(s.name)) continue;
        if (s.start === 'Відпустка') continue;
        const [h1, m1] = s.start.split(':').map(Number);
        const [h2, m2] = s.end.split(':').map(Number);
        const st = h1 * 60 + m1;
        let en = h2 * 60 + m2;

        // Обробка нічних змін
        if (en < st) en += 24 * 60; // Якщо зміна закінчується наступного дня

        if (curMin >= st && curMin < en) {
            const u = await User.findOne({ name: s.name });
            const nameDisplay = u?.telegramChatId ? `<a href="tg://user?id=${u.telegramChatId}">${s.name}</a>` : `<b>${s.name}</b>`;
            active.push(`👤 ${nameDisplay} (${s.end})`);
        }
    }

    const txt = active.length ? `🟢 <b>Зараз працюють:</b>\n\n${active.join('\n')}` : "🌑 Нікого немає";
    const opts = { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🔙 Назад у меню', callback_data: 'menu_back' }]] } };

    return messageId
        ? bot.editMessageText(txt, { chat_id: chatId, message_id: messageId, ...opts })
        : bot.sendMessage(chatId, txt, opts);
};

const handleSettings = async (bot, chatId, user, messageId = null) => {
    const appUrl = process.env.APP_URL || 'https://shifter-app.onrender.com';
    const opts = {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [{ text: '📱 Налаштувати точний час у додатку', web_app: { url: appUrl } }],
                [{ text: '🔕 Вимкнути нагадування', callback_data: 'set_remind_off' }],
                [{ text: '💬 Зв\'язок з розробником', url: 'https://t.me/StanisLoveIt' }],
                [{ text: '🔙 Назад у меню', callback_data: 'menu_back' }]
            ]
        }
    };
    
    let current = user.reminderTime || 'off';
    if (current === 'off' || current === 'none') {
        current = 'Вимкнено 🔕';
    } else if (current === '1h' || current === '12h' || current === 'start' || current === '20:00') {
        current = `${current} (старий формат)`;
    } else {
        current = `${current} ⏰`;
    }

    const txt = `⚙️ <b>Налаштування сповіщень</b>\nПоточний час нагадування: <b>${current}</b>\n\n<i>Щоб обрати точний час нагадування (наприклад, 21:30), відкрийте додаток та перейдіть у свій Профіль.</i>`;
    return messageId ? bot.editMessageText(txt, { chat_id: chatId, message_id: messageId, ...opts }) : bot.sendMessage(chatId, txt, opts);
};


const handleMessage = async (bot, msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;
    const chatId = msg.chat.id;
    const user = await User.findOne({ telegramChatId: chatId });

    if (!user) {
        if (['📋 Мої зміни', '🌴 Мої віхідні', '⚙️ Налаштування', '👀 Зараз на зміні'].includes(msg.text))
            return bot.sendMessage(chatId, "❌ Спочатку увійди через /login");
        return;
    }

    if (msg.text === '📋 Мої зміни') return handleMyShifts(bot, chatId, user);
    if (msg.text === '🌴 Мої віхідні') return handleMyWeekends(bot, chatId, user);
    if (msg.text === '👀 Зараз на зміні') return handleWhoIsWorking(bot, chatId, user);
    if (msg.text === '⚙️ Налаштування') return handleSettings(bot, chatId, user);
};

module.exports = {
    handleMessage,
    handleMyShifts,
    handleMyWeekends,
    handleWhoIsWorking,
    handleSettings
};