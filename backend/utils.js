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
        const headers = rows[0].split(',').map(h => h.trim());
        const dateColumns = [];

        for (let i = 1; i < headers.length; i++) {
            if (headers[i].match(/^\d{4}-\d{2}-\d{2}$/)) {
                dateColumns.push({ index: i, date: headers[i] });
            }
        }

        const shiftsToImport = [];

        for (let r = 1; r < rows.length; r++) {
            const cols = rows[r].split(',').map(c => c.trim());
            const name = cols[0];
            if (!name) continue;

            for (const dc of dateColumns) {
                let cellValue = cols[dc.index];
                if (!cellValue || cellValue === '-' || cellValue === '') continue;

                let start = '', end = '';
                if (cellValue.includes('-')) {
                    const parts = cellValue.split('-');
                    start = parts[0].trim();
                    end = parts[1].trim();
                } else {
                    start = cellValue;
                    end = '';
                }

                shiftsToImport.push({ date: dc.date, name, start, end, storeId });
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