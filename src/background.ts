import type { ClaudeNavigationTarget } from './types/interfaces';

// Global variables for API endpoints and IDs
const CHATGPT_ORIGIN = 'https://chatgpt.com';
const CLAUDE_ORIGIN = 'https://claude.ai';
let claudeOrgId: string | null = null;

const DEBUG_CLAUDE_NAVIGATION = false;
const debugClaudeNavigation = (...args: unknown[]) => {
  if (DEBUG_CLAUDE_NAVIGATION) {
    console.log(...args);
  }
};

let claudeNavigationQueue: Promise<void> = Promise.resolve();

async function enqueueClaudeNavigation(work: () => Promise<void>) {
  const run = async () => {
    await work();
  };

  const next = claudeNavigationQueue.then(run, run);
  // Keep the queue alive even if the task fails
  claudeNavigationQueue = next.catch((error) => {
    console.error('[ChatTree] Claude navigation task failed:', error);
  });
  await next;
}

// Function to save headers to chrome.storage
function saveRequestHeaders(headers: chrome.webRequest.HttpHeader[]) {
  chrome.storage.session.set({ storedRequestHeaders: headers }, () => {
    if (chrome.runtime.lastError) {
      console.error('Error saving headers:', chrome.runtime.lastError);
    }
  });
}

// Function to load headers from chrome.storage
function loadRequestHeaders(): Promise<chrome.webRequest.HttpHeader[] | null> {
  return new Promise((resolve) => {
    chrome.storage.session.get(['storedRequestHeaders'], (result) => {
      if (chrome.runtime.lastError) {
        console.error('Error loading headers:', chrome.runtime.lastError);
        resolve(null);
      } else {
        resolve(result.storedRequestHeaders || null);
      }
    });
  });
}

function captureHeaders() {
  chrome.webRequest.onBeforeSendHeaders.addListener(
    (details) => {
      if (details.requestHeaders?.some(h => h.name.toLowerCase() === 'authorization')) {
        saveRequestHeaders(details.requestHeaders);
      }
    },
    { urls: ["https://chatgpt.com/backend-api/*"] },
    ["requestHeaders"]
  );

  chrome.webRequest.onSendHeaders.addListener(
    (details) => {
      if (details.requestHeaders?.some(h => h.name.toLowerCase() === 'authorization')) {
        saveRequestHeaders(details.requestHeaders);
      }
    },
    { urls: ["https://chatgpt.com/backend-api/*"] },
    ["requestHeaders"]
  );
}

// Function to capture Claude organization IDs
function captureClaudeOrgId() {
  const CLAUDE_ORG_PATTERN = "https://claude.ai/api/organizations/*";
  const CLAUDE_ORG_PREFIX = "https://claude.ai/api/organizations/";

  chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
      if (details.url.startsWith(CLAUDE_ORG_PREFIX)) {
        const orgId = details.url.substring(CLAUDE_ORG_PREFIX.length).split('/')[0];
        if (orgId) {
          claudeOrgId = orgId;
          // Store the org ID in chrome.storage for potential future use
          chrome.storage.session.set({ claudeOrgId: orgId });
        }
      }
    },
    {
      urls: [CLAUDE_ORG_PATTERN],
      types: ["xmlhttprequest"] as chrome.webRequest.ResourceType[]
    }
  );
}

// Add message listener to handle requests for headers and conversation history
chrome.runtime.onMessage.addListener(
  (request, _sender, sendResponse) => {
    if (request.action === "getHeaders") {
      loadRequestHeaders().then(headers => {
        sendResponse({ headers });
      });
      return true;
    }
    else if (request.action === "fetchConversationHistory") {
      fetchConversationHistory()
        .then(data => {
          // After fetching conversation history, trigger native events
          triggerNativeArticleEvents();
          sendResponse({ success: true, data });
        })
        .catch(error => {
          sendResponse({ success: false, error: error.message });
        });
      return true;
    }
    else if (request.action === "checkNodes") {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]?.url) {
          sendResponse({ success: false, error: "Could not get current tab URL" });
          return;
        }

        const url = new URL(tabs[0].url);
        if (url.origin === CHATGPT_ORIGIN) {
          checkNodesExistence(request.nodeIds)
            .then(existingNodes => {
              sendResponse({ success: true, existingNodes });
            })
            .catch(error => {
              sendResponse({ success: false, error: error.message });
            });
        } else {
          sendResponse({ success: false, error: "Invalid origin for OpenAI check" });
        }
      });
      return true;
    }
    else if (request.action === "checkNodesClaude") {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]?.url) {
          sendResponse({ success: false, error: "Could not get current tab URL" });
          return;
        }

        const url = new URL(tabs[0].url);
        if (url.origin === CLAUDE_ORIGIN) {


          if (!request.nodeTexts || !Array.isArray(request.nodeTexts)) {
            console.error('Invalid nodeTexts:', request.nodeTexts);
            sendResponse({ success: false, error: "Invalid nodeTexts provided" });
            return;
          }
          checkNodesExistenceClaude(request.nodeTexts)
            .then(existingNodes => {
              sendResponse({ success: true, existingNodes });
            })
            .catch(error => {
              sendResponse({ success: false, error: error.message });
            });
        } else {
          sendResponse({ success: false, error: "Invalid origin for Claude check" });
        }
      });
      return true;
    }
    else if (request.action === "editMessage") {
      (async () => {
        try {
          await editMessage(request.messageId, request.message);
          sendResponse({ success: true, completed: true });
        } catch (error: any) {
          sendResponse({
            success: false,
            completed: false,
            error: error.message
          });
        }
      })();
      return true; // Keep message channel open for async response
    }
    else if (request.action === "respondToMessage") {
      (async () => {
        try {
          await respondToMessage(request.childrenIds, request.message);
          sendResponse({ success: true, completed: true });
        } catch (error: any) {
          sendResponse({
            success: false,
            completed: false,
            error: error.message
          });
        }
      })();
      return true; // Keep message channel open for async response
    } else if (request.action === "executeSteps") {
      (async () => {
        try {
          await selectBranch(request.steps);
          sendResponse({ success: true, completed: true });
        } catch (error: any) {
          sendResponse({
            success: false,
            completed: false,
            error: error.message
          });
        }
      })();
      return true; // Keep message channel open for async response
    } else if (request.action === "executeStepsClaude") {
      (async () => {
        try {
          await enqueueClaudeNavigation(async () => {
            await selectBranchClaude(request.navigationTarget);
          });
          sendResponse({ success: true, completed: true });
        } catch (error: any) {
          sendResponse({
            success: false,
            completed: false,
            error: error.message
          });
        }
      })();
      return true; // Keep message channel open for async response
    } else if (request.action === "goToTarget") {
      (async () => {
        try {
          const found = await goToTarget(request.targetId);
          sendResponse({ success: found, completed: found });
        } catch (error: any) {
          sendResponse({ success: false, completed: false, error: error.message });
        }
      })();
      return true;
    } else if (request.action === "goToTargetClaude") {
      (async () => {
        try {
          const found = await goToTargetClaude(request.targetId);
          sendResponse({ success: found, completed: found });
        } catch (error: any) {
          sendResponse({ success: false, completed: false, error: error.message });
        }
      })();
      return true;
    } else if (request.action === "log") {
      console.log(request.message);
      sendResponse({ success: true });
      return true;
    } else if (request.action === "triggerNativeEvents") {
      triggerNativeArticleEvents();
      sendResponse({ success: true });
      return true;
    } else if (request.action === "getClaudeOrgId") {
      chrome.storage.session.get(['claudeOrgId'], (result) => {
        sendResponse({ orgId: result.claudeOrgId || null });
      });
      return true;
    } else if (request.action === "respondToMessageClaude") {
      (async () => {
        try {
          const childrenTexts =
            Array.isArray(request.childrenTexts) ? request.childrenTexts : request.childrenIds;

          if (!Array.isArray(childrenTexts)) {
            throw new Error('childrenTexts must be an array');
          }

          // Serialize via enqueueClaudeNavigation to prevent chrome.debugger attach collisions
          await enqueueClaudeNavigation(async () => {
            await respondToMessageClaude(childrenTexts, request.message);
          });
          sendResponse({ success: true, completed: true });
        } catch (error: any) {
          sendResponse({
            success: false,
            completed: false,
            error: error.message
          });
        }
      })();
      return true; // Keep message channel open for async response
    } else if (request.action === "editMessageClaude") {
      (async () => {
        try {
          const messageText = typeof request.messageText === 'string' ? request.messageText : request.messageId;
          const newMessage = typeof request.newMessage === 'string' ? request.newMessage : request.message;

          await editMessageClaude(messageText, newMessage);
          sendResponse({ success: true, completed: true });
        } catch (error: any) {
          sendResponse({
            success: false,
            completed: false,
            error: error.message
          });
        }
      })();
      return true; // Keep message channel open for async response
    }
    return false; // For non-async handlers
  }
);

