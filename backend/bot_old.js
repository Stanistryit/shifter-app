process.env.NTBA_FIX_350 = 1;
const axios = require('axios'); 
const TelegramBot = require('node-telegram-bot-api');
const { User, Shift, Request, NewsPost, Task, AuditLog, PendingNotification, Store } = require('./models');

let bot = null;
let APP_URL = ''; 

// --- 1. QUIET HOURS LOGIC ---
const sendMessageWithQuietHours = async (chatId, text, options = {}) => {
    if (!bot) return;
    const now = new Date(new Date().toLocaleString("en-US", {timeZone: "Europe/Kiev"}));
    const hours = now.getHours();

    const isQuietHour = hours >= 22 || hours < 8;

    if (isQuietHour) {
        await PendingNotification.create({ chatId, text });
        console.log(`zzz Повідомлення відкладено для ${chatId} (Тиха година)`);
    } else {
        try {
            await bot.sendMessage(chatId, text, options);
        } catch (e) {
            console.error(`Error sending message to ${chatId}:`, e.message);
        }
    }
};

// --- 2. INIT BOT ---
const initBot = (token, appUrl) => { 
    if (!token) return null;
    
    APP_URL = appUrl;
    bot = new TelegramBot(token, { polling: false });

    bot.setWebHook(`${appUrl}/bot${token}`)
        .then(() => console.log("🤖 Telegram Bot: Webhook set successfully"))
        .catch(err => console.error("⚠️ Telegram Bot: Webhook connection failed:", err.message));

    const commands = [
        { command: '/start', description: '🏠 Головне меню' },
        { command: '/now', description: '👀 Хто зараз на зміні' },
        { command: '/shifts', description: '📋 Мої зміни' },
        { command: '/login', description: '🔐 Авторизація' },
        { command: '/settings', description: '⚙️ Налаштування' },
        { command: '/my_id', description: '🆔 Мій Telegram ID' }
    ];
    bot.setMyCommands(commands).catch(e => {});

    // --- ОБРОБНИКИ КОМАНД ---
    bot.onText(/\/start/, (msg) => handleStart(msg, appUrl));
    bot.onText(/\/login (.+) (.+)/, handleLogin);
    
    // 🔥 НОВІ КОМАНДИ ДЛЯ ГРУП
    bot.onText(/\/link_store (.+)/, handleLinkStore); // Прив'язка групи до магазину
    bot.onText(/\/set_news/, handleSetNews);         // Встановити топік новин
    bot.onText(/\/set_evening/, handleSetEvening);   // Встановити топік звітів
    
    // Допоміжна команда
    bot.onText(/\/my_id/, (msg) => bot.sendMessage(msg.chat.id, `Ваш ID: <code>${msg.from.id}</code>`, {parse_mode:'HTML'}));
    bot.onText(/\/set_time (.+)/, handleSetReportTime);

    bot.on('message', handleMessage);
    bot.on('callback_query', handleCallback);

    bot.on('polling_error', (e) => console.log(`[Polling Error] ${e.message}`));
    bot.on('webhook_error', (e) => console.log(`[Webhook Error] ${e.message}`));
    bot.on('error', (e) => console.log(`[General Bot Error] ${e.message}`));

    return bot;
};

// --- 3. HANDLERS ---

const mainMenu = (appUrl) => ({
    keyboard: [
        [{ text: "📅 Відкрити Графік", web_app: { url: appUrl } }],
        [{ text: "📋 Мої зміни" }, { text: "🌴 Мої віхідні" }],
        [{ text: "👀 Зараз на зміні" }, { text: "⚙️ Налаштування" }]
    ],
    resize_keyboard: true
});

const handleStart = (msg, appUrl) => {
    const txt = `👋 <b>Привіт! Це бот Shifter.</b>\n\nТут ти можеш:\n📅 Дивитись графік роботи\n👀 Бачити, хто зараз працює\n🔔 Отримувати нагадування про зміни\n\n🔐 <b>Доступ:</b>\nЩоб користуватися кнопками, треба авторизуватися:\n<code>/login логін пароль</code>`;
    bot.sendMessage(msg.chat.id, txt, { reply_markup: mainMenu(appUrl), parse_mode: 'HTML' });
};

