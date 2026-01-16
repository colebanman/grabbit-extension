(function() {
  const XHR = XMLHttpRequest.prototype;
  const originalOpen = XHR.open;
  const originalSend = XHR.send;
  const originalSetRequestHeader = XHR.setRequestHeader;
  const originalFetch = window.fetch;

  // Helper to safely post message to content script
  function broadcastRequest(data) {
    window.postMessage({ source: 'grabbit-interceptor', payload: data }, '*');
  }

  function resolveUrl(url) {
    if (!url) return url;
    try {
      return new URL(url, window.location.href).href;
    } catch (e) {
      return url;
    }
  }

  // Stealth patch helper: Hides the fact that function is monkey-patched
  function patch(target, name, replacement) {
    const original = target[name];
    target[name] = replacement;
    // Hide the patch by mimicking the original toString
    try {
      Object.defineProperty(replacement, 'toString', {
        value: function() { return original.toString(); },
        configurable: true,
        writable: true
      });
    } catch(e) {}
  }

  // Intercept XMLHttpRequest.open
  patch(XHR, 'open', function(method, url) {
    this._method = method;
    this._url = resolveUrl(url);
    this._requestHeaders = {};
    return originalOpen.apply(this, arguments);
  });

  // Intercept XMLHttpRequest.setRequestHeader
  patch(XHR, 'setRequestHeader', function(header, value) {
    this._requestHeaders = this._requestHeaders || {};
    this._requestHeaders[header] = value;
    return originalSetRequestHeader.apply(this, arguments);
  });

  // Intercept XMLHttpRequest.send
  patch(XHR, 'send', function(postData) {
    this.addEventListener('load', function() {
      // Only parse if we have a valid response type for JSON/Text
      if (!this.responseType || this.responseType === 'text' || this.responseType === 'json') {
        try {
          let responseBody;
          if (this.responseType === 'json') {
              responseBody = this.response;
          } else {
              // Try parsing text as JSON, if it fails, ignore (it's not an API we care about)
              try {
                  responseBody = JSON.parse(this.responseText);
              } catch(e) {
                  return; 
              }
          }
          
          broadcastRequest({
            url: this._url,
            method: this._method,
            requestBody: postData,
            requestHeaders: this._requestHeaders,
            responseBody: responseBody,
            type: 'xhr',
            timestamp: Date.now()
          });
        } catch (e) {
          // Ignore
        }
      }
    });
    return originalSend.apply(this, arguments);
  });

  // Intercept Fetch
  // We use a regular function returning a promise to mimic fetch exactly, 
  // rather than an async function which might have subtle diffs.
  const newFetch = function(input, init) {
    return originalFetch.apply(this, arguments).then(async (response) => {
      // Clone immediately to avoid using the body
      const clone = response.clone();

      // Process asynchronously without blocking the original response
      clone.json().then(data => {
        let url = '';
        let method = 'GET';
        let body = null;
        let headers = {};

        if (typeof input === 'string') {
          url = input;
        } else if (input instanceof Request) {
          url = input.url;
          method = input.method;
          body = input.body;
          if (input.headers) {
              input.headers.forEach((v, k) => headers[k] = v);
          }
        }

        if (init) {
          if (init.method) method = init.method;
          if (init.body) body = init.body;
          if (init.headers) {
              if (init.headers instanceof Headers) {
                  init.headers.forEach((v, k) => headers[k] = v);
              } else {
                  Object.assign(headers, init.headers);
              }
          }
        }

        broadcastRequest({
          url: resolveUrl(url),
          method: method,
          requestBody: body,
          requestHeaders: headers,
          responseBody: data,
          type: 'fetch',
          timestamp: Date.now()
        });
      }).catch(err => {
        // Not JSON
      });

      return response;
    });
  };
  
  patch(window, 'fetch', newFetch);

})();