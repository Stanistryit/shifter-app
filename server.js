require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const path = require('path');

// Імпорти модулів
const { initBot, getBot } = require('./backend/bot');
const { initDB } = require('./backend/utils');
const routes = require('./backend/routes');
const { initScheduler } = require('./backend/scheduler'); // 🔥 Підключили планувальник

const app = express();
const PORT = process.env.PORT || 3000;

// Config
const TG_CONFIG = {
    groupId: process.env.TG_GROUP_ID,
    topics: { schedule: 36793, news: 36865 }
};
app.set('tgConfig', TG_CONFIG);
app.set('trust proxy', 1);

// Middleware
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ limit: '10mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: 'supersecretkey',
    resave: false, saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URI }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7, httpOnly: true, secure: true, sameSite: 'none' }
}));

// Routes API
app.use('/api', routes);

// Webhook для Telegram
app.post(`/bot${process.env.TELEGRAM_TOKEN}`, (req, res) => {
    const bot = getBot();
    if (bot) {
        bot.processUpdate(req.body);
    }
    res.sendStatus(200);
});

// Глобальний обробник помилок (повинен бути останнім middleware)
app.use((err, req, res, next) => {
    console.error("🔥 Global Error Handler:", err.stack);
    res.status(500).json({
        success: false,
        message: "Internal Server Error",
        error: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
    });
});

// Database & Bot & Scheduler Init
mongoose.connect(process.env.MONGO_URI)
    .then(() => {
        console.log("✅ MongoDB OK");

        initDB();

        // 1. Запускаємо Бота (з Webhook та обробкою команд)
        initBot(process.env.TELEGRAM_TOKEN, 'https://shifter-app.onrender.com', TG_CONFIG);

        // ⚠️ Планувальник (Cron/Agenda) ТУТ НЕ ЗАПУСКАЄТЬСЯ.
        // Він винесений в окремий процес worker.js для масштабування!
    })
    .catch(console.error);

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));