/**
 * LLM streaming module.
 *
 * Providers:
 *   - openai:   chat.completions.create({ stream: true })
 *   - anthropic: messages.stream
 *   - groq:     OpenAI-compatible
 *   - ollama:   POST /api/chat with stream:true
 *
 * Returns an async generator of text chunks. The main process consumes
 * chunks and pipes them to the overlay + to the text-injector.
 */

import OpenAI from 'openai';

export interface LLMConfig {
  provider: 'openai' | 'anthropic' | 'groq' | 'ollama';
  model: string;
  apiKey: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface StreamOptions {
  onChunk: (text: string) => void;
  signal?: AbortSignal;
}

export async function streamLLM(
  cfg: LLMConfig,
  messages: ChatMessage[],
  opts: StreamOptions,
): Promise<string> {
  if (cfg.provider === 'openai' || cfg.provider === 'groq') {
    const baseURL = cfg.provider === 'groq' ? 'https://api.groq.com/openai/v1' : undefined;
    const client = new OpenAI({ apiKey: cfg.apiKey, baseURL });
    const stream = await client.chat.completions.create({
      model: cfg.model || (cfg.provider === 'groq' ? 'llama-3.1-70b-versatile' : 'gpt-4o-mini'),
      messages,
      stream: true,
    });
    let full = '';
    for await (const part of stream as any) {
      if (opts.signal?.aborted) break;
      const delta = part.choices?.[0]?.delta?.content ?? '';
      if (delta) { full += delta; opts.onChunk(delta); }
    }
    return full;
  }

  if (cfg.provider === 'anthropic') {
    // defence in depth: enforce HTTPS for cloud LLM endpoints
    const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
    const sys = messages.find((m) => m.role === 'system')?.content ?? '';
    const userMsgs = messages.filter((m) => m.role !== 'system');
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: cfg.model || 'claude-3-5-sonnet-20241022',
        max_tokens: 2048,
        system: sys,
        messages: userMsgs.map((m) => ({ role: m.role, content: m.content })),
        stream: true,
      }),
      signal: opts.signal,
    });
    if (!res.body) throw new Error('Anthropic: no body');
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let full = '';
    let buf = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') break;
        try {
          const evt = JSON.parse(data);
          if (evt.type === 'content_block_delta') {
            const t = evt.delta?.text ?? '';
            if (t) { full += t; opts.onChunk(t); }
          }
        } catch { /* ignore parse error on partial line */ }
      }
    }
    return full;
  }

  if (cfg.provider === 'ollama') {
    const res = await fetch('http://localhost:11434/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: cfg.model || 'llama3.2',
        messages,
        stream: true,
      }),
      signal: opts.signal,
    });
    if (!res.body) throw new Error('Ollama: no body');
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let full = '';
    let buf = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const evt = JSON.parse(line);
          const t = evt.message?.content ?? '';
          if (t) { full += t; opts.onChunk(t); }
        } catch { /* ignore */ }
      }
    }
    return full;
  }

  throw new Error('Unknown LLM provider: ' + cfg.provider);
}
