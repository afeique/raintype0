// Center-screen banners — "WAVE N", "GAME OVER".

const titleEl = () => document.getElementById('message-title');
const subEl   = () => document.getElementById('message-subtitle');

export function showMessage(title, subtitle = '', durationMs = 0) {
    const t = titleEl(), s = subEl();
    t.textContent = title;
    t.style.display = 'block';
    s.innerHTML = subtitle.replace(/\n/g, '<br>');
    s.style.display = subtitle ? 'block' : 'none';
    if (durationMs > 0) setTimeout(hideMessage, durationMs);
}

export function hideMessage() {
    titleEl().style.display = 'none';
    subEl().style.display = 'none';
}
