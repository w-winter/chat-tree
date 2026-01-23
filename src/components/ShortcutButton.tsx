import { useState } from 'react';

import { useTogglePanelCommandShortcut } from '../hooks/useTogglePanelCommandShortcut';
import { ShortcutModal } from './ShortcutModal';

export const ShortcutButton = () => {
  const { shortcut } = useTogglePanelCommandShortcut();
  const [isModalOpen, setIsModalOpen] = useState(false);

  const shortcutLabel = shortcut ? ` (${shortcut})` : '';

  return (
    <>
      <button
        onClick={() => setIsModalOpen(true)}
        className="p-2.5 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors group"
        title={`Keyboard shortcut${shortcutLabel}`}
        aria-label="Keyboard shortcut"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-5 w-5 text-gray-600 group-hover:text-gray-800 dark:text-gray-300 dark:group-hover:text-gray-100"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="2" y="6" width="20" height="12" rx="2" ry="2" />
          <path d="M6 10h.01" />
          <path d="M10 10h.01" />
          <path d="M14 10h.01" />
          <path d="M18 10h.01" />
          <path d="M6 14h12" />
        </svg>
      </button>

      {isModalOpen && (
        <ShortcutModal
          currentShortcut={shortcut}
          onClose={() => setIsModalOpen(false)}
        />
      )}
    </>
  );
};