const handleLogin = async (msg, match) => {
    try {
        const u = await User.findOne({ username: match[1] }); 
        if (u && (await u.comparePassword(match[2]))) { 
            u.telegramChatId = msg.chat.id; 
            await u.save(); 
            bot.sendMessage(msg.chat.id, `✅ Привіт, ${u.name}! Тепер ти можеш користуватися кнопками.`); 
        } else {
            bot.sendMessage(msg.chat.id, "❌ Невірний логін або пароль"); 
        }
    } catch (e) { bot.sendMessage(msg.chat.id, "❌ Помилка сервера"); }
};

// --- 🔥 ЛОГІКА ПРИВ'ЯЗКИ ГРУП ---

const handleLinkStore = async (msg, match) => {
    const code = match[1].trim();
    const chatId = msg.chat.id;
    try {
        const store = await Store.findOne({ code });
        if (!store) return bot.sendMessage(chatId, `❌ Магазин з кодом <b>${code}</b> не знайдено.`, {parse_mode: 'HTML'});
        
        store.telegram.chatId = chatId;
        await store.save();
        bot.sendMessage(chatId, `✅ <b>Чат прив'язано до магазину: ${store.name}</b>\n\nТепер зайдіть у відповідні гілки (Topics) і напишіть:\n/set_news — для новин\n/set_evening — для звітів`, {parse_mode: 'HTML'});
    } catch (e) { console.error(e); }
};

const handleSetNews = async (msg) => {
    const chatId = msg.chat.id;
    const threadId = msg.message_thread_id;
    
    const store = await Store.findOne({ 'telegram.chatId': chatId });
    if (!store) return bot.sendMessage(chatId, '❌ Спочатку прив\'яжіть магазин командою /link_store КОД', { message_thread_id: threadId });

    store.telegram.newsTopicId = threadId;
    await store.save();
    
    bot.sendMessage(chatId, `📢 Цей топік встановлено для <b>Новин</b>.`, { parse_mode: 'HTML', message_thread_id: threadId });
};

const handleSetEvening = async (msg) => {
    const chatId = msg.chat.id;
    const threadId = msg.message_thread_id;
    
    const store = await Store.findOne({ 'telegram.chatId': chatId });
    if (!store) return bot.sendMessage(chatId, '❌ Спочатку прив\'яжіть магазин командою /link_store КОД', { message_thread_id: threadId });

    store.telegram.eveningTopicId = threadId;
    await store.save();
    
    bot.sendMessage(chatId, `🌙 Цей топік встановлено для <b>Звітів</b>.`, { parse_mode: 'HTML', message_thread_id: threadId });
};

const handleSetReportTime = async (msg, match) => {
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
        bot.sendMessage(chatId, `✅ Час звіту: <b>${timeStr}</b>`, {parse_mode:'HTML'});
    } catch (e) { bot.sendMessage(chatId, "❌ Помилка"); }
};

