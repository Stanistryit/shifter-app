const { Shift, User, Request, Store } = require('../models');
const { logAction, handlePermission } = require('../utils');
const { notifyUser, sendRequestToSM, getBot } = require('../bot');

const runMigrationIfNeeded = async () => {
    const count = await Shift.countDocuments({ storeId: null });
    if (count === 0) return;

    const shifts = await Shift.find({ storeId: null });
    const users = await User.find({}, 'name storeId');
    const userMap = {};
    users.forEach(u => { userMap[u.name] = u.storeId; });

    const bulkOps = [];
    for (const s of shifts) {
        if (userMap[s.name]) {
            bulkOps.push({
                updateOne: {
                    filter: { _id: s._id },
                    update: { $set: { storeId: userMap[s.name] } }
                }
            });
        }
    }

    if (bulkOps.length > 0) {
        await Shift.bulkWrite(bulkOps);
    }
};

exports.getShifts = async (req, res) => {
    if (!req.session.userId) return res.status(403).json({});
    await runMigrationIfNeeded();

    const currentUser = await User.findById(req.session.userId);
    let query = {};

    if (currentUser.role !== 'admin') {
        const myUsers = await User.find({ storeId: currentUser.storeId });
        const myUserNames = myUsers.map(u => u.name);
        query = {
            $or: [
                { storeId: currentUser.storeId },
                { name: { $in: myUserNames } }
            ]
        };
    }

    const s = await Shift.find(query).select('date name start end storeId isSubstitute substituteStoreId').populate('storeId', 'name').lean();
    res.json(s);
};

exports.addShift = async (req, res) => {
    const perm = await handlePermission(req, req.session.userId);
    if (perm === 'unauthorized' || perm === 'forbidden') return res.status(403).json({});
    const { user, status } = perm;

    if (status === 'pending') {
        const targetUser = await User.findOne({ name: req.body.name });
        const storeId = targetUser ? targetUser.storeId : user.storeId;

        const reqDoc = await Request.create({
            type: 'add_shift',
            data: { ...req.body, storeId },
            createdBy: user.name
        });
        sendRequestToSM(reqDoc);
        return res.json({ success: true, pending: true });
    }

    const targetUser = await User.findOne({ name: req.body.name });
    const shiftData = { ...req.body };

    if (targetUser && targetUser.storeId) {
        shiftData.storeId = targetUser.storeId;
    } else if (user.storeId) {
        shiftData.storeId = user.storeId;
    }

    await Shift.deleteOne({ date: req.body.date, name: req.body.name });
    await Shift.create(shiftData);
    logAction(user.name, 'add_shift', `${req.body.date} ${req.body.name}`);

    const todayStr = new Date().toISOString().split('T')[0];
    if (req.body.date >= todayStr) {
        const typeInfo = req.body.start === 'Відпустка' ? '🌴 <b>Відпустка</b>' : `⏰ Час: <b>${req.body.start} - ${req.body.end}</b>`;
        notifyUser(req.body.name, `📅 <b>Графік оновлено!</b>\n\n📆 Дата: <b>${req.body.date}</b>\n${typeInfo}`);
    }
    res.json({ success: true });
};

