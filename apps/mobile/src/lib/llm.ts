/**
 * Mobile LLM client. Same providers as desktop, fetch-based, streams into
 * the React state via a callback.
 */
type Settings = {
  llm: { provider: 'openai' | 'anthropic' | 'groq' | 'ollama'; model: string; apiKey: string };
};

export class LLMClient {
  async stream(
    settings: Settings,
    prompt: string,
    onChunk: (text: string) => void,
  ): Promise<string> {
    const { provider, model, apiKey } = settings.llm;

    if (provider === 'openai' || provider === 'groq') {
      const url = provider === 'groq'
        ? 'https://api.groq.com/openai/v1/chat/completions'
        : 'https://api.openai.com/v1/chat/completions';
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: model || (provider === 'groq' ? 'llama-3.1-70b-versatile' : 'gpt-4o-mini'),
          stream: true,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      // Parse SSE
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = '', full = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n'); buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const d = line.slice(5).trim();
          if (d === '[DONE]') break;
          try {
            const j = JSON.parse(d);
            const t = j.choices?.[0]?.delta?.content ?? '';
            if (t) { full += t; onChunk(t); }
          } catch {}
        }
      }
      return full;
    }

    if (provider === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: model || 'claude-3-5-sonnet-20241022',
          max_tokens: 2048,
          messages: [{ role: 'user', content: prompt }],
          stream: true,
        }),
      });
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = '', full = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n'); buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          try {
            const j = JSON.parse(line.slice(5).trim());
            if (j.type === 'content_block_delta') {
              const t = j.delta?.text ?? '';
              if (t) { full += t; onChunk(t); }
            }
          } catch {}
        }
      }
      return full;
    }

    if (provider === 'ollama') {
      const res = await fetch('http://localhost:11434/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: model || 'llama3.2',
          messages: [{ role: 'user', content: prompt }],
          stream: true,
        }),
      });
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = '', full = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        for (const line of buf.split('\n')) {
          if (!line.trim()) continue;
          try {
            const j = JSON.parse(line);
            const t = j.message?.content ?? '';
            if (t) { full += t; onChunk(t); }
          } catch {}
        }
        buf = '';
      }
      return full;
    }

    throw new Error('Unknown provider: ' + provider);
  }
}
