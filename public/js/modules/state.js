// Зберігаємо глобальні змінні тут, щоб вони були доступні всім
export const state = {
    currentUser: null,
    shifts: [],
    users: [],
    tasks: [],
    notes: [],
    filter: 'all',
    currentDate: new Date(),
    selectedNoteDate: null,
    noteType: 'private'
};