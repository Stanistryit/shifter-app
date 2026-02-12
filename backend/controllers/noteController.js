const { Note, User } = require('../models');
const { logAction } = require('../utils');

exports.getNotes = async (req, res) => {
    if (!req.session.userId) return res.json([]);
    const u = await User.findById(req.session.userId);
    
    let publicQuery = { type: 'public' };
    
    // Якщо не адмін, показуємо публічні нотатки тільки його магазину
    if (u.role !== 'admin') {
        publicQuery.storeId = u.storeId;
    }

    const n = await Note.find({ 
        $or: [
            publicQuery, 
            { type: 'private', author: u.name } // Приватні бачить тільки автор
        ] 
    });
    res.json(n);
};

exports.addNote = async (req, res) => {
    const u = await User.findById(req.session.userId);
    let t = 'private';
    
    if (req.body.type === 'public' && (u.role === 'SM' || u.role === 'admin')) {
        t = 'public';
    }
    
    await Note.create({ 
        ...req.body, 
        author: u.name, 
        type: t,
        storeId: u.storeId // Зберігаємо прив'язку
    });
    
    logAction(u.name, 'add_note', t);
    res.json({ success: true });
};

exports.deleteNote = async (req, res) => {
    const u = await User.findById(req.session.userId);
    const n = await Note.findById(req.body.id);
    
    if (!n) return res.json({ success: false, message: "Нотатку не знайдено" });

    // Перевірка прав (тільки свого магазину або адмін)
    const isAuthor = n.author === u.name;
    const isStoreSM = u.role === 'SM' && n.type === 'public' && String(n.storeId) === String(u.storeId);
    const isAdmin = u.role === 'admin';

    if (isAuthor || isStoreSM || isAdmin) {
        await Note.findByIdAndDelete(req.body.id);
        res.json({ success: true });
    } else {
        res.status(403).json({});
    }
};