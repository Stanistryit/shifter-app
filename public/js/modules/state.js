// Зберігаємо глобальні змінні тут, щоб вони були доступні всім
export const state = {
    currentUser: null,

    // Дані
    shifts: [],
    users: [],
    tasks: [],
    notes: [],
    stores: [],

    // Фільтри та навігація (🔥 ОНОВЛЕНО: читаємо з LocalStorage)
    filter: localStorage.getItem('shifter_filter') || 'all',
    selectedStoreFilter: localStorage.getItem('shifter_storeFilter') || 'all',
    viewMode: localStorage.getItem('shifter_viewMode') || 'list', // Зберігаємо режим (list/calendar/grid)

    currentDate: new Date(),

    // Стан UI
    selectedNoteDate: null,
    noteType: 'private',
    isHoursPinned: localStorage.getItem('shifter_hoursPinned') === '1', // Зберігаємо налаштування стовпця Годин

    // 🔥 НОВЕ: Стан Редактора Графіку
    isEditMode: false,          // Чи відкрито редактор
    activeTool: null,           // Поточний пензлик ({start:'10:00', end:'20:00'} або 'eraser')
    pendingChanges: {},         // Чернетки: { '2023-10-01_User': { start, end } }
    shiftTemplates: [           // Стандартні шаблони (можна буде редагувати)
        { label: '10-22', start: '10:00', end: '22:00' },
        { label: '10-20', start: '10:00', end: '20:00' },
        { label: '10-18', start: '10:00', end: '18:00' },
        { label: '10-16', start: '10:00', end: '16:00' },
        { label: '12-20', start: '12:00', end: '20:00' },
        { label: '16-22', start: '16:00', end: '22:00' }
    ]
};