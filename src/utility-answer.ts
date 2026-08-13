import type {
    UtilityAnswerDeps,
    UtilityAnswerElements,
    UtilityCurrencySuccessView,
    UtilityErrorView,
    UtilityKind,
    UtilityTimezoneSuccessView,
    UtilityTimezoneZoneView,
    UtilityTranslateSuccessView,
} from './types';
import type { UtilityIntent } from './utility-intent';
import {
    currencyDefaultsFromLocale,
    FRANKFURTER_CURRENCY_CODES,
    languageDefaultsFromLocale,
    UTILITY_LANGUAGE_OPTIONS,
} from './utility-intent';
import {
    buildCurrencyUtilityPath,
    buildTimezoneUtilityPath,
    buildTranslateUtilityPath,
    defaultCountryFromLocale,
} from './utility-early-path';
import {
    isTimezoneCountry,
    listTimezoneCountryCodes,
} from '../lib/country-timezones.ts';
import { asArray, isRecord, readNumber, readString } from './unknown';

export { defaultCountryFromLocale } from './utility-early-path';

const KIND_LABELS: Record<UtilityKind, string> = {
    currency: 'Currency',
    translate: 'Translate',
    timezone: 'Timezone',
};

const EMPTY_HINTS: Record<UtilityKind, string> = {
    currency: 'Enter an amount and currencies to convert.',
    translate: 'Enter text and choose source and target languages.',
    timezone: 'Choose a country to see local time.',
};

const DEFAULT_EXAMPLES = ['100 usd to eur', 'translate hello to french'] as const;
const TIMEZONE_EXAMPLES = ['time in japan', 'time in usa'] as const;
const TRANSLATE_EXAMPLES = ['translate hello to french', 'how do you say goodbye in german'] as const;
const CURRENCY_EXAMPLES = ['100 usd to eur', '5 eur to usd'] as const;

type TranslateFormState = {
    text: string;
    from: string;
    to: string;
    translatedText: string | null;
};

type CurrencyFormState = {
    amount: number;
    from: string;
    to: string;
    result: UtilityCurrencySuccessView | null;
};

