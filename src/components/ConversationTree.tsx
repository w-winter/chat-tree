import { useCallback, useEffect, useState } from 'react';
import { ReactFlow, addEdge, Connection, MiniMap, Controls, Background, BackgroundVariant, NodeTypes } from '@xyflow/react';
import { ContextMenu } from './ContextMenu';
import { LoadingSpinner, ErrorState } from "./LoadingStates";
import { useConversationTree } from '../hooks/useConversationTree';
import { useThemePreference } from '../hooks/useThemePreference';
import { createContextMenuHandler, checkNodes, checkNodesClaude, createClaudeContextMenuHandler } from '../utils/conversationTreeHandlers';
import { createNodesInOrder } from '../utils/nodeCreation';
import { createClaudeNodesInOrder} from '../utils/claudeNodeCreation';
import { calculateSteps } from '../utils/nodeNavigation';
import { ExportButton } from './ExportButton';
import { ExportButtonClaude } from './ExportButtonClaude';
import { CopyButton } from './CopyButton';
import { ShortcutButton } from './ShortcutButton';
import { CustomNode } from "./CustomNode";
import { SearchBar } from './SearchBar';
import { OpenAIConversationData, ClaudeConversation, ClaudeNode, OpenAINode } from '../types/interfaces';
import { computeNavigationTargetClaude } from '../utils/nodeNavigationClaude';
import '@xyflow/react/dist/style.css';

const nodeTypes: NodeTypes = {
  custom: CustomNode,
};

