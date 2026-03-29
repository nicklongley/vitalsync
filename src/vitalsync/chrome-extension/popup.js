// VitalSync Chrome Extension — Garmin Cookie Capture
// Reads cookies from connect.garmin.com and sends to VitalSync

const GARMIN_DOMAIN = 'connect.garmin.com';
const VITALSYNC_URL = 'https://vitalsync-7e04b.web.app';

// Essential auth cookies that Garmin requires
const REQUIRED_COOKIES = ['session', 'GARMIN-SSO-CUST-GUID'];

const statusEl = document.getElementById('status');
const statusIcon = document.getElementById('garmin-status-icon');
const garminStatus = document.getElementById('garmin-status');
const connectBtn = document.getElementById('connect-btn');
const copyBtn = document.getElementById('copy-btn');

let cookieHeader = '';

// On popup open, check for Garmin cookies
checkGarminSession();

async function checkGarminSession() {
  try {
    const cookies = await chrome.cookies.getAll({ domain: '.garmin.com' });
    const connectCookies = await chrome.cookies.getAll({ domain: 'connect.garmin.com' });
    const allCookies = [...cookies, ...connectCookies];

    // Deduplicate by name (prefer connect.garmin.com over .garmin.com)
    const cookieMap = new Map();
    for (const c of allCookies) {
      const existing = cookieMap.get(c.name);
      if (!existing || c.domain === 'connect.garmin.com') {
        cookieMap.set(c.name, c);
      }
    }

    // Check for required cookies
    const hasRequired = REQUIRED_COOKIES.every(name => cookieMap.has(name));

    if (!hasRequired) {
      statusIcon.textContent = '\u274C';
      garminStatus.textContent = 'Not logged into Garmin Connect. Please log in first at connect.garmin.com';
      connectBtn.disabled = true;
      return;
    }

    // Build the cookie header string
    cookieHeader = Array.from(cookieMap.values())
      .map(c => `${c.name}=${c.value}`)
      .join('; ');

    statusIcon.textContent = '\u2705';
    garminStatus.textContent = 'Garmin Connect session found! Ready to connect.';
    connectBtn.disabled = false;
    copyBtn.style.display = 'block';

  } catch (err) {
    statusIcon.textContent = '\u274C';
    garminStatus.textContent = 'Error reading cookies: ' + err.message;
  }
}

// Copy cookies to clipboard (fallback for manual paste)
copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(cookieHeader);
    statusEl.textContent = 'Copied to clipboard! Paste into VitalSync Settings.';
    statusEl.className = 'status success';
  } catch (err) {
    statusEl.textContent = 'Copy failed: ' + err.message;
    statusEl.className = 'status error';
  }
});

// Send cookies directly to VitalSync via postMessage
connectBtn.addEventListener('click', async () => {
  connectBtn.disabled = true;
  connectBtn.innerHTML = '<span class="spinner"></span> Connecting...';
  statusEl.textContent = '';

  try {
    // Open VitalSync in a new tab (or find existing) and send cookies
    // We use a special URL parameter to trigger the cookie import
    const targetUrl = `${VITALSYNC_URL}?garmin_cookie_import=1`;

    // Find existing VitalSync tab or create one
    const tabs = await chrome.tabs.query({ url: `${VITALSYNC_URL}/*` });
    let tab;

    if (tabs.length > 0) {
      tab = tabs[0];
      await chrome.tabs.update(tab.id, { active: true });
    } else {
      tab = await chrome.tabs.create({ url: targetUrl });
    }

    // Wait a moment for the page to load, then send the message
    const sendMessage = () => {
      chrome.tabs.sendMessage(tab.id, {
        type: 'VITALSYNC_GARMIN_COOKIES',
        cookieHeader: cookieHeader,
      }).then(() => {
        connectBtn.innerHTML = '\u2713 Sent to VitalSync';
        connectBtn.style.background = '#059669';
        statusEl.textContent = 'Cookies sent! Check VitalSync to complete connection.';
        statusEl.className = 'status success';
      }).catch(() => {
        // Content script might not be loaded yet — fall back to clipboard
        navigator.clipboard.writeText(cookieHeader).then(() => {
          connectBtn.innerHTML = '\u2713 Copied!';
          statusEl.textContent = 'Cookies copied to clipboard. Paste into VitalSync Settings > Garmin Connection.';
          statusEl.className = 'status success';
        });
      });
    };

    // Give the tab time to load
    if (tabs.length > 0) {
      sendMessage();
    } else {
      setTimeout(sendMessage, 2000);
    }

  } catch (err) {
    connectBtn.disabled = false;
    connectBtn.textContent = 'Connect to VitalSync';
    statusEl.textContent = 'Error: ' + err.message;
    statusEl.className = 'status error';
  }
});
