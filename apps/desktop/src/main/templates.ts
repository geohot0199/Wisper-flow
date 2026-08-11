/**
 * Mode-specific prompt templates.
 *
 * Some users want a final, opinionated system prompt wrapped around the
 * refined user message before it's sent to the LLM. This is the right
 * place for that — keep it separate from the deterministic refinement
 * engine so the engine stays pure & testable.
 */

import type { Mode } from '@wisper-flow/refinement';

const SYSTEM: Record<Mode, string> = {
  general:
    'You are a helpful, concise assistant. Answer in 1-3 short paragraphs unless asked otherwise.',
  code:
    'You are a senior software engineer. Always write production-quality, idiomatic code with edge-case handling, a brief docstring, and at least one example. Explain trade-offs in 2-3 lines after the code.',
  email:
    'You write professional, concise emails. Use a clear subject line and a polite sign-off. Match the tone to context (formal/casual).',
  note:
    'You turn spoken notes into clean, structured Markdown: a one-line title, 3-5 bullet points, and an "Action items" section when relevant.',
  shell:
    'You give correct, portable shell commands. When multiple steps are required, chain them with proper operators. Add a short comment explaining each command when non-obvious.',
};

export function applyPromptTemplate(
  refinedUserContent: string,
  mode: Mode,
  language: string | null,
): string {
  const sys = SYSTEM[mode];
  const langLine = language && mode === 'code' ? `[Language: ${language}]\n` : '';
  return `${sys}\n\n${langLine}${refinedUserContent}`;
}
