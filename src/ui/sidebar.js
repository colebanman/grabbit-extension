document.addEventListener('DOMContentLoaded', () => {
  const list = document.getElementById('history-list');
  const clearBtn = document.getElementById('clear-btn');
  const logsBtn = document.getElementById('logs-btn');
  const logsContainer = document.getElementById('logs-container');
  const headersCheckbox = document.getElementById('include-headers');
  const cookiesCheckbox = document.getElementById('include-cookies');

  // Load Settings
  chrome.storage.local.get({ settings: { includeHeaders: false, includeCookies: true } }, (result) => {
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
    chrome.storage.local.get({ history: [], debugLogs: [], settings: { includeHeaders: false, includeCookies: true } }, (result) => {
      const settings = result.settings;
      // Render History
      list.innerHTML = '';
      const history = result.history;

      if (history.length === 0) {
        list.innerHTML = '<div class="empty-state">No APIs extracted yet.<br>Highlight data on a page and right-click "Grabbit".</div>';
      } else {
        history.forEach((item, index) => {
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
                <button class="action-btn copy-curl" data-index="${index}">Curl</button>
                <button class="action-btn copy-grep" data-index="${index}">Grep</button>
                <button class="action-btn copy-schema" data-index="${index}">Schema</button>
                <button class="action-btn copy-response" data-index="${index}">Response</button>
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
          const item = history[idx];
          
          const headersToUse = settings.includeHeaders ? item.requestHeaders : {};
          const cookiesToUse = settings.includeCookies ? (item.cookies || []) : [];
          
          const curl = generateCurl(item, headersToUse, cookiesToUse);
          copyToClipboard(curl, 'curl copied!');
        });
      });

      document.querySelectorAll('.copy-grep').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const idx = e.target.getAttribute('data-index');
          const item = history[idx];
          
          const headersToUse = settings.includeHeaders ? item.requestHeaders : {};
          const cookiesToUse = settings.includeCookies ? (item.cookies || []) : [];
          
          let curl = generateCurl(item, headersToUse, cookiesToUse);
          
          if (item.matchedPath === "document.body.innerText") {
            // Smart Regex extraction for HTML/SSR content
            const target = item.matchedValue || item.selection;
            // Escape special regex characters in the target
            const escapedTarget = String(target).replace(/[.*+?^${}()|[\\]\\]/g, '\\{new_string}');
            // Regex to find text between tags containing the target
            curl += ` | grep -oE '[^>]*${escapedTarget}[^<]*'`;
            copyToClipboard(curl, 'regex command copied!');
          } else if (item.matchedPath) {
            // Smart JSON extraction using jq
            const segments = item.matchedPath.split('.');
            const jqPath = segments.map(seg => {
              // Handle array indices like "items[0]"
              if (seg.includes('[') && seg.includes(']')) {
                return seg.replace(/^([^\[]+)(\[.*\])$/, '["$1"]$2');
              }
              return `["${seg}"]`;
            }).join('');
            
            curl += ` | jq '.${jqPath}'`;
            copyToClipboard(curl, 'jq command copied!');
          } else {
            // Fallback to smart grep if no path
            const target = item.matchedValue || item.selection;
            const safeTarget = String(target).replace(/'/g, "'\\''");
            curl += ` | grep --color=always -iC 2 '${safeTarget}'`;
            copyToClipboard(curl, 'grep command copied!');
          }
        });
      });

      document.querySelectorAll('.copy-schema').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const idx = e.target.getAttribute('data-index');
          copyToClipboard(JSON.stringify(history[idx].schema, null, 2), 'schema copied!');
        });
      });

      document.querySelectorAll('.copy-response').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const idx = e.target.getAttribute('data-index');
          copyToClipboard(JSON.stringify(history[idx].responseBody, null, 2), 'response copied!');
        });
      });
    });
  }

  function shellEscapeSingleQuotes(value) {
    return String(value).replace(/'/g, "'\\''");
  }

  function generateCurl(item, headers = {}, cookies = []) {
    let cmd = `curl -X ${item.method} "${item.url}"`;
    let cookieHeaderValue = null;
    
    // Add Headers
    if (headers) {
      for (const [key, value] of Object.entries(headers)) {
        const lowerKey = key.toLowerCase();
        // Filter out cache headers and anything with "forwarded"
        if (lowerKey === 'cookie') {
          cookieHeaderValue = value;
          continue;
        }
        if (lowerKey === 'if-none-match' || 
            lowerKey === 'if-modified-since' || 
            lowerKey === 'cache-control' || 
            lowerKey === 'pragma' || 
            lowerKey.includes('forwarded')) {
          continue;
        }
        const headerValue = `${key}: ${value}`;
        cmd += ` \\\n  -H '${shellEscapeSingleQuotes(headerValue)}'`;
      }
    }

    // Add Cookies
    if (cookies && cookies.length > 0) {
      const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');
      cmd += ` \\\n  -b '${shellEscapeSingleQuotes(cookieString)}'`;
    } else if (cookieHeaderValue) {
      cmd += ` \\\n  -b '${shellEscapeSingleQuotes(cookieHeaderValue)}'`;
    }
    
    if (item.requestBody) {
        const bodyStr = typeof item.requestBody === 'object' ? JSON.stringify(item.requestBody) : item.requestBody;
        const safeBody = shellEscapeSingleQuotes(bodyStr);
        cmd += ` \\\n  -d '${safeBody}'`;
    }

    return cmd;
  }

  function showNotification(text, type = 'success') {
    // Inject styles for the animation if not already present
    if (!document.getElementById('grabbit-sidebar-styles')) {
      const style = document.createElement('style');
      style.id = 'grabbit-sidebar-styles';
      style.textContent = `
        @keyframes grabbit-pop {
          0% { transform: scale(0) rotate(-10deg); opacity: 0; }
          50% { transform: scale(1.2) rotate(5deg); opacity: 1; }
          100% { transform: scale(1) rotate(0deg); opacity: 1; }
        }
        .grabbit-notification {
          position: fixed;
          z-index: 2147483647;
          pointer-events: none;
          bottom: 20px;
          right: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .grabbit-bubble {
          padding: 8px 16px;
          border-radius: 4px;
          font-family: 'Courier New', Courier, monospace;
          font-weight: 900;
          font-size: 14px;
          color: white;
          box-shadow: 4px 4px 0px rgba(0,0,0,0.2);
          animation: grabbit-pop 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
          border: 2px solid white;
          text-transform: lowercase;
        }
      `;
      document.head.appendChild(style);
    }

    const container = document.createElement('div');
    container.className = 'grabbit-notification';
    const color = type === 'success' ? '#5ea568' : '#ff8787';
    
    const bubble = document.createElement('div');
    bubble.className = 'grabbit-bubble';
    bubble.style.backgroundColor = color;
    bubble.textContent = text;

    container.appendChild(bubble);
    document.body.appendChild(container);

    setTimeout(() => {
      container.style.transition = 'opacity 0.3s, transform 0.3s';
      container.style.opacity = '0';
      container.style.transform = 'translateY(20px)';
      setTimeout(() => container.remove(), 300);
    }, 1200);
  }

  function copyToClipboard(text, successMsg) {
    navigator.clipboard.writeText(text).then(() => {
        showNotification(successMsg, 'success');
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
