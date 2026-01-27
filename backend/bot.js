const TelegramBot = require('node-telegram-bot-api');
const { User, Shift, Contact, NewsPost, Task } = require('./models');
const ExcelJS = require('exceljs');

let bot = null;

const initBot = (token, appUrl, tgConfig) => {
    if (!token) return null;
    
    bot = new TelegramBot(token);
    bot.setWebHook(`${appUrl}/bot${token}`);
    console.log("🤖 Telegram Bot: Webhook set");

    bot.setMyCommands([
        { command: '/start', description: '🏠 Головне меню' },
        { command: '/now', description: '👀 Хто зараз на зміні' },
        { command: '/shifts', description: '📋 Мої зміни' },
        { command: '/login', description: '🔐 Авторизація' },
        { command: '/settings', description: '⚙️ Налаштування' }
    ]);

    const mainMenu = {
        keyboard: [
            [{ text: "📅 Відкрити Графік", web_app: { url: appUrl } }],
            [{ text: "📋 Мої зміни" }, { text: "🌴 Мої віхідні" }],
            [{ text: "👀 Зараз на зміні" }, { text: "⚙️ Налаштування" }]
        ],
        resize_keyboard: true
    };

    bot.onText(/\/start/, (msg) => bot.sendMessage(msg.chat.id, "👋 Привіт! Вибери дію:", { reply_markup: mainMenu }));
    
    // Auth
    bot.onText(/\/login (.+) (.+)/, async (msg, match) => { 
        const u = await User.findOne({ username: match[1], password: match[2] }); 
        if(u){ 
            u.telegramChatId=msg.chat.id; await u.save(); 
            bot.sendMessage(msg.chat.id, `✅ Привіт, ${u.name}! Тепер ти можеш користуватися кнопками.`, { reply_markup: mainMenu }); 
        } else bot.sendMessage(msg.chat.id, "❌ Помилка логіна/пароля"); 
    });

    // Stats
    bot.onText(/\/stats/, async (msg) => {
        try {
            const u = await User.findOne({ telegramChatId: msg.from.id }); 
            if (!u || (u.role !== 'SM' && u.role !== 'admin')) return bot.sendMessage(msg.chat.id, "⛔️ Немає прав.");

            const now = new Date(); const mStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
            const shifts = await Shift.find({ date: { $regex: `^${mStr}` } });
            if(!shifts.length) return bot.sendMessage(msg.chat.id, "📁 Даних немає.");
            
            const report = {}; 
            shifts.forEach(s => { 
                if(!report[s.name]) report[s.name] = { hours: 0, shifts: 0, vacations: 0 };
                if (s.start === 'Відпустка') { report[s.name].vacations += 1; } 
                else { const [h1,m1]=s.start.split(':').map(Number); const [h2,m2]=s.end.split(':').map(Number); const h=(h2+m2/60)-(h1+m1/60); report[s.name].hours += h; report[s.name].shifts += 1; }
            });

            let txt = `📊 <b>Табель (${mStr}):</b>\n\n`; 
            Object.entries(report).sort((a,b)=>b[1].hours-a[1].hours).forEach(([n, data], i)=> {
                txt += `${i<3?['🥇','🥈','🥉'][i]:'👤'} <b>${n}:</b> ${data.hours.toFixed(1)} год.`;
                if (data.vacations > 0) txt += ` (🌴 ${data.vacations} дн.)`;
                txt += '\n';
            });
            await bot.sendMessage(msg.chat.id, txt, {parse_mode:'HTML', message_thread_id: msg.message_thread_id});

            const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Табель');
            const dim = new Date(now.getFullYear(), now.getMonth()+1, 0).getDate();
            const cols = [{header:'Ім\'я', key:'name', width:20}]; for(let i=1; i<=dim; i++) cols.push({header:`${i}`, key:`d${i}`, width:10}); cols.push({header:'Всього', key:'total', width:12});
            ws.columns = cols; ws.getRow(1).font={bold:true};
            Object.keys(report).sort().forEach(n => {
                const row = {name:n, total:parseFloat(report[n].hours.toFixed(1))};
                shifts.filter(s=>s.name===n).forEach(s=> {
                    const day = parseInt(s.date.split('-')[2]);
                    if (s.start === 'Відпустка') row[`d${day}`] = 'В'; else row[`d${day}`] = `${s.start}-${s.end}`;
                });
                ws.addRow(row);
            });
            const buf = await wb.xlsx.writeBuffer();
            bot.sendDocument(msg.chat.id, buf, { caption: `📂 Табель_${mStr}.xlsx`, message_thread_id: msg.message_thread_id }, { filename: `Табель_${mStr}.xlsx`, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        } catch (e) { console.error(e); bot.sendMessage(msg.chat.id, "❌ Помилка."); }
    });

    // Buttons Handler
    bot.on('message', async (msg) => {
        if (!msg.text || msg.text.startsWith('/')) return;
        const chatId = msg.chat.id;
        const user = await User.findOne({ telegramChatId: chatId });
        if (!user) {
            if (['📋 Мої зміни', '🌴 Мої віхідні', '⚙️ Налаштування'].includes(msg.text)) return bot.sendMessage(chatId, "❌ Спочатку увійди через /login");
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
            bot.sendMessage(chatId, `🌴 <b>Вихідні:</b>\n\n${weekends.join(', ')}`, {parse_mode:'HTML'});
        }
        else if (msg.text === '👀 Зараз на зміні') {
            const now = new Date(new Date().toLocaleString("en-US", {timeZone: "Europe/Kiev"}));
            const shifts = await Shift.find({ date: now.toISOString().split('T')[0] });
            const curMin = now.getHours()*60 + now.getMinutes();
            let active = [];
            shifts.forEach(s => {
                if(s.start === 'Відпустка') return;
                const [h1,m1]=s.start.split(':').map(Number); const [h2,m2]=s.end.split(':').map(Number); const st=h1*60+m1; const en=h2*60+m2; 
                if(curMin>=st && curMin<en) active.push(`👤 <b>${s.name}</b> (${s.end})`);
            });
            bot.sendMessage(chatId, active.length ? `🟢 <b>Працюють:</b>\n\n${active.join('\n')}` : "🌑 Нікого", {parse_mode:'HTML'});
        }
        else if (msg.text === '⚙️ Налаштування') {
            bot.sendMessage(chatId, `⚙️ <b>Сповіщення:</b> ${user.reminderTime}`, {parse_mode:'HTML', reply_markup:{inline_keyboard:[[{text:'🌙 20:00',callback_data:'set_remind_20'}],[{text:'☀️ 08:00',callback_data:'set_remind_08'}],[{text:'🔕 Вимкнути',callback_data:'set_remind_none'}]]}});
        }
    });

    bot.on('callback_query', async (q) => {
        const uid = q.from.id;
        if (q.data === 'read_news') {
            const u = await User.findOne({telegramChatId:uid});
            let name = u ? u.name : q.from.first_name;
            const shortName = name.trim().split(' ')[1] || name.trim().split(' ')[0];
            let p = await NewsPost.findOne({messageId:q.message.reply_to_message ? q.message.reply_to_message.message_id : q.message.message_id});
            if(!p) p = await NewsPost.findOne({messageId: q.message.message_id});
            if(!p) return bot.answerCallbackQuery(q.id, {text:'Старий пост'});
            if(p.readBy.includes(shortName)) return bot.answerCallbackQuery(q.id, {text:'Вже є', show_alert:true});
            p.readBy.push(shortName); await p.save();
            if (p.type !== 'file' || !q.message.reply_to_message) {
                 const txt = (p.text ? p.text + "\n\n" : "") + `👀 <b>Ознайомились:</b>\n${p.readBy.join(', ')}`;
                 try { if(p.type==='text') bot.editMessageText(txt, {chat_id:q.message.chat.id, message_id:q.message.message_id, parse_mode:'HTML', reply_markup:q.message.reply_markup}); else bot.editMessageCaption(txt, {chat_id:q.message.chat.id, message_id:q.message.message_id, parse_mode:'HTML', reply_markup:q.message.reply_markup}); } catch(e){}
            }
            bot.answerCallbackQuery(q.id, {text:`Дякую, ${shortName}! ✅`});
        }
        if (q.data.startsWith('set_remind_')) {
            const u = await User.findOne({telegramChatId:uid});
            if(u){ u.reminderTime = q.data.replace('set_remind_','').replace('none','none'); if(u.reminderTime!=='none') u.reminderTime+=':00'; await u.save(); bot.answerCallbackQuery(q.id); bot.sendMessage(q.message.chat.id, `✅ Збережено: ${u.reminderTime}`); }
        }
    });

    return bot;
};

// Functions exposed to Server
const notifyUser = async (name, msg) => { if(!bot) return; try { const u = await User.findOne({name}); if(u?.telegramChatId) bot.sendMessage(u.telegramChatId, msg, {parse_mode:'HTML'}); } catch(e){} };
const notifyRole = async (role, msg) => { if(!bot) return; try { const us = await User.find({role}); for(const u of us) if(u.telegramChatId) bot.sendMessage(u.telegramChatId, msg, {parse_mode:'HTML'}); } catch(e){} };
const notifyAll = async (msg) => { if(!bot) return; try { const us = await User.find({telegramChatId:{$ne:null}}); for(const u of us) bot.sendMessage(u.telegramChatId, msg, {parse_mode:'HTML'}); } catch(e){} };
const getBot = () => bot;

module.exports = { initBot, notifyUser, notifyRole, notifyAll, getBot };