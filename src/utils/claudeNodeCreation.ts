import { ClaudeChatMessage, ClaudeConversation, ClaudeEdge, ClaudeNode } from '../types/interfaces';
import { nodeHeight, nodeWidth } from '../constants/constants';
import dagre from '@dagrejs/dagre';

const dagreGraph = new dagre.graphlib.Graph().setGraph({}).setDefaultEdgeLabel(() => ({}));

const EMPTY_PARENT_UUID = '00000000-0000-4000-8000-000000000000';

const parseClaudeTimestampSeconds = (createdAt: unknown): number => {
  const createdAtMs = Date.parse(String(createdAt));
  if (!Number.isFinite(createdAtMs)) {
    return Math.floor(Date.now() / 1000);
  }
  return Math.floor(createdAtMs / 1000);
};

const getClaudeParentId = (message: ClaudeChatMessage): string => {
  if (!message.parent_message_uuid || message.parent_message_uuid === EMPTY_PARENT_UUID) {
    return 'root';
  }
  return message.parent_message_uuid;
};

// Extract text from all content blocks in a Claude message
const extractMessageText = (message: ClaudeChatMessage): string => {
  if (message.content && message.content.length > 0) {
    const texts = message.content
      .filter((block) => block.text && block.text.trim())
      .map((block) => block.text.trim());

    if (texts.length > 0) {
      return texts.join('\n\n');
    }
  }

  if (message.text && message.text.trim()) {
    return message.text.trim();
  }

  return 'No content available';
};

// Create a short label/preview from full text
const createLabel = (fullText: string, maxLength: number = 100): string => {
  if (fullText.length <= maxLength) return fullText;
  return fullText.substring(0, maxLength) + '...';
};

export const createClaudeNodesInOrder = async (
  conversationData: ClaudeConversation,
  checkNodes: (nodeTexts: string[]) => Promise<boolean[]>
) => {
  const nodeById = new Map<string, ClaudeNode>();

  const rootNode: ClaudeNode = {
    id: 'root',
    type: 'custom',
    parent: null,
    children: [],
    position: { x: 0, y: 0 },
    message: null,
    data: {
      label: 'Start of your conversation',
      text: 'Start of your conversation',
      role: 'system',
      timestamp: Math.floor(Date.now() / 1000),
      id: 'root',
      hidden: true,
      contentType: 'text',
    },
  };
  nodeById.set(rootNode.id, rootNode);

  for (const message of conversationData.chat_messages) {
    const parentId = getClaudeParentId(message);
    const fullText = extractMessageText(message);

    const node: ClaudeNode = {
      id: message.uuid,
      type: 'custom',
      parent: parentId,
      children: [],
      position: { x: 0, y: 0 },
      message,
      data: {
        label: createLabel(fullText),
        text: fullText,
        role: message.sender,
        timestamp: parseClaudeTimestampSeconds(message.created_at),
        id: message.uuid,
        hidden: true,
        contentType: message.content?.[0]?.type || 'text',
      },
    };

    nodeById.set(node.id, node);
  }

  for (const node of nodeById.values()) {
    if (node.id === 'root') continue;

    const parentId = node.parent || 'root';
    const parentNode = nodeById.get(parentId) || rootNode;

    node.parent = parentNode.id;
    parentNode.children.push(node.id);
  }

  const nodes = Array.from(nodeById.values());
  const edges = nodes
    .filter((node) => node.parent)
    .map((node) => ({
      id: `${node.parent}-${node.id}`,
      source: node.parent as string,
      target: node.id,
      type: 'smoothstep',
      animated: true,
      style: { stroke: '#000000', strokeWidth: 2 },
    })) as ClaudeEdge[];

  const nodesToCheck = nodes.filter((node) => node.id !== 'root');
  const existingNodes = await checkNodes(nodesToCheck.map((node) => node.data.text));
  existingNodes.forEach((hidden: boolean, index: number) => {
    if (nodesToCheck[index]) {
      nodesToCheck[index]!.data!.hidden = hidden;
    }
  });

  return layoutNodes(nodes, edges);
};

const layoutNodes = (nodes: ClaudeNode[], edges: ClaudeEdge[]) => {
  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const nodesWithPositions = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    return {
      ...node,
      targetPosition: 'top',
      sourcePosition: 'bottom',
      position: {
        x: nodeWithPosition.x - nodeWidth / 2,
        y: nodeWithPosition.y - nodeHeight / 2,
      },
    };
  });

  return { nodes: nodesWithPositions, edges };
};
