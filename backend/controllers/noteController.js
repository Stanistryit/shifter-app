const { Note, User } = require('../models');
const { logAction } = require('../utils');

exports.getNotes = async (req, res) => {
    if (!req.session.userId) return res.json([]);
    const u = await User.findById(req.session.userId);
    const n = await Note.find({ $or: [{ type: 'public' }, { type: 'private', author: u.name }] });
    res.json(n);
};

exports.addNote = async (req, res) => {
    const u = await User.findById(req.session.userId);
    let t = 'private';
    if (req.body.type === 'public' && (u.role === 'SM' || u.role === 'admin')) t = 'public';
    await Note.create({ ...req.body, author: u.name, type: t });
    logAction(u.name, 'add_note', t);
    res.json({ success: true });
};

exports.deleteNote = async (req, res) => {
    const u = await User.findById(req.session.userId);
    const n = await Note.findById(req.body.id);
    if (n && (n.author === u.name || (u.role === 'SM' && n.type === 'public'))) {
        await Note.findByIdAndDelete(req.body.id);
        res.json({ success: true });
    } else {
        res.status(403).json({});
    }
};