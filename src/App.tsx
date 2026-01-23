import { useEffect, useRef } from 'react';

import Tree from "./components/ConversationTree";

function App() {
  const tabIdRef = useRef<number | null>(null);

  useEffect(() => {
    let isCancelled = false;

    const handleRuntimeMessage = (message: any) => {
      if (message?.action !== 'closeSidePanel') {
        return;
      }

      const tabId = tabIdRef.current;
      if (!tabId || message.tabId !== tabId) {
        return;
      }

      // Closing the window closes the side panel UI without disabling it
      window.close();
    };

    chrome.runtime.onMessage.addListener(handleRuntimeMessage);

    const notifyOpen = async () => {
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tabId = tabs[0]?.id;
        if (!tabId || isCancelled) {
          return;
        }

        tabIdRef.current = tabId;
        await chrome.runtime.sendMessage({ action: 'sidePanelOpened', tabId });
      } catch (error) {
        console.warn('[ChatTree] Failed to notify side panel open:', error);
      }
    };

    const notifyClosed = () => {
      const tabId = tabIdRef.current;
      if (!tabId) {
        return;
      }

      try {
        chrome.runtime.sendMessage({ action: 'sidePanelClosed', tabId });
      } catch (error) {
        console.warn('[ChatTree] Failed to notify side panel close:', error);
      }
    };

    void notifyOpen();

    window.addEventListener('beforeunload', notifyClosed);

    return () => {
      isCancelled = true;

      chrome.runtime.onMessage.removeListener(handleRuntimeMessage);

      window.removeEventListener('beforeunload', notifyClosed);
      notifyClosed();
    };
  }, []);

  return (
    <div className="w-full h-screen flex flex-col bg-gray-50 text-gray-900 dark:bg-gray-900 dark:text-gray-100 transition-colors">
      <div className="flex-1 overflow-hidden">
        <Tree />
      </div>
    </div>
  );
}

export default App;