export function createUtilityAnswer(elements: UtilityAnswerElements, deps: UtilityAnswerDeps) {
    let activeRequestId = 0;
    let visibleKind: UtilityKind | null = null;
    let selectedCountry = defaultCountryFromLocale();
    let translateState: TranslateFormState | null = null;
    let currencyState: CurrencyFormState | null = null;

    function reset() {
        activeRequestId += 1;
        visibleKind = null;
        selectedCountry = defaultCountryFromLocale();
        translateState = null;
        currencyState = null;
        elements.title.textContent = '';
        elements.content.replaceChildren();
        elements.root.style.display = 'none';
    }

    function showEmpty(kind: UtilityKind) {
        visibleKind = kind;
        elements.title.textContent = KIND_LABELS[kind];
        if (kind === 'timezone') {
            renderTimezoneTool(selectedCountry, null);
            return;
        }
        if (kind === 'translate') {
            const defaults = languageDefaultsFromLocale();
            renderTranslateForm({
                text: '',
                from: defaults.from,
                to: defaults.to,
                translatedText: null,
            });
            return;
        }
        if (kind === 'currency') {
            const defaults = currencyDefaultsFromLocale();
            renderCurrencyForm({
                amount: defaults.amount,
                from: defaults.from,
                to: defaults.to,
                result: null,
            });
            return;
        }
        elements.content.replaceChildren();
        const hint = document.createElement('p');
        hint.className = 'utility-answer-empty-hint';
        hint.textContent = EMPTY_HINTS[kind];
        elements.content.appendChild(hint);
        elements.root.style.display = 'block';
    }

    function showError(view: UtilityErrorView) {
        elements.title.textContent = visibleKind ? KIND_LABELS[visibleKind] : 'Utility';

        if (visibleKind === 'timezone') {
            renderTimezoneTool(selectedCountry, null, view);
            return;
        }
        if (visibleKind === 'translate' && translateState) {
            renderTranslateForm({ ...translateState, translatedText: null }, view);
            return;
        }
        if (visibleKind === 'currency' && currencyState) {
            renderCurrencyForm({ ...currencyState, result: null }, view);
            return;
        }

        elements.content.replaceChildren();
        elements.content.appendChild(buildErrorBlock(view));
        elements.root.style.display = 'block';
    }

    function renderCurrencyForm(state: CurrencyFormState, error?: UtilityErrorView) {
        currencyState = { ...state };
        visibleKind = 'currency';
        elements.title.textContent = KIND_LABELS.currency;
        elements.content.replaceChildren();

        const form = document.createElement('form');
        form.className = 'utility-currency-form';
        form.addEventListener('submit', (event) => {
            event.preventDefault();
            const next = readCurrencyForm(form);
            if (!next) return;
            void fetchCurrency(next);
        });

        const amountField = document.createElement('label');
        amountField.className = 'utility-currency-field';
        const amountLabel = document.createElement('span');
        amountLabel.className = 'utility-currency-field-label';
        amountLabel.textContent = 'Amount';
        const amountInput = document.createElement('input');
        amountInput.type = 'number';
        amountInput.name = 'amount';
        amountInput.className = 'utility-currency-amount';
        amountInput.min = '0';
        amountInput.step = 'any';
        amountInput.required = true;
        amountInput.value = String(state.amount);
        amountInput.setAttribute('aria-label', 'Amount');
        amountField.append(amountLabel, amountInput);

        const fromSelect = buildCurrencySelect('from', 'From', state.from);
        const toSelect = buildCurrencySelect('to', 'To', state.to);

        const actions = document.createElement('div');
        actions.className = 'utility-currency-actions';
        const submit = document.createElement('button');
        submit.type = 'submit';
        submit.className = 'utility-currency-submit';
        submit.textContent = 'Convert';
        actions.appendChild(submit);

        const row = document.createElement('div');
        row.className = 'utility-currency-controls';
        row.append(amountField, fromSelect.wrap, toSelect.wrap, actions);
        form.appendChild(row);
        elements.content.appendChild(form);

        if (error) {
            elements.content.appendChild(buildErrorBlock(error));
        } else if (state.result) {
            elements.content.appendChild(buildCurrencyResult(state.result));
        } else {
            const hint = document.createElement('p');
            hint.className = 'utility-answer-empty-hint';
            hint.textContent = EMPTY_HINTS.currency;
            elements.content.appendChild(hint);
        }

        elements.root.style.display = 'block';
    }

    function buildCurrencySelect(
        name: 'from' | 'to',
        labelText: string,
        selected: string
    ): { wrap: HTMLElement; select: HTMLSelectElement } {
        const wrap = document.createElement('label');
        wrap.className = 'utility-currency-field';
        const label = document.createElement('span');
        label.className = 'utility-currency-field-label';
        label.textContent = labelText;
        const select = document.createElement('select');
        select.className = 'utility-currency-select';
        select.name = name;
        select.setAttribute('aria-label', labelText);

        const codes: string[] = [...FRANKFURTER_CURRENCY_CODES];
        if (selected && !codes.includes(selected)) {
            codes.unshift(selected);
        }
        for (const code of codes) {
            const option = document.createElement('option');
            option.value = code;
            option.textContent = code;
            if (code === selected) option.selected = true;
            select.appendChild(option);
        }
        wrap.append(label, select);
        return { wrap, select };
    }

    function readCurrencyForm(form: HTMLFormElement): {
        amount: number;
        from: string;
        to: string;
    } | null {
        const data = new FormData(form);
        const amountRaw = data.get('amount');
        const fromRaw = data.get('from');
        const toRaw = data.get('to');
        if (typeof amountRaw !== 'string' || typeof fromRaw !== 'string' || typeof toRaw !== 'string') {
            return null;
        }
        const amount = Number(amountRaw);
        if (!Number.isFinite(amount) || amount <= 0) return null;
        return { amount, from: fromRaw.trim().toUpperCase(), to: toRaw.trim().toUpperCase() };
    }

    function buildCurrencyResult(result: UtilityCurrencySuccessView): HTMLElement {
        const wrap = document.createElement('div');
        wrap.className = 'utility-currency-result';

        const converted = document.createElement('p');
        converted.className = 'utility-currency-converted';
        converted.textContent = formatMoney(result.converted, result.to);

        const rate = document.createElement('p');
        rate.className = 'utility-currency-rate';
        rate.textContent = `1 ${result.from} = ${formatRate(result.rate)} ${result.to}`;

        wrap.append(converted, rate);
        return wrap;
    }

    async function fetchCurrency(
        input: { amount: number; from: string; to: string },
        searchQuery?: string
    ) {
        const requestId = ++activeRequestId;
        visibleKind = 'currency';
        currencyState = {
            amount: input.amount,
            from: input.from,
            to: input.to,
            result: null,
        };
        renderCurrencyForm(currencyState);

        try {
            const path = buildCurrencyUtilityPath(input);
            let response: Response | null = null;
            if (searchQuery) {
                response = await deps.takeEarlyFetch('utility', searchQuery);
            }
            if (!response) response = await deps.apiFetch(path);
            if (requestId !== activeRequestId) return;
            if (!response.ok) {
                showError({
                    message: `Currency conversion failed (${String(response.status)}).`,
                    examples: [...CURRENCY_EXAMPLES],
                });
                return;
            }
            const data: unknown = await response.json();
            if (requestId !== activeRequestId) return;
            const parsed = parseCurrencyResponse(data);
            if (!parsed.ok) {
                showError(parsed.error);
                return;
            }
            renderCurrencyForm({
                amount: parsed.value.amount,
                from: parsed.value.from,
                to: parsed.value.to,
                result: parsed.value,
            });
        } catch (error) {
            console.error('Error fetching currency utility:', error);
            if (requestId !== activeRequestId) return;
            showError({
                message: error instanceof Error ? error.message : 'Currency conversion failed.',
                examples: [...CURRENCY_EXAMPLES],
            });
        }
    }

    function renderTranslateForm(state: TranslateFormState, error?: UtilityErrorView) {
        translateState = { ...state };
        visibleKind = 'translate';
        elements.title.textContent = KIND_LABELS.translate;
        elements.content.replaceChildren();

        const form = document.createElement('form');
        form.className = 'utility-translate-form';
        form.addEventListener('submit', (event) => {
            event.preventDefault();
            const next = readTranslateForm(form);
            if (!next) return;
            void fetchTranslate(next);
        });

        const textLabel = document.createElement('label');
        textLabel.className = 'utility-translate-label';
        textLabel.htmlFor = 'utility-translate-text';
        textLabel.textContent = 'Text';

        const textArea = document.createElement('textarea');
        textArea.id = 'utility-translate-text';
        textArea.className = 'utility-translate-text';
        textArea.name = 'text';
        textArea.rows = 3;
        textArea.value = state.text;
        textArea.placeholder = 'Text to translate';

        const langs = document.createElement('div');
        langs.className = 'utility-translate-langs';
        langs.append(
            buildLangSelect('from', 'From', state.from).wrap,
            buildLangSelect('to', 'To', state.to).wrap
        );

        const actions = document.createElement('div');
        actions.className = 'utility-translate-actions';
        const submit = document.createElement('button');
        submit.type = 'submit';
        submit.className = 'utility-translate-submit';
        submit.textContent = 'Translate';
        actions.appendChild(submit);

        form.append(textLabel, textArea, langs, actions);
        elements.content.appendChild(form);

        if (error) {
            elements.content.appendChild(buildErrorBlock(error));
        } else if (state.translatedText !== null) {
            const result = document.createElement('div');
            result.className = 'utility-translate-result';
            const resultLabel = document.createElement('div');
            resultLabel.className = 'utility-translate-result-label';
            resultLabel.textContent = 'Translation';
            const resultText = document.createElement('p');
            resultText.className = 'utility-translate-result-text';
            resultText.textContent = state.translatedText;
            result.append(resultLabel, resultText);
            elements.content.appendChild(result);
        } else if (!state.text.trim()) {
            const hint = document.createElement('p');
            hint.className = 'utility-answer-empty-hint';
            hint.textContent = EMPTY_HINTS.translate;
            elements.content.appendChild(hint);
        }

        elements.root.style.display = 'block';
    }

    function buildLangSelect(
        name: 'from' | 'to',
        labelText: string,
        selected: string
    ): { wrap: HTMLElement; select: HTMLSelectElement } {
        const wrap = document.createElement('label');
        wrap.className = 'utility-translate-lang';
        const label = document.createElement('span');
        label.className = 'utility-translate-lang-label';
        label.textContent = labelText;

        const select = document.createElement('select');
        select.className = 'utility-translate-lang-select';
        select.name = name;
        select.setAttribute('aria-label', labelText);

        const options = [...UTILITY_LANGUAGE_OPTIONS];
        if (selected && !options.some((o) => o.code === selected)) {
            options.unshift({ code: selected, label: selected });
        }
        for (const opt of options) {
            const option = document.createElement('option');
            option.value = opt.code;
            option.textContent = opt.label;
            if (opt.code === selected) option.selected = true;
            select.appendChild(option);
        }

        wrap.append(label, select);
        return { wrap, select };
    }

    function readTranslateForm(form: HTMLFormElement): TranslateFormState | null {
        const data = new FormData(form);
        const textRaw = data.get('text');
        const fromRaw = data.get('from');
        const toRaw = data.get('to');
        if (typeof textRaw !== 'string' || typeof fromRaw !== 'string' || typeof toRaw !== 'string') {
            return null;
        }
        return {
            text: textRaw,
            from: fromRaw,
            to: toRaw,
            translatedText: translateState?.translatedText ?? null,
        };
    }

    async function fetchTranslate(
        input: { text: string; from: string; to: string },
        searchQuery?: string
    ) {
        const requestId = ++activeRequestId;
        visibleKind = 'translate';
        translateState = {
            text: input.text,
            from: input.from,
            to: input.to,
            translatedText: null,
        };

        const trimmed = input.text.trim();
        if (!trimmed) {
            showError({
                message: 'Enter text to translate.',
                examples: [...TRANSLATE_EXAMPLES],
            });
            return;
        }
        if (!input.from || !input.to) {
            showError({
                message: 'Choose both source and target languages.',
                examples: [...TRANSLATE_EXAMPLES],
            });
            return;
        }
        if (input.from === input.to) {
            showError({
                message: 'Source and target languages must differ.',
                examples: [...TRANSLATE_EXAMPLES],
            });
            return;
        }

        try {
            const path = buildTranslateUtilityPath({
                text: trimmed,
                from: input.from,
                to: input.to,
            });
            let response: Response | null = null;
            if (searchQuery) {
                response = await deps.takeEarlyFetch('utility', searchQuery);
            }
            if (!response) response = await deps.apiFetch(path);
            if (requestId !== activeRequestId) return;
            if (!response.ok) {
                showError({
                    message: `Translation failed (${String(response.status)}).`,
                    examples: [...TRANSLATE_EXAMPLES],
                });
                return;
            }
            const data: unknown = await response.json();
            if (requestId !== activeRequestId) return;
            const parsed = parseTranslateResponse(data);
            if (!parsed.ok) {
                showError(parsed.error);
                return;
            }
            renderTranslateForm({
                text: parsed.value.text,
                from: parsed.value.from,
                to: parsed.value.to,
                translatedText: parsed.value.translatedText,
            });
        } catch (error) {
            console.error('Error fetching translation:', error);
            if (requestId !== activeRequestId) return;
            showError({
                message: error instanceof Error ? error.message : 'Translation request failed.',
                examples: [...TRANSLATE_EXAMPLES],
            });
        }
    }

    function renderTimezoneTool(
        country: string,
        answer: UtilityTimezoneSuccessView | null,
        error?: UtilityErrorView
    ) {
        visibleKind = 'timezone';
        selectedCountry = country;
        elements.title.textContent = KIND_LABELS.timezone;
        elements.content.replaceChildren();

        const root = document.createElement('div');
        root.className = 'utility-timezone';

        const controls = document.createElement('div');
        controls.className = 'utility-timezone-controls';

        const label = document.createElement('label');
        label.className = 'utility-timezone-field';
        const labelText = document.createElement('span');
        labelText.className = 'utility-timezone-field-label';
        labelText.textContent = 'Country';
        const select = document.createElement('select');
        select.className = 'utility-timezone-country';
        select.setAttribute('aria-label', 'Country');
        fillCountrySelect(select, country);
        label.append(labelText, select);

        const refresh = document.createElement('button');
        refresh.type = 'button';
        refresh.className = 'utility-timezone-refresh';
        refresh.textContent = 'Show time';

        controls.append(label, refresh);
        root.appendChild(controls);

        if (error) {
            root.appendChild(buildErrorBlock(error));
        } else if (answer) {
            root.appendChild(buildZonesList(answer));
        } else {
            const hint = document.createElement('p');
            hint.className = 'utility-answer-empty-hint';
            hint.textContent = EMPTY_HINTS.timezone;
            root.appendChild(hint);
        }

        const run = () => {
            const next = select.value.trim().toLowerCase();
            if (!next) return;
            void fetchTimezone(next);
        };
        select.addEventListener('change', run);
        refresh.addEventListener('click', run);

        elements.content.appendChild(root);
        elements.root.style.display = 'block';
    }

    function buildZonesList(answer: UtilityTimezoneSuccessView): HTMLElement {
        const list = document.createElement('ul');
        list.className = 'utility-timezone-zones';
        list.setAttribute('aria-label', `Local time in ${answer.countryLabel}`);

        for (const zone of answer.zones) {
            list.appendChild(buildZoneRow(zone));
        }
        return list;
    }

    function buildZoneRow(zone: UtilityTimezoneZoneView): HTMLElement {
        const item = document.createElement('li');
        item.className = 'utility-timezone-zone';

        const label = document.createElement('span');
        label.className = 'utility-timezone-zone-label';
        label.textContent = zone.label;

        const time = document.createElement('span');
        time.className = 'utility-timezone-zone-time';
        time.textContent = zone.localTime;

        const offset = document.createElement('span');
        offset.className = 'utility-timezone-zone-offset';
        offset.textContent = zone.offset;

        item.append(label, time, offset);
        return item;
    }

    function buildErrorBlock(view: UtilityErrorView): HTMLElement {
        const wrap = document.createElement('div');
        wrap.className = 'utility-answer-error';

        const message = document.createElement('p');
        message.className = 'utility-answer-error-message';
        message.textContent = view.message;
        wrap.appendChild(message);

        const examples = view.examples.slice(0, 2);
        if (examples.length > 0) {
            const list = document.createElement('ul');
            list.className = 'utility-answer-examples';
            for (const example of examples) {
                const item = document.createElement('li');
                item.className = 'utility-answer-example';
                item.textContent = example;
                list.appendChild(item);
            }
            wrap.appendChild(list);
        }
        return wrap;
    }

    async function fetchTimezone(country: string, searchQuery?: string) {
        const requestId = ++activeRequestId;
        visibleKind = 'timezone';
        selectedCountry = country;
        renderTimezoneTool(country, null);

        try {
            const path = buildTimezoneUtilityPath(country);
            let response: Response | null = null;
            if (searchQuery) {
                response = await deps.takeEarlyFetch('utility', searchQuery);
            }
            if (!response) response = await deps.apiFetch(path);
            if (requestId !== activeRequestId) return;
            if (!response.ok) {
                showError({
                    message: `Timezone request failed (${String(response.status)}).`,
                    examples: [...TIMEZONE_EXAMPLES],
                });
                return;
            }
            const data: unknown = await response.json();
            if (requestId !== activeRequestId) return;
            const parsed = parseTimezonePayload(data);
            if (!parsed.ok) {
                showError(parsed.error);
                return;
            }
            renderTimezoneTool(parsed.view.country, parsed.view);
        } catch (error) {
            console.error('Error fetching timezone utility:', error);
            if (requestId !== activeRequestId) return;
            showError({
                message: error instanceof Error ? error.message : 'Timezone request failed.',
                examples: [...TIMEZONE_EXAMPLES],
            });
        }
    }

    /** Intent → utility card. Clear kind branches for Issues 3–5. */
    async function fetchFromIntent(intent: UtilityIntent, searchQuery?: string) {
        if (intent.kind === 'timezone') {
            await fetchTimezone(intent.country, searchQuery);
            return;
        }
        if (intent.kind === 'currency') {
            await fetchCurrency(
                {
                    amount: intent.amount,
                    from: intent.from,
                    to: intent.to,
                },
                searchQuery
            );
            return;
        }
        if (intent.kind === 'translate') {
            const defaults = languageDefaultsFromLocale();
            const from = intent.from ?? defaults.from;
            const to = intent.to ?? (intent.from === defaults.to ? defaults.from : defaults.to);
            const text = intent.text.trim();
            if (!text) {
                renderTranslateForm({ text: '', from, to, translatedText: null });
                return;
            }
            await fetchTranslate({ text, from, to }, searchQuery);
            return;
        }
        if (intent.kind === 'empty') {
            if (intent.tool === 'timezone') {
                await fetchTimezone(defaultCountryFromLocale(), searchQuery);
                return;
            }
            if (intent.tool === 'language') {
                showEmpty('translate');
                return;
            }
            showEmpty(intent.tool);
        }
    }

    async function fetchUtility(kind?: UtilityKind) {
        if (kind === 'translate') {
            showEmpty('translate');
            return;
        }
        if (kind === 'currency') {
            showEmpty('currency');
            return;
        }
        if (kind === 'timezone') {
            await fetchTimezone(defaultCountryFromLocale());
            return;
        }
        const requestId = ++activeRequestId;
        if (kind) visibleKind = kind;
        try {
            const params = new URLSearchParams({
                q: kind ?? 'utility',
                source: 'utility',
            });
            if (kind) params.set('kind', kind);
            const response = await deps.apiFetch(`/api/search?${params.toString()}`);
            if (requestId !== activeRequestId) return;
            if (!response.ok) {
                showError({
                    message: `Utility request failed (${String(response.status)}).`,
                    examples: [...DEFAULT_EXAMPLES],
                });
                return;
            }
            const data: unknown = await response.json();
            if (requestId !== activeRequestId) return;
            showError(parseStubError(data));
        } catch (error) {
            console.error('Error fetching utility answer:', error);
            if (requestId !== activeRequestId) return;
            showError({
                message: error instanceof Error ? error.message : 'Utility request failed.',
                examples: [...DEFAULT_EXAMPLES],
            });
        }
    }

    return {
        reset,
        showEmpty,
        showError,
        fetchUtility,
        fetchFromIntent,
        fetchTimezone,
        fetchCurrency,
    };
}

