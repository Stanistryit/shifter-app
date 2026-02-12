const { User, Request, Shift, Task, NewsPost, AuditLog } = require('../models');
const { notifyUser } = require('./notifications');

const handleCallback = async (bot, q) => {
    const uid = q.from.id;
    const data = q.data;

    // 1. Читання новин
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
    
    // 2. Налаштування нагадувань
    else if (data.startsWith('set_remind_')) {
        const val = data.replace('set_remind_','');
        let dbVal = val === '20' ? '20:00' : val;
        const u = await User.findOne({telegramChatId:uid});
        if(u){ u.reminderTime = dbVal; await u.save(); bot.answerCallbackQuery(q.id, {text: 'Збережено ✅'}); bot.sendMessage(q.message.chat.id, `✅ Режим сповіщень змінено.`); }
    }
    
    // 3. Переведення користувачів
    else if (data.startsWith('transfer_')) {
        await handleTransferLogic(bot, q, uid, data);
    }
    
    // 4. Підтвердження запитів (Зміни, Задачі)
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
        // ... (Стара логіка для юзерів, якщо вона ще використовується)
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

module.exports = { handleCallback };