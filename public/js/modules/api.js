let activeRequests = 0;

function showTopProgress() {
    activeRequests++;
    const bar = document.getElementById('topProgressBar');
    if (bar && activeRequests === 1) {
        bar.classList.add('active');
    }
}

function hideTopProgress() {
    activeRequests--;
    if (activeRequests <= 0) {
        activeRequests = 0;
        const bar = document.getElementById('topProgressBar');
        if (bar) {
            bar.classList.remove('active');
        }
    }
}

// Всі запити до сервера
export async function fetchJson(url, options = {}) {
    showTopProgress();
    try {
        const res = await fetch(url, options);
        hideTopProgress();
        return await res.json();
    } catch (e) {
        console.error("API Error:", e);
        hideTopProgress();
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