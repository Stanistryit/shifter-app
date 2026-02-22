const { AuditLog, User, Shift, Task, Contact } = require('./models');
const axios = require('axios');
const bcrypt = require('bcryptjs'); // New import

async function logAction(performer, action, details) {
    try { await AuditLog.create({ performer, action, details }); } catch (e) { console.error("Log error", e); }
}

async function handlePermission(req, userId, type, data, notifyRoleCallback) {
    const user = await User.findById(userId);
    if (!user) return 'unauthorized';
    if (user.role === 'RRP') return 'forbidden';
    if (user.role === 'SSE') {
        return { status: 'pending', user };
    }
    if (user.role === 'SM' || user.role === 'admin') return { status: 'allowed', user };
    return 'forbidden';
}

async function syncWithGoogleSheets(googleSheetUrl, storeId) {
    if (!googleSheetUrl || googleSheetUrl.length < 10) return { success: false, message: "URL not set" };
    try {
        const response = await axios.get(googleSheetUrl);
        const rows = response.data.split('\n').map(row => row.trim()).filter(row => row.length > 0);
        const shiftsToImport = [];
        for (let i = 1; i < rows.length; i++) {
            const cols = rows[i].split(',');
            if (cols.length < 4) continue;
            const [date, name, start, end] = cols.map(c => c.trim());
            if (date.match(/^\d{4}-\d{2}-\d{2}$/) && name && start && end) {
                shiftsToImport.push({ date, name, start, end, storeId }); // Add storeId to imported shift
            }
        }
        if (shiftsToImport.length > 0) {
            const datesToUpdate = [...new Set(shiftsToImport.map(s => s.date))];

            // Delete old shifts ONLY for these dates AND for this specific store
            await Shift.deleteMany({ date: { $in: datesToUpdate }, storeId: storeId });

            // Insert the new shifts
            await Shift.insertMany(shiftsToImport);
            return { success: true, count: shiftsToImport.length };
        }
        return { success: false, message: "No data" };
    } catch (e) { return { success: false, message: e.message }; }
}

// SECURITY MIGRATION: Convert plain text passwords to hashes
async function migratePasswords() {
    try {
        const users = await User.find({});
        let count = 0;
        for (const user of users) {
            // Check if not hashed (bcrypt hashes start with $2a$ or similar)
            if (!user.password.startsWith('$2a$')) {
                user.password = await bcrypt.hash(user.password, 10);
                await user.save();
                count++;
            }
        }
        if (count > 0) console.log(`🔒 Security: Migrated ${count} passwords to hashes.`);
    } catch (e) {
        console.error("Migration error:", e);
    }
}

async function initDB() {
    // Create admin if not exists (hashed)
    if ((await User.countDocuments()) === 0) {
        const hash = await bcrypt.hash("123", 10);
        await User.create([{ username: "admin", password: hash, role: "admin", name: "Адмін" }]);
    }
    // Create RRP if not exists (hashed)
    if (!(await User.findOne({ role: 'RRP' }))) {
        const hash = await bcrypt.hash("rrp", 10);
        await User.create({ username: "rrp", password: hash, role: "RRP", name: "Регіональний Менеджер" });
    }

    if ((await Contact.countDocuments()) === 0) await Contact.create([{ name: "RRP Наташа", phone: "+380954101682" }, { name: "AM Руслан", phone: "+380674652158" }]);

    // Run migration
    await migratePasswords();
}

module.exports = { logAction, handlePermission, syncWithGoogleSheets, initDB };