// Function to trigger native events for all article elements in the page
async function triggerNativeArticleEvents() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const currentTab = tabs[0];

  if (!currentTab?.id) {
    console.error('No active tab found for triggering native events');
    return;
  }
  if (!currentTab.url || currentTab.url.startsWith('chrome://') || currentTab.url.startsWith('edge://')) {
    return;
  }

  await chrome.scripting.executeScript({
    target: { tabId: currentTab.id },
    func: () => {
      function triggerNativeEvents(element: Element) {
        if (!element) {
          console.error("triggerNativeEvents: Element is null or undefined.");
          return;
        }

        const eventTypes = [
          'pointerover', 'pointerenter', 'pointermove',
          'mouseover', 'mouseenter', 'mousemove'
        ];

        for (const eventType of eventTypes) {
          try {
            const event = new MouseEvent(eventType, {
              bubbles: true,
              cancelable: true,
              view: window,
            });

            Object.defineProperty(event, 'target', {
              value: element,
              enumerable: true,
              configurable: true
            });
            Object.defineProperty(event, 'currentTarget', {
              value: element,
              enumerable: true,
              configurable: true
            });

            element.dispatchEvent(event);
            // console.log(`Dispatched native ${eventType} event on:`, element); // Optional logging
          } catch (error) {
            console.error(`Error dispatching ${eventType} event:`, error);
          }
        }
      }

      // Keep track of triggered elements.
      const triggeredElements = new Set<Element>();

      function processArticle(article: Element) {
        if (!triggeredElements.has(article)) { //only if not already triggered
          // Process recursively up to 5 levels deep
          processElementRecursively(article, 0);
          triggeredElements.add(article); //remember we triggered.
        }
      }

      function processElementRecursively(element: Element, depth: number) {
        if (depth > 5) return; // Stop at depth 5

        // Trigger events on the current element
        triggerNativeEvents(element);

        // Process all children recursively
        Array.from(element.children).forEach(child => {
          processElementRecursively(child, depth + 1);
        });
      }

      function findAndTriggerEvents() {
        const articles = document.querySelectorAll('article[data-testid^="conversation-turn-"]');
        articles.forEach(processArticle);
      }

      function startPollingForNewArticles() {
        let previousArticleCount = document.querySelectorAll('article[data-testid^="conversation-turn-"]').length;

        const pollingInterval = setInterval(() => {
          const currentArticleCount = document.querySelectorAll('article[data-testid^="conversation-turn-"]').length;

          if (currentArticleCount > previousArticleCount) {
            findAndTriggerEvents();
          }

          previousArticleCount = currentArticleCount;
        }, 2000);

        setTimeout(() => {
          clearInterval(pollingInterval);
        }, 30000);
      }

      function init() {
        findAndTriggerEvents();
        startPollingForNewArticles();

        const parentContainerSelector = '.mt-1\\.5\\.flex\\.flex-col\\.text-sm\\.\\@thread-xl\\/thread\\:pt-header-height\\.md\\:pb-9';
        const parentContainer = document.querySelector(parentContainerSelector);

        const observer = new MutationObserver(() => {
          findAndTriggerEvents();
        });

        const observeTarget = parentContainer || document.body;
        observer.observe(observeTarget, { childList: true, subtree: true });

        const chatContainer = document.querySelector('main');
        if (chatContainer) {
          const chatObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
              if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                setTimeout(() => {
                  findAndTriggerEvents();
                  startPollingForNewArticles();
                }, 500);
                break;
              }
            }
          });

          chatObserver.observe(chatContainer, { childList: true, subtree: true });
        }
      }

      // Check if we've already initialized to avoid duplicate observers
      // Use a data attribute on body instead of a window property
      const isInitialized = document.body.hasAttribute('data-events-initialized');
      if (!isInitialized) {
        document.body.setAttribute('data-events-initialized', 'true');

        // Ensure DOM is ready
        if (document.readyState === "loading") {
          document.addEventListener("DOMContentLoaded", init);
        } else {
          init();
        }
      } else {
        // If already initialized, just trigger events for any new articles
        findAndTriggerEvents();
      }
    }
  }).catch(error => {
    console.error('Error executing triggerNativeArticleEvents:', error);
  });
}

// fetch the conversation history
async function fetchConversationHistory() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const currentTab = tabs[0];

    if (!currentTab?.url) {
      console.log('No active tab URL found');
      return null;
    }

    const url = new URL(currentTab.url);
    const conversationId = url.pathname.split('/').pop();

    // Determine if we're on Claude or ChatGPT
    if (url.origin === CLAUDE_ORIGIN && claudeOrgId) {
      // Claude API endpoint - no need for headers
      const response = await fetch(
        `${CLAUDE_ORIGIN}/api/organizations/${claudeOrgId}/chat_conversations/${conversationId}?tree=True&rendering_mode=messages&render_all_tools=true`,
        {
          method: 'GET',
          credentials: 'include' // This will include cookies
        }
      );

      const data = await response.json();
      if (!data) {
        throw new Error('No data received from Claude API');
      }

      // Trigger native events after fetching conversation history
      await triggerNativeArticleEvents();

      return data;
    } else if (url.origin === CHATGPT_ORIGIN) {
      // ChatGPT API endpoint - needs headers
      let headers = null;
      for (let i = 0; i < 3; i++) {
        headers = await loadRequestHeaders();
        if (headers?.some(h => h.name.toLowerCase() === 'authorization')) {
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      if (!headers?.some(h => h.name.toLowerCase() === 'authorization')) {
        console.error('No authorization header available');
        throw new Error('Authorization header not found');
      }

      const headersList = new Headers();
      headers.forEach(header => {
        headersList.append(header.name, header.value || '');
      });

      const response = await fetch(`https://chatgpt.com/backend-api/conversation/${conversationId}`, {
        method: 'GET',
        headers: headersList,
      });

      const data = await response.json();
      if (!data) {
        throw new Error('No data received from ChatGPT API');
      }

      // Trigger native events after fetching conversation history
      await triggerNativeArticleEvents();

      return data;
    } else {
      throw new Error('Unsupported chat platform');
    }
  } catch (error) {
    console.error('Error in fetchConversationHistory:', error);
    throw error;
  }
}

async function checkNodesExistence(nodeIds: string[]) {
  try {
    // return true if the node does not exist in the DOM (thus hidden)
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const currentTab = tabs[0];
    const results = await chrome.scripting.executeScript({
      target: { tabId: currentTab.id ?? 0 },
      func: (ids) => {
        return ids.map(id => document.querySelector(`[data-message-id="${id}"]`) === null);
      },
      args: [nodeIds]  // Pass nodeIds as an argument to the injected function
    });

    return results[0].result;  // Returns array of nodeIds that exist in the DOM
  } catch (error) {
    console.error('Error in checkNodesExistence:', error);
    throw error;
  }
}

