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
    return new Date();
}

function getKievDateStr(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Kiev',
        year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(date);
    const y = parts.find(p => p.type === 'year').value;
    const m = parts.find(p => p.type === 'month').value;
    const d = parts.find(p => p.type === 'day').value;
    return `${y}-${m}-${d}`;
}

function formatTimeKiev(date = new Date()) {
    if (!date) return '--:--';
    return new Intl.DateTimeFormat('uk-UA', {
        timeZone: 'Europe/Kiev',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    }).format(new Date(date));
}

function parseKievTimeToDate(timeStr, baseDate = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Kiev',
        year: 'numeric', month: '2-digit', day: '2-digit',
        timeZoneName: 'shortOffset'
    }).formatToParts(baseDate);
    const y = parts.find(p => p.type === 'year').value;
    const m = parts.find(p => p.type === 'month').value;
    const d = parts.find(p => p.type === 'day').value;
    const tzPart = parts.find(p => p.type === 'timeZoneName')?.value || 'GMT+3';
    let offset = '+03:00';
    if (tzPart.includes('+')) {
        offset = '+' + tzPart.split('+')[1].padStart(2, '0') + ':00';
    } else if (tzPart.includes('-')) {
        offset = '-' + tzPart.split('-')[1].padStart(2, '0') + ':00';
    }
    const partsTime = (timeStr || '10:00').split(':');
    const hh = (partsTime[0] || '10').padStart(2, '0');
    const mm = (partsTime[1] || '00').padStart(2, '0');
    return new Date(`${y}-${m}-${d}T${hh}:${mm}:00${offset}`);
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
async function sendStoreAlarmMessage(store, text, replyMarkup = null) {
    try {
        const bot = getBot();
        if (!bot) return;

        const chatId = store.telegram?.chatId;
        if (!chatId) return;

        const opts = { parse_mode: 'HTML' };
        if (store.telegram?.alarmTopicId) {
            opts.message_thread_id = store.telegram.alarmTopicId;
        }
        if (replyMarkup) {
            opts.reply_markup = replyMarkup;
        }

        try {
            await bot.sendMessage(chatId, text, opts);
        } catch (sendErr) {
            // Якщо помилка в топіку (гілку видалено або закрито), пробуємо надіслати в головний чат
            if (opts.message_thread_id && (sendErr.message.includes('thread') || sendErr.message.includes('topic'))) {
                delete opts.message_thread_id;
                await bot.sendMessage(chatId, text, opts);
            } else {
                throw sendErr;
            }
        }
    } catch (err) {
        const storeIdentifier = store.code || store.name || store._id;
        if (err.message && err.message.includes('chat not found')) {
            console.warn(`[AlarmService] ⚠️ Магазин ${storeIdentifier}: Telegram-чат (${store.telegram?.chatId}) не знайдено. ` +
                `Перевірте, чи бот доданий у групу цієї точки, або напишіть у групі команду: /link_store ${store.code || store._id}`);
        } else if (err.message && (err.message.includes('bot was kicked') || err.message.includes('bot was blocked'))) {
            console.warn(`[AlarmService] ⚠️ Магазин ${storeIdentifier}: бота заблоковано або видалено з чату (${store.telegram?.chatId}).`);
        } else {
            console.error(`[AlarmService] Error sending Telegram message for store ${storeIdentifier}:`, err.message);
        }
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
    if (!states || !regionName) return { isAlert: false, alertLevel: null, enabledAt: null, disabledAt: null };

    const reg = states[regionName];
    if (!reg) return { isAlert: false, alertLevel: null, enabledAt: null, disabledAt: null };

    if (districtName && reg.districts && reg.districts[districtName]) {
        const dist = reg.districts[districtName];
        return {
            isAlert: !!dist.enabled,
            alertLevel: dist.alert_level || null,
            enabledAt: dist.enabled_at || null,
            disabledAt: dist.disabled_at || null
        };
    }

    return {
        isAlert: !!reg.enabled,
        alertLevel: reg.alert_level || null,
        enabledAt: reg.enabled_at || null,
        disabledAt: reg.disabled_at || null
    };
}

// Головний цикл перевірки тривог
async function checkAlarms() {
    try {
        const states = await fetchStatuses();
        const stores = await Store.find({}).lean();
        if (!stores || stores.length === 0) return;

        const now = new Date();
        const todayStr = getKievDateStr(now);

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

            const workStartDate = parseKievTimeToDate(store.alarmTrackingStart || store.openTime || "10:00", now);
            const workEndDate = parseKievTimeToDate(store.alarmTrackingEnd || store.closeTime || "22:00", now);

            const isDuringWorkHours = now >= workStartDate && now < workEndDate;
            const isBeforeWork = now < workStartDate;
            const isAfterWork = now >= workEndDate;

            // Перевіряємо наявність активної події в базі даних (status: 'active')
            const activeEvent = await AlarmEvent.findOne({ storeId: store._id, date: todayStr, status: 'active' });

            // 1. Початок тривоги
            if (status.isAlert) {
                if (isDuringWorkHours && !activeEvent) {
                    // Якщо тривога триває у робочий час, а активної події в базі ще немає
                    const rawStart = status.enabledAt ? new Date(status.enabledAt) : now;
                    // Якщо тривога почалася до відкриття магазину, робочий час рахуємо з моменту відкриття (workStartDate)
                    const effectiveStart = rawStart < workStartDate ? workStartDate : rawStart;

                    await AlarmEvent.create({
                        storeId: store._id,
                        date: todayStr,
                        region,
                        district,
                        alertLevel: status.alertLevel,
                        startedAt: rawStart,
                        effectiveStartedAt: effectiveStart,
                        status: 'active'
                    });

                    // Якщо тривога почалася до відкриття і затримує відкриття:
                    if (rawStart < workStartDate) {
                        const text = `⚠️ <b>УВАГА! Відкриття магазину затримується через тривогу</b>\n\n` +
                            `📍 Регіон: <b>${region}${district ? ` (${district})` : ''}</b>\n` +
                            `🕒 Заплановане відкриття: <b>${formatTimeKiev(workStartDate)}</b>\n` +
                            `⚠️ Наразі триває повітряна тривога. Час тривоги та простою магазину рахується з <b>${formatTimeKiev(workStartDate)}</b>.`;
                        await sendStoreAlarmMessage(store, text);
                    } else {
                        // Звичайний початок у робочий час
                        const levelBadge = status.alertLevel === 'yellow'
                            ? '🟡 <b>Жовтий (БПЛА / Загроза дронів)</b>'
                            : (status.alertLevel === 'red' ? '🔴 <b>Червоний (Ракетна загроза)</b>' : '⚠️ <b>Підвищена загроза</b>');

                        const text = `🚨 <b>УВАГА! ПОВІТРЯНА ТРИВОГА!</b>\n\n` +
                            `📍 Регіон: <b>${region}${district ? ` (${district})` : ''}</b>\n` +
                            `⚠️ Рівень: ${levelBadge}\n` +
                            `🕒 Час початку: <b>${formatTimeKiev(rawStart)}</b>\n\n` +
                            `Магазин тимчасово припиняє роботу. Пройдіть в укриття! 🛡️`;
                        await sendStoreAlarmMessage(store, text);
                    }
                } else if (isBeforeWork) {
                    mState.preWorkAlertActive = true;
                }
            }

            // 2. Відбій тривоги
            if (!status.isAlert) {
                mState.preWorkAlertActive = false;

                if (activeEvent) {
                    const rawEnd = status.disabledAt ? new Date(status.disabledAt) : now;
                    const effectiveEnd = rawEnd > workEndDate ? workEndDate : (rawEnd < workStartDate ? workStartDate : rawEnd);
                    const alertDuration = Math.max(0, Math.round((effectiveEnd - activeEvent.effectiveStartedAt) / 60000));

                    activeEvent.endedAt = rawEnd;
                    activeEvent.effectiveEndedAt = effectiveEnd;
                    activeEvent.alertDurationMinutes = alertDuration;
                    activeEvent.status = 'ended_waiting_reopen';
                    await activeEvent.save();

                    // Надсилаємо сповіщення про відбій, оскільки тривога була активною для цього магазину
                    const text = `🟢 <b>ВІДБІЙ ПОВІТРЯНОЇ ТРИВОГИ!</b>\n\n` +
                        `📍 Регіон: <b>${region}${district ? ` (${district})` : ''}</b>\n` +
                        `🕒 Час відбою: <b>${formatTimeKiev(rawEnd)}</b>\n` +
                        `⏱️ Тривалість тривоги у робочий час: <b>${formatDuration(alertDuration)}</b>\n\n` +
                        `🏪 <i>Очікуємо відкриття магазину. Натисніть кнопку <b>'Відкрились'</b> на терміналі або кнопкою нижче після відновлення роботи.</i>`;

                    const inlineKeyboard = {
                        inline_keyboard: [
                            [{ text: "🏪 Відкрились", callback_data: `alarm_reopen_${store._id}` }]
                        ]
                    };

                    await sendStoreAlarmMessage(store, text, inlineKeyboard);
                }
            }

            // 3. Якщо робочий день закінчився (22:00+), а тривога все ще триває
            if (isAfterWork) {
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

                // Також закриваємо подію, яка чекала на відкриття, якщо настав кінець дня
                const waitingEvent = await AlarmEvent.findOne({ storeId: store._id, date: todayStr, status: 'ended_waiting_reopen' });
                if (waitingEvent) {
                    waitingEvent.status = 'closed_at_end_of_day';
                    waitingEvent.reopenedAt = workEndDate;
                    waitingEvent.reopenDurationMinutes = Math.max(0, Math.round((workEndDate - waitingEvent.endedAt) / 60000));
                    waitingEvent.totalDowntimeMinutes = waitingEvent.alertDurationMinutes + waitingEvent.reopenDurationMinutes;
                    await waitingEvent.save();
                }

                // 4. Щоденне підсумкове повідомлення о 22:00
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

    const workStartDate = parseKievTimeToDate(store.alarmTrackingStart || store.openTime || "10:00", now);
    const workEndDate = parseKievTimeToDate(store.alarmTrackingEnd || store.closeTime || "22:00", now);

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

    // Якщо подія ще була в статусі 'active' (наприклад, відкрились під час закінчення або до оновлення API)
    if (event.status === 'active') {
        const effectiveEnd = now > workEndDate ? workEndDate : (now < workStartDate ? workStartDate : now);
        const alertDuration = Math.max(0, Math.round((effectiveEnd - event.effectiveStartedAt) / 60000));
        event.endedAt = now;
        event.effectiveEndedAt = effectiveEnd;
        event.alertDurationMinutes = alertDuration;
        event.reopenedAt = now;
        event.reopenDurationMinutes = 0;
        event.totalDowntimeMinutes = alertDuration;
        event.status = 'reopened';
        await event.save();

        const text = `🏪 <b>МАГАЗИН ВІДНОВИВ РОБОТУ (ВІДКРИЛИСЬ)</b>\n\n` +
            `🕒 Час відкриття: <b>${formatTimeKiev(now)}</b>\n` +
            `⏱️ Тривалість тривоги: <b>${formatDuration(alertDuration)}</b>\n` +
            `⏳ Час на відкриття: <b>0 хв</b>\n` +
            `🚫 <b>Загальний неробочий час ТТ: ${formatDuration(alertDuration)}</b>\n` +
            `👤 Відкрив(ла): <b>${openedBy}</b>`;

        await sendStoreAlarmMessage(store, text);

        return {
            success: true,
            message: "Відкриття успішно зафіксовано та надіслано в Telegram!",
            event
        };
    }

    // Якщо подія була в статусі 'ended_waiting_reopen'
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
    const todayStr = getKievDateStr(now);

    const workStartDate = parseKievTimeToDate(store.alarmTrackingStart || store.openTime || "10:00", now);
    const workEndDate = parseKievTimeToDate(store.alarmTrackingEnd || store.closeTime || "22:00", now);
    const isDuringWorkHours = now >= workStartDate && now < workEndDate;

    const todayEvents = await AlarmEvent.find({ storeId: store._id, date: todayStr }).sort({ createdAt: -1 });
    const lastEvent = todayEvents[0] || null;

    const totalAlertMins = todayEvents.reduce((s, e) => s + (e.alertDurationMinutes || 0), 0);
    const totalReopenMins = todayEvents.reduce((s, e) => s + (e.reopenDurationMinutes || 0), 0);
    const totalDowntimeMins = todayEvents.reduce((s, e) => s + (e.totalDowntimeMinutes || (e.alertDurationMinutes || 0)), 0);

    return {
        isAlert: status.isAlert,
        alertLevel: status.alertLevel,
        enabledAt: status.enabledAt,
        disabledAt: status.disabledAt,
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
