/**
 * Settings renderer — loads/saves config via IPC, also has a "test refine" box.
 */
const $ = <T extends HTMLElement = HTMLInputElement>(id: string) =>
  document.getElementById(id) as T;

const fields = {
  provider: $<HTMLSelectElement>('llm-provider'),
  model: $<HTMLInputElement>('llm-model'),
  key: $<HTMLInputElement>('llm-key'),
  sttProvider: $<HTMLSelectElement>('stt-provider'),
  sttModel: $<HTMLInputElement>('stt-model'),
  hotkey: $<HTMLInputElement>('hotkey'),
  mode: $<HTMLSelectElement>('mode'),
  codingMode: $<HTMLInputElement>('coding-mode'),
  autoInject: $<HTMLInputElement>('auto-inject'),
  maxTokens: $<HTMLInputElement>('max-tokens'),
  testInput: $<HTMLTextAreaElement>('test-input'),
  testOutput: $<HTMLPreElement>('test-output'),
  testBtn: $<HTMLButtonElement>('test-btn'),
  save: $<HTMLButtonElement>('save'),
  status: $<HTMLParagraphElement>('status'),
};

async function load() {
  const c = await (window as any).wisper.getConfig();
  fields.provider.value = c.llm.provider;
  fields.model.value = c.llm.model;
  fields.key.value = c.llm.apiKey; // already masked
  fields.sttProvider.value = c.stt.provider;
  fields.sttModel.value = c.stt.model;
  fields.hotkey.value = c.hotkey;
  fields.mode.value = c.mode;
  fields.codingMode.checked = c.codingMode;
  fields.autoInject.checked = c.autoInject;
  fields.maxTokens.value = String(c.maxTokens);
}

async function save() {
  const partial: any = {
    llm: {
      provider: fields.provider.value,
      model: fields.model.value,
      apiKey: fields.key.value,
    },
    stt: {
      provider: fields.sttProvider.value,
      model: fields.sttModel.value,
    },
    hotkey: fields.hotkey.value,
    mode: fields.mode.value,
    codingMode: fields.codingMode.checked,
    autoInject: fields.autoInject.checked,
    maxTokens: parseInt(fields.maxTokens.value, 10),
  };
  await (window as any).wisper.setConfig(partial);
  fields.status.textContent = 'Saved ✓';
  setTimeout(() => (fields.status.textContent = ''), 2000);
}

fields.save.addEventListener('click', save);
fields.testBtn.addEventListener('click', async () => {
  const out = await (window as any).wisper.testRefine(fields.testInput.value);
  fields.testOutput.textContent = JSON.stringify(out, null, 2);
});

load();
