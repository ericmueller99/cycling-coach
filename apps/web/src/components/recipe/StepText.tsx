import ReactMarkdown from 'react-markdown';

/** One recipe step. Coach steps bold their heat and time cues (DECISIONS #47); only inline marks render. */
export function StepText({ text }: { text: string }) {
  return (
    <ReactMarkdown allowedElements={['p', 'strong', 'em', 'code']} unwrapDisallowed components={{ p: ({ children }) => <>{children}</> }}>
      {text}
    </ReactMarkdown>
  );
}
