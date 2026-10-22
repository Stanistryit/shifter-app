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

export async function fetchJson(url, options = {}, retries = 2) {
    showTopProgress();
    try {
        const res = await fetch(url, options);
        hideTopProgress();
        const text = await res.text();
        
        if (!res.ok) {
            console.error(`HTTP ${res.status} error for ${url}`);
            try {
                return JSON.parse(text);
            } catch {
                return { success: false, status: res.status, message: `HTTP ${res.status}` };
            }
        }

        try {
            return JSON.parse(text);
        } catch (parseErr) {
            console.error(`JSON Parse error for ${url}:`, parseErr, `(length: ${text.length})`);
            // Відновлення обірваного JSON масиву [ {...}, {...}
            const trimmed = text.trim();
            if (trimmed.startsWith('[') && trimmed.lastIndexOf('}') > 0) {
                try {
                    const repaired = trimmed.slice(0, trimmed.lastIndexOf('}') + 1) + ']';
                    const data = JSON.parse(repaired);
                    console.warn(`⚠️ Auto-repaired truncated JSON array for ${url} (recovered ${data.length} items)`);
                    return data;
                } catch (repairErr) {
                    // ignore and throw original parseErr
                }
            }
            throw parseErr;
        }
    } catch (e) {
        console.error(`API Error for ${url}:`, e);
        hideTopProgress();
        const isGet = !options.method || options.method.toUpperCase() === 'GET';
        if (retries > 0 && isGet) {
            console.warn(`🔄 Повторна спроба для ${url} (${retries} залишилось)...`);
            await new Promise(r => setTimeout(r, 400));
            return fetchJson(url, options, retries - 1);
        }
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