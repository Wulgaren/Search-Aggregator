import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAIComponent } from './ai';
import type { AIDeps, AIElements, AISource, AIStreamChunk } from './types';

function encodeSSE(chunks: AIStreamChunk[]): Uint8Array {
    const text = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('');
    return new TextEncoder().encode(text);
}

function streamResponse(chunks: AIStreamChunk[], ok = true, status = 200): Response {
    const body = new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(encodeSSE(chunks));
            controller.close();
        },
    });
    return {
        ok,
        status,
        body,
        json: async () => ({}),
    } as Response;
}

function hangingResponse(signal?: AbortSignal): Promise<Response> {
    return new Promise((_resolve, reject) => {
        if (signal?.aborted) {
            const err = new Error('Aborted');
            err.name = 'AbortError';
            reject(err);
            return;
        }
        signal?.addEventListener('abort', () => {
            const err = new Error('Aborted');
            err.name = 'AbortError';
            reject(err);
        });
    });
}

function createElements(): AIElements {
    document.body.innerHTML = `
        <button id="aiBtn"></button>
        <div id="aiPanel" style="display:none">
            <button id="aiPanelClose"></button>
            <div id="aiLoading" style="display:none"></div>
            <div id="aiAnswer" style="display:none"></div>
            <div id="aiPanelFooter" style="display:none">
                <div id="aiSources"></div>
            </div>
        </div>
    `;
    const aiPanel = document.getElementById('aiPanel') as HTMLElement;
    aiPanel.scrollIntoView = vi.fn();
    return {
        aiBtn: document.getElementById('aiBtn') as HTMLButtonElement,
        aiPanel,
        aiPanelClose: document.getElementById('aiPanelClose') as HTMLButtonElement,
        aiLoading: document.getElementById('aiLoading') as HTMLElement,
        aiAnswer: document.getElementById('aiAnswer') as HTMLElement,
        aiPanelFooter: document.getElementById('aiPanelFooter') as HTMLElement,
        aiSources: document.getElementById('aiSources') as HTMLElement,
    };
}

