const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// 0. Схема Магазину (ОНОВЛЕНО)
const storeSchema = new mongoose.Schema({
    name: { type: String, required: true }, 
    type: { type: String, enum: ['expansion', 'top', 'kiev', 'standard'], default: 'standard' }, 
    code: { type: String, unique: true, required: true }, 
    telegram: {
        chatId: { type: Number, default: null },       
        newsTopicId: { type: Number, default: null },  
        requestsTopicId: { type: Number, default: null }, 
        eveningTopicId: { type: Number, default: null }   
    },
    createdAt: { type: Date, default: Date.now }
});

// 1. Схема Користувача
const userSchema = new mongoose.Schema({
    // Auth info
    username: { type: String, unique: true, required: true }, 
    password: { type: String, required: true },
    
    // Personal info
    fullName: { type: String, default: '' }, 
    email: { type: String, default: '' },
    phone: { type: String, default: '' },
    
    // System info
    name: { type: String, required: true }, 
    avatar: { type: String, default: null }, 
    telegramChatId: { type: Number, default: null }, 
    
    // Work info
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', default: null }, 
    role: { type: String, enum: ['admin', 'SM', 'SSE', 'SE', 'RRP', 'Guest'], default: 'Guest' }, 
    position: { type: String, enum: ['SM', 'SSE', 'SE', 'RRP', 'None'], default: 'None' }, 
    grade: { type: Number, default: 0 }, 
    status: { type: String, enum: ['pending', 'active', 'blocked'], default: 'active' }, 
    
    // Settings
    reminderTime: { type: String, default: 'none' },
    tSalesCookie: { type: String, default: null }
});

userSchema.methods.comparePassword = async function(candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
};

// 2. Схема Зміни
const shiftSchema = new mongoose.Schema({
    date: { type: String, required: true }, 
    name: { type: String, required: true },
    start: { type: String, required: true }, 
    end: { type: String, required: true },
    // 🔥 НОВЕ: Прив'язка зміни до магазину. 
    // default: null дозволяє нам не зламати старі записи до міграції.
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
    // 🔥 НОВЕ: Прив'язка задачі до магазину
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
    month: { type: String, required: true }, 
    name: { type: String, required: true },  
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
    month: { type: String, required: true, unique: true }, 
    normHours: { type: Number, required: true }
});

// 12. Схема Відкладених Сповіщень
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