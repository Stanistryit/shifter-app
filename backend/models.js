const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, default: 'user' },
    name: { type: String, required: true },
    telegramChatId: { type: Number, default: null },
    reminderTime: { type: String, default: '20:00' },
    avatar: { type: String, default: null }
});

const ShiftSchema = new mongoose.Schema({ date: String, name: String, start: String, end: String });
const TaskSchema = new mongoose.Schema({ date: String, name: String, title: String, isFullDay: Boolean, start: String, end: String });
const EventSchema = new mongoose.Schema({ date: String, title: String, repeat: { type: String, default: 'none' } });
const RequestSchema = new mongoose.Schema({ type: String, data: Object, createdBy: String, createdAt: { type: Date, default: Date.now } });
const NewsPostSchema = new mongoose.Schema({ messageId: Number, chatId: Number, text: String, type: String, readBy: [String], createdAt: { type: Date, default: Date.now } });
const ContactSchema = new mongoose.Schema({ name: { type: String, required: true }, phone: { type: String, required: true } });
const NoteSchema = new mongoose.Schema({ date: { type: String, required: true }, text: { type: String, required: true }, type: { type: String, default: 'private' }, author: { type: String, required: true }, createdAt: { type: Date, default: Date.now } });
const AuditLogSchema = new mongoose.Schema({ action: String, performer: String, details: String, timestamp: { type: Date, default: Date.now } });

module.exports = {
    User: mongoose.model('User', UserSchema),
    Shift: mongoose.model('Shift', ShiftSchema),
    Task: mongoose.model('Task', TaskSchema),
    Event: mongoose.model('Event', EventSchema),
    Request: mongoose.model('Request', RequestSchema),
    NewsPost: mongoose.model('NewsPost', NewsPostSchema),
    Contact: mongoose.model('Contact', ContactSchema),
    Note: mongoose.model('Note', NoteSchema),
    AuditLog: mongoose.model('AuditLog', AuditLogSchema)
};