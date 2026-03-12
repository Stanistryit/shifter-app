const { Notification } = require('../models');

// Зберігаємо підключених клієнтів (userId -> набір об'єктів res)
const clients = new Map();

exports.stream = async (req, res) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).end();
    }

    // Normalize to string so it matches ObjectId.toString() from bot calls
    const userId = req.session.userId.toString();

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Додаємо клієнта
    if (!clients.has(userId)) {
        clients.set(userId, new Set());
    }
    clients.get(userId).add(res);

    // Відправляємо початкову подію
    res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

    // Heartbeat кожні 25 секунд — запобігає розриву з'єднання на Render/Heroku
    const heartbeat = setInterval(() => {
        try { res.write(': ping\n\n'); } catch (e) { clearInterval(heartbeat); }
    }, 25000);

    // При закритті з'єднання видаляємо клієнта і зупиняємо heartbeat
    req.on('close', () => {
        clearInterval(heartbeat);
        const userClients = clients.get(userId);
        if (userClients) {
            userClients.delete(res);
            if (userClients.size === 0) {
                clients.delete(userId);
            }
        }
    });
};

// Функція для відправки події конкретному юзеру
exports.sendToUser = (userId, data) => {
    // toString() normalizes both string and ObjectId keys
    const userClients = clients.get(userId.toString());
    if (userClients) {
        userClients.forEach(res => {
            try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch (e) { }
        });
    }
};

// Відправка всім (наприклад, для глобальних сповіщень)
exports.sendToAll = (data) => {
    clients.forEach(userClients => {
        userClients.forEach(res => {
            res.write(`data: ${JSON.stringify(data)}\n\n`);
        });
    });
};

// Отримання списку сповіщень
exports.getNotifications = async (req, res) => {
    if (!req.session.userId) return res.status(401).json([]);
    try {
        const notifs = await Notification.find({ userId: req.session.userId })
            .sort({ createdAt: -1 })
            .limit(50);
        res.json(notifs);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// Маркування як прочитані
exports.markAsRead = async (req, res) => {
    if (!req.session.userId) return res.status(401).json({});
    try {
        await Notification.updateMany(
            { userId: req.session.userId, isRead: false },
            { $set: { isRead: true } }
        );
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// Broadcast від адміна всім підключеним користувачам
exports.broadcastNotification = async (req, res) => {
    if (!req.session.userId) return res.status(401).json({});

    const { User } = require('../models');
    const caller = await User.findById(req.session.userId).select('role');
    if (!caller || caller.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    const { title = '📢 Повідомлення', message } = req.body;
    if (!message || !message.trim()) {
        return res.status(400).json({ success: false, message: 'Повідомлення порожнє' });
    }

    try {
        // Створюємо записи для всіх користувачів
        const allUsers = await User.find({}).select('_id');
        const docs = allUsers.map(u => ({
            userId: u._id,
            title,
            message: message.trim(),
            type: 'info'
        }));
        await Notification.insertMany(docs);

        // Відправляємо SSE всім підключеним клієнтам
        const payload = JSON.stringify({ type: 'notification', notification: { title, message: message.trim(), type: 'info' } });
        clients.forEach(userClients => {
            userClients.forEach(r => {
                try { r.write(`data: ${payload}\n\n`); } catch (e) { }
            });
        });

        res.json({ success: true, sentTo: allUsers.length });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
};
