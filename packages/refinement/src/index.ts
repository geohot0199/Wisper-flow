/**
 * Wisper Flow — Prompt Refinement Engine
 *
 * The core IP. Takes a raw, filler-heavy spoken transcript and:
 *   1. Strips disfluencies (um, uh, like, you know, ...)
 *   2. Classifies intent (code / email / note / general)
 *   3. Re-frames into a token-efficient, LLM-ready prompt
 *   4. (Coding mode) Injects software-engineering scaffolding
 *
 * No LLM calls happen here — this is pure deterministic logic so it
 * runs offline, on mobile, and never costs tokens.
 */

// ─── 1. Filler / disfluency strip ───────────────────────────────────────────

const FILLERS = [
  // English
  'um', 'uh', 'erm', 'er', 'uhh', 'umm', 'hmm', 'mm', 'mhm',
  'like', 'you know', 'i mean', 'i guess', 'i think', 'kinda', 'kind of',
  'sort of', 'basically', 'literally', 'actually', 'honestly',
  'so yeah', 'yeah', 'yep', 'yup', 'okay so', 'ok so', 'so basically',
  'right so', 'alright so', 'let me think', 'how do i put this',
  'what i want to say is', 'the thing is', 'to be honest',
  // Hindi / Hinglish
  'matlab', 'basically matlab', 'kya', 'haan', 'acha', 'wah wah',
  'arey', 'arre', 'matlab ye', 'samjhe', 'samjha',
  // Spanish
  'pues', 'o sea', 'vale', 'venga', 'bueno',
  // French
  'euh', 'hein', 'tu vois', 'en fait', 'du coup',
  // German
  'ähm', 'also', 'quasi', 'halt', 'ne',
];

// Pre-compile regexes for speed
const FILLER_PATTERNS = FILLERS
  .map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .sort((a, b) => b.length - a.length) // longest first
  .map((f) => new RegExp(`\\b${f}\\b[, ]?`, 'gi'));

const REPEATED_WORD = /\b(\w{2,})\s+\1\b/gi;
const TRAILING_PUNCT = /[, ]+$/g;
const DOUBLE_SPACE = /\s{2,}/g;

/**
 * Remove filler words, repeated words, and normalize whitespace.
 * Idempotent: stripFiller(stripFiller(x)) === stripFiller(x).
 */
export function stripFiller(input: string): string {
  if (!input) return '';
  let out = input.trim();
  for (const re of FILLER_PATTERNS) out = out.replace(re, '');
  out = out.replace(REPEATED_WORD, '$1');
  out = out.replace(DOUBLE_SPACE, ' ');
  // Capitalize first letter of each sentence
  out = out.replace(/(^|[.!?]\s+)([a-z])/g, (_, p1, p2) => p1 + p2.toUpperCase());
  // Lowercase the very first char if not at sentence start
  if (out.length && out[0] === out[0].toUpperCase() && out[0] !== out[0].toLowerCase()) {
    // ok
  }
  return out.replace(TRAILING_PUNCT, '').trim();
}

// ─── 2. Intent classifier ───────────────────────────────────────────────────

export type Mode = 'general' | 'code' | 'email' | 'note' | 'shell';

// Keywords shorter than 4 chars that could falsely match inside other words
// (e.g. "row" inside "tomorrow") are matched as exact tokens only.
const SHORT_KEYWORDS = new Set(['row', 'for', 'if', 'cd', 'ls', 'rm', 'mv', 'cp', 'go']);

const CODE_KEYWORDS = [
  'function', 'class', 'method', 'variable', 'array', 'list', 'dict', 'object',
  'string', 'integer', 'boolean', 'null', 'undefined', 'promise', 'async', 'await',
  'return', 'loop', 'while', 'else', 'switch', 'case',
  'import', 'export', 'require', 'module', 'package', 'npm', 'pip', 'cargo',
  'react', 'vue', 'angular', 'next', 'node', 'django', 'flask', 'fastapi',
  'typescript', 'javascript', 'python', 'rust', 'java', 'kotlin', 'swift',
  'sql', 'query', 'database', 'table', 'column', 'index',
  'api', 'endpoint', 'route', 'middleware', 'controller', 'service',
  'bug', 'fix', 'refactor', 'implement', 'build', 'compile', 'deploy',
  'test', 'spec', 'unit test', 'integration test',
  'git', 'commit', 'branch', 'merge', 'pull request', 'pr',
  'docker', 'kubernetes', 'ci', 'cd', 'pipeline',
  'algorithm', 'data structure', 'recursion', 'closure', 'callback',
  'vs code', 'ide', 'terminal', 'command line', 'cli',
  'refactor this', 'write a function', 'make it', 'code', 'coding', 'script',
];

