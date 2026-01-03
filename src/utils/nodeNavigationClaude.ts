import { ClaudeNavigationTarget, ClaudeNode } from '../types/interfaces';

const normalizeText = (text: string) => text.replace(/\s+/g, ' ').trim();

const makeNeedles = (text: string): string[] => {
  const normalized = normalizeText(text);
  if (!normalized) return [];

  const needles: string[] = [];

  const head = normalized.slice(0, 80);
  if (head) needles.push(head);

  if (normalized.length > 240) {
    const midStart = Math.max(0, Math.floor(normalized.length / 2) - 40);
    const mid = normalized.slice(midStart, midStart + 80);
    if (mid && !needles.includes(mid)) needles.push(mid);

    const tail = normalized.slice(-80);
    if (tail && !needles.includes(tail)) needles.push(tail);
  }

  return needles;
};

const makeNeedle = (text: string) => makeNeedles(text)[0] || null;

export const computeNavigationTargetClaude = (nodes: ClaudeNode[], targetId: string): ClaudeNavigationTarget => {
  const levels: ClaudeNavigationTarget['levels'] = [];

  let currentNode = nodes.find((node) => node.id === targetId);
  if (!currentNode) {
    return { levels, targetNeedle: null, targetNeedles: [] };
  }

  const targetText = currentNode.data?.text || currentNode.data?.label || '';
  const targetNeedles = makeNeedles(targetText);
  const targetNeedle = targetNeedles[0] || null;

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

      const parentAnchorText = parent.data?.text ? normalizeText(parent.data.text).slice(0, 400) : null;
      levels.unshift({ siblingCount, targetIndex, anchorText: parentAnchorText, siblingNeedles });
    }

    currentNode = parent;
  }

  return { levels, targetNeedle, targetNeedles };
};