const ConversationTree = () => {
  const {
    nodes,
    setNodes,
    edges,
    setEdges,
    conversationData,
    setConversationData,
    provider,
    setProvider,
    isLoading,
    setIsLoading,
    menu,
    setMenu,
    ref,
    reactFlowInstance,
    onNodesChange,
    onEdgesChange
  } = useConversationTree();

  type FlowEdge = {
    id: string;
    source: string;
    target: string;
    type?: string;
    animated?: boolean;
    style?: any;
  };

  const typedEdges = edges as FlowEdge[];

  const [showSearch, setShowSearch] = useState(false);
  const [lastActiveChildMap, setLastActiveChildMap] = useState<Record<string, string>>({});
  const [previousPathNodeIds, setPreviousPathNodeIds] = useState<Set<string>>(new Set());

  const { preference, resolvedTheme, isDark, cyclePreference } = useThemePreference();

  useEffect(() => {
    const desiredStroke = isDark ? '#f9fafb' : '#000000';
    const currentEdges = edges as any[];
    const needsUpdate = currentEdges.some((edge) => (edge.style?.stroke ?? '#000000') !== desiredStroke);

    if (!needsUpdate) {
      return;
    }

    setEdges(
      currentEdges.map((edge) => ({
        ...edge,
        style: {
          ...(edge.style || {}),
          stroke: desiredStroke,
        },
      })) as any
    );
  }, [isDark, edges, setEdges]);

  // Create nodes and edges when conversation data changes
  useEffect(() => {
    if (conversationData) {
      chrome.runtime.sendMessage({ action: "log", message: "Starting tree initialization with provider: " + provider });
      const createNodes = provider === 'openai' 
        ? (data: OpenAIConversationData) => {
            return createNodesInOrder(data, checkNodes);
          }
        : (data: ClaudeConversation) => {
            return createClaudeNodesInOrder(data, checkNodesClaude);
          };
      
      createNodes(conversationData as any)
        .then(({ nodes: newNodes, edges: newEdges }) => {
          chrome.runtime.sendMessage({ action: "log", message: `Created ${newNodes.length} nodes and ${newEdges.length} edges` });
          setNodes(newNodes as any);
          setEdges(newEdges as any);
          setIsLoading(false);
        })
        .catch(error => {
          chrome.runtime.sendMessage({ action: "log", message: "Error creating nodes: " + error.message });
          setIsLoading(false);
          console.error("Error creating nodes:", error);
        });
    }
  }, [conversationData, provider]);

  // Add another useEffect to handle initial data fetch
  useEffect(() => {
   
    handleRefresh();
  }, []);

  // Fetch conversation history from Chrome extension
  const handleRefresh = useCallback(async () => {
    setIsLoading(true);
    try {
      chrome.runtime.sendMessage({ action: "log", message: "Fetching conversation history" });
      const response = await chrome.runtime.sendMessage({ action: "fetchConversationHistory" });
      if (response.success) {
        chrome.runtime.sendMessage({ action: "log", message: "Successfully fetched conversation data" });
        // Determine the provider based on the response data structure
        const isClaude = 'chat_messages' in response.data;
        chrome.runtime.sendMessage({ action: "log", message: `Detected provider: ${isClaude ? 'claude' : 'openai'}` });
        setProvider(isClaude ? 'claude' : 'openai');
        setConversationData(response.data);
        
        // Fit view after nodes are rendered
        setTimeout(() => {
          if (reactFlowInstance.current) {
            chrome.runtime.sendMessage({ action: "log", message: "Fitting view to nodes" });
            reactFlowInstance.current.fitView();
          }
        }, 100);
      } else {
        chrome.runtime.sendMessage({ action: "log", message: "Failed to fetch conversation data: " + response.error });
        console.error('Failed to fetch conversation data:', response.error);
      }
    } catch (error) {
      chrome.runtime.sendMessage({ action: "log", message: "Error in handleRefresh: " + error });
      console.error('Error in handleRefresh:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Update nodes visibility by checking if they still exist in the DOM
  const updateNodesVisibility = useCallback(async () => {
    if (provider === 'openai') {
      const nodeIds = nodes.map((node: any) => node.id);
      
      const existingNodes = await checkNodes(nodeIds);
      
      setNodes((prevNodes: any) => 
        prevNodes.map((node: any, index: number) => ({
          ...node,
          data: {
            ...node.data,
            hidden: existingNodes[index]
          }
        }))
      );
    } else {
      // Claude case
      const nodeTexts = nodes.map((node: any) => node.data.text);
      const existingNodes = await checkNodesClaude(nodeTexts);
      
      // Create a map of node IDs to their parents for efficient lookup
      const parentMap: Record<string, string> = {};
      edges.forEach((edge: any) => {
        parentMap[edge.target] = edge.source;
      });

      // Create a map of node IDs to their visibility status
      const visibilityMap: Record<string, boolean> = {};
      nodes.forEach((node: any, index: number) => {
        visibilityMap[node.id] = !existingNodes[index];
      });

      setNodes((prevNodes: any) => 
        prevNodes.map((node: any, index: number) => {
          const isHidden = existingNodes[index];
          const wasOnPreviousPath = previousPathNodeIds.has(node.id);
          
          let isPreviouslyVisited = false;
          if (wasOnPreviousPath && isHidden) {
            // Check if parent is hidden - if parent is visible, we're on a new branch
            const parentId = parentMap[node.id];
            if (!parentId || visibilityMap[parentId]) {
              // No parent (root) or parent is visible - we're on a new branch
              isPreviouslyVisited = false;
            } else {
              // Parent is hidden - maintain previously visited state
              isPreviouslyVisited = true;
            }
          }

          return {
            ...node,
            data: {
              ...node.data,
              hidden: isHidden,
              previouslyVisited: isPreviouslyVisited
            }
          };
        })
      );
    }
  }, [nodes, provider, edges, previousPathNodeIds]);

  // Calculate navigation steps when a node is clicked
  const handleNodeClick = useCallback(async (messageId: string) => {
    setMenu(null);
    
    if (provider === 'openai') {
      return calculateSteps(nodes, messageId);
    } else {
      let navigationNodes = nodes as unknown as ClaudeNode[];

      // Claude DOM visibility refresh is best-effort only
      try {
        const nodeTexts = navigationNodes.map((node) => node.data.text);
        const existingNodes = await checkNodesClaude(nodeTexts);

        const freshNodes = navigationNodes.map((node, index) => ({
          ...node,
          data: {
            ...node.data,
            hidden: existingNodes[index]
          }
        })) as ClaudeNode[];

        navigationNodes = freshNodes;
        setNodes(freshNodes as any);

        const currentlyVisibleNodes = new Set(
          freshNodes
            .filter((node) => !node.data.hidden)
            .map((node) => node.id)
        );
        setPreviousPathNodeIds(currentlyVisibleNodes);
      } catch (error) {
        console.warn('[handleNodeClick] Failed to refresh Claude visibility from DOM:', error);
      }
      
      // Find the parent of the clicked node
      const parentEdge = typedEdges.find(edge => edge.target === messageId);
      if (parentEdge) {
        const parentId = parentEdge.source;
          
        // Update the lastActiveChildMap with this new active child
        setLastActiveChildMap(prev => {
          const updated = { ...prev, [parentId]: messageId };
          
          return updated;
        });
      }

      const navigationTarget = computeNavigationTargetClaude(navigationNodes, messageId);
      
      // After navigation completes, update visibility states again
      setTimeout(() => {
        void updateNodesVisibility().catch((error) => {
          console.warn('[handleNodeClick] updateNodesVisibility failed:', error);
        });
      }, 100); // Small delay to ensure DOM updates have completed

      return navigationTarget;
    }
  }, [nodes, provider, lastActiveChildMap, typedEdges, updateNodesVisibility]);

  useEffect(() => {
    const messageListener = (message: any, _sender: chrome.runtime.MessageSender, _sendResponse: (response?: any) => void) => {
      if (message.action === "updateLastActiveChild" && message.parentId && message.activeChildId) {
        
        setLastActiveChildMap(prevMap => {
          const updated = { ...prevMap, [message.parentId]: message.activeChildId };
         
          return updated;
        });
      }
    };

    chrome.runtime.onMessage.addListener(messageListener);

    return () => {
      chrome.runtime.onMessage.removeListener(messageListener);
    };
  }, []);

  const onNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: any) => {
      // Ensure ref is treated as RefObject<HTMLDivElement> to match function signature
      if (provider === 'openai') {
        // Use the ref as is, the function handles null checking internally
        createContextMenuHandler(ref as React.RefObject<HTMLDivElement>, setMenu)(event, node);
      } else {
        // Use the ref as is, the function handles null checking internally
        createClaudeContextMenuHandler(ref as React.RefObject<HTMLDivElement>, setMenu, nodes)(event, node);
      }
    },
    [ref, setMenu, provider, nodes]
  );

  const onPaneClick = useCallback(() => setMenu(null), [setMenu]);
  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  // Add keyboard shortcut for search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setShowSearch(true);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (isLoading) return <LoadingSpinner />;
  if (!conversationData) return <ErrorState />;

  return (
    <div className="w-full h-full" style={{ height: '100%', width: '100%' }}>
      <div className="absolute top-4 right-4 flex items-center bg-white dark:bg-gray-800 rounded-lg shadow-lg divide-x divide-gray-200 dark:divide-gray-700 z-10">
        <button
          onClick={() => setShowSearch(true)}
          className="p-2.5 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors rounded-l-lg group"
          title="Search messages (⌘+K)"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-600 group-hover:text-gray-800 dark:text-gray-300 dark:group-hover:text-gray-100" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
          </svg>
        </button>
        <button
          onClick={handleRefresh}
          className="p-2.5 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors group"
          title="Refresh conversation"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-600 group-hover:text-gray-800 dark:text-gray-300 dark:group-hover:text-gray-100" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
          </svg>
        </button>
        <button
          onClick={cyclePreference}
          className="p-2.5 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors group"
          title={`Theme: ${preference}${preference === 'system' ? ` (${resolvedTheme})` : ''}`}
          aria-label="Change theme"
        >
          {preference === 'system' ? (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5 text-gray-600 group-hover:text-gray-800 dark:text-gray-300 dark:group-hover:text-gray-100"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9.75 17h4.5m-6 3h7.5M4.5 4.5h15v10.5h-15V4.5z"
              />
            </svg>
          ) : preference === 'dark' ? (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5 text-gray-600 group-hover:text-gray-800 dark:text-gray-300 dark:group-hover:text-gray-100"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 12.79A9 9 0 1111.21 3a7 7 0 109.79 9.79z"
              />
            </svg>
          ) : (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5 text-gray-600 group-hover:text-gray-800 dark:text-gray-300 dark:group-hover:text-gray-100"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 3v2m0 14v2m9-9h-2M5 12H3m15.364-6.364l-1.414 1.414M7.05 16.95l-1.414 1.414m12.728 0l-1.414-1.414M7.05 7.05L5.636 5.636M12 8a4 4 0 100 8 4 4 0 000-8z"
              />
            </svg>
          )}
        </button>
        <ShortcutButton />
        <CopyButton 
          nodes={nodes} 
          onNodeClick={handleNodeClick}
          provider={provider}
        />
        {provider === 'claude' ? (
          <ExportButtonClaude
            nodes={nodes as unknown as ClaudeNode[]}
            conversationData={conversationData as ClaudeConversation}
            className="p-2.5 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors rounded-r-lg group"
          />
        ) : (
          <ExportButton
            nodes={nodes as unknown as OpenAINode[]}
            conversationData={conversationData as OpenAIConversationData}
            className="p-2.5 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors rounded-r-lg group"
          />
        )}
      </div>
      <ReactFlow
        ref={ref}
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        onNodeContextMenu={onNodeContextMenu}
        onPaneClick={onPaneClick}
        onInit={instance => { 
          reactFlowInstance.current = instance;
        }}
        colorMode={resolvedTheme}
        fitView
        proOptions={{ hideAttribution: true }}
        minZoom={0.1}
        maxZoom={1.5}
        defaultViewport={{ x: 0, y: 0, zoom: 0.8 }}
      >
        <Controls className="bg-white dark:bg-gray-800 rounded-lg shadow-lg" />
        <MiniMap 
          nodeColor={(node) => {
            const isUser = node.data?.role === 'user' || node.data?.role === 'human';
            if (isDark) {
              return isUser ? '#f59e0b' : '#9ca3af';
            }
            return isUser ? '#fefce8' : '#f9fafb';
          }}
          className="bg-white dark:bg-gray-800 rounded-lg shadow-lg"
        />
        <Background
          variant={BackgroundVariant.Dots}
          gap={12}
          size={1}
          color={isDark ? '#334155' : '#f1f1f1'}
        />
        {menu && <ContextMenu 
          provider={provider}
          onClick={onPaneClick} 
          onNodeClick={handleNodeClick} 
          onRefresh={updateNodesVisibility}
          refreshNodes={handleRefresh}
          {...menu} 
        />}
      </ReactFlow>
      {showSearch && (
        <SearchBar
          provider={provider}
          nodes={nodes}
          onNodeClick={handleNodeClick}
          onClose={() => setShowSearch(false)}
          onRefresh={updateNodesVisibility}
        />
      )}
    </div>
  );
};

export default ConversationTree;
