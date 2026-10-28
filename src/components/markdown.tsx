import { Fragment } from "react";

// Minimal, safe markdown for the agent's summaries: headings, paragraphs,
// bullet lists, bold, inline code and links. No raw HTML ever reaches the DOM.

function inline(text: string, key: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\((https?:\/\/[^)\s]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const k = `${key}-${i++}`;
    if (tok.startsWith("**")) out.push(<strong key={k}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("`")) out.push(<code key={k} className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[0.85em]">{tok.slice(1, -1)}</code>);
    else {
      const label = tok.slice(1, tok.indexOf("]("));
      out.push(
        <a key={k} href={m[2]} target="_blank" rel="noreferrer" className="text-accent underline">
          {label}
        </a>,
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text, className = "" }: { text: string; className?: string }) {
  const blocks: React.ReactNode[] = [];
  const lines = text.replace(/\r/g, "").split("\n");
  let para: string[] = [];
  let list: string[] = [];
  let n = 0;
  const flush = () => {
    if (para.length) {
      blocks.push(<p key={`p${n++}`}>{inline(para.join(" "), `p${n}`)}</p>);
      para = [];
    }
    if (list.length) {
      blocks.push(
        <ul key={`l${n++}`} className="list-disc space-y-1 pl-5">
          {list.map((item, i) => (
            <li key={i}>{inline(item, `l${n}-${i}`)}</li>
          ))}
        </ul>,
      );
      list = [];
    }
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      const level = h[1].length;
      const cls = level <= 2 ? "text-base font-semibold text-ink" : "text-sm font-semibold text-ink";
      blocks.push(
        <Fragment key={`h${n++}`}>{level <= 2 ? <h3 className={cls}>{inline(h[2], `h${n}`)}</h3> : <h4 className={cls}>{inline(h[2], `h${n}`)}</h4>}</Fragment>,
      );
      continue;
    }
    const li = /^[-*•]\s+(.*)$/.exec(line) ?? /^\d+[.)]\s+(.*)$/.exec(line);
    if (li) {
      if (para.length) flush();
      list.push(li[1]);
      continue;
    }
    if (list.length) flush();
    para.push(line);
  }
  flush();
  return <div className={`space-y-3 text-sm leading-relaxed text-ink-2 ${className}`}>{blocks}</div>;
}
