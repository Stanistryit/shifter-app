const { User, Shift, Task } = require('../models');

function escapeIcsText(str) {
    return String(str || '')
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\r?\n/g, '\\n');
}

function getNextDatePlain(yyyyMmDd) {
    const [y, m, d] = yyyyMmDd.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + 1));
    return dt.toISOString().split('T')[0].replace(/-/g, '');
}

function formatHmToIcsTime(hmStr) {
    const parts = String(hmStr || '').trim().split(':');
    const hh = String(parseInt(parts[0], 10) || 0).padStart(2, '0');
    const mm = String(parseInt(parts[1], 10) || 0).padStart(2, '0');
    return `${hh}${mm}00`;
}

function stripHtmlForIcs(str) {
    return String(str || '')
        .replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi, '$2 ($1)')
        .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1 ($2)')
        .replace(/<[^>]+>/g, '');
}

function buildTaskDescription(task, extraLine = '') {
    const lines = [];
    lines.push(`Статус: ${task.status === 'completed' ? '✅ Виконано' : '⏳ В роботі'}`);
    if (extraLine) lines.push(extraLine);
    if (task.description && String(task.description).trim()) {
        lines.push(`Опис: ${stripHtmlForIcs(task.description).trim()}`);
    }
    if (Array.isArray(task.subtasks) && task.subtasks.length > 0) {
        lines.push('Підзадачі:');
        for (const st of task.subtasks) {
            if (st && st.title) {
                lines.push(`${st.completed ? '☑️' : '⬜'} ${st.title}`);
            }
        }
    }
    if (Array.isArray(task.attachments) && task.attachments.length > 0) {
        lines.push(`📎 Файли (${task.attachments.length}): ${task.attachments.map(a => a.name).join(', ')}`);
    }
    return escapeIcsText(lines.join('\n'));
}

