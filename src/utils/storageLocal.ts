export async function storageLocalGet<T>(key: string): Promise<T | undefined> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return undefined;
  }

  return await new Promise((resolve) => {
    chrome.storage.local.get([key], (result) => {
      if (chrome.runtime?.lastError) {
        console.error('storageLocalGet error:', chrome.runtime.lastError);
        resolve(undefined);
        return;
      }

      resolve(result[key] as T | undefined);
    });
  });
}

export async function storageLocalSet<T>(key: string, value: T): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return;
  }

  await new Promise<void>((resolve) => {
    chrome.storage.local.set({ [key]: value }, () => {
      if (chrome.runtime?.lastError) {
        console.error('storageLocalSet error:', chrome.runtime.lastError);
      }
      resolve();
    });
  });
}
