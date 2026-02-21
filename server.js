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

// Database & Bot & Scheduler Init
mongoose.connect(process.env.MONGO_URI)
    .then(() => {
        console.log("✅ MongoDB OK");

        initDB();

        // 1. Запускаємо Бота
        initBot(process.env.TELEGRAM_TOKEN, 'https://shifter-app.onrender.com', TG_CONFIG);

        // 2. Запускаємо Планувальник (Cron / Agenda)
        // Вся логіка часу (18:00 звіт і т.д.) тепер всередині цієї функції
        initScheduler(TG_CONFIG).catch(err => console.error("⏰ Agenda Scheduler Error:", err));
    })
    .catch(console.error);

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));