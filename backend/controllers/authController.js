const { User, Store, Shift, Task } = require('../models');
const { logAction } = require('../utils');
const { getBot } = require('../bot');
const bcrypt = require('bcryptjs');

exports.getStores = async (req, res) => {
    try {
        const stores = await Store.find({}, 'name code type');
        res.json(stores);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

exports.register = async (req, res) => {
    try {
        const { fullName, username, password, phone, email, storeCode } = req.body;

        const existingUser = await User.findOne({ username });
        if (existingUser) return res.json({ success: false, message: "Цей логін вже зайнятий" });

        const store = await Store.findOne({ code: storeCode });
        if (!store) return res.json({ success: false, message: "Магазин не знайдено" });

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        const shortName = fullName.split(' ')[0] || username;

        const newUser = await User.create({
            username,
            password: hashedPassword,
            fullName,
            name: shortName,
            phone,
            email,
            storeId: store._id,
            role: 'Guest',
            status: 'pending',
            position: 'None',
            grade: 0
        });

        const bot = getBot();
        if (bot) {
            const managers = await User.find({ storeId: store._id, role: { $in: ['SM', 'admin'] } });
            for (const sm of managers) {
                if (sm.telegramChatId) {
                    try {
                        await bot.sendMessage(sm.telegramChatId,
                            `🔔 <b>Нова заявка на вступ!</b>\n\n👤 <b>${fullName}</b>\n📞 ${phone}\n🏪 Магазин: ${store.name}\n\nОберіть дію:`,
                            {
                                parse_mode: 'HTML',
                                reply_markup: {
                                    inline_keyboard: [
                                        [
                                            { text: "✅ Прийняти", callback_data: `approve_user_${newUser._id}` },
                                            { text: "❌ Відхилити", callback_data: `reject_user_${newUser._id}` }
                                        ]
                                    ]
                                }
                            }
                        );
                    } catch (e) { console.error(e); }
                }
            }
        }

        logAction('System', 'register_user', `New user: ${username} (${store.name})`);
        res.json({ success: true });

    } catch (e) {
        console.error('❌ Помилка реєстрації:', e);
        res.status(500).json({ success: false, message: "Помилка сервера" });
    }
};

exports.login = async (req, res) => {
    try {
        const { username, password, telegramId } = req.body;
        // Знаходимо користувача за іменем
        const user = await User.findOne({ username }).populate('storeId');

        if (!user) {
            return res.json({ success: false, message: 'Користувача не знайдено' });
        }

        // Перевіряємо зашифрований пароль
        const isMatch = await user.comparePassword(password);

        if (!isMatch) {
            return res.json({ success: false, message: 'Невірний пароль' });
        }

        if (user.status === 'blocked') {
            return res.json({ success: false, message: "Акаунт заблоковано" });
        }

        req.session.userId = user._id;

        // 🔥 НОВЕ: Автоматична прив'язка Telegram, якщо користувач входить з WebApp
        if (telegramId && !user.telegramChatId) {
            user.telegramChatId = telegramId;
            await user.save();

            const bot = getBot();
            if (bot) {
                bot.sendMessage(telegramId, `✅ <b>Привіт, ${user.name}!</b>\n\nТвій акаунт успішно прив'язано до Telegram. Тепер ти отримуватимеш сюди сповіщення про задачі та графік роботи.`, { parse_mode: 'HTML' }).catch(() => { });
            }
        }

        logAction(user.name, 'login', 'Web Login');
        return res.json({
            success: true,
            user: {
                _id: user._id,
                name: user.name,
                role: user.role,
                avatar: user.avatar,
                status: user.status,
                storeId: user.storeId?._id || user.storeId,
                store: user.storeId ? {
                    openTime: user.storeId.openTime,
                    closeTime: user.storeId.closeTime,
                    reportTime: user.storeId.telegram?.reportTime,
                    kpi_enabled: user.storeId.kpi_enabled !== false
                } : null,
                hasTelegram: !!user.telegramChatId
            }
        });
    } catch (e) {
        res.status(500).json({ success: false });
    }
};

exports.updateUser = async (req, res) => {
    const admin = await User.findById(req.session.userId);
    if (!admin || (admin.role !== 'SM' && admin.role !== 'admin')) {
        return res.status(403).json({ success: false, message: "Тільки SM може редагувати" });
    }

    try {
        // 🔥 НОВЕ: отримуємо sortOrder
        const { id, fullName, email, phone, position, grade, role, status, storeId, sortOrder } = req.body;
        const userToEdit = await User.findById(id);
        if (!userToEdit) return res.json({ success: false, message: "Користувача не знайдено" });

        if (admin.role === 'SM' && String(userToEdit.storeId) !== String(admin.storeId)) {
            return res.status(403).json({ success: false, message: "Це не ваш співробітник" });
        }

        if (fullName !== undefined) userToEdit.fullName = fullName;
        if (email !== undefined) userToEdit.email = email;
        if (phone !== undefined) userToEdit.phone = phone;
        if (position !== undefined) userToEdit.position = position;
        if (grade !== undefined) userToEdit.grade = Number(grade);
        if (role !== undefined) userToEdit.role = role;

        // 🔥 НОВЕ: Оновлення порядку сортування
        if (sortOrder !== undefined) userToEdit.sortOrder = Number(sortOrder);

        if (admin.role === 'admin' && storeId !== undefined) {
            userToEdit.storeId = storeId === 'null' ? null : storeId;
        }

        if (status !== undefined) {
            userToEdit.status = status;

            if (status === 'blocked') {
                const tomorrow = new Date();
                tomorrow.setDate(tomorrow.getDate() + 1);
                const tomorrowStr = tomorrow.toISOString().split('T')[0];

                await Shift.deleteMany({ name: userToEdit.name, date: { $gte: tomorrowStr } });
                await Task.deleteMany({ name: userToEdit.name, date: { $gte: tomorrowStr } });
            }
        }

        await userToEdit.save();
        logAction(admin.name, 'update_user', `Updated profile for ${userToEdit.name}`);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
};

exports.changePassword = async (req, res) => {
    if (!req.session.userId) return res.status(403).json({});
    try {
        const { oldPassword, newPassword } = req.body;
        const user = await User.findById(req.session.userId);
        if (!user) return res.json({ success: false, message: "User not found" });

        const isMatch = await user.comparePassword(oldPassword);
        if (!isMatch) return res.json({ success: false, message: "Старий пароль невірний" });

        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(newPassword, salt);
        await user.save();

        logAction(user.name, 'change_password', 'Password updated');
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
};

exports.updateNotificationPref = async (req, res) => {
    if (!req.session.userId) return res.status(403).json({});
    try {
        const { preference } = req.body;
        if (!['telegram', 'push', 'both'].includes(preference)) {
            return res.json({ success: false, message: "Invalid preference" });
        }
        await User.findByIdAndUpdate(req.session.userId, { notificationPreference: preference });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
};

exports.telegramLogin = async (req, res) => {
    const { telegramId } = req.body;
    if (!telegramId) return res.json({ success: false });

    const user = await User.findOne({ telegramChatId: telegramId }).populate('storeId');
    if (user) {
        req.session.userId = user._id;
        logAction(user.name, 'login', 'Tg Login');
        res.json({
            success: true,
            user: {
                _id: user._id,
                name: user.name,
                role: user.role,
                avatar: user.avatar,
                status: user.status,
                storeId: user.storeId?._id || user.storeId,
                store: user.storeId ? {
                    openTime: user.storeId.openTime,
                    closeTime: user.storeId.closeTime,
                    reportTime: user.storeId.telegram?.reportTime,
                    kpi_enabled: user.storeId.kpi_enabled !== false
                } : null,
                notificationPreference: user.notificationPreference || 'telegram',
                hasTelegram: !!user.telegramChatId
            }
        });
    } else res.json({ success: false });
};

exports.logout = (req, res) => {
    req.session.destroy();
    res.json({ success: true });
};

exports.getUsers = async (req, res) => {
    if (!req.session.userId) return res.status(403).json([]);
    const currentUser = await User.findById(req.session.userId);
    let query = {};

    if (currentUser.role !== 'admin') {
        query.storeId = currentUser.storeId;
    }

    // 🔥 НОВЕ: Додав sortOrder у вибірку
    const users = await User.find(query, 'name role avatar fullName email phone position grade status storeId sortOrder');
    res.json(users);
};

exports.getMe = async (req, res) => {
    if (!req.session.userId) return res.json({ loggedIn: false });
    // 🔥 НОВЕ: populate storeId щоб отримати графік роботи магазину
    const user = await User.findById(req.session.userId).populate('storeId');

    let userData = null;
    if (user) {
        userData = {
            _id: user._id, // Додали ID для надійності
            name: user.name,
            role: user.role,
            avatar: user.avatar,
            status: user.status,
            storeId: user.storeId?._id || user.storeId,

            store: user.storeId ? {
                openTime: user.storeId.openTime,
                closeTime: user.storeId.closeTime,
                reportTime: user.storeId.telegram?.reportTime,
                kpi_enabled: user.storeId.kpi_enabled !== false // Default to true if undefined
            } : null,
            notificationPreference: user.notificationPreference || 'telegram',
            hasTelegram: !!user.telegramChatId
        };
    }

    res.json({ loggedIn: !!user, user: userData });
};

// --- СКИДАННЯ ПАРОЛЯ ЧЕРЕЗ TELEGRAM ---
const crypto = require('crypto');

exports.forgotPassword = async (req, res) => {
    try {
        const { username } = req.body;
        const user = await User.findOne({ username });

        if (!user) {
            return res.json({ success: false, message: "Користувача не знайдено" });
        }

        if (!user.telegramChatId) {
            return res.json({ success: false, message: "Для відновлення пароля потрібен прив'язаний Telegram акаунт" });
        }

        // Генеруємо токен
        const resetToken = crypto.randomBytes(32).toString('hex');

        // Зберігаємо хеш токена в БД (через bcrypt для безпеки)
        user.resetPasswordToken = await bcrypt.hash(resetToken, await bcrypt.genSalt(10));
        user.resetPasswordExpires = Date.now() + 15 * 60 * 1000; // 15 хвилин
        await user.save();

        const bot = getBot();
        if (bot) {
            // Формуємо посилання з `startapp` параметром
            const webAppUrl = process.env.WEBAPP_URL || 'https://shifter-app.onrender.com';
            // Вказуємо url, який буде відкриватись по кнопці
            // Приблизний вигляд: t.me/shifter_prod_bot/app?startapp=reset_TOKEN

            await bot.sendMessage(
                user.telegramChatId,
                `🔐 <b>Запит на скидання пароля</b>\n\nХтось (ймовірно ти) запросив скидання пароля для акаунта <b>${user.username}</b>.\n\nНатисни кнопку нижче, щоб встановити новий пароль. Посилання дійсне 15 хвилин.\n\n<i>Якщо це був не ти, просто проігноруй це повідомлення.</i>`,
                {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [[
                            { text: "🔑 Відкрити форму скидання", web_app: { url: `${webAppUrl}?reset=${resetToken}&user=${user._id}` } }
                        ]]
                    }
                }
            );
        }

        res.json({ success: true, message: "Інструкції відправлено в Telegram!" });

    } catch (e) {
        console.error("Forgot Password Error:", e);
        res.status(500).json({ success: false, message: "Помилка сервера" });
    }
};

exports.resetPassword = async (req, res) => {
    try {
        const { token, newPassword, userId } = req.body;

        if (!userId || !token || !newPassword) {
            return res.json({ success: false, message: "Некоректні дані" });
        }

        const user = await User.findById(userId);

        if (!user || !user.resetPasswordToken || !user.resetPasswordExpires) {
            return res.json({ success: false, message: "Токен недійсний або акаунт не знайдено" });
        }

        if (user.resetPasswordExpires < Date.now()) {
            return res.json({ success: false, message: "Час дії токена (15 хв) минув. Зробіть новий запит." });
        }

        const isValidToken = await bcrypt.compare(token, user.resetPasswordToken);
        if (!isValidToken) {
            return res.json({ success: false, message: "Невірний токен" });
        }

        // Встановлюємо новий пароль
        user.password = await bcrypt.hash(newPassword, await bcrypt.genSalt(10));
        user.resetPasswordToken = undefined;
        user.resetPasswordExpires = undefined;
        await user.save();

        const bot = getBot();
        if (bot && user.telegramChatId) {
            bot.sendMessage(user.telegramChatId, `✅ <b>Пароль успішно змінено!</b>\n\nТепер ти можеш увійти в додаток з новим паролем.`, { parse_mode: 'HTML' }).catch(() => { });
        }

        logAction(user.name, 'reset_password', 'Password reset via Telegram token');
        res.json({ success: true, message: "Пароль успішно змінено!" });

    } catch (e) {
        console.error("Reset Password Error:", e);
        res.status(500).json({ success: false, message: "Помилка сервера" });
    }
};

exports.uploadAvatar = async (req, res) => {
    if (!req.session.userId) return res.status(403).json({});
    const { avatar } = req.body;
    // base64 строка ~4/3 від реального розміру; 500KB реальних ≈ 680KB base64
    if (avatar && avatar.length > 700000) {
        return res.status(400).json({ success: false, message: 'Зображення завелике. Максимальний розмір: ~500 KB' });
    }
    await User.findByIdAndUpdate(req.session.userId, { avatar });
    res.json({ success: true });
};

exports.getTelegramLink = async (req, res) => {
    if (!req.session.userId) return res.status(403).json({});
    const bot = getBot();
    if (!bot) return res.json({ success: false, message: "Bot not initialized" });
    try {
        const me = await bot.getMe();
        const url = `https://t.me/${me.username}?start=auth_${req.session.userId}`;
        res.json({ success: true, url });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
};