const SHELL_KEYWORDS = [
  'run', 'execute', 'shell', 'bash', 'zsh', 'powershell', 'cmd',
  'grep', 'find', 'mkdir', 'cat', 'echo',
  'chmod', 'chown', 'sudo', 'apt', 'brew', 'systemctl',
  'npm install', 'npm run', 'npm i ', 'pip install', 'pip3 install',
  'git commit', 'git push', 'git pull', 'git clone', 'git checkout', 'git status', 'git diff',
  'docker build', 'docker run', 'docker ps', 'docker compose',
  'kubectl get', 'kubectl apply', 'kubectl logs',
  'pnpm install', 'yarn install', 'yarn add', 'pnpm add',
  'ls ', 'cd ', 'rm ', 'mv ', 'cp ', 'cat ',
];

const EMAIL_KEYWORDS = [
  'email', 'gmail', 'mail to', 'reply to', 'forward', 'subject',
  'dear ', 'hi ', 'hello ', 'regards', 'sincerely', 'best,', 'thanks,',
  'follow up', 'following up', 'as per', 'per our', 'cc ', 'bcc ',
];

const NOTE_KEYWORDS = [
  'note', 'notes', 'remember', 'remind me', 'todo', 'to-do', 'task',
  'meeting', 'agenda', 'minutes', 'summary', 'summarize', 'jot down',
  'idea:', 'brainstorm', 'outline', 'plan:', 'next steps',
];

export interface IntentResult {
  mode: Mode;
  confidence: number;
  signals: string[];
}

/**
 * Lightweight keyword + heuristic intent classifier.
 * Confidence = hits / total words (capped at 1).
 */
export function classifyIntent(text: string): IntentResult {
  const t = text.toLowerCase();
  const tokens = t.split(/\s+/).filter(Boolean);

  const score = (kws: string[]) => {
    const hits: string[] = [];
    for (const kw of kws) {
      if (SHORT_KEYWORDS.has(kw)) {
        // strict whole-word match for short keywords
        const re = new RegExp(`\\b${kw}\\b`, 'i');
        if (re.test(t)) hits.push(kw);
      } else {
        if (t.includes(kw)) hits.push(kw);
      }
    }
    return { hits, score: tokens.length ? Math.min(1, hits.length / Math.max(1, tokens.length / 8)) : 0 };
  };

  const code = score(CODE_KEYWORDS);
  const shell = score(SHELL_KEYWORDS);
  const email = score(EMAIL_KEYWORDS);
  const note = score(NOTE_KEYWORDS);

  const results: Array<{ mode: Mode; r: typeof code }> = [
    { mode: 'shell', r: shell },
    { mode: 'code', r: code },
    { mode: 'email', r: email },
    { mode: 'note', r: note },
  ];
  results.sort((a, b) => b.r.score - a.r.score);

  const best = results[0];
  // General fallback if no signal
  if (best.r.score === 0) {
    return { mode: 'general', confidence: 0, signals: [] };
  }
  return { mode: best.mode, confidence: best.r.score, signals: best.r.hits };
}

// ─── 3. Re-framer (turns spoken intent into LLM-ready prompt) ───────────────

const GENERAL_TEMPLATES: Record<Mode, (clean: string) => string> = {
  general: (clean) => clean,

  code: (clean) => `You are a senior software engineer. Task:\n${clean}\n\n` +
    `Requirements:\n` +
    `- Production-quality, idiomatic code\n` +
    `- Handle edge cases and invalid input\n` +
    `- Include a brief docstring\n` +
    `- Add at least one example usage or unit test\n` +
    `- Explain trade-offs in 2-3 lines at the end`,

  email: (clean) => `Write a professional, concise email based on:\n"${clean}"\n\n` +
    `Constraints:\n` +
    `- Clear subject line\n` +
    `- Polite greeting and sign-off\n` +
    `- Under 150 words unless asked otherwise\n` +
    `- Match the tone (formal if business, casual if personal)`,

  note: (clean) => `Turn the following spoken notes into a clean, structured note:\n"${clean}"\n\n` +
    `Format:\n` +
    `- Title (one line)\n` +
    `- 3-5 bullet points with the key facts\n` +
    `- A short "Action items:" section if any tasks are mentioned`,

  shell: (clean) => `Provide a shell command for the following task. ` +
    `If multiple commands are needed, chain them with proper operators.\n\n` +
    `Task: ${clean}\n\n` +
    `Requirements:\n` +
    `- Prefer portable POSIX where possible (note OS if not)\n` +
    `- Quote paths with spaces\n` +
    `- Explain what each part does in one short comment`,
};

