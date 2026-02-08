require('dotenv').config(); // Спробуємо завантажити .env, якщо є
const mongoose = require('mongoose');
const { User, Store } = require('./backend/models'); // Шлях до моделей

// --- НАЛАШТУВАННЯ ---
// 1. Встав сюди свій рядок підключення, якщо .env не спрацює
const MONGO_URI = process.env.MONGODB_URI || 'mongodb+srv://ТВІЙ_ЛОГІН:ТВІЙ_ПАРОЛЬ@cluster.mongodb.net/shifter?retryWrites=true&w=majority';


const DEFAULT_TELEGRAM_ID = null; 

// 3. Налаштування магазину за замовчуванням
const DEFAULT_STORE = {
    name: 'IQOS Space Sumy',
    code: 'iqos_space_sumy', // Унікальний код
    type: 'Експансія'
};

// --- МІГРАЦІЯ ---
const migrate = async () => {
    try {
        console.log('🔄 Підключення до БД...');
        await mongoose.connect(MONGO_URI);
        console.log('✅ Підключено!');

        // 1. Створюємо або знаходимо Магазин
        let store = await Store.findOne({ code: DEFAULT_STORE.code });
        
        if (!store) {
            console.log('🏪 Магазин не знайдено. Створюємо новий...');
            store = await Store.create({
                ...DEFAULT_STORE,
                telegram: {
                    chatId: DEFAULT_TELEGRAM_ID,
                    newsTopicId: null, 
                    requestsTopicId: null
                }
            });
            console.log(`✅ Створено магазин: ${store.name} (ID: ${store._id})`);
        } else {
            console.log(`👌 Магазин вже існує: ${store.name} (ID: ${store._id})`);
            // Оновимо ID чату, якщо він був null, а ми вказали новий
            if (!store.telegram.chatId && DEFAULT_TELEGRAM_ID) {
                store.telegram.chatId = DEFAULT_TELEGRAM_ID;
                await store.save();
                console.log('📲 Оновлено Telegram ID магазину.');
            }
        }

        // 2. Оновлюємо Користувачів
        const users = await User.find();
        console.log(`👥 Знайдено користувачів: ${users.length}`);

        let updatedCount = 0;
        for (const user of users) {
            let changed = false;

            // Прив'язка до магазину
            if (!user.storeId) {
                user.storeId = store._id;
                changed = true;
            }

            // Статус
            if (!user.status || user.status === 'pending') {
                user.status = 'active'; // Всі існуючі стають активними
                changed = true;
            }

            // Міграція Ролей у Посади
            if (user.position === 'None') {
                if (user.role === 'admin' || user.role === 'SM') {
                    user.position = 'SM';
                    user.grade = 7; // Стартовий грейд для SM
                } else if (user.role === 'SSE') {
                    user.position = 'SSE';
                    user.grade = 5;
                } else if (user.role === 'SE') {
                    user.position = 'SE';
                    user.grade = 3;
                } else if (user.role === 'RRP') {
                    user.position = 'RRP';
                    user.grade = 1;
                }
                changed = true;
            }

            // Додаємо заглушки для нових полів, якщо їх немає
            if (!user.email) user.email = `${user.username}@example.com`; // Тимчасово
            if (!user.phone) user.phone = '-';

            if (changed) {
                await user.save();
                updatedCount++;
                console.log(`🔹 Оновлено: ${user.name} -> ${user.position} (Grade ${user.grade})`);
            }
        }

        console.log(`✨ Міграцію завершено! Оновлено користувачів: ${updatedCount}`);
        process.exit(0);

    } catch (e) {
        console.error('❌ Помилка міграції:', e);
        process.exit(1);
    }
};

migrate();