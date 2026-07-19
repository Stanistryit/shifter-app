const Shift = require('../models').Shift;
const User = require('../models').User;
const Task = require('../models').Task;

exports.getPersonalStats = async (req, res) => {
    try {
        if (!req.session.userId) return res.status(401).json({ success: false, message: 'Не авторизовано' });
        const user = await User.findById(req.session.userId);
        if (!user) return res.status(401).json({ success: false, message: 'Не авторизовано' });
        
        const userName = user.name;
        // get all shifts for this user for calculating "days without sick leave"
        const allShifts = await Shift.find({ name: userName }).sort({ date: 1 });
        
        // Use local timezone or server timezone? Let's use standard JS date manipulation
        // Format of date in shift is YYYY-MM-DD
        const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Kyiv' }); // e.g. "2026-05-29"
        const currentYearStr = todayStr.substring(0, 4);
        const targetYear = req.query.year || currentYearStr;

        let workedDays = 0;
        let workedHours = 0;
        let vacationDays = 0;
        let sickDays = 0;
        let donorDays = 0;
        
        let lastSickDateStr = null;

        allShifts.forEach(shift => {
            const isTargetYear = shift.date.startsWith(targetYear);
            
            // "isPastOrToday" is useful for current year to not count future shifts,
            // but for past years, all shifts are past. We should just check if it's <= todayStr
            const isPastOrToday = shift.date <= todayStr;

            if (shift.start === 'Лікарняний') {
                if (isPastOrToday && (!lastSickDateStr || shift.date > lastSickDateStr)) {
                    lastSickDateStr = shift.date;
                }
                if (isTargetYear && isPastOrToday) {
                    sickDays++;
                }
            } else if (shift.start === 'Відпустка') {
                if (isTargetYear && isPastOrToday) {
                    vacationDays++;
                }
            } else if (shift.start === 'Донорство') {
                if (isTargetYear && isPastOrToday) {
                    donorDays++;
                }
            } else if (shift.start && shift.end) {
                if (isTargetYear && isPastOrToday) {
                    workedDays++;
                    const [h1, m1] = shift.start.split(':').map(Number);
                    const [h2, m2] = shift.end.split(':').map(Number);
                    let hours = (h2 + m2 / 60) - (h1 + m1 / 60);
                    if (hours < 0) hours += 24; // Handle night shifts
                    workedHours += hours;
                }
            }
        });

        // Add task durations where includeHours is true
        const allTasks = await Task.find({ name: userName, includeHours: true });
        allTasks.forEach(task => {
            const isTargetYear = task.date.startsWith(targetYear);
            const isPastOrToday = task.date <= todayStr;
            if (task.start && task.end && !task.isFullDay) {
                if (isTargetYear && isPastOrToday) {
                    const [h1, m1] = task.start.split(':').map(Number);
                    const [h2, m2] = task.end.split(':').map(Number);
                    let hours = (h2 + m2 / 60) - (h1 + m1 / 60);
                    if (hours < 0) hours += 24;
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

        // Calculate total weekends
        const startOfYear = new Date(`${targetYear}-01-01`);
        let endOfYearDateForCalc = todayDate;
        
        if (targetYear < currentYearStr) {
            endOfYearDateForCalc = new Date(`${targetYear}-12-31`);
        } else if (targetYear > currentYearStr) {
            endOfYearDateForCalc = startOfYear; // No days passed
        }
        
        const diffTimeYear = Math.abs(endOfYearDateForCalc - startOfYear);
        let daysPassedThisYear = Math.floor(diffTimeYear / (1000 * 60 * 60 * 24)) + 1; // +1 to include today
        
        if (targetYear > currentYearStr) daysPassedThisYear = 0;
        
        // Total days with ANY shift (work, vacation, sick, donor) in the target year up to end date
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