async function checkNodesExistenceClaude(nodeTexts: string[] | undefined) {
  if (!nodeTexts || !Array.isArray(nodeTexts)) {
    throw new Error('Invalid nodeTexts provided');
  }

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const currentTab = tabs[0];

  if (!currentTab?.id) {
    throw new Error('No active tab found');
  }

  // Ensure nodeTexts is serializable by converting to plain strings
  const serializableTexts = nodeTexts.map(text => String(text));

  const results = await chrome.scripting.executeScript({
    target: { tabId: currentTab.id },
    func: (texts: string[]) => {
      function htmlTextEqualsIgnoringArtifacts(html: string, text: string): boolean {
        const decodeEntities = (str: string) =>
          str
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&#39;/g, "'")
            .replace(/&quot;/g, '"');

        const stripMarkdown = (str: string) =>
          str
            .replace(/[*_`~>#-]/g, '')
            .replace(/\[(.*?)\]\(.*?\)/g, '$1')
            .replace(/!\[(.*?)\]\(.*?\)/g, '$1');

        const removeArtifactBlocks = (str: string) =>
          str.replace(/<antArtifact[^>]*title="([^"]+)"[^>]*>[\s\S]*?<\/antArtifact>/gi, '$1 Document');

        const normalize = (str: string) =>
          decodeEntities(stripMarkdown(removeArtifactBlocks(str)))
            .replace(/^\d+\.\s*/gm, '')   // remove numbered bullets
            .replace(/^•\s*/gm, '')       // remove bullets
            .replace(/\s+/g, ' ')         // collapse all whitespace
            .trim();


        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        function getVisibleTextWithSpacing(node: Node, listStack: number[] = []): string {
          let result = '';


          for (const child of node.childNodes) {
            if (child.nodeType === Node.TEXT_NODE) {
              result += child.textContent || '';
            } else if (child.nodeType === Node.ELEMENT_NODE) {
              const el = child as HTMLElement;
              const tag = el.tagName.toLowerCase();

              if (tag === 'br') {
                result += '\n';
                continue;
              }

              if (tag === 'ol') {
                const startAttr = parseInt(el.getAttribute('start') || '1', 10);
                listStack.push(startAttr);
                result += '\n' + getVisibleTextWithSpacing(el, listStack) + '\n';
                listStack.pop();
                continue;
              }

              if (tag === 'ul') {
                listStack.push(-1); // sentinel for unordered
                result += '\n' + getVisibleTextWithSpacing(el, listStack) + '\n';
                listStack.pop();
                continue;
              }

              if (tag === 'li') {
                let bullet = '• ';
                if (listStack[listStack.length - 1] !== -1) {
                  bullet = `${listStack[listStack.length - 1]++}. `;
                }
                result += bullet + getVisibleTextWithSpacing(el, listStack).trim() + '\n';
                continue;
              }

              result += getVisibleTextWithSpacing(el, listStack);
              if (['p', 'div', 'section', 'article', 'li'].includes(tag)) {
                result += '\n';
              }
            }
          }

          return result;
        }

        const htmlText = getVisibleTextWithSpacing(doc.body);

        const normalizedHTML = normalize(htmlText);
        const normalizedText = normalize(text);

        return normalizedHTML === normalizedText;
      }

      return texts.map(expectedText => {
        const containers = document.querySelectorAll('.grid-cols-1');

        for (const container of containers) {
          const containerHTML = container.innerHTML;
          if (htmlTextEqualsIgnoringArtifacts(containerHTML, expectedText)) {
            return false;
          }
        }
        return true;
      });
    },
    args: [serializableTexts]
  });

  return results[0].result;
}

async function editMessage(messageId: string, message: string) {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const currentTab = tabs[0];

  await chrome.scripting.executeScript({
    target: { tabId: currentTab.id ?? 0 },
    func: (messageId, message) => {
      // Helper function to wait for DOM changes
      const waitForDomChange = (element: Element, timeout = 2000): Promise<void> => {
        return new Promise((resolve, reject) => {
          const timeoutId = setTimeout(() => {
            observer.disconnect();
            reject(new Error('Timeout waiting for DOM changes'));
          }, timeout);

          const observer = new MutationObserver((mutations) => {
            if (mutations.length > 0) {
              clearTimeout(timeoutId);
              observer.disconnect();
              // Give a small buffer for the DOM to settle
              setTimeout(resolve, 50);
            }
          });

          observer.observe(element, {
            childList: true,
            subtree: true,
            attributes: true,
            characterData: true
          });
        });
      };

      // Convert the callback hell into async/await
      const performEdit = async () => {
        const element = document.querySelector(`[data-message-id="${messageId}"]`);
        if (!element) throw new Error('Message element not found');

        const buttonDiv = element.parentElement?.parentElement;
        if (!buttonDiv) throw new Error('Button container not found');

        let button = null;
        let attempts = 0;
        const maxAttempts = 50;

        while (!button && attempts < maxAttempts) {
          const buttons = Array.from(buttonDiv.querySelectorAll("button"));
          // For user messages, buttons are [copy, edit, left, right]
          // For assistant messages, buttons are [buttons..., left, right, copy, thumbs up, thumbs down, read aloud, regenerate]
          const isAssistant = element.getAttribute('data-message-author-role') === 'assistant';
          const buttonIndex = isAssistant ? buttons.length - 7 : 1; // edit is always second button for user, or 7th from end for assistant
          button = buttons[buttonIndex];

          if (!button) {
            attempts++;
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }

        if (!button) throw new Error('Edit button not found');

        button.click();
        await waitForDomChange(buttonDiv);

        // Set textarea value
        let textArea = buttonDiv.querySelector("textarea");
        let textAreaAttempts = 0;
        const maxTextAreaAttempts = 5;

        while (!textArea && textAreaAttempts < maxTextAreaAttempts) {
          await new Promise(resolve => setTimeout(resolve, 100));
          textArea = buttonDiv.querySelector("textarea");
          textAreaAttempts++;
        }

        if (!textArea) throw new Error('Textarea not found after multiple attempts');

        textArea.value = message;
        textArea.dispatchEvent(new Event('input', { bubbles: true }));
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });

        // Find and click send button
        let currentElement: Element | null = textArea;
        let sendButton: HTMLButtonElement | null = null;
        let iterations = 0;

        while (currentElement && iterations < 10) {
          const buttons = Array.from(currentElement.querySelectorAll('button'));
          // Send button is always the second button in the textarea container
          sendButton = buttons[1] as HTMLButtonElement || null;
          if (sendButton) break;

          currentElement = currentElement.parentElement;
          iterations++;
        }

        if (!sendButton) throw new Error('Send button not found');
        sendButton.click();

        // Wait for final update after sending
        await waitForDomChange(buttonDiv, 2000);
      };

      // Execute the async function and handle errors
      return performEdit().catch(error => {
        console.error('Error in editMessage:', error);
        throw error;
      });
    },
    args: [messageId, message]
  });
}

async function respondToMessage(childrenIds: string[], message: string) {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const currentTab = tabs[0];

  await chrome.scripting.executeScript({
    target: { tabId: currentTab.id ?? 0 },
    func: (childrenIds, message: string) => {
      // Helper function to wait for DOM changes
      const waitForDomChange = (element: Element, timeout = 2000): Promise<void> => {
        return new Promise((resolve, reject) => {
          const timeoutId = setTimeout(() => {
            observer.disconnect();
            reject(new Error('Timeout waiting for DOM changes'));
          }, timeout);

          const observer = new MutationObserver((mutations) => {
            if (mutations.length > 0) {
              clearTimeout(timeoutId);
              observer.disconnect();
              setTimeout(resolve, 50);
            }
          });

          observer.observe(element, {
            childList: true,
            subtree: true,
            attributes: true,
            characterData: true
          });
        });
      };

      const performResponse = async () => {
        // Find the first visible message element
        let element = null;
        for (const messageId of childrenIds) {
          element = document.querySelector(`[data-message-id="${messageId}"]`);
          if (element) break;
        }
        if (!element) throw new Error('No visible message element found');

        const buttonDiv = element.parentElement?.parentElement;
        if (!buttonDiv) throw new Error('Button container not found');

        let button = null;
        let attempts = 0;
        const maxAttempts = 50;

        while (!button && attempts < maxAttempts) {
          const buttons = Array.from(buttonDiv.querySelectorAll("button"));
          // For user messages, buttons are [copy, edit, left, right]
          // For assistant messages, buttons are [buttons..., left, right, copy, thumbs up, thumbs down, read aloud, regenerate]
          const isAssistant = element.getAttribute('data-message-author-role') === 'assistant';
          const buttonIndex = isAssistant ? buttons.length - 7 : 1; // edit is always second button for user, or 7th from end for assistant
          button = buttons[buttonIndex];

          if (!button) {
            attempts++;
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }

        if (!button) throw new Error('Edit button not found');

        button.click();
        await waitForDomChange(buttonDiv);

        // Set textarea value
        let textArea = buttonDiv.querySelector("textarea");
        let textAreaAttempts = 0;
        const maxTextAreaAttempts = 5;

        while (!textArea && textAreaAttempts < maxTextAreaAttempts) {
          await new Promise(resolve => setTimeout(resolve, 100));
          textArea = buttonDiv.querySelector("textarea");
          textAreaAttempts++;
        }

        if (!textArea) throw new Error('Textarea not found after multiple attempts');

        textArea.value = message;
        textArea.dispatchEvent(new Event('input', { bubbles: true }));
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });

        // Find and click send button
        let currentElement: Element | null = textArea;
        let sendButton: HTMLButtonElement | null = null;
        let iterations = 0;

        while (currentElement && iterations < 10) {
          const buttons = Array.from(currentElement.querySelectorAll('button'));
          // Send button is always the second button in the textarea container
          sendButton = buttons[1] as HTMLButtonElement || null;
          if (sendButton) break;

          currentElement = currentElement.parentElement;
          iterations++;
        }

        if (!sendButton) throw new Error('Send button not found');
        sendButton.click();

        // Wait for final update after sending
        await waitForDomChange(buttonDiv, 2000);
      };

      // Execute the async function and handle errors
      return performResponse().catch(error => {
        console.error('Error in respondToMessage:', error);
        throw error;
      });
    },
    args: [childrenIds, message]
  });
}

async function selectBranchClaude(navigationTarget: ClaudeNavigationTarget) {
  try {
    if (!navigationTarget || !Array.isArray(navigationTarget.levels)) {
      throw new Error('navigationTarget must be an object with a levels array');
    }

    if (navigationTarget.levels.length === 0) {
      return;
    }

    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs || tabs.length === 0) {
      throw new Error('No active tab found');
    }
    const currentTab = tabs[0];
    if (!currentTab.id) {
      throw new Error('Current tab has no ID');
    }

    const tabId = currentTab.id;
    const debuggee = { tabId };

    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const stringifyError = (error: unknown) => (error instanceof Error ? error.message : String(error));

    const safeDetach = async (context: string) => {
      try {
        await chrome.debugger.detach(debuggee);
      } catch (error) {
        const message = stringifyError(error).toLowerCase();
        const expected =
          message.includes('not attached') || message.includes('no debugger') || message.includes('cannot detach');
        if (!expected) {
          debugClaudeNavigation('[selectBranchClaude] Unexpected detach error:', context, message);
        }
      }
    };

    const getTargetNeedles = () => {
      const needles: string[] = [];
      if (navigationTarget.targetNeedle) needles.push(navigationTarget.targetNeedle);
      if (Array.isArray(navigationTarget.targetNeedles)) needles.push(...navigationTarget.targetNeedles);
      return Array.from(new Set(needles.map((n) => n.trim()).filter(Boolean))).slice(0, 3);
    };

    const isTargetVisible = async (needles: string[]) => {
      const usableNeedles = (needles || []).map((n) => n.trim()).filter((n) => n.length >= 10);
      if (usableNeedles.length === 0) return false;

      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: (needleList: string[]) => {
          const normalize = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();
          const normalizedNeedles = needleList.map((n) => normalize(n)).filter(Boolean);
          if (normalizedNeedles.length === 0) return false;

          const wrappers = Array.from(document.querySelectorAll('div.group')).filter((el) =>
            el.querySelector('[role="group"][aria-label="Message actions"]')
          );

          const requiredMatches = normalizedNeedles.length >= 2 ? 2 : 1;

          return wrappers.some((wrapper) => {
            const wrapperText = ((wrapper as HTMLElement).innerText || wrapper.textContent || '').toString();
            const normalizedWrapperText = normalize(wrapperText);

            let matchCount = 0;
            for (const needle of normalizedNeedles) {
              if (normalizedWrapperText.includes(needle)) {
                matchCount += 1;
                if (matchCount >= requiredMatches) return true;
              }
            }

            return false;
          });
        },
        args: [usableNeedles],
      });

      return Boolean(results[0]?.result);
    };

    const getLevelStateAndClickPoint = async (
      anchorText: string | null,
      expectedSiblingCount: number,
      direction: 'Previous' | 'Next',
      siblingNeedles: string[]
    ) => {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: (
          anchorText: string | null,
          expectedSiblingCount: number,
          direction: string,
          siblingNeedles: string[]
        ) => {
          const indicatorRegex = /^\s*(\d+)\s*\/\s*(\d+)\s*$/;

          const canonicalize = (text: string) =>
            text
              .normalize('NFKC')
              .toLowerCase()
              .replace(/[\u2018\u2019]/g, "'")
              .replace(/[\u201c\u201d]/g, '"')
              .replace(/\s+/g, ' ')
              .trim();

          const makeNeedles = (text: string) => {
            const normalized = canonicalize(text);
            const midStart = Math.max(0, Math.floor(normalized.length / 2) - 40);
            return {
              head: normalized.slice(0, 80),
              mid: normalized.slice(midStart, midStart + 80),
            };
          };

          const actionGroups = Array.from(document.querySelectorAll('[role="group"][aria-label="Message actions"]'));

          const anchorNeedles = anchorText ? makeNeedles(anchorText) : null;
          const canonicalSiblingNeedles = (siblingNeedles || []).map((t) => canonicalize(t)).filter(Boolean);

          const scoreText = (text: string) => {
            const wrapperText = canonicalize(text);
            if (!wrapperText) return 0;

            let score = 0;
            if (anchorNeedles?.head && wrapperText.includes(anchorNeedles.head)) score += 5;
            if (anchorNeedles?.mid && anchorNeedles.mid.length > 20 && wrapperText.includes(anchorNeedles.mid))
              score += 3;
            for (const needle of canonicalSiblingNeedles) {
              if (needle.length < 5) continue;
              if (wrapperText.includes(needle)) score += 1;
            }
            return score;
          };

          const candidates: Array<{
            group: Element;
            wrapper: Element | null;
            score: number;
            currentIndex: number;
            total: number;
            hoverPoint: { x: number; y: number };
            clickPoint: { x: number; y: number } | null;
            indicatorText: string;
          }> = [];

          for (let i = 0; i < actionGroups.length; i++) {
            const group = actionGroups[i] as Element;
            const span = Array.from(group.querySelectorAll('span')).find((s) =>
              indicatorRegex.test((s.textContent || '').trim())
            );
            if (!span) continue;

            const match = (span.textContent || '').trim().match(indicatorRegex);
            if (!match) continue;

            const current = parseInt(match[1], 10);
            const total = parseInt(match[2], 10);
            if (!Number.isFinite(current) || !Number.isFinite(total)) continue;

            const matchesExpectedTotal = total === expectedSiblingCount;

            const prevButton = group.querySelector('button[aria-label="Previous"]') as HTMLButtonElement | null;
            const nextButton = group.querySelector('button[aria-label="Next"]') as HTMLButtonElement | null;

            const wrapper = group.closest('div.group');
            const wrapperText = wrapper
              ? ((wrapper as HTMLElement).innerText || wrapper.textContent || '')
              : (group.textContent || '');
            const score = scoreText(wrapperText) + (matchesExpectedTotal ? 2 : 0);

            const hoverTarget =
              (wrapper && wrapper.querySelector('[data-testid$="message"], [data-testid*="message"]')) ||
              wrapper ||
              group;
            const hoverRect = (hoverTarget as Element).getBoundingClientRect();
            const hoverPoint = {
              x: hoverRect.left + hoverRect.width / 2,
              y: hoverRect.top + Math.min(40, hoverRect.height / 2),
            };

            let clickPoint: { x: number; y: number } | null = null;
            const targetButton = direction === 'Previous' ? prevButton : nextButton;
            if (targetButton) {
              const buttonRect = targetButton.getBoundingClientRect();
              clickPoint = { x: buttonRect.left + buttonRect.width / 2, y: buttonRect.top + buttonRect.height / 2 };
            }

            candidates.push({
              group,
              wrapper,
              score,
              currentIndex: current - 1,
              total,
              hoverPoint,
              clickPoint,
              indicatorText: `${current} / ${total}`,
            });
          }

          if (candidates.length === 0) {
            if (anchorText || canonicalSiblingNeedles.length > 0) {
              return { error: 'No matching message wrapper found for anchor/sibling needles' };
            }
            return { error: 'No branch control found for expected sibling count' };
          }

          candidates.sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            const ay = a.wrapper ? a.wrapper.getBoundingClientRect().top : a.group.getBoundingClientRect().top;
            const by = b.wrapper ? b.wrapper.getBoundingClientRect().top : b.group.getBoundingClientRect().top;
            return by - ay;
          });

          const best = candidates[0];
          const wrapperToScroll = best.wrapper || best.group;
          wrapperToScroll.scrollIntoView({ block: 'center', inline: 'nearest' });

          if (!best.clickPoint) {
            return { error: 'Branch buttons not found under candidate wrapper', hoverPoint: best.hoverPoint, debug: { score: best.score } };
          }

          return {
            error: null,
            currentIndex: best.currentIndex,
            total: best.total,
            hoverPoint: best.hoverPoint,
            clickPoint: best.clickPoint,
            debug: { score: best.score, indicatorText: best.indicatorText },
          };
        },
        args: [anchorText, expectedSiblingCount, direction, siblingNeedles],
      });

      const result = results[0]?.result as any;
      if (!result || typeof result !== 'object') {
        return { error: 'DOM probe returned no result' };
      }
      return result;
    };

    const clickAt = async (point: { x: number; y: number }) => {
      await chrome.debugger.sendCommand(debuggee, 'Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: point.x,
        y: point.y,
      });
      await chrome.debugger.sendCommand(debuggee, 'Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: point.x,
        y: point.y,
        button: 'left',
        clickCount: 1,
      });
      await chrome.debugger.sendCommand(debuggee, 'Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: point.x,
        y: point.y,
        button: 'left',
        clickCount: 1,
      });
    };

    const hoverAt = async (point: { x: number; y: number }) => {
      await chrome.debugger.sendCommand(debuggee, 'Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: point.x,
        y: point.y,
      });
    };

    // Attach debugger to send trusted input events
    debugClaudeNavigation('[selectBranchClaude] Attaching debugger to tab', tabId);
    await safeDetach('pre-attach');

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await chrome.debugger.attach(debuggee, '1.3');
        debugClaudeNavigation('[selectBranchClaude] Debugger attached successfully');
        break;
      } catch (error: any) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes('Another debugger is already attached')) {
          throw error;
        }
        if (attempt === 2) {
          throw error;
        }
        await sleep(200);
      }
    }

    try {
      const targetLevels = navigationTarget.levels as Array<{
        siblingCount: number;
        targetIndex: number;
        anchorText: string | null;
        siblingNeedles: string[];
      }>;

      await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const input = document.querySelector('[data-testid="chat-input-grid-container"]');
          let el: Element | null = input ? input.parentElement : null;
          for (let i = 0; i < 25 && el; i++) {
            const style = window.getComputedStyle(el);
            if (['auto', 'scroll'].includes(style.overflowY) && el.scrollHeight > el.clientHeight + 100) {
              (el as HTMLElement).scrollTop = 0;
              return;
            }
            el = el.parentElement;
          }
        },
      });
      await sleep(200);

      const viewportResult = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const input = document.querySelector('[data-testid="chat-input-grid-container"]');
          let el: Element | null = input ? input.parentElement : null;
          for (let i = 0; i < 25 && el; i++) {
            const style = window.getComputedStyle(el);
            if (['auto', 'scroll'].includes(style.overflowY) && el.scrollHeight > el.clientHeight + 100) {
              return { height: (el as HTMLElement).clientHeight || window.innerHeight };
            }
            el = el.parentElement;
          }

          return { height: window.innerHeight };
        },
      });
      const viewportHeight = viewportResult[0]?.result?.height ?? 800;
      const scrollDy = Math.floor(viewportHeight * 0.8);

      const targetNeedles = getTargetNeedles();
      if (await isTargetVisible(targetNeedles)) {
        debugClaudeNavigation('[selectBranchClaude] Target already visible; skipping branch navigation');
        return;
      }

      const getAvailableBranchTotals = async () => {
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => {
            const indicatorRegex = /^\s*(\d+)\s*\/\s*(\d+)\s*$/;
            const actionGroups = Array.from(
              document.querySelectorAll('[role="group"][aria-label="Message actions"]')
            );
            const totals: number[] = [];

            for (const group of actionGroups) {
              const span = Array.from(group.querySelectorAll('span')).find((s) =>
                indicatorRegex.test((s.textContent || '').trim())
              );
              const match = span ? (span.textContent || '').trim().match(indicatorRegex) : null;
              if (!match) continue;
              const total = parseInt(match[2], 10);
              if (Number.isFinite(total)) totals.push(total);
            }

            return Array.from(new Set(totals)).sort((a, b) => a - b);
          },
        });

        return (results[0]?.result as number[]) || [];
      };

      const pendingLevels = new Set<number>(targetLevels.map((_l, index) => index));
      const maxIterations = 120;
      let scrollDirection = -1;
      let lastScrollTop: number | null = null;
      let stuckCount = 0;
      const lastErrors: Record<number, string> = {};

      for (let iteration = 0; iteration < maxIterations; iteration++) {
        if (await isTargetVisible(targetNeedles)) {
          debugClaudeNavigation('[selectBranchClaude] Target became visible; stopping');
          return;
        }

        let acted = false;

        for (let levelIndex = 0; levelIndex < targetLevels.length; levelIndex++) {
          if (!pendingLevels.has(levelIndex)) continue;

          const level = targetLevels[levelIndex];

          let located = await getLevelStateAndClickPoint(
            level.anchorText,
            level.siblingCount,
            'Next',
            level.siblingNeedles || []
          );

          if (located?.error && located?.hoverPoint) {
            // Some Claude UIs only render branch controls after hover/focus
            await hoverAt(located.hoverPoint);
            await sleep(120);
            located = await getLevelStateAndClickPoint(
              level.anchorText,
              level.siblingCount,
              'Next',
              level.siblingNeedles || []
            );
          }

          if (!located || located.error) {
            lastErrors[levelIndex] = located?.error || 'Unknown error locating branch control';
            continue;
          }

          const currentIndex = (located as { currentIndex: number }).currentIndex;

          if (currentIndex === level.targetIndex) {
            debugClaudeNavigation(
              `[selectBranchClaude] Level ${levelIndex} satisfied (${currentIndex + 1}/${level.siblingCount})`
            );
            pendingLevels.delete(levelIndex);
            continue;
          }

          const direction = currentIndex < level.targetIndex ? 'Next' : 'Previous';
          let state = await getLevelStateAndClickPoint(
            level.anchorText,
            level.siblingCount,
            direction,
            level.siblingNeedles || []
          );

          if (state?.error && state?.hoverPoint) {
            await hoverAt(state.hoverPoint);
            await sleep(120);
            state = await getLevelStateAndClickPoint(
              level.anchorText,
              level.siblingCount,
              direction,
              level.siblingNeedles || []
            );
          }

          if (!state || state.error || !state.clickPoint) {
            lastErrors[levelIndex] = state?.error || 'Unknown error acquiring click point';
            continue;
          }

          if (state.hoverPoint) {
            await hoverAt(state.hoverPoint);
            await sleep(100);
          }

          debugClaudeNavigation(
            `[selectBranchClaude] Iter ${iteration + 1}/${maxIterations} ` +
              `Level ${levelIndex} ${direction} ` +
              `(${currentIndex + 1}/${level.siblingCount} -> ${level.targetIndex + 1}/${level.siblingCount})`
          );

          await clickAt(state.clickPoint);
          await sleep(200);
          acted = true;
          break;
        }

        if (await isTargetVisible(targetNeedles)) {
          debugClaudeNavigation('[selectBranchClaude] Target became visible; stopping');
          return;
        }

        if (pendingLevels.size === 0) {
          debugClaudeNavigation('[selectBranchClaude] All levels satisfied; stopping');
          return;
        }

        if (!acted) {
          if (iteration % 10 === 0) {
            const availableTotals = await getAvailableBranchTotals();
            debugClaudeNavigation(
              `[selectBranchClaude] No actionable controls (available totals: ${JSON.stringify(availableTotals)}); scrolling`
            );
          }

          // Scan the chat scroller systematically to coax virtualization into rendering different message wrappers
          const scrollResult = await chrome.scripting.executeScript({
            target: { tabId },
            func: (dy: number) => {
              const input = document.querySelector('[data-testid="chat-input-grid-container"]');
              let el: Element | null = input ? input.parentElement : null;
              let scroller: HTMLElement | null = null;

              for (let i = 0; i < 25 && el; i++) {
                const style = window.getComputedStyle(el);
                if (['auto', 'scroll'].includes(style.overflowY) && el.scrollHeight > el.clientHeight + 100) {
                  scroller = el as HTMLElement;
                  break;
                }
                el = el.parentElement;
              }

              if (!scroller) {
                return { scrollTop: null, maxScrollTop: null };
              }

              const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
              const nextScrollTop = Math.max(0, Math.min(maxScrollTop, scroller.scrollTop + dy));
              scroller.scrollTop = nextScrollTop;
              return { scrollTop: scroller.scrollTop, maxScrollTop };
            },
            args: [scrollDy * scrollDirection],
          });

          const scrollTop = scrollResult[0]?.result?.scrollTop ?? null;
          const maxScrollTop = scrollResult[0]?.result?.maxScrollTop ?? null;

          if (scrollTop !== null) {
            if (lastScrollTop !== null && Math.abs(scrollTop - lastScrollTop) < 2) {
              stuckCount += 1;
            } else {
              stuckCount = 0;
            }
            lastScrollTop = scrollTop;

            if (maxScrollTop !== null) {
              if (scrollTop <= 1 || scrollTop >= maxScrollTop - 1) {
                scrollDirection = scrollDirection * -1;
              }
            }
          }

          if (stuckCount > 8) {
      debugClaudeNavigation('[selectBranchClaude] Scroller appears stuck; flipping direction');
            stuckCount = 0;
            scrollDirection = scrollDirection * -1;
          }

          await sleep(220);
        }
      }

      const availableTotals = await getAvailableBranchTotals();
      const missing = Array.from(pendingLevels).map((levelIndex) => ({
        levelIndex,
        siblingCount: targetLevels[levelIndex].siblingCount,
        targetIndex: targetLevels[levelIndex].targetIndex,
        lastError: lastErrors[levelIndex] || null,
      }));

    const suffix =
    missing.length === 0
      ? 'All levels satisfied but target never became visible'
      : `Pending levels: ${JSON.stringify(missing)}`;

      throw new Error(
        `Exceeded max iterations while navigating Claude branches. ` +
          `Available totals: ${JSON.stringify(availableTotals)}. ` +
      suffix
      );
    } finally {
      await safeDetach('finally');
      await sleep(50);
      await safeDetach('finally-retry');
    }
  } catch (error) {
    try {
      const message = error instanceof Error ? error.message : String(error);
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const currentTab = tabs[0];
      if (currentTab?.id) {
        await chrome.scripting.executeScript({
          target: { tabId: currentTab.id },
          func: (msg: string) => console.error('[ChatTree][selectBranchClaude]', msg),
          args: [message],
        });
      }
    } catch {
      // Ignore console emit errors
    }
    console.error('selectBranchClaude failed:', error);
    throw error;
  }
}

async function selectBranch(stepsToTake: any[]) {
  try {
    if (!Array.isArray(stepsToTake)) {
      throw new Error('stepsToTake must be an array');
    }

    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs || tabs.length === 0) {
      throw new Error('No active tab found');
    }
    const currentTab = tabs[0];
    if (!currentTab.id) {
      throw new Error('Current tab has no ID');
    }


    await chrome.scripting.executeScript({
      target: { tabId: currentTab.id },
      func: (stepsToTake) => {

        // Function to trigger native events on a specific element
        function triggerNativeEvents(element: Element) {
          if (!element) {
            console.error("triggerNativeEvents: Element is null or undefined.");
            return;
          }

          const eventTypes = [
              'mouseover', 'mouseenter', 'mousemove', 'mousedown', 'mouseup', 'click',
              'pointerover', 'pointerenter', 'pointerdown', 'pointerup', 'pointermove', 'pointercancel',
              'focus', 'focusin'
          ];

          for (const eventType of eventTypes) {
            try {
              const event = new MouseEvent(eventType, {
                bubbles: true,
                cancelable: true,
                view: window,
              });

              Object.defineProperty(event, 'target', {
                value: element,
                enumerable: true,
                configurable: true
              });

              Object.defineProperty(event, 'currentTarget', {
                value: element,
                enumerable: true,
                configurable: true
              });

              element.dispatchEvent(event);
            } catch (error) {
              console.error(`Error dispatching ${eventType} event:`, error);
            }
          }
        }
        // Optimized DOM change detection with shorter timeout
        const waitForDomChange = (): Promise<void> => {
          return new Promise((resolve) => {
            const observer = new MutationObserver((mutations) => {
              if (mutations.some(m =>
                  m.type === 'childList' && (m.addedNodes.length > 0 || m.removedNodes.length > 0) ||
                  (m.type === 'attributes' && ['style', 'class'].includes(m.attributeName || '')))) {
                observer.disconnect();
                resolve();
              }
            });

            const mainContent = document.querySelector('main') || document.body;
            observer.observe(mainContent, {
              childList: true,
              subtree: true,
              attributes: true,
              attributeFilter: ['style', 'class', 'aria-hidden']
            });
          });
        };

        // Process all steps as fast as possible
        const processSteps = async () => {
          try {
            for (const step of stepsToTake) {
              if (!step.nodeId) {
                throw new Error('Step missing nodeId');
              }

              // Find the target element
              const element = document.querySelector(`[data-message-id="${step.nodeId}"]`);
              if (!element) {
                throw new Error(`Element not found for nodeId: ${step.nodeId}`);
              }

              triggerNativeEvents(element);

              const buttonDiv = element.parentElement?.parentElement;
              if (!buttonDiv) {
                throw new Error(`Button container not found for nodeId: ${step.nodeId}`);
              }

              const findNavigationButton = (buttonDiv: Element, step: { role: string, stepsLeft: number, nodeId: string }) => {
                if (step.role === "assistant") {
                  const container = buttonDiv.querySelector('.text-token-text-secondary.flex.items-center.justify-center');
                  const buttons = Array.from(container?.querySelectorAll('button') || []);
                  return buttons[step.stepsLeft > 0 ? 0 : 1]; // 0 for left, 1 for right
                }

                // User message: buttons are [copy, edit, left, right]
                const buttons = Array.from(buttonDiv.querySelectorAll("button"));
                return buttons[step.stepsLeft > 0 ? 2 : 3]; // 2 for left, 3 for right
              };

              const processElementRecursively = (element: Element, depth = 0) => {
                if (depth > 5) return;
                triggerNativeEvents(element);
                Array.from(element.children).forEach(child => {
                  processElementRecursively(child, depth + 1);
                });
              };

              let button = null;
              let attempts = 0;
              const maxAttempts = 50;

              while (!button && attempts < maxAttempts) {
                button = findNavigationButton(buttonDiv, step);

                if (!button) {
                  processElementRecursively(element);
                  attempts++;
                }
              }

              if (!button) {
                throw new Error(`Navigation button not found for node: ${step.nodeId}`);
              }

              button.click();
              await waitForDomChange();
            }
          } catch (error) {
            console.error('Error processing steps:', error);
            throw error;
          }
        };

        return processSteps();
      },
      args: [stepsToTake]
    });

  } catch (error) {
    console.error('selectBranch failed:', error);
    throw error;
  }
}

async function goToTarget(targetId: string): Promise<boolean> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const currentTab = tabs[0];
  if (!currentTab?.id) {
    console.error('goToTarget: No active tab found');
    return false;
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId: currentTab.id },
    func: (targetId: string) => {
      const element = document.querySelector(`[data-message-id="${targetId}"]`);
      if (!element) return false;
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return true;
    },
    args: [targetId],
  });

  return Boolean(results[0]?.result);
}

async function goToTargetClaude(targetText: string): Promise<boolean> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const currentTab = tabs[0];
  if (!currentTab?.id) {
    console.error('goToTargetClaude: No active tab found');
    return false;
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId: currentTab.id },
    func: (targetText: string) => {
      function htmlTextEqualsIgnoringArtifacts(html: string, text: string): boolean {
        const decodeEntities = (str: string) =>
          str
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&#39;/g, "'")
            .replace(/&quot;/g, '"');

        const stripMarkdown = (str: string) =>
          str
            .replace(/[*_`~>#-]/g, '')
            .replace(/\[(.*?)\]\(.*?\)/g, '$1')
            .replace(/!\[(.*?)\]\(.*?\)/g, '$1');

        const removeArtifactBlocks = (str: string) =>
          str.replace(/<antArtifact[^>]*title="([^"]+)"[^>]*>[\s\S]*?<\/antArtifact>/gi, '$1 Document');

        const normalize = (str: string) =>
          decodeEntities(stripMarkdown(removeArtifactBlocks(str)))
            .replace(/^\d+\.\s*/gm, '')   // remove numbered bullets
            .replace(/^•\s*/gm, '')       // remove bullets
            .replace(/\s+/g, ' ')         // collapse all whitespace
            .trim();


        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        function getVisibleTextWithSpacing(node: Node, listStack: number[] = []): string {
          let result = '';


          for (const child of node.childNodes) {
            if (child.nodeType === Node.TEXT_NODE) {
              result += child.textContent || '';
            } else if (child.nodeType === Node.ELEMENT_NODE) {
              const el = child as HTMLElement;
              const tag = el.tagName.toLowerCase();

              if (tag === 'br') {
                result += '\n';
                continue;
              }

              if (tag === 'ol') {
                const startAttr = parseInt(el.getAttribute('start') || '1', 10);
                listStack.push(startAttr);
                result += '\n' + getVisibleTextWithSpacing(el, listStack) + '\n';
                listStack.pop();
                continue;
              }

              if (tag === 'ul') {
                listStack.push(-1); // sentinel for unordered
                result += '\n' + getVisibleTextWithSpacing(el, listStack) + '\n';
                listStack.pop();
                continue;
              }

              if (tag === 'li') {
                let bullet = '• ';
                if (listStack[listStack.length - 1] !== -1) {
                  bullet = `${listStack[listStack.length - 1]++}. `;
                }
                result += bullet + getVisibleTextWithSpacing(el, listStack).trim() + '\n';
                continue;
              }

              result += getVisibleTextWithSpacing(el, listStack);
              if (['p', 'div', 'section', 'article', 'li'].includes(tag)) {
                result += '\n';
              }
            }
          }

          return result;
        }

        const htmlText = getVisibleTextWithSpacing(doc.body);

        const normalizedHTML = normalize(htmlText);
        const normalizedText = normalize(text);


        return normalizedHTML === normalizedText;
      }

      const containers = document.querySelectorAll('.grid-cols-1');

      for (const container of containers) {
        const containerHTML = container.innerHTML;
        if (htmlTextEqualsIgnoringArtifacts(containerHTML, targetText)) {
          container.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return true;
        }
      }

      return false;
    },
    args: [targetText],
  });

  return Boolean(results[0]?.result);
}

async function respondToMessageClaude(childrenTexts: string[], message: string) {
  // Hardened version: uses tolerant matching, wrapper-scoped textarea lookup, native setter,
  // semantic button selection, and trusted click via chrome.debugger (same pattern as editMessageClaude)

  if (!Array.isArray(childrenTexts)) {
    throw new Error('childrenTexts must be an array');
  }

  if (typeof message !== 'string') {
    throw new Error('message must be a string');
  }

  // Filter out empty/whitespace-only texts
  const candidateTexts = childrenTexts.filter(text => typeof text === 'string' && text.trim().length > 0);
  if (candidateTexts.length === 0) {
    throw new Error('No valid candidate texts provided');
  }

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs || tabs.length === 0) {
    throw new Error('No active tab found');
  }
  const currentTab = tabs[0];
  if (!currentTab.id) {
    throw new Error('Current tab has no ID');
  }

  const tabId = currentTab.id;
  const debuggee = { tabId };

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const stringifyError = (error: unknown) => (error instanceof Error ? error.message : String(error));

  const safeDetach = async (context: string) => {
    try {
      await chrome.debugger.detach(debuggee);
    } catch (error) {
      const message = stringifyError(error).toLowerCase();
      const expected =
        message.includes('not attached') || message.includes('no debugger') || message.includes('cannot detach');
      if (!expected) {
        debugClaudeNavigation('[respondToMessageClaude] Unexpected detach error:', context, message);
      }
    }
  };

  const clickAt = async (point: { x: number; y: number }) => {
    await chrome.debugger.sendCommand(debuggee, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: point.x,
      y: point.y,
    });
    await chrome.debugger.sendCommand(debuggee, 'Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: point.x,
      y: point.y,
      button: 'left',
      clickCount: 1,
    });
    await chrome.debugger.sendCommand(debuggee, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: point.x,
      y: point.y,
      button: 'left',
      clickCount: 1,
    });
  };

  const hoverAt = async (point: { x: number; y: number }) => {
    await chrome.debugger.sendCommand(debuggee, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: point.x,
      y: point.y,
    });
  };

  // Phase 1: Probe to find the target message wrapper and compute click coordinates
  const respondProbe = await chrome.scripting.executeScript({
    target: { tabId },
    func: (candidateTexts: string[]) => {
      const normalizeText = (value: string): string => value.trim().replace(/\s+/g, ' ');

      const stripMarkdown = (value: string): string =>
        value
          .replace(/!\[(.*?)\]\(.*?\)/g, '$1')
          .replace(/\[(.*?)\]\(.*?\)/g, '$1')
          .replace(/[*_`~>#-]/g, '');

      const normalizeForMatch = (value: string): string =>
        normalizeText(
          stripMarkdown(value)
            .replace(/[`*_~>]/g, '')
            .replace(/\u00a0/g, ' ')
            .replace(/^\d+\.\s*/gm, '')
            .replace(/^•\s*/gm, '')
        );

      const getButtonLabel = (button: HTMLButtonElement): string => {
        const ariaLabel = button.getAttribute('aria-label') || '';
        const title = button.getAttribute('title') || '';
        const text = button.textContent || '';
        return normalizeText([ariaLabel, title, text].filter(Boolean).join(' '));
      };

      // Find message wrappers that have action buttons
      const wrappers = Array.from(document.querySelectorAll('div.group')).filter((el) =>
        el.querySelector('[role="group"][aria-label="Message actions"]')
      );

      let bestWrapper: Element | null = null;
      let bestScore = -1;
      let matchedText: string | null = null;

      // Try to match any of the candidate texts (tolerant matching)
      for (const candidateText of candidateTexts) {
        const normalizedCandidateText = normalizeForMatch(candidateText);
        if (!normalizedCandidateText) continue;

        const headNeedle = normalizedCandidateText.slice(0, 80);
        const tailNeedle = normalizedCandidateText.slice(-80);

        for (const wrapper of wrappers) {
          const wrapperText = normalizeForMatch((wrapper as HTMLElement).innerText || wrapper.textContent || '');
          if (!wrapperText) continue;

          let score = 0;
          if (wrapperText === normalizedCandidateText) score += 999;
          if (headNeedle && wrapperText.includes(headNeedle)) score += 2;
          if (tailNeedle && wrapperText.includes(tailNeedle)) score += 2;
          // Prefer user messages for respond (these are the child messages we want to edit)
          if (wrapper.querySelector('[data-testid="user-message"]')) score += 1;

          if (score > bestScore) {
            bestScore = score;
            bestWrapper = wrapper;
            matchedText = candidateText;
          }
        }
      }

      if (!bestWrapper || bestScore < 2) {
        return {
          error: 'No matching message wrapper found for respond',
          hoverPoint: null,
          clickPoint: null,
          matchedText: null
        };
      }

      bestWrapper.scrollIntoView({ block: 'center', inline: 'nearest' });

      const actionGroup = bestWrapper.querySelector('[role="group"][aria-label="Message actions"]');
      if (!actionGroup) {
        return {
          error: 'Message actions group not found under wrapper',
          hoverPoint: null,
          clickPoint: null,
          matchedText: null
        };
      }

      const buttons = Array.from(actionGroup.querySelectorAll('button')) as HTMLButtonElement[];
      const editButton = buttons.find((button) => /edit/i.test(getButtonLabel(button)));
      if (!editButton) {
        return {
          error: 'Edit button not found under message actions group',
          hoverPoint: null,
          clickPoint: null,
          matchedText: null
        };
      }

      const wrapperRect = (bestWrapper as HTMLElement).getBoundingClientRect();
      const buttonRect = editButton.getBoundingClientRect();

      const hoverPoint = {
        x: wrapperRect.left + Math.min(40, Math.max(5, wrapperRect.width / 2)),
        y: wrapperRect.top + Math.min(40, Math.max(5, wrapperRect.height / 2)),
      };

      const clickPoint = {
        x: buttonRect.left + buttonRect.width / 2,
        y: buttonRect.top + buttonRect.height / 2,
      };

      return { error: null, hoverPoint, clickPoint, matchedText };
    },
    args: [candidateTexts],
  });

  type ProbeResult = {
    error: string | null;
    hoverPoint: { x: number; y: number } | null;
    clickPoint: { x: number; y: number } | null;
    matchedText: string | null;
  };

  const probeResult = respondProbe[0]?.result as ProbeResult | undefined;

  if (!probeResult || typeof probeResult !== 'object') {
    throw new Error('respondToMessageClaude probe returned no result');
  }
  if (probeResult.error || !probeResult.hoverPoint || !probeResult.clickPoint) {
    throw new Error(probeResult.error || 'Could not locate respond click points');
  }

  // Phase 2: Trusted hover+click to open edit mode
  await safeDetach('pre-attach');
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await chrome.debugger.attach(debuggee, '1.3');
      break;
    } catch (error) {
      const errorMessage = stringifyError(error);
      if (!errorMessage.includes('Another debugger is already attached')) {
        throw error;
      }
      if (attempt === 2) {
        throw error;
      }
      await sleep(200);
    }
  }
  try {
    await hoverAt(probeResult.hoverPoint);
    await sleep(100);
    await clickAt(probeResult.clickPoint);
    await sleep(150);
  } finally {
    await safeDetach('post-click');
  }

  // Phase 3: Fill textarea and submit (scoped to wrapper, native setter, semantic button)
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (originalMessageText, newMessage) => {
      const normalizeText = (value: string): string => value.trim().replace(/\s+/g, ' ');

      const stripMarkdown = (value: string): string =>
        value
          .replace(/!\[(.*?)\]\(.*?\)/g, '$1')
          .replace(/\[(.*?)\]\(.*?\)/g, '$1')
          .replace(/[*_`~>#-]/g, '');

      const normalizeForMatch = (value: string): string =>
        normalizeText(
          stripMarkdown(value)
            .replace(/[`*_~>]/g, '')
            .replace(/\u00a0/g, ' ')
            .replace(/^\d+\.\s*/gm, '')
            .replace(/^•\s*/gm, '')
        );

      const isElementVisible = (element: Element): boolean => {
        const rect = (element as HTMLElement).getBoundingClientRect?.();
        if (!rect) return true;
        return rect.width > 0 && rect.height > 0;
      };

      const scoreCandidateTextArea = (candidate: HTMLTextAreaElement, normalizedOriginalText: string): number => {
        const normalizedValue = normalizeForMatch(candidate.value || '');
        if (!normalizedValue) return -1;
        if (normalizedValue === normalizedOriginalText) return 100;
        const headNeedle = normalizedOriginalText.slice(0, 80);
        const tailNeedle = normalizedOriginalText.slice(-80);
        let score = 0;
        if (headNeedle && normalizedValue.includes(headNeedle)) score += 2;
        if (tailNeedle && normalizedValue.includes(tailNeedle)) score += 2;
        return score;
      };

      const findEditTextArea = async (normalizedOriginalText: string): Promise<HTMLTextAreaElement | null> => {
        const selector = 'textarea.bg-bg-000.border.border-border-300';
        const attemptCandidates = (): HTMLTextAreaElement[] => {
          const all = Array.from(document.querySelectorAll(selector)) as HTMLTextAreaElement[];
          return all.filter((el) => isElementVisible(el));
        };

        let best: HTMLTextAreaElement | null = null;
        let bestScore = -1;
        const maxAttempts = 15;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          for (const candidate of attemptCandidates()) {
            const score = scoreCandidateTextArea(candidate, normalizedOriginalText);
            if (score > bestScore) {
              bestScore = score;
              best = candidate;
            }
          }

          if (best && bestScore >= 2) {
            return best;
          }

          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        return best;
      };

      const setNativeTextAreaValue = (textArea: HTMLTextAreaElement, value: string) => {
        const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
        if (descriptor?.set) {
          descriptor.set.call(textArea, value);
        } else {
          textArea.value = value;
        }
        textArea.dispatchEvent(new Event('input', { bubbles: true }));
        textArea.dispatchEvent(new Event('change', { bubbles: true }));
      };

      const findSubmitButton = (scope: Element): HTMLButtonElement | null => {
        const byType = scope.querySelector('button[type="submit"]:not([disabled])') as HTMLButtonElement | null;
        if (byType) return byType;

        const buttons = Array.from(scope.querySelectorAll('button')) as HTMLButtonElement[];
        const semantic = buttons.find((button) => {
          if (button.hasAttribute('disabled')) return false;
          const label = normalizeText(
            [button.getAttribute('aria-label') || '', button.getAttribute('title') || '', button.textContent || '']
              .filter(Boolean)
              .join(' ')
          );
          if (!label) return false;
          if (/cancel|close/i.test(label)) return false;
          return /save|send|resend|update/i.test(label);
        });
        return semantic || null;
      };

      const waitForEnabledSubmitButton = async (scope: Element): Promise<HTMLButtonElement | null> => {
        const maxAttempts = 20;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          const button = findSubmitButton(scope);
          if (button && !button.hasAttribute('disabled')) {
            return button;
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return null;
      };

      const performRespond = async () => {
        const normalizedOriginalText = normalizeForMatch(originalMessageText);
        const textArea = await findEditTextArea(normalizedOriginalText);

        if (!textArea) {
          console.error('Textarea not found after multiple attempts');
          throw new Error('Textarea not found after multiple attempts');
        }

        setNativeTextAreaValue(textArea, newMessage);

        const form = textArea.closest('form');
        const submitScope = form || textArea.parentElement || document.body;
        const sendButton = await waitForEnabledSubmitButton(submitScope);
        if (!sendButton) {
          console.error('Send button not found');
          throw new Error('Send button not found');
        }

        sendButton.click();
      };

      return performRespond().catch(error => {
        console.error('Error in respondToMessageClaude fill+submit:', error);
        throw error;
      });
    },
    args: [probeResult.matchedText || candidateTexts[0], message]
  });
}

