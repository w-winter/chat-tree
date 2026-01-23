import { useCallback } from 'react';

type ShortcutModalProps = {
  currentShortcut: string | null;
  onClose: () => void;
};

export const ShortcutModal = ({ currentShortcut, onClose }: ShortcutModalProps) => {
  const openChromeShortcuts = useCallback(() => {
    try {
      chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    } catch (error) {
      console.warn('[ChatTree] Failed to open chrome://extensions/shortcuts:', error);
    }
  }, []);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Keyboard Shortcut</h3>

        <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
          Chrome manages extension keyboard shortcuts. To set or change the ChatTree toggle shortcut,
          open Chrome’s shortcut settings.
        </p>

        <div className="mb-5">
          <div className="text-sm text-gray-700 dark:text-gray-200">Current shortcut</div>
          <div className="mt-1 text-sm font-medium text-gray-900 dark:text-gray-100">
            {currentShortcut || 'Not set'}
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100"
          >
            Close
          </button>
          <button
            onClick={openChromeShortcuts}
            className="px-4 py-2 text-sm text-white rounded-lg bg-blue-500 hover:bg-blue-600 transition-colors"
          >
            Configure…
          </button>
        </div>
      </div>
    </div>
  );
};
