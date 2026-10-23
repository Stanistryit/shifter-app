const axios = require('axios');
const { Store, AlarmEvent } = require('../models');
const { getBot } = require('../bot');

const API_URL = 'https://vadimklimenko.com/map/statuses.json';

// Кеш останнього статусу з API
let cachedData = null;
let lastFetchTime = 0;
let monitoringInterval = null;

// Пам'ять станів магазинів
const memoryState = {};

// Допоміжні функції для роботи з часом у Києві (Europe/Kiev)
function getKievNow() {
    return new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Kiev" }));
}

function getKievDateStr(date = new Date()) {
    const k = new Date(date.toLocaleString("en-US", { timeZone: "Europe/Kiev" }));
    const y = k.getFullYear();
    const m = String(k.getMonth() + 1).padStart(2, '0');
    const d = String(k.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function formatTimeKiev(date = new Date()) {
    if (!date) return '--:--';
    const k = new Date(date.toLocaleString("en-US", { timeZone: "Europe/Kiev" }));
    return `${String(k.getHours()).padStart(2, '0')}:${String(k.getMinutes()).padStart(2, '0')}`;
}

function parseTimeToDateToday(timeStr, baseDate = new Date()) {
    const [h, m] = (timeStr || "10:00").split(':').map(Number);
    const k = new Date(baseDate.toLocaleString("en-US", { timeZone: "Europe/Kiev" }));
    k.setHours(h, m, 0, 0);
    return k;
}

function formatDuration(mins) {
    if (!mins || mins <= 0) return '0 хв';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h > 0 && m > 0) return `${h} год ${m} хв`;
    if (h > 0) return `${h} год`;
    return `${m} хв`;
}

// Відправка повідомлення в Telegram бот
async function sendStoreAlarmMessage(store, text) {
    try {
        const bot = getBot();
        if (!bot) return;

        const chatId = store.telegram?.chatId;
        if (!chatId) return;

        const opts = { parse_mode: 'HTML' };
        if (store.telegram?.alarmTopicId) {
            opts.message_thread_id = store.telegram.alarmTopicId;
        }

        await bot.sendMessage(chatId, text, opts);
    } catch (err) {
        console.error(`[AlarmService] Error sending Telegram message for store ${store.code || store._id}:`, err.message);
    }
}

// Отримання даних з єМапа API
async function fetchStatuses() {
    const now = Date.now();
    if (cachedData && (now - lastFetchTime < 10000)) {
        return cachedData;
    }

    try {
        const res = await axios.get(API_URL, { timeout: 6000 });
        if (res.data) {
            cachedData = res.data.states || res.data;
            lastFetchTime = now;
            return cachedData;
        }
    } catch (err) {
        console.warn("[AlarmService] Failed to fetch statuses.json:", err.message);
    }
    return cachedData || {};
}

// Отримання поточного статусу регіону/району
function getRegionStatus(states, regionName, districtName) {
    if (!states || !regionName) return { isAlert: false, alertLevel: null, enabledAt: null };

    const reg = states[regionName];
    if (!reg) return { isAlert: false, alertLevel: null, enabledAt: null };

    if (districtName && reg.districts && reg.districts[districtName]) {
        const dist = reg.districts[districtName];
        return {
            isAlert: !!dist.enabled,
            alertLevel: dist.alert_level || null,
            enabledAt: dist.enabled_at || null
        };
    }

    return {
        isAlert: !!reg.enabled,
        alertLevel: reg.alert_level || null,
        enabledAt: reg.enabled_at || null
    };
}

// Головний цикл перевірки тривог
async function checkAlarms() {
    try {
        const states = await fetchStatuses();
        const stores = await Store.find({}).lean();
        if (!stores || stores.length === 0) return;

        const now = new Date();
        const nowKiev = getKievNow();
        const todayStr = getKievDateStr(now);
        const currentMins = nowKiev.getHours() * 60 + nowKiev.getMinutes();

        for (const store of stores) {
            const storeIdStr = String(store._id);
            if (!memoryState[storeIdStr]) {
                memoryState[storeIdStr] = {
                    lastAlertState: null,
                    preWorkAlertActive: false,
                    lastSummaryDate: null,
                    closingNoticeSentDate: null
                };
            }
            const mState = memoryState[storeIdStr];

            const region = store.alarmRegion || 'м. Київ';
            const district = store.alarmDistrict || '';
            const status = getRegionStatus(states, region, district);

            const [startH, startM] = (store.alarmTrackingStart || store.openTime || "10:00").split(':').map(Number);
            const [endH, endM] = (store.alarmTrackingEnd || store.closeTime || "22:00").split(':').map(Number);
            const startMins = startH * 60 + startM;
            const endMins = endH * 60 + endM;

            const isDuringWorkHours = currentMins >= startMins && currentMins < endMins;
            const isBeforeWork = currentMins < startMins;
            const isAfterWork = currentMins >= endMins;

            const workStartDate = parseTimeToDateToday(store.alarmTrackingStart || store.openTime || "10:00", now);
            const workEndDate = parseTimeToDateToday(store.alarmTrackingEnd || store.closeTime || "22:00", now);

            // 1. Початок тривоги (false -> true)
            if (status.isAlert && mState.lastAlertState === false) {
                if (isDuringWorkHours) {
                    // Тривога почалась у робочий час
                    const enabledAtDate = status.enabledAt ? new Date(status.enabledAt) : now;
                    const effectiveStart = enabledAtDate < workStartDate ? workStartDate : enabledAtDate;

                    const newEvent = await AlarmEvent.create({
                        storeId: store._id,
                        date: todayStr,
                        region,
                        district,
                        alertLevel: status.alertLevel,
                        startedAt: enabledAtDate,
                        effectiveStartedAt: effectiveStart,
                        status: 'active'
                    });

                    const levelBadge = status.alertLevel === 'yellow'
                        ? '🟡 <b>Жовтий (БПЛА / Загроза дронів)</b>'
                        : (status.alertLevel === 'red' ? '🔴 <b>Червоний (Ракетна загроза)</b>' : '⚠️ <b>Підвищена загроза</b>');

                    const text = `🚨 <b>УВАГА! ПОВІТРЯНА ТРИВОГА!</b>\n` +
                        `📍 Регіон: <b>${region}${district ? ` (${district})` : ''}</b>\n` +
                        `⚠️ Рівень: ${levelBadge}\n` +
                        `🕒 Час початку: <b>${formatTimeKiev(now)}</b>\n\n` +
                        `Магазин тимчасово припиняє роботу. Пройдіть в укриття! 🛡️`;

                    await sendStoreAlarmMessage(store, text);
                } else if (isBeforeWork) {
                    mState.preWorkAlertActive = true;
                }
            }

            // 2. Якщо тривога почалась ДО відкриття магазину і ще триває о 10:00 (workStart)
            if (status.isAlert && isDuringWorkHours) {
                const activeEvent = await AlarmEvent.findOne({ storeId: store._id, date: todayStr, status: 'active' });
                if (!activeEvent) {
                    // Створюємо подію з початком, обмеженим 10:00 (workStartDate)
                    const enabledAtDate = status.enabledAt ? new Date(status.enabledAt) : now;
                    await AlarmEvent.create({
                        storeId: store._id,
                        date: todayStr,
                        region,
                        district,
                        alertLevel: status.alertLevel,
                        startedAt: enabledAtDate,
                        effectiveStartedAt: workStartDate,
                        status: 'active'
                    });

                    const text = `⚠️ <b>УВАГА! Відкриття магазину затримується через тривогу</b>\n\n` +
                        `📍 Регіон: <b>${region}${district ? ` (${district})` : ''}</b>\n` +
                        `🕒 Заплановане відкриття: <b>${formatTimeKiev(workStartDate)}</b>\n` +
                        `⚠️ Наразі триває повітряна тривога. Час тривоги та простою магазину рахується з <b>${formatTimeKiev(workStartDate)}</b>.`;

                    await sendStoreAlarmMessage(store, text);
                }
            }

            // 3. Відбій тривоги (true -> false)
            if (!status.isAlert && mState.lastAlertState === true) {
                mState.preWorkAlertActive = false;

                const activeEvent = await AlarmEvent.findOne({ storeId: store._id, date: todayStr, status: 'active' });
                if (activeEvent) {
                    const effectiveEnd = now > workEndDate ? workEndDate : (now < workStartDate ? workStartDate : now);
                    const alertDuration = Math.max(0, Math.round((effectiveEnd - activeEvent.effectiveStartedAt) / 60000));

                    activeEvent.endedAt = now;
                    activeEvent.effectiveEndedAt = effectiveEnd;
                    activeEvent.alertDurationMinutes = alertDuration;
                    activeEvent.status = 'ended_waiting_reopen';
                    await activeEvent.save();

                    // Сповіщаємо в чат лише якщо тривога зачепила робочий час магазину
                    if (effectiveEnd > workStartDate && activeEvent.effectiveStartedAt < workEndDate) {
                        const text = `🟢 <b>ВІДБІЙ ПОВІТРЯНОЇ ТРИВОГИ!</b>\n\n` +
                            `📍 Регіон: <b>${region}${district ? ` (${district})` : ''}</b>\n` +
                            `🕒 Час відбою: <b>${formatTimeKiev(now)}</b>\n` +
                            `⏱️ Тривалість тривоги у робочий час: <b>${formatDuration(alertDuration)}</b>\n\n` +
                            `🏪 <i>Очікуємо відкриття магазину. Натисніть кнопку <b>'Відкрились'</b> на терміналі після відновлення роботи.</i>`;

                        await sendStoreAlarmMessage(store, text);
                    }
                }
            }

            // 4. Якщо настав кінець робочого дня (22:00 / workEnd), а тривога ВСЕ ЩЕ ТРИВАЄ
            if (isAfterWork) {
                const activeEvent = await AlarmEvent.findOne({ storeId: store._id, date: todayStr, status: 'active' });
                if (activeEvent && !activeEvent.closingNoticeSent) {
                    const alertDuration = Math.max(0, Math.round((workEndDate - activeEvent.effectiveStartedAt) / 60000));
                    activeEvent.endedAt = now;
                    activeEvent.effectiveEndedAt = workEndDate;
                    activeEvent.alertDurationMinutes = alertDuration;
                    activeEvent.totalDowntimeMinutes = alertDuration;
                    activeEvent.status = 'closed_at_end_of_day';
                    activeEvent.closingNoticeSent = true;
                    await activeEvent.save();

                    const text = `🌙 <b>Робочий день завершено (${formatTimeKiev(workEndDate)}). Магазин зачинено.</b>\n\n` +
                        `Повітряна тривога все ще триває, але робочий час ТТ закінчився. Фіксуємо кінець тривоги для магазину на <b>${formatTimeKiev(workEndDate)}</b>.\n` +
                        `⏱️ Тривалість тривоги в межах робочого дня: <b>${formatDuration(alertDuration)}</b>`;

                    await sendStoreAlarmMessage(store, text);
                }

                // 5. Підсумкове повідомлення о 22:00 (або workEnd)
                if (mState.lastSummaryDate !== todayStr) {
                    mState.lastSummaryDate = todayStr;

                    const todayEvents = await AlarmEvent.find({ storeId: store._id, date: todayStr });
                    const count = todayEvents.length;
                    const totalAlertMins = todayEvents.reduce((s, e) => s + (e.alertDurationMinutes || 0), 0);
                    const totalReopenMins = todayEvents.reduce((s, e) => s + (e.reopenDurationMinutes || 0), 0);
                    const totalDowntimeMins = todayEvents.reduce((s, e) => s + (e.totalDowntimeMinutes || (e.alertDurationMinutes || 0)), 0);

                    let summaryText = `📊 <b>Підсумок повітряних тривог за робочий день (${todayStr}):</b>\n\n`;
                    if (count > 0) {
                        summaryText += `🚨 Кількість тривог у робочий час: <b>${count}</b>\n` +
                            `⏱️ Загальний час тривог: <b>${formatDuration(totalAlertMins)}</b>\n` +
                            `⏳ Час на відкриття ТТ: <b>${formatDuration(totalReopenMins)}</b>\n` +
                            `🚫 <b>Загальний неробочий час ТТ: ${formatDuration(totalDowntimeMins)}</b>`;
                    } else {
                        summaryText += `🟢 <b>У робочий час тривог не було!</b>\nМагазин відпрацював весь робочий день без перерв на безпеку. 👍`;
                    }

                    await sendStoreAlarmMessage(store, summaryText);
                }
            }

            // Оновлюємо стан у пам'яті
            mState.lastAlertState = status.isAlert;
        }
    } catch (err) {
        console.error("[AlarmService] checkAlarms execution error:", err);
    }
}

// Запуск періодичного моніторингу (кожні 15 секунд)
function startAlarmMonitoring() {
    if (monitoringInterval) clearInterval(monitoringInterval);
    console.log("🚨 Alarm Monitoring Service started (interval: 15s)");
    checkAlarms();
    monitoringInterval = setInterval(checkAlarms, 15000);
}

// Обробка натискання кнопки "Відкрились"
async function recordStoreReopen(storeId, openedBy = 'Співробітник') {
    const store = await Store.findById(storeId);
    if (!store) throw new Error("Магазин не знайдено");

    const now = new Date();
    const todayStr = getKievDateStr(now);

    // Шукаємо подію, яка очікує відкриття або активна
    let event = await AlarmEvent.findOne({
        storeId: store._id,
        date: todayStr,
        status: { $in: ['ended_waiting_reopen', 'active'] }
    }).sort({ createdAt: -1 });

    if (!event) {
        // Якщо прямо зараз немає незакритої тривоги, шукаємо останню за сьогодні
        const lastReopened = await AlarmEvent.findOne({
            storeId: store._id,
            date: todayStr,
            status: 'reopened'
        }).sort({ reopenedAt: -1 });

        if (lastReopened && (now - lastReopened.reopenedAt < 120000)) {
            return {
                success: true,
                alreadyRecorded: true,
                message: `Магазин вже було відмічено як відкритий о ${formatTimeKiev(lastReopened.reopenedAt)}`,
                event: lastReopened
            };
        }

        // Надсилаємо інформаційне повідомлення про відкриття магазину
        const text = `🏪 <b>МАГАЗИН ВІДЧИНЕНО</b>\n\n🕒 Час: <b>${formatTimeKiev(now)}</b>\n👤 Відкрив(ла): <b>${openedBy}</b>`;
        await sendStoreAlarmMessage(store, text);

        return {
            success: true,
            message: `Зафіксовано відкриття магазину о ${formatTimeKiev(now)}`,
            event: null
        };
    }

    // Розраховуємо час на відкриття та неробочий час ТТ
    const alertDuration = event.alertDurationMinutes || 0;
    const baseEndedAt = event.endedAt || now;
    const reopenDuration = Math.max(0, Math.round((now - baseEndedAt) / 60000));
    const totalDowntime = alertDuration + reopenDuration;

    event.reopenedAt = now;
    if (!event.endedAt) event.endedAt = now;
    if (!event.effectiveEndedAt) event.effectiveEndedAt = now;
    event.reopenDurationMinutes = reopenDuration;
    event.totalDowntimeMinutes = totalDowntime;
    event.status = 'reopened';
    await event.save();

    // Відправляємо повідомлення в Telegram канал/топік
    const text = `🏪 <b>МАГАЗИН ВІДНОВИВ РОБОТУ (ВІДКРИЛИСЬ)</b>\n\n` +
        `🕒 Час відкриття: <b>${formatTimeKiev(now)}</b>\n` +
        `⏱️ Тривалість тривоги: <b>${formatDuration(alertDuration)}</b>\n` +
        `⏳ Час на відкриття: <b>${formatDuration(reopenDuration)}</b>\n` +
        `🚫 <b>Загальний неробочий час ТТ: ${formatDuration(totalDowntime)}</b>\n` +
        `👤 Відкрив(ла): <b>${openedBy}</b>`;

    await sendStoreAlarmMessage(store, text);

    return {
        success: true,
        message: "Відкриття успішно зафіксовано та надіслано в Telegram!",
        event
    };
}

// Отримання поточного статусу для терміналу
async function getStoreAlarmStatus(storeId) {
    const store = await Store.findById(storeId);
    if (!store) throw new Error("Магазин не знайдено");

    const states = await fetchStatuses();
    const region = store.alarmRegion || 'м. Київ';
    const district = store.alarmDistrict || '';
    const status = getRegionStatus(states, region, district);

    const now = new Date();
    const nowKiev = getKievNow();
    const todayStr = getKievDateStr(now);
    const currentMins = nowKiev.getHours() * 60 + nowKiev.getMinutes();

    const [startH, startM] = (store.alarmTrackingStart || store.openTime || "10:00").split(':').map(Number);
    const [endH, endM] = (store.alarmTrackingEnd || store.closeTime || "22:00").split(':').map(Number);
    const startMins = startH * 60 + startM;
    const endMins = endH * 60 + endM;
    const isDuringWorkHours = currentMins >= startMins && currentMins < endMins;

    const todayEvents = await AlarmEvent.find({ storeId: store._id, date: todayStr }).sort({ createdAt: -1 });
    const lastEvent = todayEvents[0] || null;

    const totalAlertMins = todayEvents.reduce((s, e) => s + (e.alertDurationMinutes || 0), 0);
    const totalReopenMins = todayEvents.reduce((s, e) => s + (e.reopenDurationMinutes || 0), 0);
    const totalDowntimeMins = todayEvents.reduce((s, e) => s + (e.totalDowntimeMinutes || (e.alertDurationMinutes || 0)), 0);

    return {
        isAlert: status.isAlert,
        alertLevel: status.alertLevel,
        enabledAt: status.enabledAt,
        region,
        district,
        tracking: {
            start: store.alarmTrackingStart || store.openTime || "10:00",
            end: store.alarmTrackingEnd || store.closeTime || "22:00",
            isDuringWorkHours
        },
        lastEvent,
        todayStats: {
            count: todayEvents.length,
            totalAlertMins,
            totalReopenMins,
            totalDowntimeMins
        }
    };
}

module.exports = {
    fetchStatuses,
    startAlarmMonitoring,
    checkAlarms,
    recordStoreReopen,
    getStoreAlarmStatus
};