function fillCountrySelect(select: HTMLSelectElement, selected: string): void {
    const display = new Intl.DisplayNames(['en'], { type: 'region' });
    const codes = listTimezoneCountryCodes();
    const preferred = selected.toLowerCase();
    for (const code of codes) {
        const option = document.createElement('option');
        option.value = code;
        const name = display.of(code.toUpperCase()) ?? code.toUpperCase();
        option.textContent = name;
        if (code === preferred) option.selected = true;
        select.appendChild(option);
    }
    if (!isTimezoneCountry(preferred) && codes[0]) {
        select.value = codes[0];
    }
}

function parseTimezonePayload(
    data: unknown
):
    | { ok: true; view: UtilityTimezoneSuccessView }
    | { ok: false; error: UtilityErrorView } {
    if (!isRecord(data)) {
        return {
            ok: false,
            error: {
                message: 'Timezone unavailable.',
                examples: [...TIMEZONE_EXAMPLES],
            },
        };
    }
    if (data['ok'] === true) {
        const country = readString(data, 'country');
        const countryLabel = readString(data, 'countryLabel');
        const rawZones = asArray(data['zones']);
        if (!country || !countryLabel || !rawZones) {
            return {
                ok: false,
                error: {
                    message: 'Timezone response was incomplete.',
                    examples: [...TIMEZONE_EXAMPLES],
                },
            };
        }
        const zones: UtilityTimezoneZoneView[] = [];
        for (const raw of rawZones) {
            if (!isRecord(raw)) continue;
            const id = readString(raw, 'id');
            const label = readString(raw, 'label');
            const localTime = readString(raw, 'localTime');
            const offset = readString(raw, 'offset');
            if (!id || !label || !localTime) continue;
            zones.push({ id, label, localTime, offset: offset ?? '' });
        }
        if (zones.length === 0) {
            return {
                ok: false,
                error: {
                    message: 'No timezone rows returned.',
                    examples: [...TIMEZONE_EXAMPLES],
                },
            };
        }
        return { ok: true, view: { country, countryLabel, zones } };
    }

    return { ok: false, error: parseStubError(data, TIMEZONE_EXAMPLES) };
}

