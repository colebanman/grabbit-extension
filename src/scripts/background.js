// Setup Context Menu
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "grabbit-extract",
    title: "Grabbit: Extract API for '%s'",
    contexts: ["selection"]
  });

  chrome.contextMenus.create({
    id: "grabbit-extract-image",
    title: "Grabbit: Extract Image Request",
    contexts: ["image"]
  });
});

// Helper: Generate basic JSON Schema from object
function generateSchema(data) {
  const type = typeof data;
  if (Array.isArray(data)) {
    return {
      type: "array",
      items: data.length > 0 ? generateSchema(data[0]) : {}
    };
  } else if (data === null) {
    return { type: "null" };
  } else if (type === 'object') {
    const properties = {};
    for (const key in data) {
      properties[key] = generateSchema(data[key]);
    }
    return { type: "object", properties };
  } else {
    return { type };
  }
}

function shellEscapeSingleQuotes(value) {
  return String(value).replace(/'/g, "'\\''");
}

// Helper: Generate simple Curl
function generateCurl(req, headers = {}, cookies = []) {
  let cmd = `curl -X ${req.method} "${req.url}"`;
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
  
  if (req.requestBody) {
      // If it's an object, stringify it, else use as is
      const bodyStr = typeof req.requestBody === 'object' ? JSON.stringify(req.requestBody) : req.requestBody;
      // escape single quotes for shell safety (basic)
      const safeBody = shellEscapeSingleQuotes(bodyStr);
      cmd += ` \\\n  -d '${safeBody}'`;
  }

  return cmd;
}

// Handle Context Menu Click
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "grabbit-extract" || info.menuItemId === "grabbit-extract-image") {
    const isImage = info.menuItemId === "grabbit-extract-image";
    const action = isImage ? "FIND_IMAGE" : "FIND_API";
    const payload = isImage ? { url: info.srcUrl } : { selection: info.selectionText };
    
    // 1. Send message to content script to find the request
    chrome.tabs.sendMessage(tab.id, {
      action: action,
      ...payload
    }, async (response) => {
      
      if (chrome.runtime.lastError) {
        console.error("Grabbit Error:", chrome.runtime.lastError.message || chrome.runtime.lastError);
        return;
      }

      // Save Debug Log
      if (response) {
        const logEntry = {
          timestamp: new Date().toISOString(),
          message: response.log || "No log provided",
          type: response.success ? 'success' : 'error'
        };
        chrome.storage.local.get({ debugLogs: [] }, (res) => {
          const newLogs = [logEntry, ...res.debugLogs].slice(0, 50);
          chrome.storage.local.set({ debugLogs: newLogs });
        });
      }

      if (response && response.success) {
        const req = response.data;
        const urlObj = new URL(req.url);
        const path = urlObj.pathname;
        const origin = urlObj.origin;

        // Fetch Cookies (Always record, even if settings don't include them in the initial copy)
        let cookies = [];
        try {
          cookies = await chrome.cookies.getAll({ url: req.url });
        } catch (e) {
          console.error("Failed to fetch cookies", e);
        }

        // Fetch Settings for initial copy
        chrome.storage.local.get({ settings: { includeHeaders: false, includeCookies: true } }, async (storage) => {
             const settings = storage.settings;
             const headersToUse = settings.includeHeaders ? req.requestHeaders : {};
             const cookiesToUse = settings.includeCookies ? cookies : [];

            // Parse Request Body if possible
            let parsedRequestBody = null;
            if (req.requestBody) {
              try {
                parsedRequestBody = typeof req.requestBody === 'string' ? JSON.parse(req.requestBody) : req.requestBody;
              } catch (e) {
                // keep as string or ignore
                parsedRequestBody = req.requestBody; // fallback
              }
            }
    
            const operationObject = {
              responses: {
                "200": {
                  description: "Successful response",
                  content: {
                    "application/json": {
                      schema: generateSchema(req.responseBody)
                    }
                  }
                }
              }
            };
    
            // Add Request Body Schema if exists
            if (parsedRequestBody && (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH')) {
               operationObject.requestBody = {
                 content: {
                   "application/json": {
                     schema: generateSchema(parsedRequestBody)
                   }
                 }
               };
            }
    
            // 2. Generate Artifacts
            const schema = {
              openapi: "3.0.0",
              info: { title: "Extracted API", version: "1.0.0" },
              servers: [
                { url: origin }
              ],
              paths: {
                [path]: {
                  [req.method.toLowerCase()]: operationObject
                }
              }
            };
    
            const curl = generateCurl(req, headersToUse, cookiesToUse);
            const clipboardText = curl;
            
            // 3. Save to Storage (Always save raw headers and cookies)
            const record = {
              id: Date.now(),
              url: req.url,
              method: req.method,
              requestBody: req.requestBody, // Save raw request body for re-generating curl
              timestamp: new Date().toISOString(),
              selection: isImage ? req.url : info.selectionText,
              matchedValue: response.matchedValue || (isImage ? req.url : info.selectionText),
              matchedPath: response.matchedPath || null,
              curl: curl, // Default curl
              requestHeaders: req.requestHeaders, // Save raw headers
              cookies: cookies, // Save raw cookies
              schema: schema,
              responseBody: req.responseBody
            };
    
            chrome.storage.local.get({ history: [] }, (result) => {
              const newHistory = [record, ...result.history];
              chrome.storage.local.set({ history: newHistory });
            });
    
            // 4. Send back to content script to copy to clipboard (Content script has clipboard access on user interaction)
            // Wait, the context menu click WAS the interaction. But we are in the callback now.
            // We might need to execute a script to copy.
            chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: (text) => {
                navigator.clipboard.writeText(text).catch(err => {
                  console.error('Failed to copy', err);
                });
              },
              args: [clipboardText]
            });
    
            // Notify User via Animation
            chrome.tabs.sendMessage(tab.id, {
              action: "SHOW_NOTIFICATION",
              text: "grabbed!",
              type: "success"
            });

        }); // End Storage Get
      } else {
        // Notify user of failure
        chrome.tabs.sendMessage(tab.id, {
          action: "SHOW_NOTIFICATION",
          text: "failed!",
          type: "error"
        });
      }
    });
  }
});

// Configure Side Panel behavior
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
