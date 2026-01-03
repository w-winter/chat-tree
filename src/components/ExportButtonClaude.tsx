import { ClaudeNode } from '../types/interfaces';
import { useState } from 'react';
import { ExportModal } from './ExportModal';

interface ExportButtonClaudeProps {
  nodes: ClaudeNode[];
  conversationData: any;
  className?: string;
}

export const ExportButtonClaude = ({ nodes, conversationData, className }: ExportButtonClaudeProps) => {
  const [showModal, setShowModal] = useState(false);

  const sanitizeFilenameBase = (value: unknown, fallback: string) => {
    const base = String(value ?? '').trim() || fallback;
    return (
      base
        // Windows-illegal (also safe cross-platform)
        .replace(/[\\/:*?"<>|]/g, '-')
        .replace(/\s+/g, ' ')
        .slice(0, 120)
    );
  };

  const safeParseDate = (value: unknown) => {
    const date = new Date(typeof value === 'number' ? value : String(value));
    return Number.isFinite(date.getTime()) ? date : null;
  };

  const safeToLocaleString = (value: unknown) => {
    const date = safeParseDate(value);
    return date ? date.toLocaleString() : null;
  };

  const safeToISOString = (value: unknown) => {
    const date = safeParseDate(value);
    return date ? date.toISOString() : null;
  };

  const escapeXmlAttr = (value: string) =>
    value
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/'/g, '&apos;');

  const wrapCdata = (value: string) => `<![CDATA[${value.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;

  const getClaudeMessageBody = (node: ClaudeNode) => {
    const blocks = node.message?.content ?? [];
    const blockText = blocks
      .filter((block) => block.type === 'text' && block.text?.trim())
      .map((block) => block.text.trim())
      .join('\n\n');

    if (blockText) return blockText;
    if (node.data?.text?.trim()) return node.data.text.trim();
    return node.data?.label ?? '';
  };
  
  const handleExport = (format: 'markdown' | 'xml' | 'obsidian') => {
    try {
      const visibleNodes = nodes
        .filter((node) => !node.data?.hidden)
        .sort((a, b) => (a.data?.timestamp || 0) - (b.data?.timestamp || 0));

      const title = String(conversationData?.name ?? '').trim() || 'Claude Conversation';
      const createdOn = safeToLocaleString(conversationData?.created_at);
      const filenameBase = sanitizeFilenameBase(conversationData?.name, 'claude-conversation');

      let content: string;
      let filename: string;
      let mimeType: string;

      if (format === 'markdown') {
        content = `# ${title}\n\n`;
        if (createdOn) {
          content += `Created on ${createdOn}\n\n`;
        }
        content += '---\n\n';

        visibleNodes.forEach((node) => {
          const role = node.data?.role === 'human' ? 'You' : 'Assistant';
          const messageContent = getClaudeMessageBody(node);
          const timestamp = node.data?.timestamp ? new Date(node.data.timestamp * 1000).toLocaleString() : '';
          const model = node.data?.model_slug ? ` (${node.data.model_slug})` : '';

          content += `## ${role}${model}\n\n${messageContent}\n\n`;
          if (timestamp) {
            content += `*${timestamp}*\n\n`;
          }
          content += '---\n\n';
        });

        filename = `${filenameBase}.md`;
        mimeType = 'text/markdown';
      } else if (format === 'obsidian') {
        content = `# ${title}\n\n`;
        content += `>[!info]- Conversation Info\n`;
        if (createdOn) {
          content += `>Created on ${createdOn}\n\n`;
        } else {
          content += `>Created on Unknown\n\n`;
        }

        visibleNodes.forEach((node) => {
          const role = node.data?.role === 'human' ? 'You' : 'Assistant';
          const messageContent = getClaudeMessageBody(node);
          const timestamp = node.data?.timestamp ? new Date(node.data.timestamp * 1000).toLocaleString() : '';
          const model = node.data?.model_slug ? ` using ${node.data.model_slug}` : '';

          if (role === 'You') {
            content += `>[!question] You\n`;
          } else {
            content += `>[!note] Assistant${model}\n`;
          }

          content += messageContent.split('\n').map((line) => `>${line}`).join('\n');
          content += '\n\n';

          if (timestamp) {
            content += `^[${timestamp}]\n\n`;
          }
        });

        filename = `${filenameBase}_obsidian.md`;
        mimeType = 'text/markdown';
      } else {
        // XML format
        const createdIso = safeToISOString(conversationData?.created_at);
        const createdAttr = createdIso ? ` created="${escapeXmlAttr(createdIso)}"` : '';

        content = `<?xml version="1.0" encoding="UTF-8"?>\n`;
        content += `<conversation title="${escapeXmlAttr(title)}"${createdAttr}>\n`;

        visibleNodes.forEach((node) => {
          const role = node.data?.role === 'human' ? 'You' : 'Assistant';
          const messageContent = getClaudeMessageBody(node);
          const timestampIso = node.data?.timestamp ? new Date(node.data.timestamp * 1000).toISOString() : null;
          const model = node.data?.model_slug || '';

          const modelAttr = model ? ` model="${escapeXmlAttr(model)}"` : '';
          const timestampAttr = timestampIso ? ` timestamp="${escapeXmlAttr(timestampIso)}"` : '';

          content += `  <message role="${escapeXmlAttr(role)}"${modelAttr}${timestampAttr}>\n`;
          content += `    <content>${wrapCdata(messageContent)}</content>\n`;
          content += `  </message>\n`;
        });

        content += `</conversation>`;
        filename = `${filenameBase}.xml`;
        mimeType = 'application/xml';
      }

      // Create and trigger download
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setShowModal(false);
    } catch (error) {
      console.error('[ExportButtonClaude] Export failed:', error);
      alert('Export failed. Please check the console for details.');
    }
  };

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className={className || "p-2.5 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors group"}
        title="Export conversation"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-600 group-hover:text-gray-800 dark:text-gray-300 dark:group-hover:text-gray-100" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      </button>
      {showModal && (
        <ExportModal
          onClose={() => setShowModal(false)}
          onExport={handleExport}
          visibleNodesCount={nodes.filter(node => !node.data?.hidden).length}
        />
      )}
    </>
  );
};