const handleMessage = async (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;
    const chatId = msg.chat.id;
    const user = await User.findOne({ telegramChatId: chatId });

    if (!user) {
        if (['📋 Мої зміни', '🌴 Мої віхідні', '⚙️ Налаштування', '👀 Зараз на зміні'].includes(msg.text)) 
            return bot.sendMessage(chatId, "❌ Спочатку увійди через /login");
        return;
    }

    if (msg.text === '📋 Мої зміни') {
        const today = new Date().toISOString().split('T')[0];
        const shifts = await Shift.find({ name: user.name, date: { $gte: today } }).sort({ date: 1 }).limit(10);
        if (!shifts.length) return bot.sendMessage(chatId, "🎉 Змін немає!");
        let r = `📋 <b>Твої зміни:</b>\n\n`;
        shifts.forEach(s => { const d = new Date(s.date).toLocaleDateString('uk-UA',{weekday:'long',day:'numeric',month:'numeric'}); r += s.start==='Відпустка'?`🌴 <b>${d}</b>: Відпустка\n`:`🔹 <b>${d}</b>: ${s.start} - ${s.end}\n`; });
        bot.sendMessage(chatId, r, {parse_mode:'HTML'});
    }
    else if (msg.text === '🌴 Мої віхідні') {
        const now = new Date(); const mStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
        const shifts = await Shift.find({ name: user.name, date: { $regex: `^${mStr}` } });
        const wDates = shifts.map(s=>s.date);
        let weekends=[]; const daysInMonth=new Date(now.getFullYear(),now.getMonth()+1,0).getDate();
        for(let d=now.getDate(); d<=daysInMonth; d++){ const cD = `${mStr}-${String(d).padStart(2,'0')}`; if(!wDates.includes(cD)) weekends.push(new Date(cD).toLocaleDateString('uk-UA',{day:'numeric',month:'numeric',weekday:'short'})); }
        if(!weekends.length) return bot.sendMessage(chatId, "😐 Без вихідних...");
        bot.sendMessage(chatId, `🌴 <b>Вихідні до кінця місяця:</b>\n\n${weekends.join(', ')}`, {parse_mode:'HTML'});
    }
    else if (msg.text === '👀 Зараз на зміні') {
        const now = new Date(new Date().toLocaleString("en-US", {timeZone: "Europe/Kiev"}));
        const shifts = await Shift.find({ date: now.toISOString().split('T')[0] });
        const curMin = now.getHours()*60 + now.getMinutes();
        let active = [];
        let storeUserNames = [];
        
        if (user.storeId) {
            const colleagues = await User.find({ storeId: user.storeId });
            storeUserNames = colleagues.map(c => c.name);
        }

        for (const s of shifts) {
            if (user.storeId && !storeUserNames.includes(s.name)) continue; 
            if(s.start === 'Відпустка') continue;
            const [h1,m1]=s.start.split(':').map(Number); const [h2,m2]=s.end.split(':').map(Number); const st=h1*60+m1; const en=h2*60+m2; 
            if(curMin>=st && curMin<en) {
                const u = await User.findOne({ name: s.name });
                const nameDisplay = u?.telegramChatId ? `<a href="tg://user?id=${u.telegramChatId}">${s.name}</a>` : `<b>${s.name}</b>`;
                active.push(`👤 ${nameDisplay} (${s.end})`);
            }
        }
        bot.sendMessage(chatId, active.length ? `🟢 <b>Зараз працюють:</b>\n\n${active.join('\n')}` : "🌑 Нікого немає", {parse_mode:'HTML'});
    }
    else if (msg.text === '⚙️ Налаштування') {
        const opts = { parse_mode: 'HTML', reply_markup: { inline_keyboard: [ [{text:'⏰ За 1 годину', callback_data:'set_remind_1h'}, {text:'⏰ За 12 годин', callback_data:'set_remind_12h'}], [{text:'🏁 На початку зміни', callback_data:'set_remind_start'}], [{text:'🌙 Щодня о 20:00', callback_data:'set_remind_20'}], [{text:'🔕 Вимкнути', callback_data:'set_remind_none'}] ] } };
        let current = user.reminderTime;
        if(current === '1h') current = 'За 1 годину'; else if(current === '12h') current = 'За 12 годин'; else if(current === 'start') current = 'На початку'; else if(current === 'none') current = 'Вимкнено';
        bot.sendMessage(chatId, `⚙️ <b>Налаштування сповіщень</b>\n\nПоточний режим: <b>${current}</b>`, opts);
    }
};

const handleCallback = async (q) => {
    const uid = q.from.id;
    const data = q.data;

    if (data === 'read_news') {
        const u = await User.findOne({telegramChatId:uid});
        let name = u ? u.name : q.from.first_name;
        const shortName = name.trim().split(' ')[1] || name.trim().split(' ')[0];
        
        let p = await NewsPost.findOne({messageId:q.message.reply_to_message ? q.message.reply_to_message.message_id : q.message.message_id});
        if(!p) p = await NewsPost.findOne({messageId: q.message.message_id});
        if(!p) return bot.answerCallbackQuery(q.id, {text:'Старий пост'});
        if(p.readBy.includes(shortName)) return bot.answerCallbackQuery(q.id, {text:'Вже є', show_alert:true});
        
        p.readBy.push(shortName); await p.save(); 
        const readList = `\n\n👀 <b>Ознайомились:</b>\n${p.readBy.join(', ')}`;
        try {
            const baseText = p.text || "";
            const newContent = q.message.reply_to_message && p.type === 'file' ? "👇 Підтвердити:" + readList : baseText + readList;
            if (q.message.caption !== undefined) {
                await bot.editMessageCaption(newContent, { chat_id: q.message.chat.id, message_id: q.message.message_id, parse_mode: 'HTML', reply_markup: q.message.reply_markup });
            } else {
                await bot.editMessageText(newContent, { chat_id: q.message.chat.id, message_id: q.message.message_id, parse_mode: 'HTML', reply_markup: q.message.reply_markup });
            }
        } catch(e) {}
        bot.answerCallbackQuery(q.id, {text:`Дякую, ${shortName}! ✅`});
    }
    else if (data.startsWith('set_remind_')) {
        const val = data.replace('set_remind_','');
        let dbVal = val === '20' ? '20:00' : val;
        const u = await User.findOne({telegramChatId:uid});
        if(u){ u.reminderTime = dbVal; await u.save(); bot.answerCallbackQuery(q.id, {text: 'Збережено ✅'}); bot.sendMessage(q.message.chat.id, `✅ Режим сповіщень змінено.`); }
    }
    else if (data.startsWith('transfer_')) {
        await handleTransferLogic(bot, q, uid, data);
    }
    else if (data.startsWith('approve_') || data.startsWith('reject_')) {
        await handleApprovalLogic(bot, q, uid, data);
    }
};

