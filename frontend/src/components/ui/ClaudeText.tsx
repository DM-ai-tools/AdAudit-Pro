import type { ReactNode } from 'react';
import clsx from 'clsx';

function renderInline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="text-white font-semibold">{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

function headingLevel(line: string): 1 | 2 | 3 | 0 {
  if (/^###\s+/.test(line)) return 3;
  if (/^##\s+/.test(line)) return 2;
  if (/^#\s+/.test(line)) return 1;
  return 0;
}

function stripHeadingMarkers(line: string): string {
  return line.replace(/^#{1,3}\s+/, '').trim();
}

interface ClaudeTextProps {
  text: string;
  className?: string;
}

/** Renders Claude prose with basic markdown (headings, bold, bullets, paragraphs). */
export function ClaudeText({ text, className }: ClaudeTextProps) {
  const blocks = text.split(/\n\n+/);
  const elements: ReactNode[] = [];

  blocks.forEach((block, blockIdx) => {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return;

    const isList = lines.every((l) => /^[-*•]\s+/.test(l) || /^\d+\.\s+/.test(l));
    if (isList) {
      elements.push(
        <ul key={`ul-${blockIdx}`} className="list-disc list-inside space-y-1.5 text-body">
          {lines.map((line, i) => (
            <li key={i}>{renderInline(line.replace(/^[-*•]\s+/, '').replace(/^\d+\.\s+/, ''))}</li>
          ))}
        </ul>
      );
      return;
    }

    const level = headingLevel(lines[0]);
    if (level > 0 && lines.length === 1) {
      const content = stripHeadingMarkers(lines[0]);
      if (level === 1) {
        elements.push(<h3 key={`h-${blockIdx}`} className="text-white font-bold text-base">{renderInline(content)}</h3>);
      } else if (level === 2) {
        elements.push(<h4 key={`h-${blockIdx}`} className="text-white font-semibold text-sm">{renderInline(content)}</h4>);
      } else {
        elements.push(<h5 key={`h-${blockIdx}`} className="text-white/90 font-medium text-sm">{renderInline(content)}</h5>);
      }
      return;
    }

    elements.push(
      <p key={`p-${blockIdx}`} className="text-body leading-relaxed">
        {renderInline(lines.join(' '))}
      </p>
    );
  });

  return <div className={clsx('space-y-4 text-sm', className)}>{elements}</div>;
}
