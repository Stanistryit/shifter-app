const { User, Store, Request, AuditLog } = require('../models');
const { logAction } = require('../utils');
const { getBot } = require('../bot');

// Створення запиту на переведення (викликається СЕ)
exports.requestTransfer = async (req, res) => {
    try {
        if (!req.session.userId) return res.status(403).json({ success: false, message: "Не авторизовано" });

        const { targetStoreCode } = req.body;
        const user = await User.findById(req.session.userId);
        
        // 1. Перевірки
        if (!user) return res.status(404).json({ success: false, message: "Користувача не знайдено" });

        const targetStore = await Store.findOne({ code: targetStoreCode });
        if (!targetStore) return res.status(404).json({ success: false, message: "Магазин не знайдено" });

        if (String(user.storeId) === String(targetStore._id)) {
            return res.status(400).json({ success: false, message: "Ви вже працюєте в цьому магазині" });
        }

        // Перевірка на дублікати запитів
        const existingReq = await Request.findOne({ 
            createdBy: user.name, 
            type: 'transfer_request',
            'data.targetStoreId': targetStore._id 
        });
        if (existingReq) {
            return res.status(400).json({ success: false, message: "Заявка на цей магазин вже подана" });
        }

        // 2. Створення запиту в базі
        const newRequest = await Request.create({
            type: 'transfer_request',
            createdBy: user.name, // Ім'я того, хто хоче перевестись
            data: {
                userId: user._id,
                currentStoreId: user.storeId,
                targetStoreId: targetStore._id,
                targetStoreName: targetStore.name
            }
        });

        // 3. Сповіщення SM-ів НОВОГО магазину
        const bot = getBot();
        if (bot) {
            // Шукаємо SM-ів та Адмінів цільового магазину
            const managers = await User.find({ 
                storeId: targetStore._id, 
                role: { $in: ['SM', 'admin'] } 
            });

            const message = `🔄 <b>Запит на переведення</b>\n\n👤 <b>${user.fullName || user.name}</b> хоче перевестись у ваш магазин.\n🏢 Поточна точка: Невідома (див. профіль)\n\nПрийняти співробітника?`;

            const keyboard = {
                inline_keyboard: [
                    [
                        { text: "✅ Прийняти", callback_data: `transfer_approve_${newRequest._id}` },
                        { text: "❌ Відхилити", callback_data: `transfer_reject_${newRequest._id}` }
                    ]
                ]
            };

            for (const manager of managers) {
                if (manager.telegramChatId) {
                    try {
                        await bot.sendMessage(manager.telegramChatId, message, {
                            parse_mode: 'HTML',
                            reply_markup: keyboard
                        });
                    } catch (e) {
                        console.error(`Не вдалося надіслати повідомлення менеджеру ${manager.name}:`, e.message);
                    }
                }
            }
        }

        logAction(user.name, 'request_transfer', `To: ${targetStore.name}`);
        res.json({ success: true, message: "Запит надіслано менеджеру!" });

    } catch (e) {
        console.error(e);
        res.status(500).json({ success: false, message: e.message });
    }
};

// Обробка відповіді (викликається Ботом або Адмінкою)
exports.respondTransfer = async (req, res) => {
    try {
        const { requestId, action } = req.body; // action: 'approve' | 'reject'
        const adminUser = await User.findById(req.session.userId);

        // Перевірка прав (якщо викликається через API, а не ботом)
        if (adminUser && (adminUser.role !== 'SM' && adminUser.role !== 'admin')) {
            return res.status(403).json({ success: false, message: "Тільки SM може приймати рішення" });
        }

        const request = await Request.findById(requestId);
        if (!request) return res.status(404).json({ success: false, message: "Запит не знайдено" });

        const targetUser = await User.findById(request.data.userId);
        if (!targetUser) {
            await Request.findByIdAndDelete(requestId);
            return res.status(404).json({ success: false, message: "Користувач не знайдений" });
        }

        if (action === 'approve') {
            // 🔥 ГОЛОВНА МАГІЯ: Зміна магазину
            const oldStoreId = targetUser.storeId;
            targetUser.storeId = request.data.targetStoreId;
            await targetUser.save();

            // Логування
            await AuditLog.create({
                performer: adminUser ? adminUser.name : "System/Bot",
                action: 'approve_transfer',
                details: `${targetUser.name} moved to ${request.data.targetStoreName}`
            });

            // Сповіщення користувача
            const bot = getBot();
            if (bot && targetUser.telegramChatId) {
                bot.sendMessage(targetUser.telegramChatId, `✅ <b>Вас переведено!</b>\n🏠 Новий магазин: <b>${request.data.targetStoreName}</b>\n\nГрафік оновлено.`, {parse_mode: 'HTML'});
            }

        } else {
            // Відхилення
             const bot = getBot();
             if (bot && targetUser.telegramChatId) {
                 bot.sendMessage(targetUser.telegramChatId, `❌ <b>Запит на переведення відхилено.</b>`, {parse_mode: 'HTML'});
             }
        }

        // Видаляємо запит після обробки
        await Request.findByIdAndDelete(requestId);
        res.json({ success: true });

    } catch (e) {
        console.error(e);
        res.status(500).json({ success: false, message: e.message });
    }
};