// 🔥 ОНОВЛЕНО: Масове збереження графіку (Додано кнопки)
exports.saveSchedule = async (req, res) => {
    const u = await User.findById(req.session.userId);
    if (!u || (u.role !== 'SM' && u.role !== 'admin' && u.role !== 'SSE')) {
        return res.status(403).json({ success: false, message: "Немає прав" });
    }

    const updates = req.body.updates || [];
    if (updates.length === 0) return res.json({ success: true });

    try {
        let isSseRestricted = false;
        if (u.role === 'SSE') {
            const store = await Store.findById(u.storeId);
            if (!store || store.requireSseApproval !== false) {
                isSseRestricted = true;
            }
        }

        if (isSseRestricted) {
            let reqCount = 0;
            let changesText = [];

            for (const item of updates) {
                const targetUser = await User.findOne({ name: item.name });
                const storeId = targetUser ? targetUser.storeId : u.storeId;

                if (item.start === 'DELETE') {
                    const s = await Shift.findOne({ date: item.date, name: item.name });
                    if (s) {
                        await Request.create({
                            type: 'del_shift',
                            data: { id: s._id, date: s.date, name: s.name },
                            createdBy: u.name
                        });
                        reqCount++;
                        changesText.push(`❌ ${item.name} (${item.date})`);
                    }
                } else {
                    await Request.create({
                        type: 'add_shift',
                        data: { ...item, storeId },
                        createdBy: u.name
                    });
                    reqCount++;
                    const shiftType = (item.start === 'Лікарняний' || item.start === 'Відпустка' || item.start === 'Донорство') ? item.start : `${item.start}-${item.end}`;
                    changesText.push(`➕ ${item.name} (${item.date}) ${shiftType}`);
                }
            }

            // 🔥 FIX: Додаємо кнопки до повідомлення та деталі змін
            if (u.storeId && reqCount > 0) {
                const managers = await User.find({ storeId: u.storeId, role: { $in: ['SM', 'admin'] } });

                let detailsStr = changesText.slice(0, 15).join('\n');
                if (changesText.length > 15) {
                    detailsStr += `\n... та ще ${changesText.length - 15} змін`;
                }

                const buttons = {
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: "✅ Підтвердити Всі", callback_data: "approve_all_requests" },
                                { text: "❌ Відхилити Всі", callback_data: "reject_all_requests" }
                            ]
                        ]
                    }
                };

                managers.forEach(m => {
                    notifyUser(m.name, `✏️ <b>Редактор Графіку</b>\n👤 <b>${u.name}</b> надіслав зміни на підтвердження:\n\n${detailsStr}`, buttons);
                });
            }

            return res.json({ success: true, isRequest: true, count: reqCount });
        }

        // --- ЛОГІКА ДЛЯ ADMIN/SM ---
        const names = [...new Set(updates.map(x => x.name))];
        const users = await User.find({ name: { $in: names } }, 'name storeId');
        const userStoreMap = {};
        users.forEach(us => userStoreMap[us.name] = us.storeId);

        const bulkOps = [];

        for (const upd of updates) {
            // Якщо фронтенд передав storeId (наприклад, Global Admin редагує конкретний магазин), використовуємо його.
            // Інакше використовуємо storeId того, хто зберігає (SM).
            const targetStoreId = upd.storeId || u.storeId;

            if (u.role !== 'admin' && String(targetStoreId) !== String(u.storeId)) {
                continue;
            }

            bulkOps.push({
                deleteOne: { filter: { date: upd.date, name: upd.name } }
            });

            if (upd.start && upd.end && upd.start !== 'DELETE') {
                bulkOps.push({
                    insertOne: {
                        document: {
                            date: upd.date,
                            name: upd.name,
                            start: upd.start,
                            end: upd.end,
                            storeId: targetStoreId
                        }
                    }
                });
            }
        }

        if (bulkOps.length > 0) {
            await Shift.bulkWrite(bulkOps);
        }

        logAction(u.name, 'bulk_save', `Updated ${updates.length} items via Editor`);
        res.json({ success: true, count: updates.length });

    } catch (e) {
        console.error(e);
        res.status(500).json({ success: false, message: e.message });
    }
};

