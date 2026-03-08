const { User } = require('../models');
const webpush = require('web-push');

// Initialize Web Push with VAPID keys from environment variables
// VAPID keys must be generated via `npx web-push generate-vapid-keys`
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
        'mailto:support@shifter-app.com', // Replace with your support email
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
    );
} else {
    console.warn("VAPID Keys are missing! Web push notifications will not work. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in .env.");
}

exports.subscribe = async (req, res) => {
    if (!req.session || !req.session.user) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const subscription = req.body;
    const user = await User.findById(req.session.user._id);

    if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Determine if the subscription already exists
    const subExists = user.pushSubscriptions.some(sub => sub.endpoint === subscription.endpoint);
    if (!subExists) {
        user.pushSubscriptions.push(subscription);
        await user.save();
    }

    res.status(201).json({ success: true, message: 'Subscription saved' });
};

exports.unsubscribe = async (req, res) => {
    if (!req.session || !req.session.user) return res.status(401).send();

    const endpoint = req.body.endpoint;
    const user = await User.findById(req.session.user._id);

    if (user) {
        user.pushSubscriptions = user.pushSubscriptions.filter(sub => sub.endpoint !== endpoint);
        await user.save();
    }

    res.status(200).json({ success: true, message: 'Subscription removed' });
};

// Helper function to send push notifications to a user
exports.sendPushToUser = async (user, payload) => {
    if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return;
    if (!user.pushSubscriptions || user.pushSubscriptions.length === 0) return;

    const notifications = user.pushSubscriptions.map(sub =>
        webpush.sendNotification(sub, JSON.stringify(payload))
            .catch(err => {
                // Remove subscriptions that are no longer valid
                if (err.statusCode === 410 || err.statusCode === 404) {
                    user.pushSubscriptions = user.pushSubscriptions.filter(s => s.endpoint !== sub.endpoint);
                } else {
                    console.error("Error sending push notification: ", err);
                }
            })
    );

    await Promise.allSettled(notifications);
    // Best effort cleanup of invalid subscriptions
    try {
        await user.save();
    } catch (e) {
        console.error("Failed to clean up dead push subscriptions", e);
    }
};

exports.testPush = async (req, res) => {
    if (!req.session || !req.session.user) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const user = await User.findById(req.session.user._id);

    if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Дозволено тестувати лише глобальним адмінам (вас) та SM (щоб ви знали, у кого не працює)
    if (user.role !== 'admin' && user.role !== 'SM') {
        return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    console.log(`\n--- [PUSH TEST INITIATED BY ${user.name}] ---`);
    console.log(`1. VAPID Keys Present: ${!!process.env.VAPID_PUBLIC_KEY}`);
    console.log(`2. User Role: ${user.role}`);
    console.log(`3. Total Subscriptions: ${user.pushSubscriptions ? user.pushSubscriptions.length : 0}`);

    if (user.pushSubscriptions) {
        user.pushSubscriptions.forEach((sub, i) => {
            console.log(`   - Sub [${i}]: ${sub.endpoint.substring(0, 50)}...`);
        });
    }

    if (!user.pushSubscriptions || user.pushSubscriptions.length === 0) {
        console.log(`❌ ERROR: No active push subscriptions found for this user.`);
        console.log(`----------------------------------------------\n`);
        return res.json({ success: false, message: 'No push subscriptions enabled on this device' });
    }

    try {
        console.log(`4. Attempting to send push payload...`);
        // We call the real push function to see if it works
        await exports.sendPushToUser(user, {
            title: '✅ Тестове Push-сповіщення',
            body: 'Якщо ви бачите це, пуш-сповіщення успішно налаштовані!',
            url: '/'
        });

        console.log(`5. SUCCESSFULLY sent push test.`);
        console.log(`----------------------------------------------\n`);

        res.json({ success: true, message: 'Тестове push-сповіщення відправлено' });
    } catch (e) {
        console.error(`❌ ERROR sending push notification:`, e);
        console.log(`----------------------------------------------\n`);
        res.status(500).json({ success: false, message: 'Server error sending push test' });
    }
};