/**
 * Build a coding-mode prompt: injects SE framing and language hints
 * detected from the transcript.
 */
export function buildCodingPrompt(clean: string, language?: string): string {
  const lang = language ?? detectLanguage(clean);
  const template = GENERAL_TEMPLATES.code(clean);
  return lang ? `[Language: ${lang}]\n${template}` : template;
}

const LANG_HINTS: Record<string, string> = {
  python: 'python', py: 'python', django: 'python', flask: 'python', fastapi: 'python',
  javascript: 'javascript', js: 'javascript', node: 'javascript',
  typescript: 'typescript', ts: 'typescript', react: 'typescript', next: 'typescript', vue: 'javascript',
  rust: 'rust', cargo: 'rust',
  go: 'go', golang: 'go',
  java: 'java', kotlin: 'kotlin', spring: 'java',
  swift: 'swift', ios: 'swift',
  c: 'c', cpp: 'cpp', 'c++': 'cpp',
  sql: 'sql',
  bash: 'bash', shell: 'bash', zsh: 'bash',
  ruby: 'ruby', rails: 'ruby',
  php: 'php', laravel: 'php',
};

export function detectLanguage(text: string): string | null {
  const t = text.toLowerCase();
  for (const [hint, lang] of Object.entries(LANG_HINTS)) {
    const re = new RegExp(`\\b${hint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (re.test(t)) return lang;
  }
  return null;
}

// ─── 4. Token-budget guard ──────────────────────────────────────────────────

/**
 * Rough token estimate (1 token ≈ 4 chars of English).
 * For accurate counts on OpenAI models, swap with tiktoken.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * If the refined prompt exceeds budget, summarize it.
 * Here we just truncate + ellipsis — real impl would call a cheap LLM.
 */
export function enforceBudget(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  const head = text.slice(0, Math.floor(maxChars * 0.7));
  const tail = text.slice(-Math.floor(maxChars * 0.25));
  return `${head}\n\n[…content trimmed for token budget…]\n\n${tail}`;
}

// ─── 5. Public API: one-shot refine ─────────────────────────────────────────

export interface RefineOptions {
  mode?: Mode | 'auto';
  language?: string;
  maxTokens?: number;
  codingMode?: boolean;
}

export interface RefineResult {
  original: string;
  cleaned: string;
  mode: Mode;
  language: string | null;
  refinedPrompt: string;
  estimatedTokens: number;
  confidence: number;
  signals: string[];
}

/**
 * The single entry point used by both the desktop tray app and the
 * mobile keyboard. Given a raw STT transcript, returns an LLM-ready prompt.
 */
export const MAX_INPUT_LENGTH = 50_000; // ~12 500 tokens — far above any real dictation

export function refine(input: string, opts: RefineOptions = {}): RefineResult {
  // Cap input size. A misbehaving caller (e.g. a runaway audio buffer
  // serialised as text) can't make us run huge regex passes.
  const original = (input ?? '').slice(0, MAX_INPUT_LENGTH);
  if (!original) {
    return {
      original: '',
      cleaned: '',
      mode: 'general',
      language: null,
      refinedPrompt: '',
      estimatedTokens: 0,
      confidence: 0,
      signals: [],
    };
  }
  const cleaned = stripFiller(original);

  const detectedMode = classifyIntent(cleaned);
  const mode: Mode =
    opts.mode && opts.mode !== 'auto' ? opts.mode :
    opts.codingMode ? 'code' :
    detectedMode.mode;

  const language = opts.codingMode || mode === 'code'
    ? (opts.language ?? detectLanguage(cleaned))
    : null;

  const refined = mode === 'code'
    ? buildCodingPrompt(cleaned, language ?? undefined)
    : GENERAL_TEMPLATES[mode](cleaned);

  const budgeted = opts.maxTokens ? enforceBudget(refined, opts.maxTokens) : refined;
  const tokens = estimateTokens(budgeted);

  return {
    original,
    cleaned,
    mode,
    language,
    refinedPrompt: budgeted,
    estimatedTokens: tokens,
    confidence: detectedMode.confidence,
    signals: detectedMode.signals,
  };
}
