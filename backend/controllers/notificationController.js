const { Notification } = require('../models');

// Зберігаємо підключених клієнтів (userId -> набір об'єктів res)
const clients = new Map();

exports.stream = async (req, res) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).end();
    }

    const userId = req.session.userId;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders(); // Відправляємо заголовки одразу

    // Додаємо клієнта
    if (!clients.has(userId)) {
        clients.set(userId, new Set());
    }
    clients.get(userId).add(res);

    // Відправляємо початкову подію, щоб з'єднання не розірвалось
    res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

    // При закритті з'єднання видаляємо клієнта
    req.on('close', () => {
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
    const userClients = clients.get(userId.toString());
    if (userClients) {
        userClients.forEach(res => {
            res.write(`data: ${JSON.stringify(data)}\n\n`);
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

// Відмітка прочитання
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
