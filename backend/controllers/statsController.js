const Shift = require('../models').Shift;
const moment = require('moment-timezone'); // if available, or just use native JS dates

exports.getPersonalStats = async (req, res) => {
    try {
        const userName = req.user.name;
        // get all shifts for this user for calculating "days without sick leave"
        const allShifts = await Shift.find({ name: userName }).sort({ date: 1 });
        
        // Use local timezone or server timezone? Let's use standard JS date manipulation
        // Format of date in shift is YYYY-MM-DD
        const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Kyiv' }); // e.g. "2026-05-29"
        const currentYear = todayStr.substring(0, 4);

        let workedDays = 0;
        let workedHours = 0;
        let vacationDays = 0;
        let sickDays = 0;
        let donorDays = 0;
        
        let lastSickDateStr = null;

        allShifts.forEach(shift => {
            const isCurrentYear = shift.date.startsWith(currentYear);
            const isPastOrToday = shift.date <= todayStr;

            if (shift.start === 'Лікарняний') {
                if (isPastOrToday && (!lastSickDateStr || shift.date > lastSickDateStr)) {
                    lastSickDateStr = shift.date;
                }
                if (isCurrentYear && isPastOrToday) {
                    sickDays++;
                }
            } else if (shift.start === 'Відпустка') {
                if (isCurrentYear && isPastOrToday) {
                    vacationDays++;
                }
            } else if (shift.start === 'Донорство') {
                if (isCurrentYear && isPastOrToday) {
                    donorDays++;
                }
            } else if (shift.start && shift.end) {
                if (isCurrentYear && isPastOrToday) {
                    workedDays++;
                    const [h1, m1] = shift.start.split(':').map(Number);
                    const [h2, m2] = shift.end.split(':').map(Number);
                    let hours = (h2 + m2 / 60) - (h1 + m1 / 60);
                    if (hours < 0) hours += 24; // Handle night shifts
                    workedHours += hours;
                }
            }
        });

        // Calculate days without sick leave
        let daysWithoutSickLeave = 0;
        const todayDate = new Date(todayStr);
        if (lastSickDateStr) {
            const lastSickDate = new Date(lastSickDateStr);
            const diffTime = Math.abs(todayDate - lastSickDate);
            daysWithoutSickLeave = Math.floor(diffTime / (1000 * 60 * 60 * 24));
        } else {
            // If never sick, count days from Jan 1st of previous year? Or from first shift?
            if (allShifts.length > 0) {
                const firstShiftDate = new Date(allShifts[0].date);
                const diffTime = Math.abs(todayDate - firstShiftDate);
                daysWithoutSickLeave = Math.floor(diffTime / (1000 * 60 * 60 * 24));
            }
        }

        // Calculate total weekends (days from Jan 1 to today MINUS all recorded shifts)
        const startOfYear = new Date(`${currentYear}-01-01`);
        const diffTimeYear = Math.abs(todayDate - startOfYear);
        const daysPassedThisYear = Math.floor(diffTimeYear / (1000 * 60 * 60 * 24)) + 1; // +1 to include today
        
        // Total days with ANY shift (work, vacation, sick, donor) in the current year up to today
        const weekends = daysPassedThisYear - (workedDays + vacationDays + sickDays + donorDays);

        const vacationRemaining = Math.max(0, 24 - vacationDays);

        res.json({
            success: true,
            stats: {
                workedDays,
                workedHours: Number(workedHours.toFixed(1)),
                vacationDays,
                vacationRemaining,
                sickDays,
                donorDays,
                weekends: Math.max(0, weekends),
                daysWithoutSickLeave
            }
        });

    } catch (err) {
        console.error('Error fetching personal stats:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};
