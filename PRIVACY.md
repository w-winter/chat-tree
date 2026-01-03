# Privacy Policy for ChatTree

## Data Collection
- This extension processes ChatGPT and Claude conversations locally in your browser
- No conversation data is sent to external servers
- Authentication headers captured via `webRequest` are stored only in `chrome.storage.session` (cleared when the browser session ends)

## Permissions Usage
- `storage`: Store captured request headers in session storage
- `tabs` / `activeTab`: Access the currently active ChatGPT/Claude tab
- `webRequest`: Detect and capture the authentication headers needed to fetch conversation data
- `scripting`: Inject scripts into ChatGPT/Claude pages to locate messages and perform navigation
- `debugger`: Dispatch trusted input events for Claude branch navigation (Claude can ignore synthetic DOM `.click()` events)

## Host Permissions
- `https://chatgpt.com/backend-api/*`: Read conversation data from ChatGPT's API endpoints
- `https://claude.ai/*`: Read conversation data from Claude and perform in-page navigation

## Data Security
- All processing happens locally in your browser
- No analytics or tracking
- No data sharing with third parties

## Contact
For privacy concerns, please open an issue on our GitHub repository.