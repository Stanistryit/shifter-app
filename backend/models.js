const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// 0. Схема Магазину
const storeSchema = new mongoose.Schema({
    name: { type: String, required: true },
    type: { type: String, enum: ['expansion', 'top', 'kiev', 'standard'], default: 'standard' },
    code: { type: String, unique: true, required: true },

    // Графік роботи магазину (для таймлайну)
    openTime: { type: String, default: '10:00' },
    closeTime: { type: String, default: '22:00' },

    telegram: {
        chatId: { type: Number, default: null },
        newsTopicId: { type: Number, default: null },
        requestsTopicId: { type: Number, default: null },
        eveningTopicId: { type: Number, default: null },
        reportTime: { type: String, default: "20:00" }
    },
    createdAt: { type: Date, default: Date.now }
});

// 1. Схема Користувача
const userSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    password: { type: String, required: true },

    fullName: { type: String, default: '' },
    email: { type: String, default: '' },
    phone: { type: String, default: '' },

    name: { type: String, required: true },
    avatar: { type: String, default: null },
    telegramChatId: { type: Number, default: null },

    storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', default: null },
    role: { type: String, enum: ['admin', 'SM', 'SSE', 'SE', 'RRP', 'Guest'], default: 'Guest' },
    position: { type: String, enum: ['SM', 'SSE', 'SE', 'RRP', 'None'], default: 'None' },
    grade: { type: Number, default: 0 },
    status: { type: String, enum: ['pending', 'active', 'blocked'], default: 'active' },

    // Порядок сортування (чим менше число, тим вище у списку)
    sortOrder: { type: Number, default: 999 },

    reminderTime: { type: String, default: 'none' },
    tSalesCookie: { type: String, default: null }
});

userSchema.methods.comparePassword = async function (candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
};

// 2. Схема Зміни
const shiftSchema = new mongoose.Schema({
    date: { type: String, required: true },
    name: { type: String, required: true },
    start: { type: String, required: true },
    end: { type: String, required: true },
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', default: null }
});

// 3. Схема Задачі
const taskSchema = new mongoose.Schema({
    title: { type: String, required: true },
    date: { type: String, required: true },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    isFullDay: { type: Boolean, default: false },
    start: { type: String, default: '' },
    end: { type: String, default: '' },
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', default: null }
});

// 4. Схема Новин
const newsPostSchema = new mongoose.Schema({
    messageId: { type: Number, required: true },
    chatId: { type: Number, required: true },
    text: { type: String },
    type: { type: String, default: 'text' },
    readBy: { type: [String], default: [] },
    createdAt: { type: Date, default: Date.now }
});

// 5. Схема Запитів
const requestSchema = new mongoose.Schema({
    type: { type: String, required: true },
    data: { type: Object, required: true },
    createdBy: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});

// 6. Схема Нотаток
const noteSchema = new mongoose.Schema({
    date: { type: String, required: true },
    text: { type: String, required: true },
    author: { type: String, required: true },
    type: { type: String, enum: ['private', 'public'], default: 'private' },
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', default: null }
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
    month: { type: String, required: true },
    name: { type: String, required: true },
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', default: null },
    updatedAt: { type: Date, default: Date.now },
    stats: {
        orders: { type: Number, default: 0 },
        devices: { type: Number, default: 0 },
        devicesTarget: { type: Number, default: 0 },
        devicePercent: { type: Number, default: 0 },
        upt: { type: Number, default: 0 },
        uptTarget: { type: Number, default: 0 },
        uptPercent: { type: Number, default: 0 },
        nps: { type: Number, default: 0 },
        npsTarget: { type: Number, default: 0 },
        npsPercent: { type: Number, default: 0 },
        nba: { type: Number, default: 0 },
        nbaPercent: { type: Number, default: 0 }
    }
});

// 11. Схема Налаштувань Місяця 
const monthSettingsSchema = new mongoose.Schema({
    month: { type: String, required: true },
    normHours: { type: Number, required: true },
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', default: null }
});

// 12. Схема Відкладених Сповіщень
const pendingNotificationSchema = new mongoose.Schema({
    chatId: { type: Number, required: true },
    text: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});

// 🔥 13. Схема Матриці Зарплат (Salary Matrix)
const salaryMatrixSchema = new mongoose.Schema({
    storeType: { type: String, enum: ['expansion', 'top', 'kiev', 'standard'], required: true },
    // Прибрали RRP і None, щоб уникнути помилок при налаштуванні матриці
    position: { type: String, enum: ['SM', 'SSE', 'SE'], required: true },
    grade: { type: Number, required: true },
    rate: { type: Number, required: true, default: 0 }, // Базова ставка за норму годин
    updatedAt: { type: Date, default: Date.now }
});

// 🔥 Індекси для швидкодії
storeSchema.index({ 'telegram.chatId': 1 }); // Швидкий пошук магазину по чату
storeSchema.index({ 'telegram.reportTime': 1 }); // Для крон-задачі вечірніх звітів

userSchema.index({ storeId: 1, role: 1 }); // Списки юзерів в межах магазину
userSchema.index({ name: 1 }); // Часто шукаємо юзера по імені для призначення задач
userSchema.index({ telegramChatId: 1 }); // Швидка ідентифікація при запитах з бота

shiftSchema.index({ storeId: 1, date: 1 }); // Вивантаження графіка магазину на місяць/день
shiftSchema.index({ date: 1, name: 1 }); // Допомагає при перевірці дублів змін

taskSchema.index({ storeId: 1, date: 1 }); // Вивантаження задач для конкретного дня
taskSchema.index({ date: 1, name: 1 }); // Задачі для конкретного працівника на день

kpiSchema.index({ storeId: 1, month: 1 }); // Завантаження KPI магазину за конкретний місяць

// Індекс для уникнення дублів (один запис на кожну комбінацію: тип магазину + посада + грейд)
salaryMatrixSchema.index({ storeType: 1, position: 1, grade: 1 }, { unique: true });

const Store = mongoose.models.Store || mongoose.model('Store', storeSchema);
const User = mongoose.models.User || mongoose.model('User', userSchema);
const Shift = mongoose.models.Shift || mongoose.model('Shift', shiftSchema);
const Task = mongoose.models.Task || mongoose.model('Task', taskSchema);
const NewsPost = mongoose.models.NewsPost || mongoose.model('NewsPost', newsPostSchema);
const Request = mongoose.models.Request || mongoose.model('Request', requestSchema);
const Note = mongoose.models.Note || mongoose.model('Note', noteSchema);
const AuditLog = mongoose.models.AuditLog || mongoose.model('AuditLog', auditLogSchema);
const Contact = mongoose.models.Contact || mongoose.model('Contact', contactSchema);
const Event = mongoose.models.Event || mongoose.model('Event', eventSchema);
const KPI = mongoose.models.KPI || mongoose.model('KPI', kpiSchema);
const MonthSettings = mongoose.models.MonthSettings || mongoose.model('MonthSettings', monthSettingsSchema);
const PendingNotification = mongoose.models.PendingNotification || mongoose.model('PendingNotification', pendingNotificationSchema);
const SalaryMatrix = mongoose.models.SalaryMatrix || mongoose.model('SalaryMatrix', salaryMatrixSchema);

module.exports = { Store, User, Shift, Task, NewsPost, Request, Note, AuditLog, Contact, Event, KPI, MonthSettings, PendingNotification, SalaryMatrix };