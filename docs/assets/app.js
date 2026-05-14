(function () {
  const DATA_URL = 'data/tales.json';
  const OVERVIEW_URL = 'data/overview.json';
  const QUESTIONS_URL = 'data/questions.json';
  const LANGUAGES = {
    pt: {
      label: 'Português BR',
      targetName: 'Brazilian Portuguese',
      rewriteName: 'portugues brasileiro',
    },
    es: {
      label: 'Español',
      targetName: 'Spanish',
      rewriteName: 'espanol',
    },
    fr: {
      label: 'Français',
      targetName: 'French',
      rewriteName: 'frances',
    },
    it: {
      label: 'Italiano',
      targetName: 'Italian',
      rewriteName: 'italiano',
    },
    de: {
      label: 'Deutsch',
      targetName: 'German',
      rewriteName: 'alemao',
    },
    ja: {
      label: '日本語',
      targetName: 'Japanese',
      rewriteName: 'japones',
    },
  };
  const LANGUAGE_MODEL_OUTPUTS = new Set(['es', 'ja']);
  const LANGUAGE_MODEL_TRANSLATION_MAX_CHUNKS = 1;
  const LANGUAGE_MODEL_TRANSLATION_CHAR_LIMIT = 650;
  const LANGUAGE_MODEL_TIMEOUT_MS = 60000;
  const TRANSLATOR_TIMEOUT_MS = 15000;
  const TRANSLATOR_CREATE_TIMEOUT_MS = 15000;
  const TRANSLATOR_HEALTHCHECK_TIMEOUT_MS = 10000;
  const TRANSLATOR_CHUNK_LIMIT = 900;
  const TRANSLATOR_HEALTHCHECK_TEXT = 'Hello.';
  const TRANSLATOR_SERVICE_FAILURE_RE = /crash|service|timed out|abort/i;
  const cache = new Map();
  const translatorFailures = new Map();
  let state = {
    data: null,
    tale: null,
    tab: 'original',
    language: 'pt',
    translated: '',
    friendly: '',
    status: '',
    error: '',
    diagnostics: '',
    busy: false,
  };

  const $ = (selector, root = document) => root.querySelector(selector);

  function formatNumber(value) {
    if (value === null || value === undefined || value === '') return '—';
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return String(value);
    return new Intl.NumberFormat('en-US').format(numeric);
  }

  function paragraphs(text) {
    return String(text || '')
      .split(/\n{2,}/)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  function htmlText(text) {
    return paragraphs(text)
      .map((part) => `<p>${escapeHtml(part).replace(/\n/g, '<br>')}</p>`)
      .join('');
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    })[char]);
  }

  function chunks(text, limit = 2800) {
    const output = [];
    let current = '';
    for (const paragraph of paragraphs(text)) {
      const next = current ? `${current}\n\n${paragraph}` : paragraph;
      if (next.length > limit && current) {
        output.push(current);
        current = paragraph;
      } else {
        current = next;
      }
    }
    if (current) output.push(current);
    return output;
  }

  function key(kind, slug, mode = '', language = state.language) {
    return `grimm:${kind}:${slug}:${language}:${mode}`;
  }

  function setStatus(message) {
    state.status = message;
    const line = $('.status-line');
    if (line) line.textContent = message;
  }

  function setError(message) {
    state.error = message;
    state.status = '';
    render();
  }

  async function loadJson(url) {
    if (cache.has(url)) return cache.get(url);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Could not load ${url}. Run ./grimm export docs before serving this site locally.`);
    }
    const data = await response.json();
    cache.set(url, data);
    return data;
  }

  async function loadData() {
    return loadJson(DATA_URL);
  }

  function pickInitialTale(data) {
    return data.tales.find((tale) => tale.slug === 'hansel-and-gretel') || data.tales[0];
  }

  function chipList(items) {
    if (!items || !items.length) return '<span class="chip">None modelled</span>';
    return items.map((item) => `<span class="chip">${escapeHtml(item)}</span>`).join('');
  }

  function facetPanel(title, items) {
    return `
      <section class="facet-panel">
        <div class="facet-title">${escapeHtml(title)}</div>
        <div class="chip-list">${chipList(items)}</div>
      </section>
    `;
  }

  function sourcePanel(tale) {
    const sources = tale.sources || [];
    if (!sources.length) return facetPanel('Sources', []);
    const rows = sources.map((source) => `
      <div class="source-row">
        <div>
          <strong>${escapeHtml(source.title || source.book_tale_slug || source.book_id)}</strong>
          <div class="source-meta">${escapeHtml([
            source.book_id,
            source.weight,
            source.match_method ? `match: ${source.match_method}` : null,
          ].filter(Boolean).join(' · '))}</div>
        </div>
        ${source.is_base ? '<span class="source-badge">base</span>' : ''}
      </div>
    `).join('');
    return `
      <section class="facet-panel">
        <div class="facet-title">Sources</div>
        <div class="source-list">${rows}</div>
      </section>
    `;
  }

  function branchPanel(tale) {
    const count = tale.branches?.length || 0;
    return `
      <section class="facet-panel">
        <div class="facet-title">Branches</div>
        <div class="metric-inline">${formatNumber(count)} recorded branch${count === 1 ? '' : 'es'}</div>
      </section>
    `;
  }

  function metricCard(label, value, note = '') {
    return `
      <section class="metric-card">
        <div class="metric-value">${escapeHtml(formatNumber(value))}</div>
        <div class="metric-label">${escapeHtml(label)}</div>
        ${note ? `<div class="metric-note">${escapeHtml(note)}</div>` : ''}
      </section>
    `;
  }

  function simpleTable(rows, columns) {
    if (!rows?.length) return '<div class="empty-state">No rows generated.</div>';
    return `
      <div class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr>${columns.map((col) => `<th>${escapeHtml(col.label)}</th>`).join('')}</tr>
          </thead>
          <tbody>
            ${rows.map((row) => `
              <tr>
                ${columns.map((col) => `<td>${escapeHtml(col.format ? col.format(row[col.key], row) : row[col.key] ?? '')}</td>`).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function currentText() {
    if (state.tab === 'translation') return state.translated || 'Use Translate to generate this view.';
    if (state.tab === 'friendly') return state.friendly || 'Use Friendly rewrite to generate this view.';
    return state.tale?.text || '';
  }

  function render() {
    const root = $('#tale-reader');
    if (!root) return;
    if (!state.data) {
      root.innerHTML = '<div class="tale-app">Loading tales...</div>';
      return;
    }

    const tale = state.tale;
    const options = state.data.tales
      .map((item) => `<option value="${item.slug}" ${item.slug === tale.slug ? 'selected' : ''}>${escapeHtml(item.title)}</option>`)
      .join('');
    const languageOptions = Object.entries(LANGUAGES)
      .map(([code, language]) => `<option value="${code}" ${code === state.language ? 'selected' : ''}>${escapeHtml(language.label)}</option>`)
      .join('');
    const meta = [
      tale.khm ? `KHM ${tale.khm}` : null,
      tale.atu ? `ATU ${tale.atu}` : null,
      `${tale.stats.words} words`,
    ].filter(Boolean).join(' · ');

    root.innerHTML = `
      <div class="tale-app">
        ${state.error ? `<div class="error-box">${escapeHtml(state.error)}</div>` : ''}
        <section class="tale-toolbar">
          <label class="tale-field">
            <span class="tale-label">Tale</span>
            <select data-role="tale-select">${options}</select>
          </label>
          <label class="tale-field">
            <span class="tale-label">Language</span>
            <select data-role="language-select">${languageOptions}</select>
          </label>
          <label class="tale-field">
            <span class="tale-label">Friendly mode</span>
            <select data-role="mode-select">
              <option value="clear">Clear</option>
              <option value="child">Child-friendly</option>
              <option value="modern">Modern prose</option>
              <option value="study">Study notes</option>
            </select>
          </label>
          <button class="tale-button" data-role="translate" ${state.busy ? 'disabled' : ''}>Translate</button>
          <button class="tale-button primary" data-role="friendly" ${state.busy ? 'disabled' : ''}>Friendly rewrite</button>
          <button class="tale-button" data-role="diagnostics" ${state.busy ? 'disabled' : ''}>Check browser</button>
        </section>

        <div class="status-line">${escapeHtml(state.status)}</div>
        ${state.diagnostics ? `<pre class="diagnostics-box">${escapeHtml(state.diagnostics)}</pre>` : ''}

        <section class="tale-layout">
          <article class="tale-card">
            <header class="tale-card-header">
              <div class="tale-card-title">${escapeHtml(tale.title)}</div>
              <div class="tale-meta">${escapeHtml(meta)}</div>
            </header>
            <div class="tale-tabs">
              <button class="tale-tab ${state.tab === 'original' ? 'active' : ''}" data-tab="original">Original EN</button>
              <button class="tale-tab ${state.tab === 'translation' ? 'active' : ''}" data-tab="translation">${escapeHtml(LANGUAGES[state.language].label)}</button>
              <button class="tale-tab ${state.tab === 'friendly' ? 'active' : ''}" data-tab="friendly">Friendly</button>
            </div>
            <div class="tale-text">${htmlText(currentText())}</div>
          </article>

          <aside class="tale-side">
            ${facetPanel('World Laws', tale.facets.world_laws)}
            ${facetPanel('Moral Regimes', tale.facets.moral_regimes)}
            ${facetPanel('Characters', tale.facets.characters)}
            ${facetPanel('Locations', tale.facets.locations)}
            ${sourcePanel(tale)}
            ${branchPanel(tale)}
          </aside>
        </section>
      </div>
    `;

    bindEvents(root);
  }

  function bindEvents(root) {
    $('[data-role="tale-select"]', root)?.addEventListener('change', (event) => {
      const slug = event.target.value;
      state.tale = state.data.tales.find((item) => item.slug === slug);
      state.translated = localStorage.getItem(key('translation', slug)) || '';
      state.friendly = '';
      state.tab = 'original';
      state.error = '';
      state.status = '';
      render();
    });

    $('[data-role="language-select"]', root)?.addEventListener('change', (event) => {
      state.language = event.target.value;
      state.translated = localStorage.getItem(key('translation', state.tale.slug)) || '';
      state.friendly = '';
      state.tab = state.translated ? 'translation' : 'original';
      state.error = '';
      state.status = '';
      render();
    });

    root.querySelectorAll('[data-tab]').forEach((button) => {
      button.addEventListener('click', () => {
        state.tab = button.dataset.tab;
        render();
      });
    });

    $('[data-role="translate"]', root)?.addEventListener('click', translateCurrentTale);
    $('[data-role="friendly"]', root)?.addEventListener('click', rewriteCurrentTale);
    $('[data-role="diagnostics"]', root)?.addEventListener('click', runDiagnostics);
  }

  async function translateCurrentTale() {
    if (state.busy) return;
    state.busy = true;
    try {
      state.error = '';
      state.diagnostics = '';
      render();
      const cached = localStorage.getItem(key('translation', state.tale.slug));
      if (cached) {
        state.translated = cached;
        state.tab = 'translation';
        setStatus('Loaded cached translation.');
        render();
        return;
      }
      state.translated = await translateText(state.tale.text);
      localStorage.setItem(key('translation', state.tale.slug), state.translated);
      state.tab = 'translation';
      setStatus('Translation ready.');
      render();
    } catch (error) {
      setError(error.message || String(error));
    } finally {
      state.busy = false;
      render();
    }
  }

  async function rewriteCurrentTale() {
    if (state.busy) return;
    state.busy = true;
    try {
      state.error = '';
      state.diagnostics = '';
      render();
      const mode = $('[data-role="mode-select"]')?.value || 'clear';
      const cached = localStorage.getItem(key('friendly', state.tale.slug, mode));
      if (cached) {
        state.friendly = cached;
        state.tab = 'friendly';
        setStatus('Loaded cached friendly version.');
        render();
        return;
      }

      const base = state.translated || localStorage.getItem(key('translation', state.tale.slug)) || await translateText(state.tale.text);
      state.translated = base;
      state.friendly = await friendlyText(base, mode);
      localStorage.setItem(key('translation', state.tale.slug), state.translated);
      localStorage.setItem(key('friendly', state.tale.slug, mode), state.friendly);
      state.tab = 'friendly';
      setStatus('Friendly version ready.');
      render();
    } catch (error) {
      setError(error.message || String(error));
    } finally {
      state.busy = false;
      render();
    }
  }

  async function translateText(text) {
    try {
      return await translateWithTranslatorApi(text);
    } catch (translatorError) {
      if (!LANGUAGE_MODEL_OUTPUTS.has(state.language)) {
        throw new Error([
          'Could not translate in this browser.',
          `Translator API: ${translatorError.message || translatorError}`,
          'The local LanguageModel fallback is only reliable enough here as a short preview for Spanish and Japanese.',
        ].join(' '));
      }

      try {
        return await translateWithLanguageModel(text, translatorError);
      } catch (languageModelError) {
        throw new Error([
          'Could not translate in this browser.',
          `Translator API: ${translatorError.message || translatorError}`,
          `LanguageModel preview: ${languageModelError.message || languageModelError}`,
        ].join(' '));
      }
    }
  }

  async function translateWithTranslatorApi(text) {
    if (!('Translator' in self)) {
      throw new Error('Chrome Translator API is not available in this browser.');
    }

    const failureKey = `${state.language}`;
    if (translatorFailures.has(failureKey)) {
      throw new Error(translatorFailures.get(failureKey));
    }

    const availability = await Translator.availability({
      sourceLanguage: 'en',
      targetLanguage: state.language,
    });
    if (availability === 'unavailable') {
      throw new Error(`English to ${LANGUAGES[state.language].label} translation is unavailable on this device.`);
    }

    let translator;
    try {
      translator = await withTimeout(
        Translator.create({
          sourceLanguage: 'en',
          targetLanguage: state.language,
          monitor(monitor) {
            monitor.addEventListener('downloadprogress', (event) => {
              setStatus(`Downloading translation model: ${Math.round(event.loaded * 100)}%`);
            });
          },
        }),
        TRANSLATOR_CREATE_TIMEOUT_MS,
        `Chrome Translator service timed out while creating English to ${LANGUAGES[state.language].label}.`,
      );

      setStatus('Checking Chrome translation service...');
      await translateChunkWithTimeout(
        translator,
        TRANSLATOR_HEALTHCHECK_TEXT,
        `Chrome Translator service timed out during the ${LANGUAGES[state.language].label} health check.`,
        TRANSLATOR_HEALTHCHECK_TIMEOUT_MS,
      );

      const parts = chunks(text, TRANSLATOR_CHUNK_LIMIT);
      const translated = [];
      for (let index = 0; index < parts.length; index += 1) {
        setStatus(`Translating part ${index + 1} of ${parts.length}...`);
        translated.push(await translateChunkWithTimeout(
          translator,
          parts[index],
          `Chrome Translator service timed out on part ${index + 1}.`,
        ));
      }
      return translated.join('\n\n');
    } catch (error) {
      const message = error.message || String(error);
      if (TRANSLATOR_SERVICE_FAILURE_RE.test(message)) {
        const crashMessage = [
          `Chrome Translator service failed for English to ${LANGUAGES[state.language].label}.`,
          'This is a browser-side failure in Chrome Built-In AI, not a problem with the tale data.',
          'Restart Chrome or try another Chrome profile/version; the reader will not keep retrying this language in this tab.',
        ].join(' ');
        translatorFailures.set(failureKey, crashMessage);
        throw new Error(crashMessage);
      }
      throw error;
    } finally {
      translator?.destroy?.();
      state.status = '';
    }
  }

  async function translateChunkWithTimeout(translator, text, timeoutMessage, timeoutMs = TRANSLATOR_TIMEOUT_MS) {
    const controller = new AbortController();
    return await withTimeout(
      translator.translate(text, { signal: controller.signal }),
      timeoutMs,
      timeoutMessage,
      () => controller.abort(timeoutMessage),
    );
  }

  async function translateWithLanguageModel(text, translatorError) {
    if (!('LanguageModel' in self)) {
      throw new Error('Chrome LanguageModel Prompt API is not available in this browser.');
    }

    const modelOptions = {
      expectedInputs: [{ type: 'text', languages: ['en'] }],
      expectedOutputs: [{ type: 'text', languages: [state.language] }],
    };
    const availability = await LanguageModel.availability(modelOptions);
    if (availability === 'unavailable') {
      throw new Error('The local language model is unavailable on this device.');
    }

    let session;
    try {
      session = await LanguageModel.create({
        ...modelOptions,
        monitor(monitor) {
          monitor.addEventListener('downloadprogress', (event) => {
            setStatus(`Downloading local language model: ${Math.round(event.loaded * 100)}%`);
          });
        },
      });

      const previewText = text.length > LANGUAGE_MODEL_TRANSLATION_CHAR_LIMIT
        ? `${text.slice(0, LANGUAGE_MODEL_TRANSLATION_CHAR_LIMIT)}\n\n[Preview source truncated before local translation.]`
        : text;
      const allParts = chunks(previewText, LANGUAGE_MODEL_TRANSLATION_CHAR_LIMIT);
      const parts = allParts.slice(0, LANGUAGE_MODEL_TRANSLATION_MAX_CHUNKS);
      const translated = [];
      for (let index = 0; index < parts.length; index += 1) {
        setStatus(`Generating local preview ${index + 1} of ${parts.length}...`);
        translated.push(await promptWithTimeout(session, `
Translate the passage below from English to ${LANGUAGES[state.language].targetName}.
Preserve paragraph meaning, names, events, and fairy-tale tone.
Return only the translation.

Passage:
${parts[index]}
      `.trim(), `LanguageModel translation timed out on part ${index + 1}.`));
      }
      const suffix = [
        '',
        '',
        '[Preview only: Chrome native translation failed.',
        `Translator API said: ${translatorError.message || translatorError}`,
        'The local LanguageModel fallback is limited to a short opening preview to avoid long browser hangs.]',
      ].join(' ');
      return translated.join('\n\n') + suffix;
    } finally {
      session?.destroy?.();
    }
  }

  async function promptWithTimeout(session, prompt, timeoutMessage) {
    const controller = new AbortController();
    return await withTimeout(
      session.prompt(prompt, { signal: controller.signal }),
      LANGUAGE_MODEL_TIMEOUT_MS,
      timeoutMessage,
      () => controller.abort(timeoutMessage),
    );
  }

  async function withTimeout(promise, timeoutMs, timeoutMessage, onTimeout) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        onTimeout?.();
        reject(new Error(timeoutMessage));
      }, timeoutMs);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function friendlyText(text, mode) {
    if (!('LanguageModel' in self)) {
      throw new Error('Chrome LanguageModel Prompt API is not available in this browser.');
    }

    if (!LANGUAGE_MODEL_OUTPUTS.has(state.language)) {
      throw new Error(`Friendly rewrite with LanguageModel currently supports only Spanish and Japanese. Choose Español or 日本語, or use Translate for ${LANGUAGES[state.language].label}.`);
    }

    const modelOptions = {
      expectedInputs: [{ type: 'text', languages: [state.language] }],
      expectedOutputs: [{ type: 'text', languages: [state.language] }],
    };
    const availability = await LanguageModel.availability(modelOptions);
    if (availability === 'unavailable') {
      throw new Error('The local language model is unavailable on this device.');
    }

    const tone = {
      clear: `${LANGUAGES[state.language].rewriteName} claro, amigavel e facil de ler`,
      child: `${LANGUAGES[state.language].rewriteName} apropriado para criancas, sem perder os acontecimentos principais`,
      modern: `prosa moderna em ${LANGUAGES[state.language].rewriteName}, com frases curtas e naturais`,
      study: `${LANGUAGES[state.language].rewriteName} com tom de estudo, acrescentando pequenas notas explicativas entre parenteses quando ajudar`,
    }[mode] || `${LANGUAGES[state.language].rewriteName} claro`;

    let session;
    try {
      session = await LanguageModel.create({
        ...modelOptions,
        monitor(monitor) {
          monitor.addEventListener('downloadprogress', (event) => {
            setStatus(`Downloading local language model: ${Math.round(event.loaded * 100)}%`);
          });
        },
      });

      const parts = chunks(text, 1800);
      const rewritten = [];
      for (let index = 0; index < parts.length; index += 1) {
        setStatus(`Rewriting part ${index + 1} of ${parts.length}...`);
        rewritten.push(await promptWithTimeout(session, `
Reescreva o trecho abaixo em ${tone}.
Preserve personagens, acontecimentos, ordem narrativa e imagens importantes.
Nao acrescente moral nova. Nao resuma demais.

Trecho:
${parts[index]}
      `.trim(), `LanguageModel rewrite timed out on part ${index + 1}.`));
      }
      return rewritten.join('\n\n');
    } finally {
      session?.destroy?.();
    }
  }

  async function runDiagnostics() {
    if (state.busy) return;
    state.busy = true;
    render();
    try {
      const lines = [
        `Language: ${LANGUAGES[state.language].label} (${state.language})`,
        `Translator API present: ${'Translator' in self}`,
        `LanguageModel API present: ${'LanguageModel' in self}`,
      ];

      if ('Translator' in self) {
        try {
          const availability = await Translator.availability({
            sourceLanguage: 'en',
            targetLanguage: state.language,
          });
          lines.push(`Translator availability en -> ${state.language}: ${availability}`);
        } catch (error) {
          lines.push(`Translator availability error: ${error.message || error}`);
        }

        try {
          const translator = await Translator.create({
            sourceLanguage: 'en',
            targetLanguage: state.language,
          });
          lines.push(`Translator.create en -> ${state.language}: ok`);
          try {
            await translateChunkWithTimeout(
              translator,
              TRANSLATOR_HEALTHCHECK_TEXT,
              `Translator health check en -> ${state.language}: timed out`,
              TRANSLATOR_HEALTHCHECK_TIMEOUT_MS,
            );
            lines.push(`Translator health check en -> ${state.language}: ok`);
          } catch (error) {
            lines.push(`Translator health check en -> ${state.language}: ${error.message || error}`);
          }
          translator.destroy?.();
        } catch (error) {
          lines.push(`Translator.create en -> ${state.language}: ${error.message || error}`);
        }
      }

      if ('LanguageModel' in self) {
        try {
          const availability = await LanguageModel.availability({
            expectedInputs: [{ type: 'text', languages: ['en'] }],
            expectedOutputs: [{ type: 'text', languages: [state.language] }],
          });
          lines.push(`LanguageModel availability en -> ${state.language}: ${availability}`);
        } catch (error) {
          lines.push(`LanguageModel availability error: ${error.message || error}`);
        }
      }

      state.diagnostics = lines.join('\n');
      state.status = '';
      state.error = '';
    } finally {
      state.busy = false;
      render();
    }
  }

  async function mountReader() {
    const root = $('#tale-reader');
    if (!root || root.dataset.mounted === '1') return;
    root.dataset.mounted = '1';
    try {
      state.data = await loadData();
      state.tale = pickInitialTale(state.data);
      state.translated = localStorage.getItem(key('translation', state.tale.slug)) || '';
      state.status = 'Reader ready.';
      render();
    } catch (error) {
      root.innerHTML = `<div class="error-box">${escapeHtml(error.message || String(error))}</div>`;
    }
  }

  async function mountOverview() {
    const root = $('#overview-dashboard');
    if (!root || root.dataset.mounted === '1') return;
    root.dataset.mounted = '1';
    try {
      const [overview, tales] = await Promise.all([loadJson(OVERVIEW_URL), loadData()]);
      const topNodeTypes = (overview.graph?.node_types || [])
        .slice()
        .sort((a, b) => Number(b.count) - Number(a.count))
        .slice(0, 8);
      const collections = overview.reddb?.collections || [];
      root.innerHTML = `
        <div class="showcase-block">
          <section class="metric-grid">
            ${metricCard('canonical tales', tales.totals?.tales || tales.tales?.length)}
            ${metricCard('graph nodes', overview.graph?.nodes)}
            ${metricCard('graph edges', overview.graph?.edges)}
            ${metricCard('word rows', overview.reddb?.table_counts?.tale_words)}
            ${metricCard('source links', overview.corpus?.canonical_source_count)}
            ${metricCard('branch records', overview.corpus?.explicit_branch_count)}
          </section>
          <section class="split-grid">
            <div class="viz-panel">
              <h3>Top Node Types</h3>
              ${topNodeTypes.map((row) => `
                <div class="bar-row">
                  <span>${escapeHtml(row.node_type)}</span>
                  <div class="bar-track"><div class="bar-fill" style="width:${Math.min(100, (Number(row.count) / Number(topNodeTypes[0]?.count || 1)) * 100)}%"></div></div>
                  <strong>${formatNumber(row.count)}</strong>
                </div>
              `).join('')}
            </div>
            <div class="viz-panel">
              <h3>RedDB Collections</h3>
              ${simpleTable(collections, [
                { key: 'name', label: 'collection' },
                { key: 'model', label: 'model' },
                { key: 'entities', label: 'entities', format: formatNumber },
              ])}
            </div>
          </section>
        </div>
      `;
    } catch (error) {
      root.innerHTML = `<div class="error-box">${escapeHtml(error.message || String(error))}</div>`;
    }
  }

  async function mountAskCorpus() {
    const root = $('#ask-corpus');
    if (!root || root.dataset.mounted === '1') return;
    root.dataset.mounted = '1';
    try {
      const data = await loadJson(QUESTIONS_URL);
      root.innerHTML = `
        <div class="question-grid">
          ${(data.questions || []).map((item) => `
            <article class="question-card">
              <div class="question-id">${escapeHtml(item.id)}</div>
              <h3>${escapeHtml(item.question)}</h3>
              <p>${escapeHtml(item.answer)}</p>
              <code>${escapeHtml(item.command)}</code>
              <div class="model-list">${(item.models || []).map((model) => `<span class="chip">${escapeHtml(model)}</span>`).join('')}</div>
            </article>
          `).join('')}
        </div>
      `;
    } catch (error) {
      root.innerHTML = `<div class="error-box">${escapeHtml(error.message || String(error))}</div>`;
    }
  }

  async function mountReddbShowcase() {
    const root = $('#reddb-showcase');
    if (!root || root.dataset.mounted === '1') return;
    root.dataset.mounted = '1';
    try {
      const overview = await loadJson(OVERVIEW_URL);
      const collections = overview.reddb?.collections || [];
      const centrality = overview.reddb?.centrality_top || [];
      const ingest = overview.reddb?.ingest_metrics || [];
      root.innerHTML = `
        <div class="showcase-block">
          <section class="metric-grid">
            ${metricCard('collections', collections.length)}
            ${metricCard('graph entities', collections.find((row) => row.name === 'tales')?.entities)}
            ${metricCard('table rows', Number(overview.reddb?.table_counts?.tale_words || 0) + Number(overview.reddb?.table_counts?.tale_bigrams || 0) + Number(overview.reddb?.table_counts?.tale_vocab || 0))}
            ${metricCard('timeseries points', collections.find((row) => row.name === 'ingest_log')?.entities)}
          </section>
          <section class="split-grid">
            <div class="viz-panel">
              <h3>Collections</h3>
              ${simpleTable(collections, [
                { key: 'name', label: 'collection' },
                { key: 'model', label: 'model' },
                { key: 'entities', label: 'entities', format: formatNumber },
              ])}
            </div>
            <div class="viz-panel">
              <h3>Centrality Snapshot</h3>
              ${simpleTable(centrality.slice(0, 10), [
                { key: 'label', label: 'label' },
                { key: 'score', label: 'score', format: formatNumber },
              ])}
            </div>
          </section>
          <section class="viz-panel">
            <h3>Ingest Timeseries Metrics</h3>
            ${simpleTable(ingest, [
              { key: 'metric', label: 'metric' },
              { key: 'COUNT(*)', label: 'points', format: formatNumber },
              { key: 'AVG(value)', label: 'avg', format: formatNumber },
              { key: 'MAX(value)', label: 'max', format: formatNumber },
            ])}
          </section>
        </div>
      `;
    } catch (error) {
      root.innerHTML = `<div class="error-box">${escapeHtml(error.message || String(error))}</div>`;
    }
  }

  async function mountVisualAtlas() {
    const root = $('#visual-atlas');
    if (!root || root.dataset.mounted === '1') return;
    root.dataset.mounted = '1';
    try {
      const [overview, data] = await Promise.all([loadJson(OVERVIEW_URL), loadData()]);
      const longest = data.tales
        .slice()
        .sort((a, b) => Number(b.stats.words) - Number(a.stats.words))
        .slice(0, 12)
        .map((tale) => ({ title: tale.title, words: tale.stats.words, sources: tale.sources?.length || 0 }));
      root.innerHTML = `
        <div class="showcase-block">
          <section class="viz-panel">
            <h3>Longest Canonical Tales</h3>
            ${simpleTable(longest, [
              { key: 'title', label: 'tale' },
              { key: 'words', label: 'words', format: formatNumber },
              { key: 'sources', label: 'sources', format: formatNumber },
            ])}
          </section>
          <section class="viz-panel">
            <h3>Node Type Distribution</h3>
            ${simpleTable((overview.graph?.node_types || []).slice().sort((a, b) => Number(b.count) - Number(a.count)), [
              { key: 'node_type', label: 'node type' },
              { key: 'count', label: 'count', format: formatNumber },
            ])}
          </section>
        </div>
      `;
    } catch (error) {
      root.innerHTML = `<div class="error-box">${escapeHtml(error.message || String(error))}</div>`;
    }
  }

  async function mount() {
    await Promise.all([
      mountReader(),
      mountOverview(),
      mountAskCorpus(),
      mountReddbShowcase(),
      mountVisualAtlas(),
    ]);
  }

  window.GrimmDocs = { mount };
})();