describe('createAIComponent', () => {
    let elements: AIElements;
    let apiFetch: ReturnType<typeof vi.fn<(path: string, init?: RequestInit) => Promise<Response>>>;
    let escapeHtml: ReturnType<typeof vi.fn<(text: string) => string>>;
    let deps: AIDeps;

    beforeEach(() => {
        elements = createElements();
        apiFetch = vi.fn();
        escapeHtml = vi.fn((text: string) =>
            text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
        );
        deps = { apiFetch, escapeHtml };
    });

    it('opens panel, shows loading, hides answer initially', async () => {
        let resolveFetch!: (r: Response) => void;
        apiFetch.mockImplementation(
            () =>
                new Promise<Response>((resolve) => {
                    resolveFetch = resolve;
                })
        );

        const { fetchAIAnswer } = createAIComponent(elements, deps);
        const pending = fetchAIAnswer('hello');

        expect(elements.aiPanel.style.display).toBe('block');
        expect(elements.aiBtn.classList.contains('active')).toBe(true);
        expect(elements.aiLoading.style.display).toBe('flex');
        expect(elements.aiAnswer.style.display).toBe('none');
        expect(elements.aiAnswer.innerHTML).toBe('');
        expect(elements.aiPanelFooter.style.display).toBe('none');
        expect(elements.aiPanel.scrollIntoView).toHaveBeenCalledWith({
            behavior: 'smooth',
            block: 'start',
        });
        expect(apiFetch).toHaveBeenCalledWith(
            '/api/ai',
            expect.objectContaining({
                method: 'POST',
                body: JSON.stringify({ query: 'hello' }),
            })
        );

        resolveFetch(streamResponse([{ content: 'done' }]));
        await pending;
    });

    it('streams SSE content into aiAnswer and hides loading', async () => {
        apiFetch.mockResolvedValue(
            streamResponse([{ content: 'Hello ' }, { content: 'world' }])
        );

        const { fetchAIAnswer } = createAIComponent(elements, deps);
        await fetchAIAnswer('q');

        expect(elements.aiLoading.style.display).toBe('none');
        expect(elements.aiAnswer.style.display).toBe('block');
        expect(elements.aiAnswer.innerHTML).toContain('Hello');
        expect(elements.aiAnswer.innerHTML).toContain('world');
        expect(elements.aiAnswer.querySelector('.ai-cursor')).toBeNull();
    });

    it('error path keeps panel open, shows ai-error, hides loading', async () => {
        apiFetch.mockResolvedValue({
            ok: false,
            status: 500,
            body: null,
            json: async () => ({ error: 'boom' }),
        } as Response);

        const { fetchAIAnswer } = createAIComponent(elements, deps);
        await fetchAIAnswer('q');

        expect(elements.aiPanel.style.display).toBe('block');
        expect(elements.aiLoading.style.display).toBe('none');
        expect(elements.aiAnswer.style.display).toBe('block');
        expect(elements.aiAnswer.querySelector('.ai-error')).not.toBeNull();
        expect(elements.aiAnswer.querySelector('.ai-error-message')?.textContent).toBe('boom');
        expect(escapeHtml).toHaveBeenCalledWith('boom');
    });

    it('AbortError returns silently with no error UI', async () => {
        apiFetch.mockImplementation((_path, init) => hangingResponse(init?.signal));

        const { fetchAIAnswer, closeAIPanel } = createAIComponent(elements, deps);
        const pending = fetchAIAnswer('q');
        expect(elements.aiLoading.style.display).toBe('flex');

        closeAIPanel();
        await pending;

        expect(elements.aiPanel.style.display).toBe('none');
        expect(elements.aiAnswer.querySelector('.ai-error')).toBeNull();
        expect(elements.aiAnswer.innerHTML).toBe('');
    });

    it('closeAIPanel / reset aborts and hides panel', async () => {
        apiFetch.mockImplementation((_path, init) => hangingResponse(init?.signal));

        const { fetchAIAnswer, closeAIPanel, reset } = createAIComponent(elements, deps);
        const pending = fetchAIAnswer('q');
        expect(elements.aiPanel.style.display).toBe('block');
        expect(elements.aiBtn.classList.contains('active')).toBe(true);

        closeAIPanel();
        await pending;

        expect(elements.aiPanel.style.display).toBe('none');
        expect(elements.aiBtn.classList.contains('active')).toBe(false);

        apiFetch.mockImplementation((_path, init) => hangingResponse(init?.signal));
        const pending2 = fetchAIAnswer('again');
        expect(elements.aiPanel.style.display).toBe('block');

        reset();
        await pending2;

        expect(elements.aiPanel.style.display).toBe('none');
        expect(elements.aiBtn.classList.contains('active')).toBe(false);
    });

    it('shows sources footer when content has citations and sources array', async () => {
        const sources: AISource[] = [
            { url: 'https://example.com/a', title: 'Source A' },
            { url: 'https://example.com/b', title: 'Source B' },
        ];
        apiFetch.mockResolvedValue(
            streamResponse([{ content: 'See [1] for details.' }, { sources }])
        );

        const { fetchAIAnswer } = createAIComponent(elements, deps);
        await fetchAIAnswer('q');

        expect(elements.aiPanelFooter.style.display).toBe('block');
        const links = elements.aiSources.querySelectorAll('.ai-source-item');
        expect(links).toHaveLength(2);
        expect(links[0].getAttribute('href')).toBe('https://example.com/a');
        expect(links[0].querySelector('.ai-source-title')?.textContent).toBe('Source A');
        expect(elements.aiAnswer.querySelector('.source-ref')?.getAttribute('data-source')).toBe('1');
    });

    it('does not show sources footer without citation cues', async () => {
        const sources: AISource[] = [{ url: 'https://example.com/a', title: 'Source A' }];
        apiFetch.mockResolvedValue(streamResponse([{ content: 'Plain answer.' }, { sources }]));

        const { fetchAIAnswer } = createAIComponent(elements, deps);
        await fetchAIAnswer('q');

        expect(elements.aiPanelFooter.style.display).toBe('none');
        expect(elements.aiSources.innerHTML).toBe('');
    });

    it('toggleWhenLoading: false aborts in-flight and starts new request', async () => {
        const signals: AbortSignal[] = [];
        let call = 0;
        apiFetch.mockImplementation((_path, init) => {
            call += 1;
            signals.push(init!.signal!);
            if (call === 1) return hangingResponse(init?.signal);
            return Promise.resolve(streamResponse([{ content: 'second' }]));
        });

        const { fetchAIAnswer } = createAIComponent(elements, deps);
        const first = fetchAIAnswer('one');
        expect(elements.aiLoading.style.display).toBe('flex');
        expect(apiFetch).toHaveBeenCalledTimes(1);

        const second = fetchAIAnswer('two', { toggleWhenLoading: false });
        await Promise.all([first, second]);

        expect(signals[0].aborted).toBe(true);
        expect(apiFetch).toHaveBeenCalledTimes(2);
        expect(apiFetch.mock.calls[1][1]).toEqual(
            expect.objectContaining({ body: JSON.stringify({ query: 'two' }) })
        );
        expect(elements.aiPanel.style.display).toBe('block');
        expect(elements.aiAnswer.innerHTML).toContain('second');
        expect(elements.aiLoading.style.display).toBe('none');
    });

    it('default toggleWhenLoading closes panel instead of restarting', async () => {
        apiFetch.mockImplementation((_path, init) => hangingResponse(init?.signal));

        const { fetchAIAnswer } = createAIComponent(elements, deps);
        const first = fetchAIAnswer('one');
        expect(elements.aiPanel.style.display).toBe('block');

        await fetchAIAnswer('two');
        await first;

        expect(elements.aiPanel.style.display).toBe('none');
        expect(apiFetch).toHaveBeenCalledTimes(1);
    });
});
