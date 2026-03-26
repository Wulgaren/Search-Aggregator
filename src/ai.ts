import type { AIDeps, AIElements, AISource, AIState, AIStreamChunk } from './types';

export function createAIComponent(elements: AIElements, deps: AIDeps) {
    const state: AIState = { loading: false, abortController: null };

    function closeAIPanel() {
        if (state.abortController) {
            state.abortController.abort();
            state.abortController = null;
        }
        elements.aiPanel.style.display = 'none';
        elements.aiBtn.classList.remove('active');
        state.loading = false;
    }

    async function fetchAIAnswer(query: string) {
        if (state.loading) {
            closeAIPanel();
            return;
        }

        elements.aiPanel.style.display = 'block';
        elements.aiBtn.classList.add('active');
        elements.aiLoading.style.display = 'flex';
        elements.aiAnswer.innerHTML = '';
        elements.aiAnswer.style.display = 'none';
        elements.aiPanelFooter.style.display = 'none';
        state.loading = true;
        elements.aiPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        state.abortController = new AbortController();

        try {
            const response = await deps.apiFetch('/api/ai', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query }),
                signal: state.abortController.signal,
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                const errMsg = errorData.error || `Request failed: ${response.status}`;
                throw new Error(errMsg);
            }

            const reader = response.body!.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let fullContent = '';
            let webSearchSources: AISource[] | null = null;
            let hasReceivedContent = false;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || trimmed === 'data: [DONE]' || !trimmed.startsWith('data: ')) continue;
                    let json: AIStreamChunk;
                    try {
                        json = JSON.parse(trimmed.slice(6));
                    } catch (e: unknown) {
                        if (!(e instanceof Error) || e.message !== 'Unexpected end of JSON input') console.error('Parse error:', e);
                        continue;
                    }
                    if (json.content) {
                        if (!hasReceivedContent) {
                            elements.aiLoading.style.display = 'none';
                            elements.aiAnswer.style.display = 'block';
                            hasReceivedContent = true;
                        }
                        fullContent += json.content;
                        elements.aiAnswer.innerHTML = renderMarkdown(fullContent) + '<span class="ai-cursor"></span>';
                    }
                    if (json.sources) webSearchSources = json.sources;
                    if (json.error) throw new Error(json.error);
                }
            }

            if (!hasReceivedContent) {
                elements.aiLoading.style.display = 'none';
                elements.aiAnswer.style.display = 'block';
            }

            elements.aiAnswer.innerHTML = renderMarkdown(fullContent);
            if (webSearchSources && webSearchSources.length > 0) {
                const hasCitations =
                    /\[\d+\]/.test(fullContent) ||
                    /source|reference|cited|according to/i.test(fullContent) ||
                    webSearchSources.some((source) => fullContent.includes(source.url) || fullContent.includes(source.title));
                if (hasCitations) renderAISources(webSearchSources);
            }
        } catch (error: unknown) {
            if (error instanceof Error && error.name === 'AbortError') return;
            elements.aiLoading.style.display = 'none';
            elements.aiAnswer.style.display = 'block';
            const message = error instanceof Error ? error.message : String(error);
            elements.aiAnswer.innerHTML = `
                <div class="ai-error">
                    <span class="ai-error-icon">⚠</span>
                    <span class="ai-error-message">${deps.escapeHtml(message)}</span>
                </div>
            `;
        } finally {
            state.loading = false;
            state.abortController = null;
        }
    }

    function renderAISources(sources: AISource[]) {
        if (!sources || sources.length === 0) return;
        elements.aiPanelFooter.style.display = 'block';
        elements.aiSources.innerHTML = sources
            .map(
                (source, index) => `
            <a href="${deps.escapeHtml(source.url)}" class="ai-source-item" target="_blank" rel="noopener">
                <span class="ai-source-num">${index + 1}</span>
                <span class="ai-source-title">${deps.escapeHtml(source.title)}</span>
            </a>
        `
            )
            .join('');
    }

    function setupEvents(getQuery: () => string) {
        elements.aiBtn.addEventListener('click', () => {
            const query = getQuery().trim();
            if (query) void fetchAIAnswer(query);
        });

        elements.aiPanelClose.addEventListener('click', closeAIPanel);

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && elements.aiPanel.style.display !== 'none') closeAIPanel();
        });

        elements.aiAnswer.addEventListener('click', (e) => {
            const t = e.target;
            if (t instanceof HTMLElement && t.classList.contains('source-ref')) {
                const sourceNum = parseInt(t.dataset.source ?? '', 10);
                const sourceItem = elements.aiSources.querySelector(`.ai-source-item:nth-child(${sourceNum})`);
                if (sourceItem instanceof HTMLElement) {
                    sourceItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    sourceItem.style.animation = 'none';
                    sourceItem.offsetHeight;
                    sourceItem.style.animation = 'highlightSource 1s ease';
                }
            }
        });
    }

    function reset() {
        closeAIPanel();
    }

    return { setupEvents, fetchAIAnswer, closeAIPanel, reset };
}