const handleTransferLogic = async (bot, q, uid, data) => {
    const action = data.includes('approve') ? 'approve' : 'reject';
    const requestId = data.split('_').pop();
    const admin = await User.findOne({telegramChatId: uid});

    if (!admin || (admin.role !== 'SM' && admin.role !== 'admin')) {
        return bot.answerCallbackQuery(q.id, {text: '⛔️ Тільки для SM', show_alert: true});
    }

    try {
        const request = await Request.findById(requestId);
        if (!request) return bot.editMessageText(`⚠️ Запит вже не актуальний.`, {chat_id: q.message.chat.id, message_id: q.message.message_id});

        if (action === 'approve') {
            const targetUser = await User.findById(request.data.userId);
            if (targetUser) {
                targetUser.storeId = request.data.targetStoreId;
                await targetUser.save();
                
                await AuditLog.create({
                    performer: admin.name,
                    action: 'approve_transfer',
                    details: `${targetUser.name} moved to ${request.data.targetStoreName}`
                });

                if (targetUser.telegramChatId) {
                    bot.sendMessage(targetUser.telegramChatId, `✅ <b>Вас переведено!</b>\n🏠 Новий магазин: <b>${request.data.targetStoreName}</b>`, {parse_mode: 'HTML'});
                }
            }
            bot.editMessageText(`✅ <b>Прийнято</b> (SM: ${admin.name})\nСпівробітник переведений.`, {chat_id: q.message.chat.id, message_id: q.message.message_id, parse_mode: 'HTML'});
        } else {
            bot.editMessageText(`❌ <b>Відхилено</b> (SM: ${admin.name})`, {chat_id: q.message.chat.id, message_id: q.message.message_id, parse_mode: 'HTML'});
        }
        await Request.findByIdAndDelete(requestId);
        bot.answerCallbackQuery(q.id, {text: 'Готово'});
    } catch (e) {
        console.error(e);
        bot.answerCallbackQuery(q.id, {text: 'Помилка', show_alert: true});
    }
};

const handleApprovalLogic = async (bot, q, uid, data) => {
    const action = data.includes('approve') ? 'approve' : 'reject';
    const type = data.includes('_user_') ? 'user' : 'req';
    const targetId = data.split('_').pop();

    const admin = await User.findOne({telegramChatId: uid});
    if (!admin || (admin.role !== 'SM' && admin.role !== 'admin')) {
        return bot.answerCallbackQuery(q.id, {text: '⛔️ Тільки для SM', show_alert: true});
    }

    if (type === 'user') {
        const targetUser = await User.findById(targetId);
        if (!targetUser) return bot.editMessageText(`⚠️ Заявка не актуальна.`, {chat_id: q.message.chat.id, message_id: q.message.message_id});

        if (action === 'approve') {
            targetUser.status = 'active';
            targetUser.role = 'SE';
            targetUser.grade = 1;
            await targetUser.save();
            await AuditLog.create({ performer: admin.name, action: 'approve_user', details: `Approved ${targetUser.name}` });
            bot.editMessageText(q.message.text + `\n\n✅ <b>Прийнято</b> (SM: ${admin.name})`, {chat_id: q.message.chat.id, message_id: q.message.message_id, parse_mode: 'HTML'});
        } else {
            await User.findByIdAndDelete(targetId);
            bot.editMessageText(q.message.text + `\n\n❌ <b>Відхилено</b> (SM: ${admin.name})`, {chat_id: q.message.chat.id, message_id: q.message.message_id, parse_mode: 'HTML'});
        }
    } 
    else if (type === 'req') {
        const request = await Request.findById(targetId);
        if (!request) return bot.editMessageText(`⚠️ Запит вже оброблено.`, {chat_id: q.message.chat.id, message_id: q.message.message_id});

        if (action === 'approve') {
            if(request.type === 'add_shift') await Shift.create(request.data);
            if(request.type === 'del_shift') await Shift.findByIdAndDelete(request.data.id);
            if(request.type === 'add_task') await Task.create(request.data);
            notifyUser(request.createdBy, `✅ Ваш запит (${request.type}) схвалено!`);
            await AuditLog.create({ performer: admin.name, action: 'approve_request', details: `${request.type}` });
            bot.editMessageText(`✅ <b>Схвалено</b> (SM: ${admin.name})\n\n${q.message.text}`, {chat_id: q.message.chat.id, message_id: q.message.message_id, parse_mode: 'HTML'});
        } else {
            notifyUser(request.createdBy, `❌ Ваш запит (${request.type}) відхилено.`);
            bot.editMessageText(`❌ <b>Відхилено</b> (SM: ${admin.name})\n\n${q.message.text}`, {chat_id: q.message.chat.id, message_id: q.message.message_id, parse_mode: 'HTML'});
        }
        await Request.findByIdAndDelete(targetId);
    }
    bot.answerCallbackQuery(q.id, {text: 'Готово'});
};