function parseTranslateResponse(
    data: unknown
): { ok: true; value: UtilityTranslateSuccessView } | { ok: false; error: UtilityErrorView } {
    if (!isRecord(data)) {
        return {
            ok: false,
            error: {
                message: 'Invalid translation response.',
                examples: [...TRANSLATE_EXAMPLES],
            },
        };
    }
    if (data['ok'] === true) {
        const text = readString(data, 'text');
        const from = readString(data, 'from');
        const to = readString(data, 'to');
        const translatedText = readString(data, 'translatedText');
        if (text && from && to && translatedText) {
            return {
                ok: true,
                value: { text, from, to, translatedText },
            };
        }
        return {
            ok: false,
            error: {
                message: 'Invalid translation response.',
                examples: [...TRANSLATE_EXAMPLES],
            },
        };
    }
    return {
        ok: false,
        error: {
            message: readString(data, 'error') ?? 'Translation failed.',
            examples: readExamples(data, TRANSLATE_EXAMPLES),
        },
    };
}

function parseCurrencyResponse(
    data: unknown
): { ok: true; value: UtilityCurrencySuccessView } | { ok: false; error: UtilityErrorView } {
    if (!isRecord(data)) {
        return {
            ok: false,
            error: {
                message: 'Invalid currency response.',
                examples: [...CURRENCY_EXAMPLES],
            },
        };
    }
    if (data['ok'] === true) {
        const amount = readNumber(data, 'amount');
        const from = readString(data, 'from');
        const to = readString(data, 'to');
        const converted = readNumber(data, 'converted');
        const rate = readNumber(data, 'rate');
        if (
            amount !== undefined &&
            from &&
            to &&
            converted !== undefined &&
            rate !== undefined
        ) {
            return {
                ok: true,
                value: { amount, from, to, converted, rate },
            };
        }
        return {
            ok: false,
            error: {
                message: 'Invalid currency response.',
                examples: [...CURRENCY_EXAMPLES],
            },
        };
    }
    return {
        ok: false,
        error: {
            message: readString(data, 'error') ?? 'Currency conversion failed.',
            examples: readExamples(data, CURRENCY_EXAMPLES),
        },
    };
}

