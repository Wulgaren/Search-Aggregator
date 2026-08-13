import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUtilityAnswer } from './utility-answer';
import type { UtilityAnswerDeps, UtilityAnswerElements } from './types';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
    return {
        ok,
        status,
        json: async () => body,
    } as Response;
}

function createElements(): UtilityAnswerElements {
    const root = document.createElement('aside');
    root.style.display = 'none';
    const title = document.createElement('span');
    const content = document.createElement('div');
    root.append(title, content);
    return { root, title, content };
}

function createDeps(overrides: Partial<UtilityAnswerDeps> = {}): UtilityAnswerDeps {
    return {
        apiFetch: vi.fn(),
        takeEarlyFetch: vi.fn(async () => null),
        ...overrides,
    };
}

describe('createUtilityAnswer', () => {
    let elements: UtilityAnswerElements;
    let deps: UtilityAnswerDeps;

    beforeEach(() => {
        elements = createElements();
        deps = createDeps();
        Object.defineProperty(window.navigator, 'language', {
            configurable: true,
            get: () => 'en-US',
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('reset hides the panel and clears content', () => {
        const utility = createUtilityAnswer(elements, deps);
        utility.showEmpty('currency');
        expect(elements.root.style.display).toBe('block');

        utility.reset();

        expect(elements.root.style.display).toBe('none');
        expect(elements.title.textContent).toBe('');
        expect(elements.content.childNodes.length).toBe(0);
    });

    it('showEmpty renders kind title for each kind', () => {
        const utility = createUtilityAnswer(elements, deps);

        utility.showEmpty('currency');
        expect(elements.root.style.display).toBe('block');
        expect(elements.title.textContent).toBe('Currency');

        utility.showEmpty('translate');
        expect(elements.title.textContent).toBe('Translate');
        expect(elements.content.querySelector('.utility-translate-form')).not.toBeNull();
        expect(elements.content.querySelectorAll('.utility-translate-lang-select').length).toBe(2);

        utility.showEmpty('timezone');
        expect(elements.title.textContent).toBe('Timezone');
        expect(elements.content.querySelector('.utility-timezone-country')).not.toBeNull();
        expect(elements.content.textContent).toContain('country');
    });

    it('showEmpty translate prefills both language pickers from locale', () => {
        const utility = createUtilityAnswer(elements, deps);
        utility.showEmpty('translate');

        const selects = [
            ...elements.content.querySelectorAll<HTMLSelectElement>('.utility-translate-lang-select'),
        ];
        expect(selects).toHaveLength(2);
        expect(selects[0]?.name).toBe('from');
        expect(selects[1]?.name).toBe('to');
        expect(selects[0]?.value).toBe('en');
        expect(selects[1]?.value).toBe('es');
        expect(elements.content.textContent).toContain('languages');
    });

    it('showError renders message and up to two examples', () => {
        const utility = createUtilityAnswer(elements, deps);
        utility.showEmpty('timezone');
        utility.showError({
            message: 'Conversion failed.',
            examples: ['100 usd to eur', '5 eur to usd', 'extra ignored'],
        });

        expect(elements.root.style.display).toBe('block');
        expect(elements.content.querySelector('.utility-answer-error-message')?.textContent).toBe(
            'Conversion failed.'
        );
        const examples = [
            ...elements.content.querySelectorAll('.utility-answer-example'),
        ].map((el) => el.textContent);
        expect(examples).toEqual(['100 usd to eur', '5 eur to usd']);
    });

    it('fetchFromIntent translate success shows translated text and editable controls', async () => {
        vi.mocked(deps.apiFetch).mockResolvedValue(
            jsonResponse({
                ok: true,
                kind: 'translate',
                text: 'hello',
                from: 'en',
                to: 'fr',
                translatedText: 'bonjour',
            })
        );
        const utility = createUtilityAnswer(elements, deps);

        await utility.fetchFromIntent({ kind: 'translate', text: 'hello', to: 'fr' });

        expect(deps.apiFetch).toHaveBeenCalledWith(
            expect.stringContaining('source=utility&kind=translate')
        );
        const called = String(vi.mocked(deps.apiFetch).mock.calls[0]?.[0]);
        expect(called).toContain('text=hello');
        expect(called).toContain('from=en');
        expect(called).toContain('to=fr');
        expect(called).not.toContain('mymemory');

        expect(elements.root.style.display).toBe('block');
        expect(elements.title.textContent).toBe('Translate');
        expect(elements.content.querySelector('.utility-translate-result-text')?.textContent).toBe(
            'bonjour'
        );
        expect(elements.content.querySelector('.utility-translate-text')).not.toBeNull();
        expect(elements.content.querySelectorAll('.utility-translate-lang-select').length).toBe(2);
    });

    it('fetchFromIntent consumes takeEarlyFetch utility when present', async () => {
        const earlyResponse = jsonResponse({
            ok: true,
            kind: 'currency',
            amount: 100,
            from: 'USD',
            to: 'EUR',
            converted: 92,
            rate: 0.92,
        });
        vi.mocked(deps.takeEarlyFetch).mockResolvedValue(earlyResponse);
        const utility = createUtilityAnswer(elements, deps);

        await utility.fetchFromIntent(
            { kind: 'currency', amount: 100, from: 'USD', to: 'EUR' },
            '100 usd to eur'
        );

        expect(deps.takeEarlyFetch).toHaveBeenCalledWith('utility', '100 usd to eur');
        expect(deps.apiFetch).not.toHaveBeenCalled();
        expect(elements.content.querySelector('.utility-currency-converted')?.textContent).toMatch(
            /92/
        );
        expect(elements.content.querySelector('.utility-currency-rate')?.textContent).toContain(
            'USD'
        );
    });

    it('fetchFromIntent language empty opens translate tool without fetch', async () => {
        const utility = createUtilityAnswer(elements, deps);

        await utility.fetchFromIntent({ kind: 'empty', tool: 'language' });

        expect(deps.apiFetch).not.toHaveBeenCalled();
        expect(elements.title.textContent).toBe('Translate');
        expect(elements.content.querySelectorAll('.utility-translate-lang-select').length).toBe(2);
    });

    it('translate provider failure shows error + examples while keeping form', async () => {
        vi.mocked(deps.apiFetch).mockResolvedValue(
            jsonResponse({
                ok: false,
                kind: 'translate',
                error: 'Translation provider failed (503).',
                examples: ['translate hello to french', 'how do you say goodbye in german'],
            })
        );
        const utility = createUtilityAnswer(elements, deps);

        await utility.fetchFromIntent({ kind: 'translate', text: 'hello', from: 'en', to: 'fr' });

        expect(elements.content.querySelector('.utility-answer-error-message')?.textContent).toContain(
            '503'
        );
        expect(elements.content.querySelectorAll('.utility-answer-example').length).toBe(2);
        expect(elements.content.querySelector('.utility-translate-form')).not.toBeNull();
    });

    it('ignores stale fetchUtility responses after reset', async () => {
        let resolveFetch: ((value: Response) => void) | undefined;
        vi.mocked(deps.apiFetch).mockImplementation(
            () =>
                new Promise<Response>((resolve) => {
                    resolveFetch = resolve;
                })
        );
        const utility = createUtilityAnswer(elements, deps);

        const pending = utility.fetchFromIntent({ kind: 'timezone', country: 'jp' });
        utility.reset();
        resolveFetch?.(
            jsonResponse({
                ok: true,
                kind: 'timezone',
                country: 'jp',
                countryLabel: 'Japan',
                zones: [
                    {
                        id: 'Asia/Tokyo',
                        label: 'Japan',
                        localTime: '01:00',
                        offset: 'GMT+9',
                    },
                ],
            })
        );
        await pending;

        expect(elements.root.style.display).toBe('none');
        expect(elements.content.childNodes.length).toBe(0);
    });

    it('fetchFromIntent timezone renders zone rows from success payload', async () => {
        vi.mocked(deps.apiFetch).mockResolvedValue(
            jsonResponse({
                ok: true,
                kind: 'timezone',
                country: 'us',
                countryLabel: 'United States',
                zones: [
                    {
                        id: 'America/New_York',
                        label: 'Eastern',
                        localTime: '12:00',
                        offset: 'GMT-4',
                    },
                    {
                        id: 'America/Los_Angeles',
                        label: 'Pacific',
                        localTime: '09:00',
                        offset: 'GMT-7',
                    },
                ],
            })
        );
        const utility = createUtilityAnswer(elements, deps);

        await utility.fetchFromIntent({ kind: 'timezone', country: 'us' });

        expect(deps.apiFetch).toHaveBeenCalledWith(
            '/api/search?q=us&source=utility&kind=timezone&country=us'
        );
        expect(elements.title.textContent).toBe('Timezone');
        expect(elements.content.querySelectorAll('.utility-timezone-zone').length).toBe(2);
        expect(elements.content.textContent).toContain('Eastern');
        expect(elements.content.querySelector('.utility-timezone-country')).not.toBeNull();
    });

    it('fetchFromIntent empty timezone opens country tool and fetches locale default', async () => {
        Object.defineProperty(window.navigator, 'language', {
            configurable: true,
            get: () => 'ja-JP',
        });
        vi.mocked(deps.apiFetch).mockResolvedValue(
            jsonResponse({
                ok: true,
                kind: 'timezone',
                country: 'jp',
                countryLabel: 'Japan',
                zones: [
                    {
                        id: 'Asia/Tokyo',
                        label: 'Japan',
                        localTime: '01:00',
                        offset: 'GMT+9',
                    },
                ],
            })
        );
        const utility = createUtilityAnswer(elements, deps);

        await utility.fetchFromIntent({ kind: 'empty', tool: 'timezone' });

        expect(deps.apiFetch).toHaveBeenCalledWith(
            '/api/search?q=jp&source=utility&kind=timezone&country=jp'
        );
        expect(elements.content.querySelectorAll('.utility-timezone-zone').length).toBe(1);
        expect(elements.content.querySelector('.utility-timezone-zone-label')).toBeNull();
        expect(elements.content.querySelector('.utility-timezone-zone--solo')).not.toBeNull();
        const select = elements.content.querySelector('.utility-timezone-country');
        expect(select).toBeInstanceOf(HTMLSelectElement);
        if (!(select instanceof HTMLSelectElement)) {
            throw new Error('expected timezone country select');
        }
        expect(select.value).toBe('jp');
    });

    it('changing country in timezone tool refreshes the answer', async () => {
        vi.mocked(deps.apiFetch)
            .mockResolvedValueOnce(
                jsonResponse({
                    ok: true,
                    kind: 'timezone',
                    country: 'jp',
                    countryLabel: 'Japan',
                    zones: [
                        {
                            id: 'Asia/Tokyo',
                            label: 'Japan',
                            localTime: '01:00',
                            offset: 'GMT+9',
                        },
                    ],
                })
            )
            .mockResolvedValueOnce(
                jsonResponse({
                    ok: true,
                    kind: 'timezone',
                    country: 'us',
                    countryLabel: 'United States',
                    zones: [
                        {
                            id: 'America/New_York',
                            label: 'Eastern',
                            localTime: '12:00',
                            offset: 'GMT-4',
                        },
                        {
                            id: 'America/Chicago',
                            label: 'Central',
                            localTime: '11:00',
                            offset: 'GMT-5',
                        },
                    ],
                })
            );
        const utility = createUtilityAnswer(elements, deps);
        await utility.fetchFromIntent({ kind: 'timezone', country: 'jp' });

        const select = elements.content.querySelector('.utility-timezone-country');
        expect(select).toBeInstanceOf(HTMLSelectElement);
        if (!(select instanceof HTMLSelectElement)) return;
        select.value = 'us';
        select.dispatchEvent(new Event('change'));
        await vi.waitFor(() => {
            expect(elements.content.querySelectorAll('.utility-timezone-zone').length).toBe(2);
        });
        expect(deps.apiFetch).toHaveBeenLastCalledWith(
            '/api/search?q=us&source=utility&kind=timezone&country=us'
        );
    });

    it('timezone failure keeps controls and shows error + examples', async () => {
        vi.mocked(deps.apiFetch).mockResolvedValue(
            jsonResponse({
                ok: false,
                error: 'Unknown country. Try a country name or ISO code (e.g. japan, us).',
                examples: ['time in japan', 'time in usa'],
                kind: 'timezone',
            })
        );
        const utility = createUtilityAnswer(elements, deps);
        await utility.fetchFromIntent({ kind: 'timezone', country: 'xx' });

        expect(elements.content.querySelector('.utility-timezone-country')).not.toBeNull();
        expect(elements.content.querySelector('.utility-answer-error-message')?.textContent).toMatch(
            /unknown country/i
        );
        const examples = [
            ...elements.content.querySelectorAll('.utility-answer-example'),
        ].map((el) => el.textContent);
        expect(examples).toEqual(['time in japan', 'time in usa']);
    });
});
