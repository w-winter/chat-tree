export const LoadingSpinner = () => (
  <div className="flex items-center justify-center h-screen bg-gray-50 dark:bg-gray-900">
    <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-blue-500"></div>
  </div>
);

export const ErrorState = () => (
  <div className="flex items-center justify-center h-screen text-gray-600 dark:text-gray-300">
    No chat found, please refresh the web page and try again!
  </div>
); 