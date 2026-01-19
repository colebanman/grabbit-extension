// Inject the interceptor
const s = document.createElement('script');
s.src = chrome.runtime.getURL('src/scripts/injected.js');
s.onload = function() {
  this.remove();
};
(document.head || document.documentElement).appendChild(s);

// Buffer to store recent requests
// Structure: { url, method, requestBody, responseBody, timestamp }
let requestBuffer = [];
const MAX_BUFFER_SIZE = 100;

// Add the initial page load as a "request" so SSR content is searchable
requestBuffer.push({
  url: window.location.href,
  method: 'GET',
  requestHeaders: { "Note": "Initial Page Load" },
  responseBody: { 
    html: document.documentElement.innerText,
    title: document.title
  },
  timestamp: Date.now(),
  type: 'document'
});

let lastRightClickPos = { x: 0, y: 0 };

// Track right-click position for animation
document.addEventListener('contextmenu', (e) => {
  lastRightClickPos = { x: e.clientX, y: e.clientY };
}, true);

// Listen for intercepted network requests
function addDefaultHeader(headers, key, value) {
  if (!value) return;
  const lowerKey = key.toLowerCase();
  const hasHeader = Object.keys(headers).some(existing => existing.toLowerCase() === lowerKey);
  if (!hasHeader) {
    headers[key] = value;
  }
}

window.addEventListener('message', (event) => {
  if (event.source !== window || !event.data || event.data.source !== 'grabbit-interceptor') {
    return;
  }
  
  const req = event.data.payload;
  req.requestHeaders = req.requestHeaders || {};
  addDefaultHeader(req.requestHeaders, 'User-Agent', navigator.userAgent);
  requestBuffer.push(req);
  if (requestBuffer.length > MAX_BUFFER_SIZE) {
    requestBuffer.shift();
  }
});

function showNotification(text, type = 'success') {
  // Inject styles for the animation if not already present
  if (!document.getElementById('grabbit-styles')) {
    const style = document.createElement('style');
    style.id = 'grabbit-styles';
    style.textContent = `
      @keyframes grabbit-pop {
        0% { transform: scale(0) rotate(-10deg); opacity: 0; }
        50% { transform: scale(1.2) rotate(5deg); opacity: 1; }
        100% { transform: scale(1) rotate(0deg); opacity: 1; }
      }
      @keyframes grabbit-burst {
        0% { opacity: 1; transform: scale(0); }
        100% { opacity: 0; transform: scale(2); }
      }
      .grabbit-notification {
        position: fixed;
        z-index: 2147483647;
        pointer-events: none;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .grabbit-bubble {
        padding: 8px 16px;
        border-radius: 4px; /* Boxy retro look */
        font-family: 'Courier New', Courier, monospace; /* Indie dev feel */
        font-weight: 900;
        font-size: 16px;
        color: white;
        box-shadow: 4px 4px 0px rgba(0,0,0,0.2); /* Hard shadow */
        animation: grabbit-pop 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
        border: 2px solid white;
        text-transform: lowercase;
      }
      .grabbit-starburst {
        position: absolute;
        top: 50%;
        left: 50%;
        width: 100px;
        height: 100px;
        background: radial-gradient(circle, rgba(255,255,255,0.8) 0%, rgba(255,255,255,0) 70%);
        transform: translate(-50%, -50%);
        animation: grabbit-burst 0.6s ease-out forwards;
        z-index: -1;
      }
    `;
    document.head.appendChild(style);
  }

  const container = document.createElement('div');
  container.className = 'grabbit-notification';
  
  // Color logic
  const color = type === 'success' ? '#5ea568' : '#ff8787'; // Green or Light Red
  
  container.style.left = `${lastRightClickPos.x}px`;
  container.style.top = `${lastRightClickPos.y}px`;
  
  // Offset to float above cursor
  container.style.transform = 'translate(-50%, -40px)';

  const burst = document.createElement('div');
  burst.className = 'grabbit-starburst';
  
  const bubble = document.createElement('div');
  bubble.className = 'grabbit-bubble';
  bubble.style.backgroundColor = color;
  bubble.textContent = text; // "grabbed!" or "failed!"

  container.appendChild(burst);
  container.appendChild(bubble);
  document.body.appendChild(container);

  // Remove after delay
  setTimeout(() => {
    container.style.transition = 'opacity 0.3s, transform 0.3s';
    container.style.opacity = '0';
    container.style.transform = 'translate(-50%, -60px)';
    setTimeout(() => container.remove(), 300);
  }, 1800);
}

// Fuzzy matching logic
function cleanText(text) {
  // Remove currency symbols, commas, and extra whitespace
  // Keep alphanumeric and periods to preserve values like "26.3K" or "10.50"
  return text.replace(/[$,\s]/g, '').toLowerCase();
}

function parseShorthand(text) {
  const clean = text.toLowerCase().replace(/[$,\s]/g, '');
  // Look for a shorthand pattern anywhere in the cleaned text
  const match = clean.match(/([\d.]+)([kmb])/);
  if (!match) return null;
  
  const val = parseFloat(match[1]);
  const suffix = match[2];
  const multipliers = { k: 1000, m: 1000000, b: 1000000000 };
  const base = val * multipliers[suffix];
  
  return {
    min: base,
    max: base + (multipliers[suffix] - 1),
    suffix: suffix
  };
}