exports.deleteShift = async (req, res) => {
    const s = await Shift.findById(req.body.id);
    if (!s) return res.json({});
    const perm = await handlePermission(req, req.session.userId);

    if (perm.status === 'pending') {
        const reqDoc = await Request.create({ type: 'del_shift', data: { id: s.id, date: s.date, name: s.name }, createdBy: perm.user.name });
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
    if (u.role !== 'SM' && u.role !== 'admin') return res.status(403).json({});

    if (req.body.shifts?.length) {
        const shiftsToImport = [];

        const allUsers = await User.find({}, 'name storeId');
        const userMap = {};
        allUsers.forEach(user => { userMap[user.name] = user.storeId; });

        for (const s of req.body.shifts) {
            let storeId = null;
            if (userMap[s.name]) {
                storeId = userMap[s.name];
            } else if (u.storeId) {
                storeId = u.storeId;
            }
            shiftsToImport.push({ ...s, storeId });
        }

        await Shift.insertMany(shiftsToImport);
        logAction(u.name, 'bulk_import', `${shiftsToImport.length} shifts`);
    }
    res.json({ success: true });
};

exports.clearDay = async (req, res) => {
    const u = await User.findById(req.session.userId);
    if (!u || (u.role !== 'SM' && u.role !== 'admin')) {
        return res.status(403).json({ success: false, message: 'Тільки для SM' });
    }

    let query = { date: req.body.date };
    if (u.role !== 'admin') {
        query.storeId = u.storeId;
    }

    await Shift.deleteMany(query);
    logAction(u.name, 'clear_day', req.body.date);
    res.json({ success: true });
};

exports.clearMonth = async (req, res) => {
    const u = await User.findById(req.session.userId);
    if (u.role !== 'SM' && u.role !== 'admin') return res.status(403).json({});

    let query = { date: { $regex: `^${req.body.month}` } };
    if (u.role !== 'admin') {
        query.storeId = u.storeId;
    }

    await Shift.deleteMany(query);
    logAction(u.name, 'clear_month', req.body.month);
    res.json({ success: true });
};

// ==============================================================================
// GOOGLE SHEETS SYNC & ROLLBACK
// ==============================================================================
const axios = require('axios');
const bcrypt = require('bcryptjs');

exports.syncGoogleSheets = async (req, res) => {
    const u = await User.findById(req.session.userId);
    if (!u || !['SM', 'admin'].includes(u.role)) {
        return res.status(403).json({ success: false, message: "Тільки для SM та Admin" });
    }

    const mode = req.body.mode || 'sync'; // 'sync' | 'reload'
    const targetStoreId = req.body.storeId || u.storeId;
    const store = await Store.findById(targetStoreId);
    if (!store) {
        return res.status(404).json({ success: false, message: "Магазин не знайдено" });
    }

    const scriptUrl = (req.body.scriptUrl || store.googleSheetsUrl || process.env.GOOGLE_SHEETS_SCRIPT_URL || '').trim();
    if (!scriptUrl) {
        return res.status(400).json({
            success: false,
            message: "Не вказано URL Google Apps Script. Вкажіть його в налаштуваннях магазину."
        });
    }

    const sheetName = (req.body.sheetName || store.googleSheetsTab || '').trim();

    try {
        // 1. Отримуємо дані з Google Apps Script
        const response = await axios.get(scriptUrl, {
            params: {
                month: req.body.month,
                year: req.body.year,
                sheet: sheetName || undefined
            },
            timeout: 30000,
            maxRedirects: 5
        });

        const sheetData = response.data;
        if (!sheetData || !sheetData.success) {
            return res.status(400).json({
                success: false,
                message: sheetData?.error || "Помилка при читанні Google Таблиці"
            });
        }

        const dates = sheetData.dates || [];
        const rawShifts = sheetData.shifts || [];
        const errors = sheetData.errors || [];

        if (dates.length === 0) {
            return res.status(400).json({ success: false, message: "У таблиці не знайдено дат" });
        }

        // 2. Завантажуємо магазини та користувачів для зіставлення
        const allStores = await Store.find({});
        const allUsers = await User.find({});

        const resolveStore = (nameOrCode) => {
            if (!nameOrCode) return null;
            const clean = nameOrCode.trim().toLowerCase();

            // 1. Точний збіг по назві або коду
            let found = allStores.find(s => 
                s.name.toLowerCase() === clean || 
                s.code.toLowerCase() === clean
            );
            if (found) return found;

            // 2. Частковий збіг (наприклад "Пірам" та "Піраміда")
            found = allStores.find(s => 
                s.name.toLowerCase().includes(clean) || 
                clean.includes(s.name.toLowerCase())
            );
            return found || null;
        };

        const normalizeNameForSearch = (str) => {
            return (str || '')
                .toLowerCase()
                .replace(/['"`ʼ’]/g, '')
                .replace(/є/g, 'е')
                .replace(/і/g, 'и')
                .replace(/\s+/g, ' ')
                .trim();
        };

        const resolveUser = async (rawName, defaultStoreId) => {
            const clean = normalizeNameForSearch(rawName);
            const parts = clean.split(' ').filter(Boolean);

            // 1. Точний збіг по fullName або name
            let user = allUsers.find(usr => 
                normalizeNameForSearch(usr.fullName) === clean || 
                normalizeNameForSearch(usr.name) === clean
            );

            // 2. Збіг за частинами імені (якщо переставлені прізвище та ім'я)
            if (!user && parts.length >= 2) {
                user = allUsers.find(usr => {
                    const uFull = normalizeNameForSearch(usr.fullName);
                    const uName = normalizeNameForSearch(usr.name);
                    return parts.every(p => uFull.includes(p) || uName.includes(p));
                });
            }

            // 3. Збіг за прізвищем (першим словом)
            if (!user && parts.length >= 1) {
                user = allUsers.find(usr => {
                    const uName = normalizeNameForSearch(usr.name);
                    const uFull = normalizeNameForSearch(usr.fullName);
                    return uName === parts[0] || uFull.startsWith(parts[0]);
                });
            }

            // 4. Якщо не знайдено - створюємо тимчасового користувача
            if (!user) {
                const inviteCode = Math.floor(100000 + Math.random() * 900000).toString();
                const username = `temp_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
                const shortName = rawName.trim().split(/\s+/)[0] || rawName;
                const password = await bcrypt.hash(username, 10);
                user = await User.create({
                    username,
                    password,
                    name: shortName,
                    fullName: rawName.trim(),
                    storeId: defaultStoreId || store._id,
                    role: 'SE',
                    isTemp: true,
                    inviteCode
                });
                allUsers.push(user);
            }
            return user;
        };

        // 3. Зберігаємо SNAPSHOT для відкату ("Відмінити останні зміни")
        const myUsers = await User.find({ storeId: store._id });
        const myUserNames = myUsers.map(usr => usr.name);

        const currentShifts = await Shift.find({
            date: { $in: dates },
            $or: [
                { storeId: store._id },
                { name: { $in: myUserNames } }
            ]
        }).lean();

        const targetMonth = dates[0].slice(0, 7);
        store.lastScheduleSnapshot = {
            timestamp: new Date(),
            month: targetMonth,
            shifts: currentShifts
        };
        await store.save();

        // 4. Підготовка документів змін із таблиці
        const parsedShifts = [];
        for (const item of rawShifts) {
            let defaultStoreId = store._id;
            if (item.homeStoreName) {
                const homeSt = resolveStore(item.homeStoreName);
                if (homeSt) defaultStoreId = homeSt._id;
            }

            const user = await resolveUser(item.name, defaultStoreId);

            if (item.type === 'OFF') {
                parsedShifts.push({
                    date: item.date,
                    name: user.name,
                    type: 'OFF'
                });
                continue;
            }

            let shiftStoreId = store._id;
            let substituteStoreId = null;

            if (item.isSubstitute) {
                if (item.substituteStoreName) {
                    const subSt = resolveStore(item.substituteStoreName);
                    if (subSt) {
                        shiftStoreId = subSt._id;
                        substituteStoreId = subSt._id;
                    } else {
                        shiftStoreId = store._id;
                        errors.push(`[Підміна] Магазин "${item.substituteStoreName}" не знайдено в системі (${item.name}, ${item.date})`);
                    }
                } else if (item.isGuest) {
                    shiftStoreId = store._id;
                    const homeSt = resolveStore(item.homeStoreName);
                    substituteStoreId = homeSt ? homeSt._id : null;
                    if (!homeSt && item.homeStoreName) {
                        errors.push(`[Гість] Рідний магазин "${item.homeStoreName}" не знайдено в системі (${item.name}, ${item.date})`);
                    }
                }
            }

            parsedShifts.push({
                date: item.date,
                name: user.name,
                start: item.start,
                end: item.end,
                storeId: shiftStoreId,
                isSubstitute: !!item.isSubstitute,
                substituteStoreId: substituteStoreId,
                type: item.type
            });
        }

        // 5. Виконання оновлення бази
        if (mode === 'reload') {
            await Shift.deleteMany({
                date: { $in: dates },
                $or: [
                    { storeId: store._id },
                    { name: { $in: myUserNames } }
                ]
            });

            const toInsert = parsedShifts.filter(s => s.type !== 'OFF');
            if (toInsert.length > 0) {
                await Shift.insertMany(toInsert);
            }

            logAction(u.name, 'sheets_reload', `Reloaded ${toInsert.length} shifts for ${targetMonth} from Google Sheets`);

            return res.json({
                success: true,
                mode: 'reload',
                count: toInsert.length,
                errors: errors,
                message: `Графік за ${targetMonth} успішно перезаписано! Завантажено ${toInsert.length} змін.`
            });

        } else {
            // Режим 'sync' (Diff)
            const existingMap = new Map();
            currentShifts.forEach(s => {
                existingMap.set(`${s.date}_${s.name}`, s);
            });

            const bulkOps = [];
            let addedCount = 0;
            let updatedCount = 0;
            let deletedCount = 0;

            for (const item of parsedShifts) {
                const key = `${item.date}_${item.name}`;
                const existing = existingMap.get(key);

                if (item.type === 'OFF') {
                    if (existing) {
                        bulkOps.push({
                            deleteOne: { filter: { _id: existing._id } }
                        });
                        deletedCount++;
                    }
                } else {
                    const shiftDoc = {
                        date: item.date,
                        name: item.name,
                        start: item.start,
                        end: item.end,
                        storeId: item.storeId,
                        isSubstitute: item.isSubstitute,
                        substituteStoreId: item.substituteStoreId
                    };

                    if (!existing) {
                        bulkOps.push({
                            insertOne: { document: shiftDoc }
                        });
                        addedCount++;
                    } else {
                        const isDiff = existing.start !== item.start ||
                                       existing.end !== item.end ||
                                       String(existing.storeId) !== String(item.storeId) ||
                                       Boolean(existing.isSubstitute) !== Boolean(item.isSubstitute);

                        if (isDiff) {
                            bulkOps.push({
                                updateOne: {
                                    filter: { _id: existing._id },
                                    update: { $set: shiftDoc }
                                }
                            });
                            updatedCount++;
                        }
                    }
                }
            }

            if (bulkOps.length > 0) {
                await Shift.bulkWrite(bulkOps);
            }

            logAction(u.name, 'sheets_sync', `Sync diff for ${targetMonth}: +${addedCount}, ~${updatedCount}, -${deletedCount}`);

            return res.json({
                success: true,
                mode: 'sync',
                added: addedCount,
                updated: updatedCount,
                deleted: deletedCount,
                totalChanges: bulkOps.length,
                errors: errors,
                message: bulkOps.length > 0
                    ? `Синхронізація успішна! Додано: ${addedCount}, Оновлено: ${updatedCount}, Видалено: ${deletedCount}`
                    : `Графік уже повністю відповідає таблиці. Змін не виявлено.`
            });
        }

    } catch (e) {
        console.error("Sheets sync error:", e);
        let errorMsg = e.message;
        if (e.response && e.response.data) {
            if (typeof e.response.data === 'string' && e.response.data.includes('unexpected error')) {
                errorMsg = "Google Apps Script повернув внутрішню помилку (Error INTERNAL). Перевірте розгортання скрипту або спробуйте ще раз.";
            } else if (typeof e.response.data === 'object' && e.response.data.error) {
                errorMsg = e.response.data.error;
            }
        }
        res.status(500).json({ success: false, message: errorMsg });
    }
};

exports.rollbackGoogleSheetsSync = async (req, res) => {
    const u = await User.findById(req.session.userId);
    if (!u || !['SM', 'admin'].includes(u.role)) {
        return res.status(403).json({ success: false, message: "Тільки для SM та Admin" });
    }

    const targetStoreId = req.body.storeId || u.storeId;
    const store = await Store.findById(targetStoreId);
    if (!store || !store.lastScheduleSnapshot || !store.lastScheduleSnapshot.shifts || !store.lastScheduleSnapshot.month) {
        return res.status(400).json({ success: false, message: "Немає збереженої резервної копії для скасування" });
    }

    try {
        const snapshot = store.lastScheduleSnapshot;
        const backupShifts = snapshot.shifts || [];
        const month = snapshot.month;

        const myUsers = await User.find({ storeId: store._id });
        const myUserNames = myUsers.map(usr => usr.name);

        // 1. Очищаємо поточні зміни за цей місяць
        await Shift.deleteMany({
            date: { $regex: `^${month}` },
            $or: [
                { storeId: store._id },
                { name: { $in: myUserNames } }
            ]
        });

        // 2. Відновлюємо зміни зі знімка
        if (backupShifts.length > 0) {
            const cleanBackup = backupShifts.map(s => {
                const { _id, __v, ...rest } = s;
                return rest;
            });
            await Shift.insertMany(cleanBackup);
        }

        // Очищаємо знімок після успішного відкату
        store.lastScheduleSnapshot = { timestamp: null, month: '', shifts: [] };
        await store.save();

        logAction(u.name, 'sheets_rollback', `Restored ${backupShifts.length} shifts for ${month}`);

        res.json({
            success: true,
            restoredCount: backupShifts.length,
            message: `Останні зміни успішно скасовано! Відновлено ${backupShifts.length} змін за ${month}.`
        });

    } catch (e) {
        console.error("Rollback error:", e);
        res.status(500).json({ success: false, message: e.message });
    }
};