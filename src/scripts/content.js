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
let lastRightClickPos = { x: 0, y: 0 };

// Track right-click position for animation
document.addEventListener('contextmenu', (e) => {
  lastRightClickPos = { x: e.clientX, y: e.clientY };
}, true);

// Listen for intercepted network requests
window.addEventListener('message', (event) => {
  if (event.source !== window || !event.data || event.data.source !== 'grabbit-interceptor') {
    return;
  }
  
  const req = event.data.payload;
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
  // Remove currency symbols, commas, whitespace
  // Example: "$211.22" -> "211.22", "333,123,123" -> "333123123"
  return text.replace(/[$,\s]/g, '');
}

function findValueInObject(obj, targetValue) {
  if (!obj) return false;

  if (typeof obj === 'string' || typeof obj === 'number') {
    const strVal = String(obj);
    const cleanStrVal = cleanText(strVal);
    
    // Direct match or cleaned match
    // Allow partial matching if the selection is long enough to be unique
    if (cleanStrVal === targetValue) return true;
    if (targetValue.length > 2 && cleanStrVal.includes(targetValue)) return true;
    
    return false;
  }

  if (Array.isArray(obj)) {
    for (let item of obj) {
      if (findValueInObject(item, targetValue)) return true;
    }
  } else if (typeof obj === 'object') {
    for (let key in obj) {
      if (findValueInObject(obj[key], targetValue)) return true;
    }
  }

  return false;
}

// Handler for background script messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'FIND_API') {
    const selection = request.selection;
    const cleanSelection = cleanText(selection);
    
    console.log(`[Grabbit] Searching for: "${selection}" (clean: "${cleanSelection}")`);

    let foundRequest = null;

    // Search backwards (newest first)
    for (let i = requestBuffer.length - 1; i >= 0; i--) {
      const req = requestBuffer[i];
      if (findValueInObject(req.responseBody, cleanSelection)) {
        foundRequest = req;
        break;
      }
    }

    if (foundRequest) {
      sendResponse({ 
        success: true, 
        data: foundRequest,
        log: `Found match for "${cleanSelection}". Scanned ${requestBuffer.length} requests.`
      });
    } else {
      sendResponse({ 
        success: false, 
        error: 'No matching API request found.',
        log: `Failed to match "${cleanSelection}". Scanned ${requestBuffer.length} requests.` 
      });
    }
  } else if (request.action === 'SHOW_NOTIFICATION') {
    showNotification(request.text, request.type);
  }
});
