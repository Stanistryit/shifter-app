const { User, Shift } = require('../models');
const ical = require('ical-generator').default;

exports.exportCalendar = async (req, res) => {
    try {
        const token = req.params.token;
        if (!token) return res.status(404).send('Not found');

        const user = await User.findOne({ calendarToken: token });
        if (!user) return res.status(404).send('Not found');

        const calendar = ical({ name: 'Shifter Calendar' });

        const shifts = await Shift.find({ storeId: user.storeId, name: user.name });

        for (const shift of shifts) {
            // Формуємо рядки для дати та часу (ISO формат без Z)
            // Приклад: 2026-04-27T10:00:00
            // Зберігаємо часовий пояс Europe/Kyiv
            const startStr = `${shift.date}T${shift.start}:00`;
            let endStr = `${shift.date}T${shift.end}:00`;

            let startDate = new Date(startStr);
            let endDate = new Date(endStr);

            // Якщо час закінчення менший за час початку, вважаємо, що зміна закінчується наступного дня
            if (endDate < startDate) {
                endDate.setDate(endDate.getDate() + 1);
            }

            calendar.createEvent({
                start: startDate,
                end: endDate,
                summary: 'Зміна — Shifter',
                timezone: 'Europe/Kyiv'
            });
        }

        calendar.serve(res, 'shifts.ics');
    } catch (e) {
        console.error("Export Calendar Error:", e);
        res.status(500).send('Internal Server Error');
    }
};
