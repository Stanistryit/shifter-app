const { User, Shift } = require('../models');

exports.exportCalendar = async (req, res) => {
    try {
        const token = req.params.token;
        if (!token) return res.status(404).send('Not found');

        const user = await User.findOne({ calendarToken: token });
        if (!user) return res.status(404).send('Not found');

        const shifts = await Shift.find({ storeId: user.storeId, name: user.name });

        let icsLines = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//Shifter//Розклад//UK',
            'CALSCALE:GREGORIAN',
            'METHOD:PUBLISH',
            'X-WR-CALNAME:Shifter — ' + user.name,
            'X-WR-TIMEZONE:Europe/Kyiv',
            'X-WR-CALDESC:Графік роботи в Shifter'
        ];

        // Додаємо часовий пояс
        icsLines.push(
            'BEGIN:VTIMEZONE',
            'TZID:Europe/Kyiv',
            'BEGIN:STANDARD',
            'DTSTART:19701025T040000',
            'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
            'TZOFFSETFROM:+0300',
            'TZOFFSETTO:+0200',
            'TZNAME:EET',
            'END:STANDARD',
            'BEGIN:DAYLIGHT',
            'DTSTART:19700329T030000',
            'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
            'TZOFFSETFROM:+0200',
            'TZOFFSETTO:+0300',
            'TZNAME:EEST',
            'END:DAYLIGHT',
            'END:VTIMEZONE'
        );

        const nowUtc = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

        for (const shift of shifts) {
            // shift.date: 'YYYY-MM-DD'
            // shift.start: 'HH:mm'
            // shift.end: 'HH:mm'
            
            if (!shift.date || !shift.start || !shift.end) continue;

            const datePlain = shift.date.replace(/-/g, '');
            const startPlain = shift.start.replace(/:/g, '') + '00';
            const endPlain = shift.end.replace(/:/g, '') + '00';

            const dtStart = `${datePlain}T${startPlain}`;
            let dtEnd = `${datePlain}T${endPlain}`;

            // Обробка переходу через північ
            if (shift.end < shift.start) {
                const nextDay = new Date(shift.date);
                nextDay.setDate(nextDay.getDate() + 1);
                const nextDateStr = nextDay.toISOString().split('T')[0].replace(/-/g, '');
                dtEnd = `${nextDateStr}T${endPlain}`;
            }

            const uid = `${shift._id}@shifter.app`;

            icsLines.push(
                'BEGIN:VEVENT',
                `UID:${uid}`,
                `DTSTAMP:${nowUtc}`,
                `DTSTART;TZID=Europe/Kyiv:${dtStart}`,
                `DTEND;TZID=Europe/Kyiv:${dtEnd}`,
                `SUMMARY:Зміна — Shifter`,
                `DESCRIPTION:Робоча зміна`,
                'END:VEVENT'
            );
        }

        icsLines.push('END:VCALENDAR');

        const icsContent = icsLines.join('\r\n');

        res.set({
            'Content-Type': 'text/calendar; charset=utf-8',
            'Content-Disposition': 'attachment; filename="shifts.ics"'
        });

        res.send(icsContent);
    } catch (e) {
        console.error("Export Calendar Error:", e);
        res.status(500).send('Internal Server Error');
    }
};
