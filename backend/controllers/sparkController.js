const { Store, User, Request, Shift } = require('../models');
const { notifyUser } = require('../bot');
const { logAction } = require('../utils');

exports.syncSchedule = async (req, res) => {
    try {
        // 1. Авторизація по API ключу
        const apiKey = req.headers['x-api-key'];
        if (!apiKey || apiKey !== process.env.SPARK_API_KEY) {
            return res.status(403).json({ success: false, message: 'Forbidden: Invalid API Key' });
        }

        const { storeCode, updates } = req.body;
        if (!updates || updates.length === 0) {
            return res.json({ success: true, message: 'No updates provided' });
        }

        // 2. Знайти магазин за кодом
        const store = await Store.findOne({ code: storeCode });
        if (!store) {
            return res.status(404).json({ success: false, message: `Store with code ${storeCode} not found` });
        }

        let reqCount = 0;
        let changesText = [];

        // 3. Згенерувати запити (Requests)
        for (const item of updates) {
            // Намагаємось знайти користувача, якщо він прив'язаний до іншого магазину (як підміна), але за замовчуванням беремо поточний магазин
            const targetUser = await User.findOne({ name: item.name });
            const storeId = targetUser ? targetUser.storeId : store._id;

            if (item.start === 'DELETE') {
                const s = await Shift.findOne({ date: item.date, name: item.name });
                if (s) {
                    await Request.create({
                        type: 'del_shift',
                        data: { id: s._id, date: s.date, name: s.name },
                        createdBy: 'Gemini Spark'
                    });
                    reqCount++;
                    changesText.push(`❌ ${item.name} (${item.date})`);
                }
            } else {
                await Request.create({
                    type: 'add_shift',
                    data: { ...item, storeId },
                    createdBy: 'Gemini Spark'
                });
                reqCount++;
                const shiftType = (item.start === 'Лікарняний' || item.start === 'Відпустка' || item.start === 'Донорство') ? item.start : `${item.start}-${item.end}`;
                changesText.push(`➕ ${item.name} (${item.date}) ${shiftType}`);
            }
        }

        // 4. Відправити сповіщення SM
        if (reqCount > 0) {
            const managers = await User.find({ storeId: store._id, role: { $in: ['SM', 'admin'] } });

            let detailsStr = changesText.slice(0, 15).join('\n');
            if (changesText.length > 15) {
                detailsStr += `\n... та ще ${changesText.length - 15} змін`;
            }

            const buttons = {
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: "✅ Підтвердити Всі", callback_data: "approve_all_requests" },
                            { text: "❌ Відхилити Всі", callback_data: "reject_all_requests" }
                        ]
                    ]
                }
            };

            managers.forEach(m => {
                notifyUser(m.name, `✨ <b>Gemini Spark Синхронізація</b>\nОтримано нові зміни на підтвердження:\n\n${detailsStr}`, buttons);
            });
            
            logAction('Gemini Spark', 'spark_sync_requests', `Generated ${reqCount} requests for store ${storeCode}`);
        }

        return res.json({ success: true, count: reqCount, message: 'Requests generated successfully' });
    } catch (e) {
        console.error("Spark Sync Error:", e);
        return res.status(500).json({ success: false, message: e.message });
    }
};
