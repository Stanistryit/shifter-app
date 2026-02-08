const { Shift, User, Request } = require('../models');
const { logAction, handlePermission } = require('../utils');
const { notifyUser, sendRequestToSM } = require('../bot');

exports.getShifts = async (req, res) => {
    if (!req.session.userId) return res.status(403).json({});
    const s = await Shift.find();
    res.json(s);
};

exports.addShift = async (req, res) => {
    const perm = await handlePermission(req, req.session.userId);
    if (perm === 'unauthorized' || perm === 'forbidden') return res.status(403).json({});
    const { user, status } = perm;

    if (status === 'pending') {
        const reqDoc = await Request.create({ type: 'add_shift', data: req.body, createdBy: user.name });
        sendRequestToSM(reqDoc);
        return res.json({ success: true, pending: true });
    }

    await Shift.deleteOne({ date: req.body.date, name: req.body.name });
    await Shift.create(req.body);
    logAction(user.name, 'add_shift', `${req.body.date} ${req.body.name}`);

    const todayStr = new Date().toISOString().split('T')[0];
    if (req.body.date >= todayStr) {
        const typeInfo = req.body.start === 'Відпустка' ? '🌴 <b>Відпустка</b>' : `⏰ Час: <b>${req.body.start} - ${req.body.end}</b>`;
        notifyUser(req.body.name, `📅 <b>Графік оновлено!</b>\n\n📆 Дата: <b>${req.body.date}</b>\n${typeInfo}`);
    }
    res.json({ success: true });
};

exports.deleteShift = async (req, res) => {
    const s = await Shift.findById(req.body.id);
    if (!s) return res.json({});
    const perm = await handlePermission(req, req.session.userId);

    if (perm.status === 'pending') {
        const reqDoc = await Request.create({ type: 'del_shift', data: { id: s.id, date: s.date }, createdBy: perm.user.name });
        sendRequestToSM(reqDoc);
        return res.json({ success: true, pending: true });
    }
    await Shift.findByIdAndDelete(req.body.id);
    logAction(perm.user.name, 'delete_shift', `${s.date} ${s.name}`);

    const todayStr = new Date().toISOString().split('T')[0];
    if (s.date >= todayStr) {
        notifyUser(s.name, `❌ <b>Зміну скасовано</b>\n\n📅 Дата: <b>${s.date}</b>\n⏰ Було: ${s.start} - ${s.end}`);
    }
    res.json({ success: true });
};

exports.bulkImport = async (req, res) => {
    const u = await User.findById(req.session.userId);
    if (req.body.shifts?.length) {
        await Shift.insertMany(req.body.shifts);
        logAction(u.name, 'bulk_import', `${req.body.shifts.length} shifts`);
    }
    res.json({ success: true });
};

exports.clearDay = async (req, res) => {
    const u = await User.findById(req.session.userId);
    await Shift.deleteMany({ date: req.body.date });
    logAction(u.name, 'clear_day', req.body.date);
    res.json({ success: true });
};

exports.clearMonth = async (req, res) => {
    const u = await User.findById(req.session.userId);
    if (u.role !== 'SM' && u.role !== 'admin') return res.status(403).json({});
    await Shift.deleteMany({ date: { $regex: `^${req.body.month}` } });
    logAction(u.name, 'clear_month', req.body.month);
    res.json({ success: true });
};