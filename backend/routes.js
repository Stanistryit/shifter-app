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
const userController = require('./controllers/userController'); 
const salaryController = require('./controllers/salaryController'); // 🔥 Підключили фінансовий контролер

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

// --- USER TRANSFERS ---
router.post('/user/transfer/request', userController.requestTransfer);
router.post('/user/transfer/respond', userController.respondTransfer);

// --- STORES (Global Admin) ---
router.post('/admin/stores/create', adminController.createStore);
router.get('/admin/stores', adminController.getAllStores);
router.post('/admin/stores/delete', adminController.deleteStore);

// Збереження налаштувань магазину (час звіту)
router.post('/admin/store/settings', adminController.updateStoreSettings); 

// SALARY MATRIX (Global Admin)
router.get('/admin/salary-matrix', adminController.getSalaryMatrix);
router.post('/admin/salary-matrix', adminController.saveSalaryMatrix);

// --- SHIFTS ---
router.get('/shifts', shiftController.getShifts);
router.post('/shifts', shiftController.addShift);
router.post('/delete-shift', shiftController.deleteShift);
router.post('/shifts/bulk', shiftController.bulkImport);
router.post('/shifts/clear-day', shiftController.clearDay);
router.post('/shifts/clear-month', shiftController.clearMonth);

// Масове збереження графіку (для Редактора)
router.post('/shifts/save', shiftController.saveSchedule);

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

// --- SALARY (PaySlips) ---
router.get('/salary', salaryController.getUserSalary); // 🔥 Маршрут для отримання зарплати

module.exports = router;