import { fetchJson } from './api.js';

let currentStatsYear = new Date().getFullYear();

export async function loadStatistics() {
    const skeleton = document.getElementById('statsSkeleton');
    const content = document.getElementById('statsContent');
    const yearBadge = document.getElementById('statsYearBadge');
    
    if (!skeleton || !content) return;

    // Show skeleton
    skeleton.classList.remove('hidden');
    content.classList.add('hidden');
    
    if (yearBadge) yearBadge.innerText = currentStatsYear;

    try {
        const data = await fetchJson(`/api/statistics/personal?year=${currentStatsYear}`);
        
        if (data.success && data.stats) {
            const stats = data.stats;
            
            // Populate data
            document.getElementById('statWorkedDays').innerText = stats.workedDays;
            document.getElementById('statWorkedHours').innerText = stats.workedHours;
            document.getElementById('statWeekends').innerText = stats.weekends;
            document.getElementById('statDonorDays').innerText = stats.donorDays;
            document.getElementById('statSickDays').innerText = stats.sickDays;
            document.getElementById('statDaysWithoutSick').innerText = stats.daysWithoutSickLeave;
            
            document.getElementById('statVacationUsed').innerText = stats.vacationDays;
            document.getElementById('statVacationRemaining').innerText = `${stats.vacationRemaining} днів`;
            
            // Update progress bar
            const vacBar = document.getElementById('statVacationProgress');
            if (vacBar) {
                const percent = Math.min(100, (stats.vacationDays / 24) * 100);
                // small delay for animation
                setTimeout(() => {
                    vacBar.style.width = `${percent}%`;
                }, 100);
            }
        }
    } catch (err) {
        console.error('Failed to load statistics:', err);
    } finally {
        skeleton.classList.add('hidden');
        content.classList.remove('hidden');
    }
}

export function changeStatsYear(delta) {
    if (window.triggerHaptic) window.triggerHaptic('light', 'impact');
    currentStatsYear += delta;
    
    // reset progress bar instantly
    const vacBar = document.getElementById('statVacationProgress');
    if (vacBar) vacBar.style.width = '0%';

    loadStatistics();
}

// Make it globally available for the HTML buttons
window.loadStatistics = loadStatistics;
window.changeStatsYear = changeStatsYear;
