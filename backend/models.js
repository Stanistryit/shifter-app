const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// 1. Схема Користувача
const userSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    name: { type: String, required: true }, // Прізвище Ім'я
    role: { type: String, enum: ['admin', 'SM', 'SSE', 'SE', 'RRP'], default: 'SE' },
    telegramChatId: { type: Number, default: null }, // Для сповіщень
    avatar: { type: String, default: null }, // Base64 картинка
    reminderTime: { type: String, default: 'none' }, // 1h, 12h, start, none, 20:00
    tSalesCookie: { type: String, default: null } // Сесія T-Sales
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
    isFullDay: { type: Boolean, default: false },
    start: { type: String, default: '' },
    end: { type: String, default: '' }
});

// 4. Схема Новин (ОСЬ ТУТ БУЛА ПРОБЛЕМА - додаємо readBy)
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

const User = mongoose.model('User', userSchema);
const Shift = mongoose.model('Shift', shiftSchema);
const Task = mongoose.model('Task', taskSchema);
const NewsPost = mongoose.model('NewsPost', newsPostSchema);
const Request = mongoose.model('Request', requestSchema);
const Note = mongoose.model('Note', noteSchema);
const AuditLog = mongoose.model('AuditLog', auditLogSchema);

module.exports = { User, Shift, Task, NewsPost, Request, Note, AuditLog };