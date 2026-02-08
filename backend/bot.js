process.env.NTBA_FIX_350 = 1;

const TelegramBot = require('node-telegram-bot-api');
const { User, Shift, Request, NewsPost, Task, AuditLog, PendingNotification, Store } = require('./models');
const bcrypt = require('bcryptjs'); 

let bot = null;

// --- Quiet Hours Logic ---
const sendMessageWithQuietHours = async (chatId, text, options = {}) => {
    if (!bot) return;
    const now = new Date(new Date().toLocaleString("en-US", {timeZone: "Europe/Kiev"}));
    const hours = now.getHours();

    // Тиха година: з 22:00 до 07:59
    const isQuietHour = hours >= 22 || hours < 8;

    if (isQuietHour) {
        // Зберігаємо в базу
        await PendingNotification.create({ chatId, text });
        console.log(`zzz Повідомлення відкладено для ${chatId} (Тиха година)`);
    } else {
        // Відправляємо одразу
        try {
            await bot.sendMessage(chatId, text, options);
        } catch (e) {
            console.error(`Error sending message to ${chatId}:`, e.message);
        }
    }
};

// --- ВЕЧІРНЯ РОЗСИЛКА ---
const sendTomorrowShifts = async () => {
    if (!bot) return;
    
    // Визначаємо "Завтра"
    const now = new Date(new Date().toLocaleString("en-US", {timeZone: "Europe/Kiev"}));
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().split('T')[0];
    const dateDisplay = tomorrow.toLocaleDateString('uk-UA', {weekday: 'long', day: 'numeric', month: 'long'});

    const stores = await Store.find();

    for (const store of stores) {
        // Перевіряємо, чи налаштована вечірня гілка
        if (!store.telegram.chatId || !store.telegram.eveningTopicId) continue;

        // Знаходимо співробітників цього магазину
        const storeUsers = await User.find({ storeId: store._id });
        const userNames = storeUsers.map(u => u.name);

        // Шукаємо зміни на завтра для цих людей
        const shifts = await Shift.find({ date: dateStr, name: { $in: userNames } });
        
        // Якщо змін немає - можна пропустити або написати "Завтра вихідний у всіх"
        if (shifts.length === 0) continue; 

        let msg = `🌙 <b>Завтра (${dateDisplay}) працюють:</b>\n\n`;
        
        // Сортуємо за часом початку (09:00, 10:00...)
        shifts.sort((a, b) => a.start.localeCompare(b.start));

        shifts.forEach(s => {
            if (s.start === 'Відпустка') {
                msg += `🌴 <b>${s.name}</b>: Відпустка\n`;
            } else {
                msg += `👤 <b>${s.name}</b>: ${s.start} - ${s.end}\n`;
            }
        });

        try {
            // Відправляємо напряму (це запланована подія, не "тиха година")
            await bot.sendMessage(store.telegram.chatId, msg, {
                parse_mode: 'HTML',
                message_thread_id: store.telegram.eveningTopicId
            });
            console.log(`✅ Вечірній звіт відправлено для ${store.name}`);
        } catch (e) {
            console.error(`❌ Помилка вечірнього звіту для ${store.name}:`, e.message);
        }
    }
};

