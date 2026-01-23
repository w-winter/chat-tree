import { useEffect, useState } from 'react';

export function useTogglePanelCommandShortcut() {
  const [shortcut, setShortcut] = useState<string | null>(null);

  useEffect(() => {
    let isCancelled = false;

    const load = async () => {
      try {
        const commands = await chrome.commands.getAll();
        const toggle = commands.find((command) => command.name === 'toggle-panel');

        if (!isCancelled) {
          setShortcut(toggle?.shortcut || null);
        }
      } catch (error) {
        // Some environments may not expose commands (e.g. tests)
        if (!isCancelled) {
          setShortcut(null);
        }
      }
    };

    void load();

    return () => {
      isCancelled = true;
    };
  }, []);

  return { shortcut };
}
