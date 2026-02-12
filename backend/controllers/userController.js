const { User, Store, Request, AuditLog } = require('../models');
const { logAction } = require('../utils');
const { getBot, notifyUser } = require('../bot'); // 🔥 Додав notifyUser

// Створення запиту на переведення (викликається СЕ)
exports.requestTransfer = async (req, res) => {
    try {
        if (!req.session.userId) return res.status(403).json({ success: false, message: "Не авторизовано" });

        const { targetStoreCode } = req.body;
        const user = await User.findById(req.session.userId);
        
        if (!user) return res.status(404).json({ success: false, message: "Користувача не знайдено" });

        const targetStore = await Store.findOne({ code: targetStoreCode });
        if (!targetStore) return res.status(404).json({ success: false, message: "Магазин не знайдено" });

        if (String(user.storeId) === String(targetStore._id)) {
            return res.status(400).json({ success: false, message: "Ви вже працюєте в цьому магазині" });
        }

        const existingReq = await Request.findOne({ 
            createdBy: user.name, 
            type: 'transfer_request',
            'data.targetStoreId': targetStore._id 
        });
        if (existingReq) {
            return res.status(400).json({ success: false, message: "Заявка на цей магазин вже подана" });
        }

        const newRequest = await Request.create({
            type: 'transfer_request',
            createdBy: user.name,
            data: {
                userId: user._id,
                currentStoreId: user.storeId,
                targetStoreId: targetStore._id,
                targetStoreName: targetStore.name
            }
        });

        // Сповіщення SM-ів НОВОГО магазину (тут залишаємо getBot, бо потрібні кнопки)
        const bot = getBot();
        if (bot) {
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
        const { requestId, action } = req.body;
        const adminUser = await User.findById(req.session.userId);

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
            targetUser.storeId = request.data.targetStoreId;
            await targetUser.save();

            await AuditLog.create({
                performer: adminUser ? adminUser.name : "System/Bot",
                action: 'approve_transfer',
                details: `${targetUser.name} moved to ${request.data.targetStoreName}`
            });

            // 🔥 ВИПРАВЛЕНО: Використовуємо notifyUser для підтримки "тихих годин"
            notifyUser(targetUser.name, `✅ <b>Вас переведено!</b>\n🏠 Новий магазин: <b>${request.data.targetStoreName}</b>\n\nГрафік оновлено.`);

        } else {
            // 🔥 ВИПРАВЛЕНО: Використовуємо notifyUser
            notifyUser(targetUser.name, `❌ <b>Запит на переведення відхилено.</b>`);
        }

        await Request.findByIdAndDelete(requestId);
        res.json({ success: true });

    } catch (e) {
        console.error(e);
        res.status(500).json({ success: false, message: e.message });
    }
};