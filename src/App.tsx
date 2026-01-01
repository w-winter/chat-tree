import Tree from "./components/ConversationTree";

function App() {
  return (
    <div className="w-full h-screen flex flex-col bg-gray-50 text-gray-900 dark:bg-gray-900 dark:text-gray-100 transition-colors">
      <div className="flex-1 overflow-hidden">
        <Tree />
      </div>
    </div>
  );
}

export default App;
