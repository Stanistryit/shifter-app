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

// --- AUTH & USER ---
router.get('/stores', catchAsync(authController.getStores));
router.post('/register', catchAsync(authController.register));
router.post('/login', validate(schemas.login), catchAsync(authController.login));
router.post('/forgot-password', validate(schemas.forgotPassword), catchAsync(authController.forgotPassword));
router.post('/reset-password', validate(schemas.resetPassword), catchAsync(authController.resetPassword));
router.post('/user/update', catchAsync(authController.updateUser));
router.post('/user/change-password', catchAsync(authController.changePassword));
router.post('/login-telegram', catchAsync(authController.loginTelegram));
router.post('/logout', catchAsync(authController.logout));
router.get('/users', catchAsync(authController.getUsers));
router.get('/me', catchAsync(authController.getMe));
router.post('/user/avatar', catchAsync(authController.uploadAvatar));

// --- USER TRANSFERS ---
router.post('/user/transfer/request', catchAsync(userController.requestTransfer));
router.post('/user/transfer/respond', catchAsync(userController.respondTransfer));

// --- STORES (Global Admin) ---
router.post('/admin/stores/create', catchAsync(adminController.createStore));
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
router.post('/tasks/delete', catchAsync(taskController.deleteTask));
router.post('/tasks/toggle', catchAsync(taskController.toggleTaskStatus));

// --- KPI ---
router.get('/kpi', catchAsync(kpiController.getKpi));
router.post('/kpi/settings', catchAsync(kpiController.saveSettings));
router.post('/kpi/import', catchAsync(kpiController.importKpi));

// --- ADMIN (Logs, Requests, News) ---
router.get('/logs', catchAsync(adminController.getLogs));
router.get('/requests', catchAsync(adminController.getRequests));
router.post('/requests/action', catchAsync(adminController.handleRequestAction));
router.post('/requests/approve-all', catchAsync(adminController.approveAllRequests));
router.post('/news/publish', upload.array('media', 10), catchAsync(adminController.publishNews));

// --- NOTES ---
router.get('/notes', catchAsync(noteController.getNotes));
router.post('/notes', catchAsync(noteController.addNote));
router.post('/notes/delete', catchAsync(noteController.deleteNote));

// --- SALARY (PaySlips) ---
router.get('/salary', catchAsync(salaryController.getUserSalary));

module.exports = router;