const initBot = (token, appUrl) => { 
    if (!token) return null;
    
    bot = new TelegramBot(token, { polling: false });

    bot.setWebHook(`${appUrl}/bot${token}`)
        .then(() => console.log("🤖 Telegram Bot: Webhook set successfully"))
        .catch(err => console.error("⚠️ Telegram Bot: Webhook connection failed:", err.message));

    // --- CRON JOB (Кожну хвилину) ---
    setInterval(async () => {
        const now = new Date(new Date().toLocaleString("en-US", {timeZone: "Europe/Kiev"}));
        const hours = now.getHours();
        const minutes = now.getMinutes();
        
        // 1. Відправка відкладених (після 08:00)
        if (hours >= 8 && hours < 22) {
            const pending = await PendingNotification.find().sort({ createdAt: 1 });
            if (pending.length > 0) {
                console.log(`🌅 Доброго ранку! Відправка ${pending.length} відкладених повідомлень...`);
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

        // 2. 🔥 ВЕЧІРНЄ СПОВІЩЕННЯ (Рівно о 21:00)
        if (hours === 21 && minutes === 0) {
            console.log('🕘 21:00 - Запуск вечірньої розсилки...');
            await sendTomorrowShifts();
        }

    }, 60 * 1000); 

    bot.on('polling_error', (error) => console.log(`[Polling Error] ${error.code}: ${error.message}`));
    bot.on('webhook_error', (error) => console.log(`[Webhook Error] ${error.code}: ${error.message}`));
    bot.on('error', (error) => console.log(`[General Bot Error] ${error.message}`));

    const commands = [
        { command: '/start', description: '🏠 Головне меню' },
        { command: '/now', description: '👀 Хто зараз на зміні' },
        { command: '/shifts', description: '📋 Мої зміни' },
        { command: '/login', description: '🔐 Авторизація' },
        { command: '/settings', description: '⚙️ Налаштування' }
    ];
    bot.setMyCommands(commands).catch(e => {});

    const mainMenu = {
        keyboard: [
            [{ text: "📅 Відкрити Графік", web_app: { url: appUrl } }],
            [{ text: "📋 Мої зміни" }, { text: "🌴 Мої віхідні" }],
            [{ text: "👀 Зараз на зміні" }, { text: "⚙️ Налаштування" }]
        ],
        resize_keyboard: true
    };

    // --- COMMANDS ---

    bot.onText(/\/start/, (msg) => {
        const txt = `👋 <b>Привіт! Це бот Shifter.</b>\n\nТут ти можеш:\n📅 Дивитись графік роботи\n👀 Бачити, хто зараз працює\n🔔 Отримувати нагадування про зміни\n\n🔐 <b>Доступ:</b>\nЩоб користуватися кнопками, треба авторизуватися:\n<code>/login логін пароль</code>`;
        bot.sendMessage(msg.chat.id, txt, { reply_markup: mainMenu, parse_mode: 'HTML' });
    });

    // 1. Основна прив'язка (Група)
    bot.onText(/\/link_store (.+)/, async (msg, match) => {
        const code = match[1].trim();
        const chatId = msg.chat.id;
        
        try {
            const store = await Store.findOne({ code });
            if (!store) {
                return bot.sendMessage(chatId, `❌ Магазин з кодом <b>${code}</b> не знайдено.`, {parse_mode: 'HTML'});
            }
            
            store.telegram.chatId = chatId;
            // Якщо команда в гілці, можемо зберегти її як дефолтну, але краще використовувати спеціальні команди
            await store.save();
            bot.sendMessage(chatId, `✅ <b>Основний чат прив'язано!</b>\nМагазин: <b>${store.name}</b>\n\nТепер налаштуйте гілки командами:\n/link_news ${code} (в гілці новин)\n/link_evening ${code} (в гілці звітів)`, {parse_mode: 'HTML'});

        } catch (e) {
            console.error(e);
            bot.sendMessage(chatId, "❌ Помилка при прив'язці.");
        }
    });

    // 2. 🔥 Прив'язка НОВИН (Гілка)
    bot.onText(/\/link_news (.+)/, async (msg, match) => {
        const code = match[1].trim();
        const chatId = msg.chat.id;
        const topicId = msg.message_thread_id; 
        
        if (!topicId) return bot.sendMessage(chatId, "⚠️ Цю команду треба писати всередині гілки (Topic).");

        try {
            const store = await Store.findOne({ code });
            if (!store) return bot.sendMessage(chatId, `❌ Магазин <b>${code}</b> не знайдено.`, {message_thread_id: topicId});
            
            store.telegram.chatId = chatId; // Оновлюємо основний чат про всяк випадок
            store.telegram.newsTopicId = topicId;
            await store.save();
            bot.sendMessage(chatId, `📢 <b>Гілку Новин налаштовано!</b>\nТепер новини будуть падати сюди.`, {parse_mode: 'HTML', message_thread_id: topicId});
        } catch (e) { console.error(e); }
    });

    // 3. 🔥 Прив'язка "ХТО ЗАВТРА" (Гілка)
    bot.onText(/\/link_evening (.+)/, async (msg, match) => {
        const code = match[1].trim();
        const chatId = msg.chat.id;
        const topicId = msg.message_thread_id; 

        if (!topicId) return bot.sendMessage(chatId, "⚠️ Цю команду треба писати всередині гілки (Topic).", {message_thread_id: topicId});

        try {
            const store = await Store.findOne({ code });
            if (!store) return bot.sendMessage(chatId, `❌ Магазин <b>${code}</b> не знайдено.`, {message_thread_id: topicId});
            
            store.telegram.chatId = chatId;
            store.telegram.eveningTopicId = topicId;
            await store.save();
            bot.sendMessage(chatId, `🌙 <b>Вечірні звіти налаштовано!</b>\nО 21:00 сюди приходитиме список змін на завтра.`, {parse_mode: 'HTML', message_thread_id: topicId});
        } catch (e) { console.error(e); }
    });
    
    // --- AUTH & OTHER MESSAGES ---

    bot.onText(/\/login (.+) (.+)/, async (msg, match) => { 
        try {
            const u = await User.findOne({ username: match[1] }); 
            if (u && (await u.comparePassword(match[2]))) { 
                u.telegramChatId = msg.chat.id; 
                await u.save(); 
                bot.sendMessage(msg.chat.id, `✅ Привіт, ${u.name}! Тепер ти можеш користуватися кнопками.`, { reply_markup: mainMenu }); 
            } else {
                bot.sendMessage(msg.chat.id, "❌ Невірний логін або пароль"); 
            }
        } catch (e) { bot.sendMessage(msg.chat.id, "❌ Помилка сервера"); }
    });

    bot.on('message', async (msg) => {
        if (!msg.text || msg.text.startsWith('/')) return;
        const chatId = msg.chat.id;
        const user = await User.findOne({ telegramChatId: chatId });

        if (!user) {
            if (['📋 Мої зміни', '🌴 Мої віхідні', '⚙️ Налаштування', '👀 Зараз на зміні'].includes(msg.text)) 
                return bot.sendMessage(chatId, "❌ Спочатку увійди через /login");
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
            if (user && user.storeId) {
                const colleagues = await User.find({ storeId: user.storeId });
                storeUserNames = colleagues.map(c => c.name);
            }

            for (const s of shifts) {
                if (user && user.storeId && !storeUserNames.includes(s.name)) continue;

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
            if(current === '1h') current = 'За 1 годину';
            if(current === '12h') current = 'За 12 годин';
            if(current === 'start') current = 'На початку';
            if(current === 'none') current = 'Вимкнено';
            bot.sendMessage(chatId, `⚙️ <b>Налаштування сповіщень</b>\n\nПоточний режим: <b>${current}</b>`, opts);
        }
    });

    bot.on('callback_query', async (q) => {
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
            
            p.readBy.push(shortName); 
            await p.save(); 
            
            const readList = `\n\n👀 <b>Ознайомились:</b>\n${p.readBy.join(', ')}`;

            try {
                if (q.message.reply_to_message && p.type === 'file') {
                    const newText = "👇 Підтвердити:" + readList;
                    await bot.editMessageText(newText, { chat_id: q.message.chat.id, message_id: q.message.message_id, parse_mode: 'HTML', reply_markup: q.message.reply_markup });
                } else {
                    const baseText = p.text || "";
                    const newContent = baseText + readList;
                    if (q.message.caption !== undefined) {
                        await bot.editMessageCaption(newContent, { chat_id: q.message.chat.id, message_id: q.message.message_id, parse_mode: 'HTML', reply_markup: q.message.reply_markup });
                    } else {
                        await bot.editMessageText(newContent, { chat_id: q.message.chat.id, message_id: q.message.message_id, parse_mode: 'HTML', reply_markup: q.message.reply_markup });
                    }
                }
            } catch(e) { console.error("❌ Edit Message Error:", e.message); }
            bot.answerCallbackQuery(q.id, {text:`Дякую, ${shortName}! ✅`});
        }
        
        if (data.startsWith('set_remind_')) {
            const val = data.replace('set_remind_','');
            let dbVal = val;
            if (val === '20') dbVal = '20:00'; if (val === '08') dbVal = '08:00';
            const u = await User.findOne({telegramChatId:uid});
            if(u){ u.reminderTime = dbVal; await u.save(); bot.answerCallbackQuery(q.id, {text: 'Збережено ✅'}); bot.sendMessage(q.message.chat.id, `✅ Режим сповіщень змінено.`); }
        }

        if (data.startsWith('approve_req_') || data.startsWith('reject_req_')) {
            const action = data.startsWith('approve') ? 'approve' : 'reject';
            const reqId = data.split('_').pop();
            const admin = await User.findOne({telegramChatId:uid});
            if (!admin || (admin.role !== 'SM' && admin.role !== 'admin')) return bot.answerCallbackQuery(q.id, {text: '⛔️ Тільки для SM', show_alert: true});
            const request = await Request.findById(reqId);
            if (!request) { bot.editMessageText(`⚠️ Запит вже оброблено.`, {chat_id: q.message.chat.id, message_id: q.message.message_id}); return bot.answerCallbackQuery(q.id); }
            if (action === 'approve') {
                if(request.type === 'add_shift') await Shift.create(request.data);
                if(request.type === 'del_shift') await Shift.findByIdAndDelete(request.data.id);
                if(request.type === 'add_task') await Task.create(request.data);
                notifyUser(request.createdBy, `✅ Ваш запит (${request.type}) схвалено!`);
                await AuditLog.create({ performer: admin.name, action: 'approve_request', details: `${request.type} by ${request.createdBy}` });
                bot.editMessageText(`✅ <b>Схвалено</b> (SM: ${admin.name})\n\n${q.message.text}`, {chat_id: q.message.chat.id, message_id: q.message.message_id, parse_mode: 'HTML'});
            } else {
                notifyUser(request.createdBy, `❌ Ваш запит (${request.type}) відхилено.`);
                bot.editMessageText(`❌ <b>Відхилено</b> (SM: ${admin.name})\n\n${q.message.text}`, {chat_id: q.message.chat.id, message_id: q.message.message_id, parse_mode: 'HTML'});
            }
            await Request.findByIdAndDelete(reqId);
            bot.answerCallbackQuery(q.id, {text: 'Готово'});
        }
    });
    return bot;
};

// --- NOTIFICATIONS WITH STORE FILTERING ---

const notifyUser = async (name, msg) => { 
    if(!bot) return; 
    try { 
        const u = await User.findOne({name}); 
        if(u?.telegramChatId) await sendMessageWithQuietHours(u.telegramChatId, msg, {parse_mode:'HTML'}); 
    } catch(e){} 
};

const notifyRole = async (role, msg, storeId = null) => { 
    if(!bot) return; 
    try { 
        const query = { role };
        if (storeId) query.storeId = storeId;
        const us = await User.find(query); 
        for(const u of us) if(u.telegramChatId) await sendMessageWithQuietHours(u.telegramChatId, msg, {parse_mode:'HTML'}); 
    } catch(e){} 
};

const notifyAll = async (msg, storeId = null) => { 
    if(!bot) return; 
    try { 
        const query = { telegramChatId: { $ne: null } };
        if (storeId) query.storeId = storeId;
        const us = await User.find(query); 
        for(const u of us) await sendMessageWithQuietHours(u.telegramChatId, msg, {parse_mode:'HTML'}); 
    } catch(e){} 
};

const sendRequestToSM = async (requestDoc) => {
    if(!bot) return;
    const creator = await User.findOne({ name: requestDoc.createdBy });
    const storeId = creator ? creator.storeId : null;
    const query = { role: { $in: ['SM', 'admin'] } };
    if (storeId) query.storeId = storeId;
    const sms = await User.find(query);

    let details = "";
    if (requestDoc.type === 'add_shift') details = `📅 Зміна: ${requestDoc.data.date}\n⏰ ${requestDoc.data.start}-${requestDoc.data.end}`;
    if (requestDoc.type === 'del_shift') details = `❌ Видалення зміни: ${requestDoc.data.date}`;
    if (requestDoc.type === 'add_task') {
        details = `📌 Задача: ${requestDoc.data.title}`;
        if (requestDoc.data.description) details += `\nℹ️ ${requestDoc.data.description}`;
    }
    const txt = `🔔 <b>Новий запит</b>\n👤 <b>Від:</b> ${requestDoc.createdBy}\nℹ️ <b>Тип:</b> ${requestDoc.type}\n\n${details}`;
    const opts = { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[ { text: "✅ Дозволити", callback_data: `approve_req_${requestDoc._id}` }, { text: "❌ Відхилити", callback_data: `reject_req_${requestDoc._id}` } ]] } };
    for(const sm of sms) { 
        if(sm.telegramChatId) await sendMessageWithQuietHours(sm.telegramChatId, txt, opts); 
    }
};

const getBot = () => bot;
module.exports = { initBot, notifyUser, notifyRole, notifyAll, sendRequestToSM, getBot };