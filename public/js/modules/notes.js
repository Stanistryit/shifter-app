import { state } from './state.js';
import { fetchJson, postJson } from './api.js';
import { showToast, triggerHaptic } from './ui.js';
import { renderAll } from './render.js';

export function openNotesModal(dateStr) {
    triggerHaptic();
    state.selectedNoteDate = dateStr;
    
    document.getElementById('notesModalTitle').innerText = `Нотатки (${dateStr})`;
    document.getElementById('notesModal').classList.remove('hidden');
    
    renderNotesList();
}

export function closeNotesModal() {
    document.getElementById('notesModal').classList.add('hidden');
}

export function renderNotesList() {
    const list = document.getElementById('notesList');
    list.innerHTML = '';
    
    const dayNotes = state.notes.filter(n => n.date === state.selectedNoteDate);
    
    if (dayNotes.length === 0) {
        list.innerHTML = '<p class="text-xs text-gray-400 text-center py-4">Немає нотаток</p>';
        return;
    }

    dayNotes.forEach(n => {
        const isPublic = n.type === 'public';
        const style = isPublic 
            ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200' 
            : 'bg-yellow-50 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200';
        const icon = isPublic ? '📢' : '🔒';
        
        // Перевірка прав на видалення: свої нотатки АБО адмін може видаляти публічні
        const canDelete = (n.author === state.currentUser.name) || 
                          ((state.currentUser.role === 'SM' || state.currentUser.role === 'admin') && isPublic);
        
        const deleteBtn = canDelete 
            ? `<button onclick="window.deleteNote('${n._id}')" class="text-red-500 ml-2 font-bold px-2 hover:bg-red-100 dark:hover:bg-red-900/30 rounded">×</button>` 
            : '';

        list.innerHTML += `
            <div class="note-item ${style} p-2 rounded-lg flex justify-between items-center mb-1 transition-all">
                <div class="flex-1 text-xs break-words">
                    <span class="mr-1">${icon}</span> 
                    <span class="font-bold mr-1">${n.author}:</span> ${n.text}
                </div>
                ${deleteBtn}
            </div>`;
    });
}

export function toggleNoteType() {
    triggerHaptic();
    if (state.noteType === 'private') {
        state.noteType = 'public';
        document.getElementById('noteTypeIcon').innerText = '📢';
        document.getElementById('noteTypeLabel').innerText = 'Всім';
    } else {
        state.noteType = 'private';
        document.getElementById('noteTypeIcon').innerText = '🔒';
        document.getElementById('noteTypeLabel').innerText = 'Особиста';
    }
}

export async function saveNote() {
    const text = document.getElementById('newNoteText').value;
    if (!text) return;

    const res = await postJson('/api/notes', { 
        date: state.selectedNoteDate, 
        text, 
        type: state.noteType 
    });

    if (res.success) {
        document.getElementById('newNoteText').value = '';
        
        // Оновлюємо список нотаток
        state.notes = await fetchJson('/api/notes');
        
        renderNotesList();
        renderAll(); // Оновлюємо іконки нотаток у графіку
        showToast("Нотатку додано");
    } else {
        showToast("Помилка", 'error');
    }
}

export async function deleteNote(id) {
    if (!confirm('Видалити нотатку?')) return;

    const res = await postJson('/api/notes/delete', { id });

    if (res.success) {
        state.notes = await fetchJson('/api/notes');
        renderNotesList();
        renderAll();
        showToast("Видалено");
    } else {
        showToast("Помилка", 'error');
    }
}