// Зберігаємо глобальні змінні тут, щоб вони були доступні всім
export const state = {
    currentUser: null,
    shifts: [],
    users: [],
    tasks: [],
    notes: [],
    stores: [], // 🔥 Зберігаємо завантажені магазини
    filter: 'all',
    selectedStoreFilter: 'all', 
    currentDate: new Date(),
    selectedNoteDate: null,
    noteType: 'private'
};