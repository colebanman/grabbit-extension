# Grabbit

Grabbit is a Chrome extension for developers that reverse-engineers the API request responsible for data on a webpage.

Highlight a value on your screen—a price, a name, or an ID—and Grabbit scans the network traffic to find the exact request that delivered it. It then generates a cURL command and an OpenAPI schema, allowing you to replay or document the endpoint immediately.

## Features

- **Fuzzy Matching:** Locates data even when formatted differently (e.g., matching "$2,110.22" on screen to "2110.22" in the JSON response).
- **Stealth Interception:** Hooks into Fetch and XHR silently, maintaining native function signatures to avoid detection.
- **Auto-Generated Artifacts:** Instantly copies a cURL command to your clipboard and logs an OpenAPI 3.0 schema to the sidebar.
- **Deep Search:** Recursively traverses complex JSON response bodies to find the source of your data.
- **Configurable:** Options to include headers and cookies in the generated commands.

## Installation

1. Clone this repository.
2. Open Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** in the top right corner.
4. Click **Load unpacked**.
5. Select the `Grabbit-Ext` directory.

## Usage

1. **Reload the page** you wish to inspect (Grabbit must inject its listeners before network requests occur).
2. **Highlight** the text you want to trace.
3. **Right-click** and select **"Grabbit: Extract API for..."**.
4. Upon success, the cURL command is copied to your clipboard.
5. Open the extension sidebar to view the full request history, headers, and schemas.

## Debugging

The extension includes a debug log for failed searches. Open the sidebar and click **Debug Logs** at the bottom to view the search history and scan results.

## License

MIT# grabbit-extension
