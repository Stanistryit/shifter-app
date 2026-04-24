const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });
const { validate, schemas } = require('./middleware/validator');
const catchAsync = require('./middleware/catchAsync');

// Імпорт контролерів
const authController = require('./controllers/authController');
const shiftController = require('./controllers/shiftController');
const taskController = require('./controllers/taskController');
const kpiController = require('./controllers/kpiController');
const adminController = require('./controllers/adminController');
const noteController = require('./controllers/noteController');
const userController = require('./controllers/userController');
const salaryController = require('./controllers/salaryController');
const pushController = require('./controllers/pushController');

// --- AUTH & USER ---
router.get('/stores', catchAsync(authController.getStores));
router.post('/register', catchAsync(authController.register));
router.post('/login', validate(schemas.login), catchAsync(authController.login));
router.post('/forgot-password', validate(schemas.forgotPassword), catchAsync(authController.forgotPassword));
router.post('/reset-password', validate(schemas.resetPassword), catchAsync(authController.resetPassword));
router.post('/user/update', catchAsync(authController.updateUser));
router.post('/user/change-password', catchAsync(authController.changePassword));
router.post('/user/notification-pref', catchAsync(authController.updateNotificationPref));
router.post('/login-telegram', catchAsync(authController.telegramLogin));
router.post('/logout', catchAsync(authController.logout));
router.get('/telegram-link', catchAsync(authController.getTelegramLink));
router.get('/users', catchAsync(authController.getUsers));
router.get('/me', catchAsync(authController.getMe));
router.post('/user/avatar', catchAsync(authController.uploadAvatar));

// --- WEB PUSH ---
router.post('/push/subscribe', catchAsync(pushController.subscribe));
router.post('/push/unsubscribe', catchAsync(pushController.unsubscribe));
router.post('/push/test', catchAsync(pushController.testPush));

// --- USER TRANSFERS ---
router.post('/user/transfer/request', catchAsync(userController.requestTransfer));
router.post('/user/transfer/respond', catchAsync(userController.respondTransfer));

// --- STORES (Global Admin) ---
router.post('/admin/stores/create', catchAsync(adminController.createStore));
router.post('/admin/stores/edit', catchAsync(adminController.editStore));
router.get('/admin/stores', catchAsync(adminController.getAllStores));
router.post('/admin/stores/delete', catchAsync(adminController.deleteStore));

// Збереження налаштувань магазину (час звіту)
router.post('/admin/store/settings', catchAsync(adminController.updateStoreSettings));
router.get('/admin/store/export', catchAsync(adminController.exportSchedule));
router.get('/admin/store/export-pdf', catchAsync(adminController.exportSchedulePdf));

// SALARY MATRIX (Global Admin)
router.get('/admin/salary-matrix', catchAsync(adminController.getSalaryMatrix));
router.post('/admin/salary-matrix', catchAsync(adminController.saveSalaryMatrix));

// --- SHIFTS ---
router.get('/shifts', catchAsync(shiftController.getShifts));
router.post('/shifts', validate(schemas.addShift), catchAsync(shiftController.addShift));
router.post('/delete-shift', catchAsync(shiftController.deleteShift));
router.post('/shifts/bulk', catchAsync(shiftController.bulkImport));
router.post('/shifts/clear-day', catchAsync(shiftController.clearDay));
router.post('/shifts/clear-month', catchAsync(shiftController.clearMonth));

// Масове збереження графіку (для Редактора)
router.post('/shifts/save', validate(schemas.saveSchedule), catchAsync(shiftController.saveSchedule));

// --- TASKS ---
router.get('/tasks', catchAsync(taskController.getTasks));
router.post('/tasks', validate(schemas.addTask), catchAsync(taskController.addTask));
router.post('/tasks/edit', catchAsync(taskController.editTask));
router.post('/tasks/delete', catchAsync(taskController.deleteTask));
router.post('/tasks/toggle', catchAsync(taskController.toggleTaskStatus));
router.post('/tasks/force-remind', catchAsync(taskController.forceRemind));

// --- KPI ---
router.get('/kpi', catchAsync(kpiController.getKpi));
router.post('/kpi/settings', catchAsync(kpiController.saveSettings));
router.post('/kpi/import', catchAsync(kpiController.importKpi));

// --- NOTIFICATIONS (In-App SSE) ---
const notificationController = require('./controllers/notificationController');
router.get('/notifications/stream', notificationController.stream);
router.get('/notifications', catchAsync(notificationController.getNotifications));
router.post('/notifications/read', catchAsync(notificationController.markAsRead));
router.post('/notifications/broadcast', catchAsync(notificationController.broadcastNotification));

// --- ADMIN (Logs, Requests, News) ---
router.get('/logs', catchAsync(adminController.getLogs));
router.get('/requests', catchAsync(adminController.getRequests));
router.post('/requests/action', catchAsync(adminController.handleRequestAction));
router.post('/requests/approve-all', catchAsync(adminController.approveAllRequests));
router.post('/news/publish', upload.array('media', 10), catchAsync(adminController.publishNews));
router.post('/admin/bot-broadcast', upload.array('media', 10), catchAsync(adminController.sendBotBroadcast));

// --- NOTES ---
router.get('/notes', catchAsync(noteController.getNotes));
router.post('/notes', catchAsync(noteController.addNote));
router.post('/notes/delete', catchAsync(noteController.deleteNote));

// --- SALARY (PaySlips) ---
router.get('/salary', catchAsync(salaryController.getUserSalary));

module.exports = router;