function formatMoney(value: number, currency: string): string {
    try {
        return new Intl.NumberFormat(undefined, {
            style: 'currency',
            currency,
            maximumFractionDigits: 6,
        }).format(value);
    } catch {
        return `${String(value)} ${currency}`;
    }
}

function formatRate(rate: number): string {
    if (!Number.isFinite(rate)) return String(rate);
    const abs = Math.abs(rate);
    const digits = abs >= 1 ? 4 : abs >= 0.01 ? 6 : 8;
    return rate.toFixed(digits).replace(/\.?0+$/, '');
}

function readExamples(
    data: Record<string, unknown>,
    fallback: readonly string[]
): string[] {
    const rawExamples = asArray(data['examples']);
    const examples: string[] = [];
    if (rawExamples) {
        for (const item of rawExamples) {
            if (typeof item === 'string' && item.trim()) examples.push(item.trim());
            if (examples.length >= 2) break;
        }
    }
    return examples.length > 0 ? examples : [...fallback];
}

function parseStubError(
    data: unknown,
    fallbackExamples: readonly string[] = DEFAULT_EXAMPLES
): UtilityErrorView {
    if (!isRecord(data)) {
        return {
            message: 'Utility unavailable.',
            examples: [...fallbackExamples],
        };
    }
    const error = readString(data, 'error') ?? 'Utility unavailable.';
    const message =
        error === 'not_implemented' ? 'This utility is not available yet.' : error;
    return {
        message,
        examples: readExamples(data, fallbackExamples),
    };
}
