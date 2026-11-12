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
        year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(baseDate);
    const y = parts.find(p => p.type === 'year').value;
    const m = parts.find(p => p.type === 'month').value;
    const d = parts.find(p => p.type === 'day').value;

    const [hhStr, mmStr] = (timeStr || '10:00').split(':');
    const targetH = parseInt(hhStr || '10', 10);
    const targetM = parseInt(mmStr || '00', 10);

    const initialUtc = new Date(Date.UTC(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10), targetH, targetM, 0));

    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Kiev',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false
    });
    const kParts = formatter.formatToParts(initialUtc);
    const ky = parseInt(kParts.find(p => p.type === 'year').value, 10);
    const km = parseInt(kParts.find(p => p.type === 'month').value, 10);
    const kd = parseInt(kParts.find(p => p.type === 'day').value, 10);
    let kh = parseInt(kParts.find(p => p.type === 'hour').value, 10);
    if (kh === 24) kh = 0;
    const kmin = parseInt(kParts.find(p => p.type === 'minute').value, 10);

    const kievTimeUtc = Date.UTC(ky, km - 1, kd, kh, kmin, 0);
    const offsetMs = kievTimeUtc - initialUtc.getTime();

    return new Date(initialUtc.getTime() - offsetMs);
}

function calcDurationMinutes(startDate, endDate) {
    if (!startDate || !endDate) return 0;
    const s = new Date(startDate).getTime();
    const e = new Date(endDate).getTime();
    if (isNaN(s) || isNaN(e) || e <= s) return 0;
    return Math.round((e - s) / 60000);
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

// Отримання поточного статусу регіону/району (з підтримкою переходу між обласною червоною та районною жовтою тривогою)
function getRegionStatus(states, regionName, districtName) {
    if (!states || !regionName) return { isAlert: false, alertLevel: null, enabledAt: null, disabledAt: null };

    const reg = states[regionName];
    if (!reg) return { isAlert: false, alertLevel: null, enabledAt: null, disabledAt: null };

    const regEnabled = !!reg.enabled;
    const regLevel = reg.alert_level || (regEnabled ? 'red' : null);

    if (districtName && reg.districts && reg.districts[districtName]) {
        const dist = reg.districts[districtName];
        const distEnabled = !!dist.enabled;
        const distLevel = dist.alert_level || (distEnabled ? 'yellow' : null);

        // Тривога активна, якщо активний або весь регіон (область), або конкретний район.
        // Це унеможливлює хибний «відбій» при зміні рівня загрози з жовтого (район) на червоний (область) і навпаки.
        const isAlert = regEnabled || distEnabled;

        let alertLevel = null;
        let enabledAt = null;
        let disabledAt = null;

        if (regEnabled && distEnabled) {
            alertLevel = (regLevel === 'red' || distLevel === 'red') ? 'red' : (distLevel || regLevel);
            const rT = reg.enabled_at ? new Date(reg.enabled_at).getTime() : Infinity;
            const dT = dist.enabled_at ? new Date(dist.enabled_at).getTime() : Infinity;
            enabledAt = rT <= dT ? (reg.enabled_at || dist.enabled_at) : (dist.enabled_at || reg.enabled_at);
        } else if (regEnabled) {
            alertLevel = regLevel;
            enabledAt = reg.enabled_at || dist.enabled_at || null;
        } else if (distEnabled) {
            alertLevel = distLevel;
            enabledAt = dist.enabled_at || reg.enabled_at || null;
        } else {
            const rD = reg.disabled_at ? new Date(reg.disabled_at).getTime() : 0;
            const dD = dist.disabled_at ? new Date(dist.disabled_at).getTime() : 0;
            disabledAt = dD >= rD ? (dist.disabled_at || reg.disabled_at) : (reg.disabled_at || dist.disabled_at);
        }

        return {
            isAlert,
            alertLevel,
            enabledAt,
            disabledAt
        };
    }

    return {
        isAlert: regEnabled,
        alertLevel: regLevel,
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

            // 1. Якщо робочий день закінчився (магазин зачинено)
            if (isAfterWork) {
                mState.preWorkAlertActive = false;

                // Якщо тривога тривала в момент закриття магазину
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

                // Також закриваємо подію, яка очікувала на відкриття
                const waitingEvent = await AlarmEvent.findOne({ storeId: store._id, date: todayStr, status: 'ended_waiting_reopen' });
                if (waitingEvent) {
                    waitingEvent.status = 'closed_at_end_of_day';
                    waitingEvent.reopenedAt = workEndDate;
                    waitingEvent.reopenDurationMinutes = Math.max(0, Math.round((workEndDate - waitingEvent.endedAt) / 60000));
                    waitingEvent.totalDowntimeMinutes = (waitingEvent.alertDurationMinutes || 0) + (waitingEvent.betweenAlarmsMinutes || 0) + waitingEvent.reopenDurationMinutes;
                    await waitingEvent.save();
                }

                // Щоденне підсумкове повідомлення про тривоги та час на відкриття в кінці робочого дня
                const alreadySent = (store.lastAlarmSummaryDate === todayStr) || (mState.lastSummaryDate === todayStr);
                if (!alreadySent) {
                    mState.lastSummaryDate = todayStr;
                    await Store.updateOne({ _id: store._id }, { lastAlarmSummaryDate: todayStr });

                    const todayEvents = await AlarmEvent.find({ storeId: store._id, date: todayStr });
                    const alarmCount = todayEvents.filter(e => (e.alertDurationMinutes || 0) > 0 || e.status === 'active').length;
                    const totalAlertMins = todayEvents.reduce((s, e) => s + (e.alertDurationMinutes || 0), 0);
                    const totalReopenMins = todayEvents.reduce((s, e) => s + (e.reopenDurationMinutes || 0), 0);
                    const totalBetweenMins = todayEvents.reduce((s, e) => s + (e.betweenAlarmsMinutes || 0), 0);
                    const totalDowntimeMins = todayEvents.reduce((s, e) => s + (e.totalDowntimeMinutes || ((e.alertDurationMinutes || 0) + (e.reopenDurationMinutes || 0) + (e.betweenAlarmsMinutes || 0))), 0);

                    let summaryText = `📊 <b>Підсумок повітряних тривог за робочий день (${todayStr}):</b>\n\n`;
                    if (alarmCount > 0 || totalDowntimeMins > 0) {
                        summaryText += `🚨 Кількість тривог у робочий час: <b>${alarmCount}</b>\n` +
                            `⏱️ Загальний час тривог: <b>${formatDuration(totalAlertMins)}</b>\n`;
                        if (totalBetweenMins > 0) {
                            summaryText += `⏸️ Час між тривогами (без відкриття): <b>${formatDuration(totalBetweenMins)}</b>\n`;
                        }
                        summaryText += `⏳ Час на відкриття ТТ: <b>${formatDuration(totalReopenMins)}</b>\n` +
                            `🚫 <b>Загальний неробочий час ТТ: ${formatDuration(totalDowntimeMins)}</b>`;
                    } else {
                        summaryText += `🟢 <b>У робочий час тривог не було!</b>\nМагазин відпрацював весь робочий день без перерв на безпеку. 👍`;
                    }

                    await sendStoreAlarmMessage(store, summaryText);
                }

                mState.lastAlertState = status.isAlert;
                continue; // Не обробляємо тривоги та відбої після закриття магазину
            }

            // 2. Активна тривога або початок нової (в межах робочого часу магазину)
            if (status.isAlert) {
                if (activeEvent) {
                    // Якщо тривога вже активна, але змінився рівень загрози (жовтий <-> червоний) — просто оновлюємо рівень без відбою!
                    if (status.alertLevel && activeEvent.alertLevel !== status.alertLevel) {
                        activeEvent.alertLevel = status.alertLevel;
                        await activeEvent.save();
                    }
                } else if (isDuringWorkHours) {
                    const rawStart = (status.enabledAt && !isNaN(new Date(status.enabledAt).getTime()))
                        ? new Date(status.enabledAt)
                        : now;
                    // Якщо тривога почалася до відкриття магазину, робочий час рахуємо з моменту відкриття (workStartDate)
                    const effectiveStart = rawStart < workStartDate ? workStartDate : rawStart;

                    // Перевіряємо, чи є попередня тривога, після якої магазин ще НЕ встиг відкритися ('ended_waiting_reopen')
                    const waitingEvent = await AlarmEvent.findOne({
                        storeId: store._id,
                        date: todayStr,
                        status: 'ended_waiting_reopen'
                    }).sort({ createdAt: -1 });

                    if (waitingEvent) {
                        const prevEndedTime = new Date(waitingEvent.endedAt || waitingEvent.effectiveEndedAt || now).getTime();
                        const gapSeconds = Math.max(0, (now.getTime() - prevEndedTime) / 1000);

                        // А) Якщо минуло до 2 хвилин (технічне перемикання рівня загрози жовтий <-> червоний в API єМапа)
                        // Відновлюємо ту саму тривогу без створення дубля і без підрахунку відкриття!
                        if (gapSeconds <= 120) {
                            waitingEvent.status = 'active';
                            waitingEvent.endedAt = null;
                            waitingEvent.effectiveEndedAt = null;
                            waitingEvent.alertDurationMinutes = 0;
                            if (status.alertLevel) waitingEvent.alertLevel = status.alertLevel;
                            await waitingEvent.save();
                            mState.lastAlertState = status.isAlert;
                            continue;
                        }

                        // Б) Якщо закінчилась одна тривога і через декілька хвилин почалась нова (магазин не встиг відкритись):
                        // Час на відкриття НЕ рахуємо (0 хв), а час між тривогами зараховуємо як неробочий час ТТ!
                        const prevEffectiveEnd = waitingEvent.effectiveEndedAt || waitingEvent.endedAt || effectiveStart;
                        const betweenMins = calcDurationMinutes(prevEffectiveEnd, effectiveStart);

                        waitingEvent.reopenDurationMinutes = 0;
                        waitingEvent.betweenAlarmsMinutes = betweenMins;
                        waitingEvent.totalDowntimeMinutes = (waitingEvent.alertDurationMinutes || 0) + betweenMins;
                        waitingEvent.status = 'reopened';
                        await waitingEvent.save();

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

                        const levelBadge = status.alertLevel === 'yellow'
                            ? '🟡 <b>Жовтий (БПЛА / Загроза дронів)</b>'
                            : (status.alertLevel === 'red' ? '🔴 <b>Червоний (Ракетна загроза)</b>' : '⚠️ <b>Підвищена загроза</b>');

                        const text = `🚨 <b>УВАГА! ПОВТОРНА ПОВІТРЯНА ТРИВОГА!</b>\n\n` +
                            `📍 Регіон: <b>${region}${district ? ` (${district})` : ''}</b>\n` +
                            `⚠️ Рівень: ${levelBadge}\n` +
                            `🕒 Час початку: <b>${formatTimeKiev(rawStart)}</b>\n` +
                            `⏸️ Магазин не встиг відкритися після попередньої тривоги — час між тривогами (<b>${formatDuration(betweenMins)}</b>) зараховано як неробочий (час на відкриття: <b>0 хв</b>).\n\n` +
                            `Пройдіть в укриття! 🛡️`;
                        await sendStoreAlarmMessage(store, text);
                    } else {
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
                    }
                } else if (isBeforeWork) {
                    mState.preWorkAlertActive = true;
                }
            }

            // 3. Відбій тривоги (тільки якщо була активна подія в робочий час)
            if (!status.isAlert) {
                mState.preWorkAlertActive = false;

                if (activeEvent) {
                    const rawEnd = (status.disabledAt && !isNaN(new Date(status.disabledAt).getTime()))
                        ? new Date(status.disabledAt)
                        : now;
                    const effectiveEnd = rawEnd > workEndDate ? workEndDate : (rawEnd < workStartDate ? workStartDate : rawEnd);

                    // Розраховуємо тривалість тривоги у робочий час з надійними fallback
                    let alertDuration = calcDurationMinutes(activeEvent.effectiveStartedAt, effectiveEnd);
                    if (alertDuration <= 0) {
                        alertDuration = calcDurationMinutes(activeEvent.startedAt, effectiveEnd);
                    }
                    if (alertDuration <= 0 && activeEvent.createdAt) {
                        alertDuration = calcDurationMinutes(activeEvent.createdAt, effectiveEnd);
                    }

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
        // Якщо прямо зараз немає незакритої тривоги, перевіряємо анти-дубль за останні 2 хв
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

        // Якщо кнопку «Відкрились» натиснуто без активної/очікуючої тривоги (наприклад, тривога закінчилась о 09:50 до відкриття ТТ о 10:00):
        // Рахуємо неробочий час (час на відкриття) від 10:00 (workStartDate) до моменту натискання кнопки!
        const effectiveNow = now > workEndDate ? workEndDate : now;
        const reopenDuration = effectiveNow > workStartDate ? calcDurationMinutes(workStartDate, effectiveNow) : 0;

        const manualEvent = await AlarmEvent.create({
            storeId: store._id,
            date: todayStr,
            region: store.alarmRegion || 'м. Київ',
            district: store.alarmDistrict || '',
            alertLevel: null,
            startedAt: workStartDate,
            effectiveStartedAt: workStartDate,
            endedAt: workStartDate,
            effectiveEndedAt: workStartDate,
            reopenedAt: now,
            alertDurationMinutes: 0,
            reopenDurationMinutes: reopenDuration,
            betweenAlarmsMinutes: 0,
            totalDowntimeMinutes: reopenDuration,
            status: 'reopened'
        });

        const text = `🏪 <b>МАГАЗИН ВІДНОВИВ РОБОТУ (ВІДКРИЛИСЬ)</b>\n\n` +
            `🕒 Відкриття за графіком: <b>${formatTimeKiev(workStartDate)}</b>\n` +
            `🕒 Фактичне відкриття: <b>${formatTimeKiev(now)}</b>\n` +
            `⏳ Час на відкриття (від ${formatTimeKiev(workStartDate)}): <b>${formatDuration(reopenDuration)}</b>\n` +
            `🚫 <b>Загальний неробочий час ТТ: ${formatDuration(reopenDuration)}</b>\n` +
            `👤 Відкрив(ла): <b>${openedBy}</b>`;
        await sendStoreAlarmMessage(store, text);

        return {
            success: true,
            message: `Зафіксовано відкриття о ${formatTimeKiev(now)} (неробочий час: ${formatDuration(reopenDuration)})`,
            event: manualEvent
        };
    }

    // Якщо подія ще була в статусі 'active' (наприклад, відкрились під час закінчення або до оновлення API)
    if (event.status === 'active') {
        const effectiveEnd = now > workEndDate ? workEndDate : (now < workStartDate ? workStartDate : now);
        let alertDuration = calcDurationMinutes(event.effectiveStartedAt, effectiveEnd);
        if (alertDuration <= 0) {
            alertDuration = calcDurationMinutes(event.startedAt, effectiveEnd);
        }
        if (alertDuration <= 0 && event.createdAt) {
            alertDuration = calcDurationMinutes(event.createdAt, effectiveEnd);
        }

        event.endedAt = now;
        event.effectiveEndedAt = effectiveEnd;
        event.alertDurationMinutes = alertDuration;
        event.reopenedAt = now;
        event.reopenDurationMinutes = 0;
        event.totalDowntimeMinutes = alertDuration + (event.betweenAlarmsMinutes || 0);
        event.status = 'reopened';
        await event.save();

        const text = `🏪 <b>МАГАЗИН ВІДНОВИВ РОБОТУ (ВІДКРИЛИСЬ)</b>\n\n` +
            `🕒 Час відкриття: <b>${formatTimeKiev(now)}</b>\n` +
            `⏱️ Тривалість тривоги: <b>${formatDuration(alertDuration)}</b>\n` +
            `⏳ Час на відкриття: <b>0 хв</b>\n` +
            `🚫 <b>Загальний неробочий час ТТ: ${formatDuration(event.totalDowntimeMinutes)}</b>\n` +
            `👤 Відкрив(ла): <b>${openedBy}</b>`;

        await sendStoreAlarmMessage(store, text);

        return {
            success: true,
            message: "Відкриття успішно зафіксовано та надіслано в Telegram!",
            event
        };
    }

    // Якщо подія була в статусі 'ended_waiting_reopen'
    let alertDuration = event.alertDurationMinutes || 0;
    // Fallback: якщо тривалість тривоги збереглася як 0 або некоректна, перераховуємо з наявних дат
    if (alertDuration <= 0) {
        const endD = event.effectiveEndedAt || event.endedAt || now;
        alertDuration = calcDurationMinutes(event.effectiveStartedAt, endD);
        if (alertDuration <= 0) alertDuration = calcDurationMinutes(event.startedAt, endD);
        if (alertDuration <= 0 && event.createdAt) alertDuration = calcDurationMinutes(event.createdAt, endD);
        event.alertDurationMinutes = alertDuration;
    }

    const baseEndedAt = event.effectiveEndedAt || event.endedAt || now;
    const reopenDuration = calcDurationMinutes(baseEndedAt, now);
    const totalDowntime = alertDuration + (event.betweenAlarmsMinutes || 0) + reopenDuration;

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

    const alarmCount = todayEvents.filter(e => (e.alertDurationMinutes || 0) > 0 || e.status === 'active').length;
    const totalAlertMins = todayEvents.reduce((s, e) => s + (e.alertDurationMinutes || 0), 0);
    const totalReopenMins = todayEvents.reduce((s, e) => s + (e.reopenDurationMinutes || 0), 0);
    const totalBetweenMins = todayEvents.reduce((s, e) => s + (e.betweenAlarmsMinutes || 0), 0);
    const totalDowntimeMins = todayEvents.reduce((s, e) => s + (e.totalDowntimeMinutes || ((e.alertDurationMinutes || 0) + (e.reopenDurationMinutes || 0) + (e.betweenAlarmsMinutes || 0))), 0);

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
            count: alarmCount,
            totalAlertMins,
            totalReopenMins,
            totalBetweenMins,
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
