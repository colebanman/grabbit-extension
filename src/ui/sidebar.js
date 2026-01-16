document.addEventListener('DOMContentLoaded', () => {
  const list = document.getElementById('history-list');
  const clearBtn = document.getElementById('clear-btn');
  const logsBtn = document.getElementById('logs-btn');
  const logsContainer = document.getElementById('logs-container');
  const headersCheckbox = document.getElementById('include-headers');
  const cookiesCheckbox = document.getElementById('include-cookies');

  // Load Settings
  chrome.storage.local.get({ settings: { includeHeaders: false, includeCookies: false } }, (result) => {
    headersCheckbox.checked = result.settings.includeHeaders;
    cookiesCheckbox.checked = result.settings.includeCookies;
  });

  // Save Settings
  function saveSettings() {
    chrome.storage.local.set({
      settings: {
        includeHeaders: headersCheckbox.checked,
        includeCookies: cookiesCheckbox.checked
      }
    });
  }
  headersCheckbox.addEventListener('change', saveSettings);
  cookiesCheckbox.addEventListener('change', saveSettings);

  function render() {
    chrome.storage.local.get({ history: [], debugLogs: [] }, (result) => {
      // Render History
      list.innerHTML = '';
      const history = result.history;

      if (history.length === 0) {
        list.innerHTML = '<div class="empty-state">No APIs extracted yet.<br>Highlight data on a page and right-click "Grabbit".</div>';
      } else {
        history.forEach((item, index) => {
           // ... (existing history rendering logic, but we need to keep it since we are replacing the whole function block if we aren't careful. 
           // Wait, I should just append the new logic or rewrite the render function carefully.
           // Let's rewrite the loop part briefly to be safe or use the tool to replace the *whole* render function + setup.)
           
            const li = document.createElement('li');
            li.className = 'item';
            const displayUrl = item.url.length > 50 ? item.url.substring(0, 50) + '...' : item.url;
            li.innerHTML = `
            <div>
                <span class="method ${item.method}">${item.method}</span>
                <span class="highlighted-text">Matched: "${item.selection}"</span>
                <span class="url" title="${item.url}">${displayUrl}</span>
            </div>
            <div class="meta">
                <span>${new Date(item.timestamp).toLocaleTimeString()}</span>
            </div>
            <div class="actions">
                <button class="action-btn copy-curl" data-index="${index}">Copy Curl</button>
                <button class="action-btn copy-schema" data-index="${index}">Copy Schema</button>
            </div>
            `;
            list.appendChild(li);
        });
      }

      // Render Logs
      logsContainer.innerHTML = '';
      const logs = result.debugLogs;
      if (logs.length === 0) {
          logsContainer.innerHTML = '<div style="padding:10px; color:#777;">No logs yet.</div>';
      } else {
          logs.forEach(log => {
              const div = document.createElement('div');
              div.className = `log-entry log-${log.type}`;
              div.innerHTML = `<span class="log-ts">[${new Date(log.timestamp).toLocaleTimeString()}]</span> ${log.message}`;
              logsContainer.appendChild(div);
          });
      }

      // Re-attach listeners for history items
      document.querySelectorAll('.copy-curl').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const idx = e.target.getAttribute('data-index');
          copyToClipboard(history[idx].curl, 'Curl copied!');
        });
      });

      document.querySelectorAll('.copy-schema').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const idx = e.target.getAttribute('data-index');
          copyToClipboard(JSON.stringify(history[idx].schema, null, 2), 'Schema copied!');
        });
      });
    });
  }

  function copyToClipboard(text, successMsg) {
    navigator.clipboard.writeText(text).then(() => {
        console.log(successMsg);
    }).catch(err => {
        console.error('Failed to copy text: ', err);
    });
  }

  clearBtn.addEventListener('click', () => {
    if (confirm('Clear all history?')) {
      chrome.storage.local.set({ history: [] }, render);
    }
  });

  logsBtn.addEventListener('click', () => {
      logsContainer.classList.toggle('visible');
      logsBtn.textContent = logsContainer.classList.contains('visible') ? 'Hide Logs' : 'Debug Logs';
  });

  // Auto-refresh when storage changes
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      render();
    }
  });

  render();
});