// --- HELPERS ---

const notifyUser = async (name, msg) => { 
    if(!bot) return; 
    try { 
        const u = await User.findOne({name}); 
        if(u?.telegramChatId) await sendMessageWithQuietHours(u.telegramChatId, msg, {parse_mode:'HTML'}); 
    } catch(e){} 
};

// 🔥 Оновлено: Відправляє новини в топіки магазинів, якщо налаштовано
const notifyAll = async (msg) => { 
    if(!bot) return; 
    try { 
        const stores = await Store.find({ 'telegram.chatId': { $ne: null } });
        for(const store of stores) {
            const opts = { parse_mode: 'HTML' };
            if (store.telegram.newsTopicId) opts.message_thread_id = store.telegram.newsTopicId;
            await sendMessageWithQuietHours(store.telegram.chatId, msg, opts);
        }
    } catch(e){} 
};

// 🔥 Оновлено: Запит летить ТІЛЬКИ SM конкретного магазину
const sendRequestToSM = async (requestDoc) => {
    if(!bot) return;
    try {
        let storeId = null;
        if (requestDoc.data && requestDoc.data.storeId) {
             storeId = requestDoc.data.storeId;
        } else {
             const creator = await User.findOne({ name: requestDoc.createdBy });
             if (creator) storeId = creator.storeId;
        }

        if (!storeId) return console.log("⚠️ Магазин не визначено для запиту");

        // Шукаємо SM цього магазину
        const smUser = await User.findOne({ storeId: storeId, role: 'SM' });
        
        if (!smUser || !smUser.telegramChatId) return console.log(`⚠️ SM не знайдено або у нього немає Telegram ID (Store: ${storeId})`);

        let details = "";
        if (requestDoc.type === 'add_shift') details = `📅 Зміна: ${requestDoc.data.date}\n⏰ ${requestDoc.data.start}-${requestDoc.data.end}`;
        if (requestDoc.type === 'del_shift') details = `❌ Видалення зміни: ${requestDoc.data.date}`;
        if (requestDoc.type === 'add_task') {
            details = `📌 Задача: ${requestDoc.data.title}`;
            if (requestDoc.data.description) details += `\nℹ️ ${requestDoc.data.description}`;
        }

        const txt = `🔔 <b>Новий запит</b>\n👤 <b>Від:</b> ${requestDoc.createdBy}\nℹ️ <b>Тип:</b> ${requestDoc.type}\n\n${details}`;
        const opts = { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[ { text: "✅ Дозволити", callback_data: `approve_req_${requestDoc._id}` }, { text: "❌ Відхилити", callback_data: `reject_req_${requestDoc._id}` } ]] } };
        
        await sendMessageWithQuietHours(smUser.telegramChatId, txt, opts); 

    } catch (e) {
        console.error("Error sending request to SM:", e.message);
    }
};

const getBot = () => bot;
module.exports = { initBot, notifyUser, notifyAll, sendRequestToSM, getBot };