import { state } from './state.js';
import { postJson, fetchJson, showToast } from './ui.js';
import { renderTable } from './render_table.js';

/**
 * Синхронізація розкладу з Google Таблиць
 * @param {'sync'|'reload'} mode 'sync' = оновити різницю, 'reload' = перезаписати весь місяць
 */
export async function syncSheetsSchedule(mode = 'sync') {
    if (!state.currentUser || (state.currentUser.role !== 'SM' && state.currentUser.role !== 'admin')) {
        showToast("Тільки для SM або Admin", "error");
        return;
    }

    const store = state.currentUser.store;
    const storeId = state.activeStoreId || (store ? (store._id || state.currentUser.storeId) : null);
    const googleSheetsUrl = store?.googleSheetsUrl || '';

    if (!googleSheetsUrl) {
        showToast("Вкажіть URL Google Apps Script у Налаштуваннях магазину! ⚙️", "warning");
        if (window.openStoreSettingsModal) {
            setTimeout(() => window.openStoreSettingsModal(), 600);
        }
        return;
    }

    const y = state.currentDate.getFullYear();
    const m = state.currentDate.getMonth() + 1;
    const monthStr = `${y}-${String(m).padStart(2, '0')}`;
    const monthName = state.currentDate.toLocaleDateString('uk-UA', { month: 'long', year: 'numeric' });

    if (mode === 'reload') {
        const confirmed = confirm(
            `⚠️ УВАГА: Повне завантаження!\n\nЦе повністю видалить поточний графік за ${monthName} і запише всі зміни наново з Google Таблиці.\n\nПродовжити?`
        );
        if (!confirmed) return;
    }

    showToast("⏳ З'єднання з Google Таблицею...", "info");

    try {
        const res = await postJson('/api/shifts/sync-sheets', {
            mode: mode,
            month: monthStr,
            year: y,
            storeId: storeId,
            scriptUrl: googleSheetsUrl
        });

        if (res.success) {
            showToast(res.message, "success");

            // Якщо були помилки парсингу в таблиці - показуємо деталі
            if (res.errors && res.errors.length > 0) {
                let errText = `⚠️ У таблиці виявлено ${res.errors.length} помилок у клітинках:\n\n`;
                res.errors.slice(0, 5).forEach((e, idx) => {
                    errText += `${idx + 1}. [${e.cell}] ${e.employee} (${e.date}): ${e.message}\n`;
                });
                if (res.errors.length > 5) {
                    errText += `... та ще ${res.errors.length - 5} помилок`;
                }
                setTimeout(() => alert(errText), 400);
            }

            // Оновлюємо дані змін та перемальовуємо
            state.shifts = await fetchJson('/api/shifts');
            if (window.renderAll) {
                window.renderAll();
            } else {
                renderTable();
            }
        } else {
            showToast(res.message || "Помилка синхронізації", "error");
        }
    } catch (e) {
        console.error("Sheets sync error:", e);
        showToast("Помилка: " + e.message, "error");
    }
}

/**
 * Скасування останньої синхронізації (Rollback)
 */
export async function rollbackSheetsSchedule() {
    if (!state.currentUser || (state.currentUser.role !== 'SM' && state.currentUser.role !== 'admin')) {
        showToast("Тільки для SM або Admin", "error");
        return;
    }

    const confirmed = confirm("Повернути графік до стану, що був перед останньою синхронізацією?");
    if (!confirmed) return;

    showToast("⏳ Відновлення графіка...", "info");

    try {
        const storeId = state.activeStoreId || (state.currentUser.store ? state.currentUser.store._id : state.currentUser.storeId);
        const res = await postJson('/api/shifts/sync-rollback', { storeId });

        if (res.success) {
            showToast(res.message || "Графік відновлено! ✅", "success");
            state.shifts = await fetchJson('/api/shifts');
            if (window.renderAll) {
                window.renderAll();
            } else {
                renderTable();
            }
        } else {
            showToast(res.message || "Немає збереженої копії для відновлення", "warning");
        }
    } catch (e) {
        console.error("Rollback error:", e);
        showToast("Помилка відкату: " + e.message, "error");
    }
}

// Реєструємо глобально у window
window.syncSheetsSchedule = syncSheetsSchedule;
window.rollbackSheetsSchedule = rollbackSheetsSchedule;