async function editMessageClaude(messageText: string, newMessage: string) {
  try {

    if (typeof messageText !== 'string') {
      throw new Error('messageText must be a string');
    }

    if (typeof newMessage !== 'string') {
      throw new Error('newMessage must be a string');
    }

    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs || tabs.length === 0) {
      throw new Error('No active tab found');
    }
    const currentTab = tabs[0];
    if (!currentTab.id) {
      throw new Error('Current tab has no ID');
    }

    const tabId = currentTab.id;
    const debuggee = { tabId };

    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const stringifyError = (error: unknown) => (error instanceof Error ? error.message : String(error));

    const safeDetach = async (context: string) => {
      try {
        await chrome.debugger.detach(debuggee);
      } catch (error) {
        const message = stringifyError(error).toLowerCase();
        const expected =
          message.includes('not attached') || message.includes('no debugger') || message.includes('cannot detach');
        if (!expected) {
          debugClaudeNavigation('[editMessageClaude] Unexpected detach error:', context, message);
        }
      }
    };

    const clickAt = async (point: { x: number; y: number }) => {
      await chrome.debugger.sendCommand(debuggee, 'Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: point.x,
        y: point.y,
      });
      await chrome.debugger.sendCommand(debuggee, 'Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: point.x,
        y: point.y,
        button: 'left',
        clickCount: 1,
      });
      await chrome.debugger.sendCommand(debuggee, 'Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: point.x,
        y: point.y,
        button: 'left',
        clickCount: 1,
      });
    };

    const hoverAt = async (point: { x: number; y: number }) => {
      await chrome.debugger.sendCommand(debuggee, 'Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: point.x,
        y: point.y,
      });
    };

    const editClickProbe = await chrome.scripting.executeScript({
      target: { tabId },
      func: (messageText: string) => {
        const normalizeText = (value: string): string => value.trim().replace(/\s+/g, ' ');

        const stripMarkdown = (value: string): string =>
          value
            .replace(/!\[(.*?)\]\(.*?\)/g, '$1')
            .replace(/\[(.*?)\]\(.*?\)/g, '$1')
            .replace(/[*_`~>#-]/g, '');

        const normalizeForMatch = (value: string): string =>
          normalizeText(
            stripMarkdown(value)
              .replace(/[`*_~>]/g, '')
              .replace(/\u00a0/g, ' ')
              .replace(/^\d+\.\s*/gm, '')
              .replace(/^•\s*/gm, '')
          );

        const getButtonLabel = (button: HTMLButtonElement): string => {
          const ariaLabel = button.getAttribute('aria-label') || '';
          const title = button.getAttribute('title') || '';
          const text = button.textContent || '';
          return normalizeText([ariaLabel, title, text].filter(Boolean).join(' '));
        };

        const normalizedTargetText = normalizeForMatch(messageText);
        if (!normalizedTargetText) {
          return { error: 'No target text provided', hoverPoint: null, clickPoint: null };
        }

        const wrappers = Array.from(document.querySelectorAll('div.group')).filter((el) =>
          el.querySelector('[role="group"][aria-label="Message actions"]')
        );

        const headNeedle = normalizedTargetText.slice(0, 80);
        const tailNeedle = normalizedTargetText.slice(-80);

        let bestWrapper: Element | null = null;
        let bestScore = -1;

        for (const wrapper of wrappers) {
          const wrapperText = normalizeForMatch((wrapper as HTMLElement).innerText || wrapper.textContent || '');
          if (!wrapperText) continue;

          let score = 0;
          if (wrapperText === normalizedTargetText) score += 999;
          if (headNeedle && wrapperText.includes(headNeedle)) score += 2;
          if (tailNeedle && wrapperText.includes(tailNeedle)) score += 2;
          if (wrapper.querySelector('[data-testid="user-message"]')) score += 1;

          if (score > bestScore) {
            bestScore = score;
            bestWrapper = wrapper;
          }
        }

        if (!bestWrapper || bestScore < 2) {
          return { error: 'No matching message wrapper found for edit click', hoverPoint: null, clickPoint: null };
        }

        bestWrapper.scrollIntoView({ block: 'center', inline: 'nearest' });

        const actionGroup = bestWrapper.querySelector('[role="group"][aria-label="Message actions"]');
        if (!actionGroup) {
          return { error: 'Message actions group not found under wrapper', hoverPoint: null, clickPoint: null };
        }

        const buttons = Array.from(actionGroup.querySelectorAll('button')) as HTMLButtonElement[];
        const editButton = buttons.find((button) => /edit/i.test(getButtonLabel(button)));
        if (!editButton) {
          return { error: 'Edit button not found under message actions group', hoverPoint: null, clickPoint: null };
        }

        const wrapperRect = (bestWrapper as HTMLElement).getBoundingClientRect();
        const buttonRect = editButton.getBoundingClientRect();

        const hoverPoint = {
          x: wrapperRect.left + Math.min(40, Math.max(5, wrapperRect.width / 2)),
          y: wrapperRect.top + Math.min(40, Math.max(5, wrapperRect.height / 2)),
        };

        const clickPoint = {
          x: buttonRect.left + buttonRect.width / 2,
          y: buttonRect.top + buttonRect.height / 2,
        };

        return { error: null, hoverPoint, clickPoint };
      },
      args: [messageText],
    });

    const probeResult = editClickProbe[0]?.result as
      | { error: string | null; hoverPoint: { x: number; y: number } | null; clickPoint: { x: number; y: number } | null }
      | undefined;

    if (!probeResult || typeof probeResult !== 'object') {
      throw new Error('editMessageClaude probe returned no result');
    }
    if (probeResult.error || !probeResult.hoverPoint || !probeResult.clickPoint) {
      throw new Error(probeResult.error || 'Could not locate edit click points');
    }

    await safeDetach('pre-attach');
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await chrome.debugger.attach(debuggee, '1.3');
        break;
      } catch (error) {
        const message = stringifyError(error);
        if (!message.includes('Another debugger is already attached')) {
          throw error;
        }
        if (attempt === 2) {
          throw error;
        }
        await sleep(200);
      }
    }
    try {
      await hoverAt(probeResult.hoverPoint);
      await sleep(100);
      await clickAt(probeResult.clickPoint);
      await sleep(150);
    } finally {
      await safeDetach('post-click');
    }

    await chrome.scripting.executeScript({
      target: { tabId },
      func: (messageText, newMessage) => {
        const normalizeText = (value: string): string => value.trim().replace(/\s+/g, ' ');

        const stripMarkdown = (value: string): string =>
          value
            .replace(/!\[(.*?)\]\(.*?\)/g, '$1')
            .replace(/\[(.*?)\]\(.*?\)/g, '$1')
            .replace(/[*_`~>#-]/g, '');

        const normalizeForMatch = (value: string): string =>
          normalizeText(
            stripMarkdown(value)
              .replace(/[`*_~>]/g, '')
              .replace(/\u00a0/g, ' ')
              .replace(/^\d+\.\s*/gm, '')
              .replace(/^•\s*/gm, '')
          );

        const isElementVisible = (element: Element): boolean => {
          const rect = (element as HTMLElement).getBoundingClientRect?.();
          if (!rect) return true;
          return rect.width > 0 && rect.height > 0;
        };

        const scoreCandidateTextArea = (candidate: HTMLTextAreaElement, normalizedOriginalText: string): number => {
          const normalizedValue = normalizeForMatch(candidate.value || '');
          if (!normalizedValue) return -1;
          if (normalizedValue === normalizedOriginalText) return 100;
          const headNeedle = normalizedOriginalText.slice(0, 80);
          const tailNeedle = normalizedOriginalText.slice(-80);
          let score = 0;
          if (headNeedle && normalizedValue.includes(headNeedle)) score += 2;
          if (tailNeedle && normalizedValue.includes(tailNeedle)) score += 2;
          return score;
        };

        const findEditTextArea = async (
          wrapper: Element,
          normalizedOriginalText: string
        ): Promise<HTMLTextAreaElement | null> => {
          const selector = 'textarea.bg-bg-000.border.border-border-300';
          const attemptCandidates = (): HTMLTextAreaElement[] => {
            const local = Array.from(wrapper.querySelectorAll(selector)) as HTMLTextAreaElement[];
            const global = Array.from(document.querySelectorAll(selector)) as HTMLTextAreaElement[];
            const all = [...local, ...global];
            return all.filter((el) => isElementVisible(el));
          };

          let best: HTMLTextAreaElement | null = null;
          let bestScore = -1;
          const maxAttempts = 15;

          for (let attempt = 0; attempt < maxAttempts; attempt++) {
            for (const candidate of attemptCandidates()) {
              const score = scoreCandidateTextArea(candidate, normalizedOriginalText);
              if (score > bestScore) {
                bestScore = score;
                best = candidate;
              }
            }

            if (best && bestScore >= 2) {
              return best;
            }

            await new Promise((resolve) => setTimeout(resolve, 100));
          }

          return best;
        };

        const setNativeTextAreaValue = (textArea: HTMLTextAreaElement, value: string) => {
          const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
          if (descriptor?.set) {
            descriptor.set.call(textArea, value);
          } else {
            textArea.value = value;
          }
          textArea.dispatchEvent(new Event('input', { bubbles: true }));
          textArea.dispatchEvent(new Event('change', { bubbles: true }));
        };

        const findSubmitButton = (scope: Element): HTMLButtonElement | null => {
          const byType = scope.querySelector('button[type="submit"]:not([disabled])') as HTMLButtonElement | null;
          if (byType) return byType;

          const buttons = Array.from(scope.querySelectorAll('button')) as HTMLButtonElement[];
          const semantic = buttons.find((button) => {
            if (button.hasAttribute('disabled')) return false;
            const label = normalizeText(
              [button.getAttribute('aria-label') || '', button.getAttribute('title') || '', button.textContent || '']
                .filter(Boolean)
                .join(' ')
            );
            if (!label) return false;
            if (/cancel|close/i.test(label)) return false;
            return /save|send|resend|update/i.test(label);
          });
          return semantic || null;
        };

        const waitForEnabledSubmitButton = async (scope: Element): Promise<HTMLButtonElement | null> => {
          const maxAttempts = 20;
          for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const button = findSubmitButton(scope);
            if (button && !button.hasAttribute('disabled')) {
              return button;
            }
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          return null;
        };

        const performEdit = async () => {
          const normalizedTargetText = normalizeForMatch(messageText);
          const textArea = await findEditTextArea(document.body, normalizedTargetText);

          if (!textArea) {
            console.error('Textarea not found after multiple attempts');
            throw new Error('Textarea not found after multiple attempts');
          }

          setNativeTextAreaValue(textArea, newMessage);

          const form = textArea.closest('form');
          const submitScope = form || textArea.parentElement || document.body;
          const sendButton = await waitForEnabledSubmitButton(submitScope);
          if (!sendButton) {
            console.error('Send button not found');
            throw new Error('Send button not found');
          }

          sendButton.click();
        };

        return performEdit().catch(error => {
          console.error('Error in editMessageClaude:', error);
          throw error;
        });
      },
      args: [messageText, newMessage]
    });
  } catch (error) {
    console.error('editMessageClaude failed:', error);
    throw error;
  }
}

