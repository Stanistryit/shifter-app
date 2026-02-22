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

async function syncWithGoogleSheets(googleSheetUrlsString, storeId) {
    if (!googleSheetUrlsString || googleSheetUrlsString.length < 10) return { success: false, message: "URL not set" };

    // 1. Розбиваємо рядок на масив посилань (якщо їх кілька через кому)
    const urls = googleSheetUrlsString.split(',').map(u => u.trim()).filter(u => u.length > 10);

    let totalUpdated = 0;
    let anySuccess = false;

    // Отримуємо сьогоднішню дату по Києву для перевірки "15+ числа"
    const uaDate = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Kiev" }));
    const currentMonth = uaDate.getMonth(); // 0-11
    const currentYear = uaDate.getFullYear();
    const currentDay = uaDate.getDate();

    for (const url of urls) {
        try {
            const response = await axios.get(url);
            const rows = response.data.split('\n').map(row => row.trim()).filter(row => row.length > 0);
            const headers = rows[0].split(',').map(h => h.trim());
            const dateColumns = [];

            for (let i = 1; i < headers.length; i++) {
                if (headers[i].match(/^\d{4}-\d{2}-\d{2}$/)) {
                    dateColumns.push({ index: i, date: headers[i] });
                }
            }

            if (dateColumns.length === 0) continue; // Немає дат у цьому файлі

            // --- ОПТИМІЗАЦІЯ: Перевірка актуальності аркушу (правило 16 числа) ---
            let allDatesArePast = true;
            for (const dc of dateColumns) {
                const sheetDate = new Date(dc.date);
                const sMonth = sheetDate.getMonth();
                const sYear = sheetDate.getFullYear();

                // Якщо дата в майбутньому, або в поточному місяці
                if (sYear > currentYear || (sYear === currentYear && sMonth >= currentMonth)) {
                    allDatesArePast = false;
                    break;
                }
            }

            // Якщо всі дати аркушу належать до минулого і вже 16+ число поточного місяця -> ПРОПУСКАЄМО
            if (allDatesArePast && currentDay >= 16) {
                console.log(`⏩ Пропускаємо стару таблицю для Store ${storeId}`);
                continue;
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

                // Видаляємо старі зміни ТІЛЬКИ для тих дат, які є В ЦЬОМУ аркуші і для ЦЬОГО магазину
                await Shift.deleteMany({ date: { $in: datesToUpdate }, storeId: storeId });

                // Зберігаємо нові зміни
                await Shift.insertMany(shiftsToImport);
                totalUpdated += shiftsToImport.length;
                anySuccess = true;
            }

        } catch (e) {
            console.error(`Sync error for URL ${url}:`, e.message);
        }
    }

    if (anySuccess) {
        return { success: true, count: totalUpdated };
    } else {
        return { success: false, message: "No data or all sheets skipped." };
    }
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