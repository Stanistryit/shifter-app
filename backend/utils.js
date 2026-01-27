const { AuditLog, User, Shift, Task, Contact } = require('./models');
const axios = require('axios');

async function logAction(performer, action, details) {
    try { await AuditLog.create({ performer, action, details }); } catch(e){ console.error("Log error", e); }
}

async function handlePermission(req, userId, type, data, notifyRoleCallback) {
    const user = await User.findById(userId);
    if (!user) return 'unauthorized';
    if (user.role === 'RRP') return 'forbidden';
    if (user.role === 'SSE') {
        // Ми не можемо імпортувати Request тут напряму, щоб уникнути циклічності, 
        // тому повертаємо статус, а логіку створення Request залишимо в роутах
        return { status: 'pending', user };
    }
    if (user.role === 'SM' || user.role === 'admin') return { status: 'allowed', user };
    return 'forbidden';
}

// Google Sheets Sync Logic
async function syncWithGoogleSheets(googleSheetUrl) {
    if (!googleSheetUrl || googleSheetUrl.length < 10) return { success: false, message: "URL not set" };
    try {
        const response = await axios.get(googleSheetUrl);
        const rows = response.data.split('\n').map(row => row.trim()).filter(row => row.length > 0);
        const shiftsToImport = [];
        for (let i = 1; i < rows.length; i++) {
            const cols = rows[i].split(','); 
            if (cols.length < 4) continue;
            const [date, name, start, end] = cols.map(c => c.trim());
            if (date.match(/^\d{4}-\d{2}-\d{2}$/) && name && start && end) shiftsToImport.push({ date, name, start, end });
        }
        if (shiftsToImport.length > 0) {
            const datesToUpdate = [...new Set(shiftsToImport.map(s => s.date))];
            await Shift.deleteMany({ date: { $in: datesToUpdate } });
            await Shift.insertMany(shiftsToImport);
            return { success: true, count: shiftsToImport.length };
        }
        return { success: false, message: "No data" };
    } catch (e) { return { success: false, message: e.message }; }
}

async function initDB() { 
    if ((await User.countDocuments()) === 0) await User.create([{ username: "admin", password: "123", role: "admin", name: "Адмін" }]); 
    if(!(await User.findOne({role:'RRP'}))) await User.create({username:"rrp",password:"rrp",role:"RRP",name:"Регіональний Менеджер"});
    if((await Contact.countDocuments())===0) await Contact.create([{name: "RRP Наташа", phone: "+380954101682"}, {name: "AM Руслан", phone: "+380674652158"}]);
}

module.exports = { logAction, handlePermission, syncWithGoogleSheets, initDB };