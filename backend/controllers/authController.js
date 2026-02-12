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
        const { username, password } = req.body;
        const user = await User.findOne({ username });

        if (user && (await user.comparePassword(password))) {
            if (user.status === 'blocked') {
                return res.json({ success: false, message: "Акаунт заблоковано" });
            }
            req.session.userId = user._id;
            logAction(user.name, 'login', 'Web Login');
            // Підтягуємо деталі магазину одразу при логіні, якщо треба
            res.json({ success: true, user: { name: user.name, role: user.role, avatar: user.avatar, status: user.status } });
        } else {
            res.json({ success: false, message: "Невірний логін або пароль" });
        }
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

exports.loginTelegram = async (req, res) => {
    const { telegramId } = req.body;
    const user = await User.findOne({ telegramChatId: telegramId });
    if (user) {
        req.session.userId = user._id;
        logAction(user.name, 'login', 'Tg Login');
        res.json({ success: true, user: { name: user.name, role: user.role, avatar: user.avatar } });
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
            
            // Передаємо дані магазину (якщо є)
            store: user.storeId ? {
                openTime: user.storeId.openTime,
                closeTime: user.storeId.closeTime,
                reportTime: user.storeId.telegram?.reportTime
            } : null
        };
    }

    res.json({ loggedIn: !!user, user: userData });
};

exports.uploadAvatar = async (req, res) => {
    if (!req.session.userId) return res.status(403).json({});
    await User.findByIdAndUpdate(req.session.userId, { avatar: req.body.avatar });
    res.json({ success: true });
};