const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// 0. Схема Магазину (ОНОВЛЕНО)
// Зберігає налаштування конкретного магазину та Telegram-групи
const storeSchema = new mongoose.Schema({
    name: { type: String, required: true }, // Назва: "IQOS Space Dream Town"
    type: { type: String, enum: ['Експансія', 'ТОП 5', 'Київ', 'Standard'], default: 'Standard' }, // Тип для майбутнього розрахунку ЗП
    code: { type: String, unique: true, required: true }, // Унікальний код (напр. "iqos_dt") для реєстрації
    telegram: {
        chatId: { type: Number, default: null },       // ID групи магазину
        newsTopicId: { type: Number, default: null },  // Гілка новин
        requestsTopicId: { type: Number, default: null }, // Гілка запитів
        eveningTopicId: { type: Number, default: null }   // 🔥 НОВЕ: Гілка для звіту "Хто завтра"
    },
    createdAt: { type: Date, default: Date.now }
});

// 1. Схема Користувача (ОНОВЛЕНО)
const userSchema = new mongoose.Schema({
    // Auth info
    username: { type: String, unique: true, required: true }, // login
    password: { type: String, required: true },
    
    // Personal info (НОВЕ - для реєстрації)
    fullName: { type: String, default: '' }, // ПІП
    email: { type: String, default: '' },
    phone: { type: String, default: '' },
    
    // System info
    name: { type: String, required: true }, // Коротке ім'я для графіку (напр. "Стас")
    avatar: { type: String, default: null }, 
    telegramChatId: { type: Number, default: null }, 
    
    // Work info (НОВЕ - для кадрів і ЗП)
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', default: null }, // Прив'язка до магазину
    role: { type: String, enum: ['admin', 'SM', 'SSE', 'SE', 'RRP', 'Guest'], default: 'Guest' }, // Guest - до апруву
    position: { type: String, enum: ['SM', 'SSE', 'SE', 'RRP', 'None'], default: 'None' }, // Конкретна посада
    grade: { type: Number, default: 0 }, // 3, 4, 5... (0 - не визначено)
    status: { type: String, enum: ['pending', 'active', 'blocked'], default: 'active' }, // pending - чекає підтвердження
    
    // Settings
    reminderTime: { type: String, default: 'none' },
    tSalesCookie: { type: String, default: null }
});

userSchema.methods.comparePassword = async function(candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
};

// 2. Схема Зміни
const shiftSchema = new mongoose.Schema({
    date: { type: String, required: true }, // YYYY-MM-DD
    name: { type: String, required: true },
    start: { type: String, required: true }, // HH:MM
    end: { type: String, required: true }    // HH:MM
});

// 3. Схема Задачі
const taskSchema = new mongoose.Schema({
    title: { type: String, required: true },
    date: { type: String, required: true },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    isFullDay: { type: Boolean, default: false },
    start: { type: String, default: '' },
    end: { type: String, default: '' }
});

// 4. Схема Новин
const newsPostSchema = new mongoose.Schema({
    messageId: { type: Number, required: true },
    chatId: { type: Number, required: true },
    text: { type: String },
    type: { type: String, default: 'text' }, // text, file
    readBy: { type: [String], default: [] }, // Список імен тих, хто прочитав
    createdAt: { type: Date, default: Date.now }
});

// 5. Схема Запитів (Requests)
const requestSchema = new mongoose.Schema({
    type: { type: String, required: true }, // add_shift, del_shift, add_task
    data: { type: Object, required: true }, // Дані зміни/задачі
    createdBy: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});

// 6. Схема Нотаток
const noteSchema = new mongoose.Schema({
    date: { type: String, required: true },
    text: { type: String, required: true },
    author: { type: String, required: true },
    type: { type: String, enum: ['private', 'public'], default: 'private' }
});

// 7. Схема Логів
const auditLogSchema = new mongoose.Schema({
    timestamp: { type: Date, default: Date.now },
    performer: { type: String, required: true },
    action: { type: String, required: true },
    details: { type: String, default: '' }
});

// 8. Схема Контактів
const contactSchema = new mongoose.Schema({
    name: { type: String, required: true },
    phone: { type: String, required: true }
});

// 9. Схема Подій
const eventSchema = new mongoose.Schema({
    title: { type: String, required: true },
    date: { type: String, required: true }
});

// 10. Схема KPI
const kpiSchema = new mongoose.Schema({
    month: { type: String, required: true }, // "YYYY-MM"
    name: { type: String, required: true },  // "Ivanov" або "TOTAL"
    updatedAt: { type: Date, default: Date.now },
    stats: {
        orders: { type: Number, default: 0 },        // Замовлень (User)
        devices: { type: Number, default: 0 },       // Девайсів (User)
        devicesTarget: { type: Number, default: 0 }, // Ціль девайсів
        devicePercent: { type: Number, default: 0 }, // % Device KPI
        upt: { type: Number, default: 0 },           // UPT факт
        uptTarget: { type: Number, default: 0 },     // UPT ціль
        uptPercent: { type: Number, default: 0 },    // % UPT KPI
        nps: { type: Number, default: 0 },           // NPS
        npsTarget: { type: Number, default: 0 },     // NPS ціль (NEW)
        npsPercent: { type: Number, default: 0 },    // % NPS KPI (NEW)
        nba: { type: Number, default: 0 },           // NBA
        nbaPercent: { type: Number, default: 0 }     // % NBA KPI (NEW)
    }
});

// 11. Схема Налаштувань Місяця
const monthSettingsSchema = new mongoose.Schema({
    month: { type: String, required: true, unique: true }, // "YYYY-MM"
    normHours: { type: Number, required: true }
});

// 12. Схема Відкладених Сповіщень (ТИХА ГОДИНА)
const pendingNotificationSchema = new mongoose.Schema({
    chatId: { type: Number, required: true },
    text: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});

const Store = mongoose.model('Store', storeSchema);
const User = mongoose.model('User', userSchema);
const Shift = mongoose.model('Shift', shiftSchema);
const Task = mongoose.model('Task', taskSchema);
const NewsPost = mongoose.model('NewsPost', newsPostSchema);
const Request = mongoose.model('Request', requestSchema);
const Note = mongoose.model('Note', noteSchema);
const AuditLog = mongoose.model('AuditLog', auditLogSchema);
const Contact = mongoose.model('Contact', contactSchema);
const Event = mongoose.model('Event', eventSchema);
const KPI = mongoose.model('KPI', kpiSchema);
const MonthSettings = mongoose.model('MonthSettings', monthSettingsSchema);
const PendingNotification = mongoose.model('PendingNotification', pendingNotificationSchema);

module.exports = { Store, User, Shift, Task, NewsPost, Request, Note, AuditLog, Contact, Event, KPI, MonthSettings, PendingNotification };