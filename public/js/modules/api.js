// Всі запити до сервера
export async function fetchJson(url, options = {}) {
    try {
        const res = await fetch(url, options);
        return await res.json();
    } catch (e) {
        console.error("API Error:", e);
        return { success: false, message: "Network Error" };
    }
}

export async function postJson(url, data) {
    return fetchJson(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
}