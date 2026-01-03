import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ClaudeContentBlock,
  ClaudeNavigationTarget,
  ClaudeNode,
  ConversationProvider,
  NavigationRequest,
  OpenAINavigationStep,
  OpenAINode,
} from '../types/interfaces';

interface SearchBarProps {
  nodes: OpenAINode[] | ClaudeNode[];
  onNodeClick: (messageId: string) => Promise<NavigationRequest> | NavigationRequest;
  onClose: () => void;
  onRefresh: () => void;
  provider: ConversationProvider;
}

interface SearchResult {
  nodeId: string;
  node: OpenAINode | ClaudeNode;
  matches: number;
  preview: string;
}

const countOccurrences = (textLower: string, queryLower: string): number => {
  if (!queryLower) return 0;

  let count = 0;
  let index = textLower.indexOf(queryLower);
  while (index !== -1) {
    count += 1;
    index = textLower.indexOf(queryLower, index + queryLower.length);
  }
  return count;
};

export const SearchBar = ({ nodes, onNodeClick, onClose, onRefresh, provider }: SearchBarProps) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const runNavigation = useCallback(async (result: SearchResult) => {
    const navigation = await onNodeClick(result.nodeId);
    if (!navigation) {
      onClose();
      return;
    }

    await chrome.runtime.sendMessage(
      provider === 'openai'
        ? {
            action: 'executeSteps',
            steps: navigation as OpenAINavigationStep[],
            requireCompletion: true,
          }
        : {
            action: 'executeStepsClaude',
            navigationTarget: navigation as ClaudeNavigationTarget,
            requireCompletion: true,
          }
    );

    const goToResponse = await chrome.runtime.sendMessage({
      action: provider === 'openai' ? 'goToTarget' : 'goToTargetClaude',
      targetId: provider === 'openai' ? result.nodeId : (result.node as ClaudeNode).data.text,
    });

    if (!goToResponse?.completed) {
      console.warn('[SearchBar] goToTarget did not complete successfully:', goToResponse);
    }

    onRefresh();
    onClose();
  }, [onClose, onNodeClick, onRefresh, provider]);

  useEffect(() => {
    inputRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }

      if (e.key === 'ArrowDown') {
        if (results.length === 0) return;
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % results.length);
        return;
      }

      if (e.key === 'ArrowUp') {
        if (results.length === 0) return;
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + results.length) % results.length);
        return;
      }

      if (e.key === 'Enter') {
        if (results.length === 0) return;
        e.preventDefault();

        const index = Math.max(0, Math.min(selectedIndex, results.length - 1));
        const selectedResult = results[index];
        if (!selectedResult) return;

        void runNavigation(selectedResult).catch((error) => {
          console.error('[SearchBar] Navigation failed:', error);
        });
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [results, selectedIndex, onClose, runNavigation]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    const searchResults: SearchResult[] = [];
    const searchQuery = query.toLowerCase();

    nodes.forEach((node) => {
      let content = '';

      if (provider === 'openai') {
        content = node.data?.label || '';
      } else {
        const claudeNode = node as ClaudeNode;
        content = (claudeNode.message?.content || [])
          .filter((block: ClaudeContentBlock) => block.type === 'text')
          .map((block: ClaudeContentBlock) => block.text)
          .join(' ');
      }

      if (!content) return;

      const contentLower = content.toLowerCase();
      const matches = countOccurrences(contentLower, searchQuery);
      if (matches === 0) return;

      const preview = content.slice(0, 100) + (content.length > 100 ? '...' : '');

      searchResults.push({
        nodeId: node.id,
        node,
        matches,
        preview,
      });
    });

    searchResults.sort((a, b) => {
      if (b.matches !== a.matches) {
        return b.matches - a.matches;
      }
      return (b.node.data?.timestamp || 0) - (a.node.data?.timestamp || 0);
    });

    setResults(searchResults);
    setSelectedIndex(0);
  }, [query, nodes, provider]);

  const handleResultClick = (result: SearchResult) => {
    void runNavigation(result).catch((error) => {
      console.error('[SearchBar] Navigation failed:', error);
    });
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-start justify-center pt-20 z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl mx-4">
        <div className="p-4">
          <div className="flex items-center space-x-2">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search messages... (⌘+K)"
              className="w-full px-4 py-2 text-lg border-none bg-transparent text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-400 focus:outline-none focus:ring-0"
            />
            <kbd className="px-2 py-1 text-xs font-semibold text-gray-800 dark:text-gray-200 bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg">
              esc
            </kbd>
          </div>
        </div>

        {results.length > 0 ? (
          <>
            <div className="border-t border-gray-200 dark:border-gray-700" />
            <div className="max-h-96 overflow-y-auto">
              {results.map((result, index) => (
                <button
                  key={result.nodeId}
                  onClick={() => handleResultClick(result)}
                  className={`w-full px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none ${
                    index === selectedIndex ? 'bg-gray-50 dark:bg-gray-700' : ''
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        {result.node.data?.role === (provider === 'openai' ? 'user' : 'human') ? 'You' : 'Assistant'}
                      </span>
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        {new Date((result.node.data?.timestamp || 0) * 1000).toLocaleString()}
                      </span>
                    </div>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {result.matches} match{result.matches !== 1 ? 'es' : ''}
                    </span>
                  </div>
                  <div className="mt-1 text-sm text-gray-700 dark:text-gray-200 line-clamp-2">
                    {result.preview}
                  </div>
                </button>
              ))}
            </div>
          </>
        ) : query ? (
          <div className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">No results found</div>
        ) : null}
      </div>
    </div>
  );
}; 
