const { KPI, MonthSettings, Shift, User } = require('../models');
const { logAction } = require('../utils');
const { notifyAll } = require('../bot');

exports.getKpi = async (req, res) => {
    if (!req.session.userId) return res.status(403).json({});
    
    const u = await User.findById(req.session.userId);
    if (!u) return res.status(403).json({});

    const { month, storeId } = req.query; // Додав підтримку storeId у запиті
    if (!month) return res.json({ kpi: [], settings: null, hours: {} });

    // 🔥 ІЗОЛЯЦІЯ ДАНИХ
    let query = { month };
    let shiftQuery = { date: { $regex: `^${month}` } };

    if (u.role !== 'admin') {
        // Якщо не адмін — жорстко фільтруємо по його магазину
        query.storeId = u.storeId;
        shiftQuery.storeId = u.storeId;
    } else {
        // Якщо адмін і обрав конкретний магазин у фільтрі
        if (storeId && storeId !== 'all') {
            query.storeId = storeId;
            shiftQuery.storeId = storeId;
        }
    }

    const kpiData = await KPI.find(query);
    const settings = await MonthSettings.findOne(query);
    const shifts = await Shift.find(shiftQuery);
    const hoursMap = {};

    shifts.forEach(s => {
        if (s.start === 'Відпустка') return;
        const [h1, m1] = s.start.split(':').map(Number);
        const [h2, m2] = s.end.split(':').map(Number);
        const dur = (h2 + m2 / 60) - (h1 + m1 / 60);
        if (dur > 0) hoursMap[s.name] = (hoursMap[s.name] || 0) + dur;
    });

    for (const name in hoursMap) hoursMap[name] = parseFloat(hoursMap[name].toFixed(1));
    
    res.json({ kpi: kpiData, settings: settings || { normHours: 0 }, hours: hoursMap });
};

exports.saveSettings = async (req, res) => {
    const u = await User.findById(req.session.userId);
    if (u.role !== 'SM' && u.role !== 'admin') return res.status(403).json({ message: "Тільки SM" });
    
    const { month, normHours } = req.body;
    
    // 🔥 Зберігаємо налаштування для КОНКРЕТНОГО магазину
    await MonthSettings.findOneAndUpdate(
        { month, storeId: u.storeId }, 
        { month, normHours: Number(normHours), storeId: u.storeId }, 
        { upsert: true }
    );
    
    logAction(u.name, 'update_kpi_settings', `${month}: ${normHours}h`);
    res.json({ success: true });
};

exports.importKpi = async (req, res) => {
    const u = await User.findById(req.session.userId);
    if (u.role !== 'SM' && u.role !== 'admin') return res.status(403).json({ message: "Тільки SM" });
    
    const { text, month } = req.body;
    if (!text || !month) return res.json({ success: false, message: "Немає даних" });

    const lines = text.trim().split('\n');
    
    // 🔥 Шукаємо співробітників ТІЛЬКИ цього магазину, щоб уникнути плутанини імен
    const users = await User.find({ storeId: u.storeId });
    
    let importedCount = 0;

    for (const line of lines) {
        if (!line.match(/\d/)) continue;
        const parts = line.includes('\t') ? line.split('\t') : line.trim().split(/\s{2,}/);
        if (parts.length < 5) continue;

        const fullName = parts[0].trim();
        let kpiName = null;

        if (fullName.toLowerCase().includes('тотал') || fullName.toLowerCase().includes('total')) {
            kpiName = 'TOTAL';
        } else {
            const foundUser = users.find(dbUser => {
                const parts = dbUser.name.split(' ');
                return fullName.includes(dbUser.name) || (parts.length > 1 && fullName.includes(parts[0]) && fullName.includes(parts[1]));
            });
            if (foundUser) kpiName = foundUser.name;
        }

        if (kpiName) {
            const parseNum = (val) => parseFloat(val?.replace(',', '.') || 0);
            const stats = {
                orders: parseNum(parts[2]), devices: parseNum(parts[6]), devicesTarget: parseNum(parts[5]),
                devicePercent: parseNum(parts[7]), upt: parseNum(parts[9]), uptTarget: parseNum(parts[10]),
                uptPercent: parseNum(parts[11]), nps: parseNum(parts[12]), nba: parseNum(parts[13])
            };
            
            // 🔥 Записуємо storeId в KPI документ
            await KPI.findOneAndUpdate(
                { month, name: kpiName, storeId: u.storeId }, 
                { month, name: kpiName, stats, updatedAt: new Date(), storeId: u.storeId }, 
                { upsert: true, new: true }
            );
            importedCount++;
        }
    }

    logAction(u.name, 'import_kpi', `${month}: ${importedCount} records`);
    
    // Сповіщення можна надсилати тільки співробітникам цього магазину (якщо notifyAll підтримує фільтр)
    // Поки що залишаємо notifyAll, але в майбутньому варто додати фільтр і туди.
    if (importedCount > 0) notifyAll(`📊 <b>KPI оновлено!</b>\n\nОпубліковано дані за: <b>${month}</b> 🏆`);
    
    res.json({ success: true, count: importedCount });
};