function renderMarkdown(text: string): string {
    if (!text) return '';
    let html = text
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/?p>/gi, '\n\n')
        .replace(/<\/?div>/gi, '\n')
        .replace(/<strong>(.+?)<\/strong>/gi, '**$1**')
        .replace(/<b>(.+?)<\/b>/gi, '**$1**')
        .replace(/<em>(.+?)<\/em>/gi, '*$1*')
        .replace(/<i>(.+?)<\/i>/gi, '*$1*')
        .replace(/<code>(.+?)<\/code>/gi, '`$1`')
        .replace(/<a\s+href=["']([^"']+)["'][^>]*>(.+?)<\/a>/gi, '[$2]($1)')
        .replace(/<h1>(.+?)<\/h1>/gi, '# $1')
        .replace(/<h2>(.+?)<\/h2>/gi, '## $1')
        .replace(/<h3>(.+?)<\/h3>/gi, '### $1')
        .replace(/<h4>(.+?)<\/h4>/gi, '#### $1')
        .replace(/<h5>(.+?)<\/h5>/gi, '##### $1')
        .replace(/<h6>(.+?)<\/h6>/gi, '###### $1')
        .replace(/<ul>/gi, '\n')
        .replace(/<\/ul>/gi, '\n')
        .replace(/<ol>/gi, '\n')
        .replace(/<\/ol>/gi, '\n')
        .replace(/<li>(.+?)<\/li>/gi, '- $1\n')
        .replace(/<blockquote>(.+?)<\/blockquote>/gi, '> $1');

    html = escapeHtml(html);
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, _lang, code) => `<pre><code>${code.trim()}</code></pre>`);
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/^(\s*)######\s+(.+?)\s*$/gm, '$1<h6>$2</h6>');
    html = html.replace(/^(\s*)#####\s+(.+?)\s*$/gm, '$1<h5>$2</h5>');
    html = html.replace(/^(\s*)####\s+(.+?)\s*$/gm, '$1<h4>$2</h4>');
    html = html.replace(/^(\s*)###\s+(.+?)\s*$/gm, '$1<h3>$2</h3>');
    html = html.replace(/^(\s*)##\s+(.+?)\s*$/gm, '$1<h2>$2</h2>');
    html = html.replace(/^(\s*)#\s+(.+?)\s*$/gm, '$1<h1>$2</h1>');
    html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    html = html.replace(/\[(\d+)\]/g, '<span class="source-ref" data-source="$1">$1</span>');
    html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
    html = html.replace(/^[\-\*] (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
    html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
    html = html.replace(/\n\n+/g, '</p><p>');
    html = '<p>' + html + '</p>';
    html = html.replace(/<p><\/p>/g, '');
    html = html.replace(/<p>\s*(<h[1-6]>)/g, '$1');
    html = html.replace(/(<\/h[1-6]>)\s*<\/p>/g, '$1');
    html = html.replace(/<p>(<(ul|pre|blockquote|table)>)/g, '$1');
    html = html.replace(/(<\/(ul|pre|blockquote|table)>)<\/p>/g, '$1');
    html = html.replace(/([^>])\n([^<])/g, '$1<br>$2');
    return html;
}

function escapeHtml(text: string): string {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
