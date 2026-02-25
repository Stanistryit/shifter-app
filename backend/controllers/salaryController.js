const { User, Shift, SalaryMatrix, MonthSettings } = require('../models');

// Допоміжна функція для підрахунку тривалості зміни в годинах (напр. з 10:00 до 22:00 = 12)
const calculateDuration = (start, end, lunchMinutes = 0) => {
    if (!start || !end || start === 'Відпустка' || start === 'Лікарняний' || start === 'DELETE') return 0;

    const [startH, startM] = start.split(':').map(Number);
    const [endH, endM] = end.split(':').map(Number);

    let diff = (endH + endM / 60) - (startH + startM / 60);
    diff -= (lunchMinutes / 60);
    return diff > 0 ? diff : 0;
};

// Головна функція розрахунку зарплати (PaySlip)
exports.getUserSalary = async (req, res) => {
    try {
        // Дозволяємо запросити зарплату для себе, або (якщо це SM/Admin) для іншого співробітника
        const targetUserId = req.query.userId || req.session.userId;
        if (!targetUserId) return res.status(403).json({ success: false, message: "Не авторизовано" });

        // populate('storeId') автоматично підтягне дані магазину (щоб дізнатися його type)
        const user = await User.findById(targetUserId).populate('storeId');
        if (!user || !user.storeId) return res.json({ success: false, message: "Користувач або магазин не знайдено" });

        // Визначаємо місяць (за замовчуванням поточний: "YYYY-MM")
        let targetMonth = req.query.month;
        if (!targetMonth) {
            const now = new Date();
            targetMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        }

        const storeType = user.storeId.type; // 'top', 'kiev', 'expansion', 'standard'
        const position = user.position;      // 'SM', 'SSE', 'SE', 'RRP'
        const grade = user.grade;            // 1, 2, 3...

        // 1. Отримуємо базову ставку з матриці
        const matrixEntry = await SalaryMatrix.findOne({ storeType, position, grade });
        const baseRate = matrixEntry ? matrixEntry.rate : 0;

        // 2. Отримуємо норму годин на місяць
        const settings = await MonthSettings.findOne({ storeId: user.storeId._id, month: targetMonth });
        const normHours = settings && settings.normHours ? settings.normHours : 160; // 160 - дефолт

        // 3. Рахуємо відпрацьовані години з таблиці Shift
        const shifts = await Shift.find({
            name: user.name,
            date: { $regex: `^${targetMonth}` }, // Шукаємо всі дати, що починаються на "YYYY-MM"
            start: { $nin: ['DELETE', 'Відпустка', 'Лікарняний'] }
        });

        const storeLunchMinutes = user.storeId.lunch_duration_minutes || 0;

        let workedHours = 0;
        shifts.forEach(s => {
            workedHours += calculateDuration(s.start, s.end, storeLunchMinutes);
        });

        // 4. Фінансова математика
        const hourlyRate = (baseRate > 0 && normHours > 0) ? (baseRate / normHours) : 0;
        const baseSalary = hourlyRate * workedHours;

        // 5. Формуємо розрахунковий лист (PaySlip)
        // Тут є масив bonuses, куди ми пізніше додамо логіку премій
        const paySlip = {
            month: targetMonth,
            position,
            grade,
            storeType,
            normHours,
            workedHours: parseFloat(workedHours.toFixed(2)),
            baseRate,
            hourlyRate: parseFloat(hourlyRate.toFixed(2)),
            baseSalary: Math.round(baseSalary),
            bonuses: [],
            totalSalary: Math.round(baseSalary) // На майбутнє: baseSalary + сума всіх bonuses
        };

        res.json({ success: true, data: paySlip });

    } catch (error) {
        console.error("Salary calculation error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};