const webpush = require('web-push');

const vapidKeys = webpush.generateVAPIDKeys();

console.log('--- PUBLIC KEY (Copy this to VAPID_PUBLIC_KEY in Render) ---');
console.log(vapidKeys.publicKey);
console.log('\n--- PRIVATE KEY (Copy this to VAPID_PRIVATE_KEY in Render) ---');
console.log(vapidKeys.privateKey);
