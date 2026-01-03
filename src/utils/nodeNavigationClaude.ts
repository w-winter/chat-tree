import { ClaudeNavigationTarget, ClaudeNode } from '../types/interfaces';

export const computeNavigationTargetClaude = (nodes: ClaudeNode[], targetId: string): ClaudeNavigationTarget => {
  const levels: ClaudeNavigationTarget['levels'] = [];

  const normalizeText = (text: string) => text.replace(/\s+/g, ' ').trim();

  const makeNeedle = (text: string) => {
    const normalized = normalizeText(text);
    if (!normalized) return null;
    return normalized.slice(0, 80);
  };

  let currentNode = nodes.find((node) => node.id === targetId);
  if (!currentNode) {
    return { levels, targetNeedle: null };
  }

  const targetNeedle = makeNeedle(currentNode.data?.text || currentNode.data?.label || '');

  while (currentNode) {
    const parent = nodes.find((node) => node.id === currentNode?.parent);
    if (!parent || !Array.isArray(parent.children) || parent.children.length === 0) {
      break;
    }

    const siblingCount = parent.children.length;
    const targetIndex = parent.children.indexOf(currentNode.id);
    if (targetIndex === -1) {
      break;
    }

    if (siblingCount > 1) {
      const siblingNeedles = parent.children
        .map((childId) => nodes.find((node) => node.id === childId))
        .map((siblingNode) => (siblingNode ? makeNeedle(siblingNode.data?.text || siblingNode.data?.label || '') : null))
        .filter((needle): needle is string => Boolean(needle))
        .slice(0, 10);

      levels.unshift({ siblingCount, targetIndex, anchorText: parent.data?.text || null, siblingNeedles });
    }

    currentNode = parent;
  }

  return { levels, targetNeedle };
};