function findValueInObject(obj, targetValue, path = '') {
  if (!obj) return null;

  // Try numeric shorthand match (e.g., "48k" -> 48005)
  const shorthand = parseShorthand(targetValue);

  if (typeof obj === 'string' || typeof obj === 'number') {
    const numVal = Number(obj);
    if (shorthand && !isNaN(numVal)) {
      if (numVal >= shorthand.min && numVal <= shorthand.max) {
        return { value: obj, path: path };
      }
    }

    const strVal = String(obj);
    const cleanStrVal = cleanText(strVal);
    
    if (cleanStrVal === targetValue ||
        (targetValue.length > 2 && cleanStrVal.includes(targetValue)) ||
        (cleanStrVal.length > 2 && targetValue.includes(cleanStrVal))) {
      return { value: obj, path: path };
    }
    
    return null;
  }

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const result = findValueInObject(obj[i], targetValue, `${path}[${i}]`);
      if (result !== null) return result;
    }
  } else if (typeof obj === 'object') {
    // Prioritize keys that are likely to be what the user wants
    const keys = Object.keys(obj);
    const priorityKeys = keys.filter(k => /count|view|id|amount|price|text/i.test(k));
    const otherKeys = keys.filter(k => !priorityKeys.includes(k));
    
    for (let key of [...priorityKeys, ...otherKeys]) {
      const newPath = path ? `${path}.${key}` : key;
      const result = findValueInObject(obj[key], targetValue, newPath);
      if (result !== null) return result;
    }
  }

  return null;
}

// Handler for background script messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'FIND_API') {
    const selection = request.selection;
    const cleanSelection = cleanText(selection);
    
    console.log(`[Grabbit] Searching for: "${selection}" (clean: "${cleanSelection}")`);

    let foundRequest = null;
    let matchResult = null;

    // Search backwards (newest first)
    for (let i = requestBuffer.length - 1; i >= 0; i--) {
      const req = requestBuffer[i];
      const result = findValueInObject(req.responseBody, cleanSelection);
      if (result !== null) {
        foundRequest = req;
        matchResult = result;
        break;
      }
    }

    if (foundRequest) {
      sendResponse({ 
        success: true, 
        data: foundRequest,
        matchedValue: matchResult.value,
        matchedPath: matchResult.path,
        log: `Found match "${matchResult.value}" at "${matchResult.path}".`
      });
    } else {
      // Priority 2: Scan the live document text directly
      const docText = document.documentElement.innerText;
      const cleanDocText = cleanText(docText);
      
      if (cleanDocText.includes(cleanSelection)) {
        sendResponse({
          success: true,
          data: {
            url: window.location.href,
            method: 'GET',
            requestHeaders: { "Note": "Found in Page Content (SSR)" },
            responseBody: { content: "Matched in static HTML" }
          },
          matchedValue: selection,
          matchedPath: "document.body.innerText",
          log: `Found match in page content (SSR).`
        });
      } else {
        sendResponse({ 
          success: false, 
          error: 'No matching API request found.',
          log: `Failed to match "${cleanSelection}". Scanned ${requestBuffer.length} requests.` 
        });
      }
    }
  } else if (request.action === 'FIND_IMAGE') {
    const imageUrl = request.url;
    // Get relative path as well in case the API returns relative URLs
    let relativeUrl = imageUrl;
    try {
      const urlObj = new URL(imageUrl);
      relativeUrl = urlObj.pathname + urlObj.search;
    } catch(e) {}

    console.log(`[Grabbit] Searching for source of image: ${imageUrl}`);

    let foundRequest = null;
    let matchResult = null;

    // Search backwards (newest first)
    for (let i = requestBuffer.length - 1; i >= 0; i--) {
      const req = requestBuffer[i];
      // Check if the image URL or its relative path exists in the response body
      const result = findValueInObject(req.responseBody, imageUrl) || 
                    (relativeUrl.length > 1 ? findValueInObject(req.responseBody, relativeUrl) : null);
      if (result !== null) {
        foundRequest = req;
        matchResult = result;
        break;
      }
    }

    if (foundRequest) {
      sendResponse({ 
        success: true, 
        data: foundRequest,
        matchedValue: matchResult.value,
        matchedPath: matchResult.path,
        log: `Found API source for image "${imageUrl}".`
      });
    } else {
      // Fallback: If no API source found, just return the image request itself if it's in the buffer
      for (let i = requestBuffer.length - 1; i >= 0; i--) {
        const req = requestBuffer[i];
        if (req.url === imageUrl) {
          foundRequest = req;
          break;
        }
      }

      if (foundRequest) {
        sendResponse({ 
          success: true, 
          data: foundRequest,
          log: `No API source found. Captured direct image request.`
        });
      } else {
        sendResponse({ 
          success: true, 
          data: {
            url: imageUrl,
            method: 'GET',
            requestHeaders: {},
            responseBody: { info: "Captured via direct URL (no intercepted request found)" }
          },
          log: `No intercepted request found for "${imageUrl}". Captured direct URL.`
        });
      }
    }
  } else if (request.action === 'SHOW_NOTIFICATION') {
    showNotification(request.text, request.type);
  }
});