captureHeaders();
captureClaudeOrgId();

chrome.tabs.onUpdated.addListener(async (tabId, _info, tab) => {
  try {
    if (!tab.url) {
      console.log('No URL found for tab:', tabId);
      return;
    }
    const url = new URL(tab.url);
    if (url.origin === CHATGPT_ORIGIN || url.origin === CLAUDE_ORIGIN) {
      await chrome.sidePanel.setOptions({
        tabId,
        path: 'index.html',
        enabled: true
      });

      // Trigger native events when a ChatGPT or Claude page is loaded or updated
      // Wait a bit for the page to fully load
      setTimeout(() => {
        triggerNativeArticleEvents();
      }, 1500);
    } else {
      await chrome.sidePanel.setOptions({
        tabId,
        enabled: false
      });
    }
  } catch (error) {
    console.error('Error in onUpdated listener:', error);
  }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tab = await chrome.tabs.get(activeInfo.tabId);
  if (!tab.url) return;
  const url = new URL(tab.url);

  if (url.origin === CHATGPT_ORIGIN || url.origin === CLAUDE_ORIGIN) {
    await chrome.sidePanel.setOptions({
      tabId: activeInfo.tabId,
      path: 'index.html',
      enabled: true
    });

    // Trigger native events when switching to a ChatGPT tab
    // Wait a bit for the page to be fully active
    setTimeout(() => {
      triggerNativeArticleEvents();
    }, 500);
  } else {
    await chrome.sidePanel.setOptions({
      tabId: activeInfo.tabId,
      enabled: false
    });
  }
});

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));
