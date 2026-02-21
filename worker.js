require('dotenv').config();
const mongoose = require('mongoose');

const { initBotClient } = require('./backend/bot');
const { initScheduler } = require('./backend/scheduler');
const { initDB } = require('./backend/utils');

const TG_CONFIG = {
    groupId: process.env.TG_GROUP_ID,
    topics: { schedule: 36793, news: 36865 }
};

mongoose.connect(process.env.MONGO_URI)
    .then(() => {
        console.log("✅ Worker: MongoDB Connected");
        initDB();

        // Ініціалізуємо бот-клієнт ТІЛЬКИ для відправки повідомлень
        // (webhook очікується на основному Web-сервері)
        initBotClient(process.env.TELEGRAM_TOKEN);

        // Запускаємо крон-задачі (які тепер масштабуються через Agenda)
        initScheduler(TG_CONFIG).catch(err => console.error("Worker Agenda Error:", err));
    })
    .catch(console.error);

// Запобігання падінню воркера від Unhandled Errors
process.on('unhandledRejection', (reason, promise) => {
    console.error('🔥 Worker Unhandled Rejection at:', promise, 'reason:', reason);
});