exports.exportCalendar = async (req, res) => {
    try {
        const token = req.params.token;
        if (!token) return res.status(404).send('Not found');

        const user = await User.findOne({ calendarToken: token });
        if (!user) return res.status(404).send('Not found');

        const [shifts, tasks, storeColleagues] = await Promise.all([
            Shift.find({
                name: user.name,
                start: { $ne: 'DELETE' }
            }).populate('storeId', 'name').populate('substituteStoreId', 'name').lean(),
            Task.find(
                user.storeId
                    ? {
                        $or: [
                            { name: user.name },
                            { storeId: user.storeId, name: { $in: ['all', 'Всі', 'Зміна'] } }
                        ]
                    }
                    : { name: user.name }
            ).lean(),
            user.storeId
                ? User.find({ storeId: user.storeId, status: 'active', birthDate: { $ne: '' } }, 'name fullName birthDate').lean()
                : []
        ]);

        let icsLines = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//Shifter//Schedule//EN',
            'CALSCALE:GREGORIAN',
            'METHOD:PUBLISH',
            'X-WR-CALNAME:' + escapeIcsText(`Shifter — ${user.name}`),
            'X-WR-TIMEZONE:Europe/Kyiv',
            'X-WR-CALDESC:' + escapeIcsText('Графік змін та задач у Shifter')
        ];

        // Обов'язковий блок VTIMEZONE для Google Calendar / Apple Calendar
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

        // 1. Робочі зміни та відсутності
        for (const shift of shifts) {
            if (!shift.date || !shift.start) continue;

            const datePlain = shift.date.replace(/-/g, '');
            const uid = `shift-${shift._id}@shifter.app`;

            // Якщо це "Лікарняний", "Відпустка", "Вихідний", "Донор" (без двокрапки часу)
            if (!shift.start.includes(':')) {
                const nextDateStr = getNextDatePlain(shift.date);

                icsLines.push(
                    'BEGIN:VEVENT',
                    `UID:${uid}`,
                    `DTSTAMP:${nowUtc}`,
                    `DTSTART;VALUE=DATE:${datePlain}`,
                    `DTEND;VALUE=DATE:${nextDateStr}`,
                    `SUMMARY:${escapeIcsText(`${shift.start} — Shifter`)}`,
                    `DESCRIPTION:${escapeIcsText(`Статус: ${shift.start}`)}`,
                    'END:VEVENT'
                );
                continue;
            }

            // Звичайний графік з годинами
            if (!shift.end || !shift.end.includes(':')) continue;

            const startPlain = formatHmToIcsTime(shift.start);
            const endPlain = formatHmToIcsTime(shift.end);

            const dtStart = `${datePlain}T${startPlain}`;
            let dtEnd = `${datePlain}T${endPlain}`;

            if (shift.end < shift.start) {
                const nextDateStr = getNextDatePlain(shift.date);
                dtEnd = `${nextDateStr}T${endPlain}`;
            }

            const storeName = (shift.isSubstitute && shift.substituteStoreId?.name)
                ? shift.substituteStoreId.name
                : (shift.storeId?.name || '');
            const summaryText = storeName ? `Зміна (${storeName}) — Shifter` : 'Зміна — Shifter';
            const descText = shift.isSubstitute && storeName
                ? `Робоча зміна (Підміна: ${storeName}, ${shift.start} - ${shift.end})`
                : `Робоча зміна (${shift.start} - ${shift.end})`;

            icsLines.push(
                'BEGIN:VEVENT',
                `UID:${uid}`,
                `DTSTAMP:${nowUtc}`,
                `DTSTART;TZID=Europe/Kyiv:${dtStart}`,
                `DTEND;TZID=Europe/Kyiv:${dtEnd}`,
                `SUMMARY:${escapeIcsText(summaryText)}`,
                `DESCRIPTION:${escapeIcsText(descText)}`,
                'END:VEVENT'
            );
        }

        // 2. Задачі (погодинні, з дедлайном та на весь день)
        for (const task of tasks) {
            if (!task || !task.title) continue;

            const uid = `task-${task._id}@shifter.app`;
            const isCompleted = task.status === 'completed';
            const statusIcon = isCompleted ? '✅' : '📌';
            const deadlineIcon = isCompleted ? '✅' : '⏳';

            const rawDeadline = String(task.postponedDeadline || task.deadline || '').trim();

            // Випадок А: Задача з конкретним часом початку і кінця (напр. 13:00 - 15:00)
            if (!task.isFullDay && task.date && task.start && task.end && task.start.includes(':') && task.end.includes(':')) {
                const datePlain = task.date.replace(/-/g, '');
                const startPlain = formatHmToIcsTime(task.start);
                const endPlain = formatHmToIcsTime(task.end);

                const dtStart = `${datePlain}T${startPlain}`;
                let dtEnd = `${datePlain}T${endPlain}`;
                if (task.end <= task.start) {
                    const nextDateStr = getNextDatePlain(task.date);
                    dtEnd = `${nextDateStr}T${endPlain}`;
                }

                const summary = `${statusIcon} Задача: ${task.title}`;
                const description = buildTaskDescription(task, `Час: ${task.start} - ${task.end}`);

                icsLines.push(
                    'BEGIN:VEVENT',
                    `UID:${uid}`,
                    `DTSTAMP:${nowUtc}`,
                    `DTSTART;TZID=Europe/Kyiv:${dtStart}`,
                    `DTEND;TZID=Europe/Kyiv:${dtEnd}`,
                    `SUMMARY:${escapeIcsText(summary)}`,
                    `DESCRIPTION:${description}`
                );

                if (!isCompleted) {
                    icsLines.push(
                        'BEGIN:VALARM',
                        'TRIGGER:-PT15M',
                        'ACTION:DISPLAY',
                        `DESCRIPTION:${escapeIcsText(`Через 15 хв задача: ${task.title}`)}`,
                        'END:VALARM'
                    );
                }

                icsLines.push('END:VEVENT');
                continue;
            }

            // Випадок Б: Задача з дедлайном (ToDo або задано deadline 'YYYY-MM-DD HH:mm' / 'YYYY-MM-DDTHH:mm')
            if (rawDeadline) {
                const match = rawDeadline.match(/^(\d{4}-\d{2}-\d{2})(?:[T\s]+(\d{1,2}:\d{2}))?/);
                if (match) {
                    const dlDate = match[1];
                    const dlTime = match[2];
                    const datePlain = dlDate.replace(/-/g, '');

                    if (dlTime) {
                        const [h, m] = dlTime.split(':').map(Number);
                        const totalMins = (h || 0) * 60 + (m || 0);
                        // 30-хвилинний слот до моменту дедлайну (або від моменту дедлайну, якщо це 00:00..00:29)
                        const startMins = totalMins >= 30 ? (totalMins - 30) : totalMins;
                        const endMins = totalMins >= 30 ? totalMins : (totalMins + 30);

                        const sH = String(Math.floor(startMins / 60)).padStart(2, '0');
                        const sM = String(startMins % 60).padStart(2, '0');
                        const eH = String(Math.floor(endMins / 60)).padStart(2, '0');
                        const eM = String(endMins % 60).padStart(2, '0');

                        const dtStart = `${datePlain}T${sH}${sM}00`;
                        const dtEnd = `${datePlain}T${eH}${eM}00`;
                        const cleanDlTime = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

                        const summary = `${deadlineIcon} Дедлайн (до ${cleanDlTime}): ${task.title}`;
                        const description = buildTaskDescription(task, `Дедлайн: ${dlDate} о ${cleanDlTime}`);

                        icsLines.push(
                            'BEGIN:VEVENT',
                            `UID:${uid}`,
                            `DTSTAMP:${nowUtc}`,
                            `DTSTART;TZID=Europe/Kyiv:${dtStart}`,
                            `DTEND;TZID=Europe/Kyiv:${dtEnd}`,
                            `SUMMARY:${escapeIcsText(summary)}`,
                            `DESCRIPTION:${description}`
                        );

                        if (!isCompleted) {
                            icsLines.push(
                                'BEGIN:VALARM',
                                'TRIGGER:-PT15M',
                                'ACTION:DISPLAY',
                                `DESCRIPTION:${escapeIcsText(`Дедлайн задачі: ${task.title} (до ${cleanDlTime})`)}`,
                                'END:VALARM'
                            );
                        }

                        icsLines.push('END:VEVENT');
                        continue;
                    } else {
                        // Дедлайн лише з датою без часу — подія на весь день
                        const nextDateStr = getNextDatePlain(dlDate);
                        const summary = `${deadlineIcon} Дедлайн: ${task.title}`;
                        const description = buildTaskDescription(task, `Дедлайн: ${dlDate}`);

                        icsLines.push(
                            'BEGIN:VEVENT',
                            `UID:${uid}`,
                            `DTSTAMP:${nowUtc}`,
                            `DTSTART;VALUE=DATE:${datePlain}`,
                            `DTEND;VALUE=DATE:${nextDateStr}`,
                            `SUMMARY:${escapeIcsText(summary)}`,
                            `DESCRIPTION:${description}`,
                            'END:VEVENT'
                        );
                        continue;
                    }
                }
            }

            // Випадок В: Задача на весь день (isFullDay = true або просто дата без часу)
            if (task.date && /^\d{4}-\d{2}-\d{2}$/.test(task.date)) {
                const datePlain = task.date.replace(/-/g, '');
                const nextDateStr = getNextDatePlain(task.date);
                const summary = `${statusIcon} Задача: ${task.title}`;
                const description = buildTaskDescription(task, 'Протягом дня');

                icsLines.push(
                    'BEGIN:VEVENT',
                    `UID:${uid}`,
                    `DTSTAMP:${nowUtc}`,
                    `DTSTART;VALUE=DATE:${datePlain}`,
                    `DTEND;VALUE=DATE:${nextDateStr}`,
                    `SUMMARY:${escapeIcsText(summary)}`,
                    `DESCRIPTION:${description}`,
                    'END:VEVENT'
                );
            }
        }

        // 3. Дні народження колег по магазину (на поточний та наступний рік)
        const curYear = new Date().getFullYear();
        for (const col of (storeColleagues || [])) {
            const bStr = String(col.birthDate || '').trim();
            const mMatch = bStr.match(/(\d{2})-(\d{2})$/);
            if (!mMatch) continue;
            const [, mm, dd] = mMatch;
            const cName = col.fullName || col.name;

            for (const yr of [curYear, curYear + 1]) {
                const isoDate = `${yr}-${mm}-${dd}`;
                const datePlain = `${yr}${mm}${dd}`;
                const nextDateStr = getNextDatePlain(isoDate);
                const uid = `bday-${col._id}-${yr}@shifter.app`;

                icsLines.push(
                    'BEGIN:VEVENT',
                    `UID:${uid}`,
                    `DTSTAMP:${nowUtc}`,
                    `DTSTART;VALUE=DATE:${datePlain}`,
                    `DTEND;VALUE=DATE:${nextDateStr}`,
                    `SUMMARY:${escapeIcsText(`🎂 День народження: ${cName}`)}`,
                    `DESCRIPTION:${escapeIcsText(`Сьогодні День народження святкує ${cName}! 🎉`)}`,
                    'END:VEVENT'
                );
            }
        }

        icsLines.push('END:VCALENDAR');

        const icsContent = icsLines.join('\r\n');

        res.set({
            'Content-Type': 'text/calendar; charset=utf-8',
            'Content-Disposition': 'attachment; filename="shifts.ics"',
            'Cache-Control': 'no-cache, no-store, must-revalidate'
        });

        res.send(icsContent);
    } catch (e) {
        console.error("Export Calendar Error:", e);
        res.status(500).send('Internal Server Error');
    }
};
