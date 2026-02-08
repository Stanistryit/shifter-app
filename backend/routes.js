const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

// Імпорт контролерів
const authController = require('./controllers/authController');
const shiftController = require('./controllers/shiftController');
const taskController = require('./controllers/taskController');
const kpiController = require('./controllers/kpiController');
const adminController = require('./controllers/adminController');
const noteController = require('./controllers/noteController');

// --- AUTH & USER ---
router.get('/stores', authController.getStores);
router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/user/update', authController.updateUser);
router.post('/user/change-password', authController.changePassword);
router.post('/login-telegram', authController.loginTelegram);
router.post('/logout', authController.logout);
router.get('/users', authController.getUsers);
router.get('/me', authController.getMe);
router.post('/user/avatar', authController.uploadAvatar);

// --- SHIFTS ---
router.get('/shifts', shiftController.getShifts);
router.post('/shifts', shiftController.addShift);
router.post('/delete-shift', shiftController.deleteShift);
router.post('/shifts/bulk', shiftController.bulkImport);
router.post('/shifts/clear-day', shiftController.clearDay);
router.post('/shifts/clear-month', shiftController.clearMonth);

// --- TASKS ---
router.get('/tasks', taskController.getTasks);
router.post('/tasks', taskController.addTask);
router.post('/tasks/delete', taskController.deleteTask);

// --- KPI ---
router.get('/kpi', kpiController.getKpi);
router.post('/kpi/settings', kpiController.saveSettings);
router.post('/kpi/import', kpiController.importKpi);

// --- ADMIN (Logs, Requests, News) ---
router.get('/logs', adminController.getLogs);
router.get('/requests', adminController.getRequests);
router.post('/requests/action', adminController.handleRequestAction);
router.post('/requests/approve-all', adminController.approveAllRequests);
router.post('/news/publish', upload.array('media', 10), adminController.publishNews);

// --- NOTES ---
router.get('/notes', noteController.getNotes);
router.post('/notes', noteController.addNote);
router.post('/notes/delete', noteController.deleteNote);

module.exports = router;