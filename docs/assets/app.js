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
    sourceIndex: 0,
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

  function compareTextHtml(goldText, sourceText) {
    const gold = paragraphs(goldText);
    const source = paragraphs(sourceText);
    const rows = Math.max(gold.length, source.length);
    return `
      <div class="compare-view">
        <div class="compare-heading">Gold canonical</div>
        <div class="compare-heading">Selected source</div>
        ${Array.from({ length: rows }, (_, index) => `
          <section class="compare-cell">
            <div class="compare-index">${index + 1}</div>
            ${gold[index] ? htmlText(gold[index]) : '<p class="empty-state">No matching paragraph.</p>'}
          </section>
          <section class="compare-cell">
            <div class="compare-index">${index + 1}</div>
            ${source[index] ? htmlText(source[index]) : '<p class="empty-state">No matching paragraph.</p>'}
          </section>
        `).join('')}
      </div>
    `;
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

  function numberValue(row, keys) {
    for (const key of keys) {
      const value = row?.[key];
      if (value !== undefined && value !== null && value !== '') return Number(value);
    }
    return 0;
  }

  function slugText(value) {
    return String(value || '').replace(/_/g, ' ');
  }

  function chartColor(index) {
    const colors = ['#2563eb', '#dc6d2e', '#059669', '#7c3aed', '#d9467c', '#0f766e', '#f59e0b', '#475569'];
    return colors[index % colors.length];
  }

  function horizontalBars(rows, options) {
    const items = rows.slice(0, options.limit || rows.length);
    const max = Number(options.max ?? Math.max(...items.map((row) => Number(options.value(row) || 0)), 1));
    if (!items.length) return '<div class="empty-state">No chart rows generated.</div>';
    return `
      <div class="hbar-chart">
        ${items.map((row, index) => {
          const value = Number(options.value(row) || 0);
          const width = Math.max(2, Math.min(100, (value / max) * 100));
          return `
            <div class="hbar-row">
              <div class="hbar-label" title="${escapeHtml(options.label(row))}">${escapeHtml(options.label(row))}</div>
              <div class="hbar-track">
                <div class="hbar-fill" style="width:${width}%; background:${chartColor(index)}"></div>
              </div>
              <div class="hbar-value">${escapeHtml(formatNumber(value))}</div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  function donutChart(rows, options = {}) {
    const items = rows.filter((row) => Number(options.value?.(row) ?? row.count) > 0).slice(0, options.limit || 8);
    const total = items.reduce((sum, row) => sum + Number(options.value?.(row) ?? row.count), 0);
    if (!items.length || !total) return '<div class="empty-state">No chart rows generated.</div>';
    let offset = 0;
    const radius = 64;
    const circumference = 2 * Math.PI * radius;
    const circles = items.map((row, index) => {
      const value = Number(options.value?.(row) ?? row.count);
      const length = (value / total) * circumference;
      const circle = `
        <circle
          class="donut-segment"
          r="${radius}"
          cx="78"
          cy="78"
          fill="transparent"
          stroke="${chartColor(index)}"
          stroke-width="24"
          stroke-dasharray="${length} ${circumference - length}"
          stroke-dashoffset="${-offset}"
        />
      `;
      offset += length;
      return circle;
    }).join('');
    return `
      <div class="donut-layout">
        <svg class="donut-chart" viewBox="0 0 156 156" role="img" aria-label="${escapeHtml(options.title || 'distribution chart')}">
          <circle r="${radius}" cx="78" cy="78" fill="transparent" stroke="#edf2f7" stroke-width="24"></circle>
          <g transform="rotate(-90 78 78)">${circles}</g>
          <text x="78" y="73" text-anchor="middle" class="donut-total">${escapeHtml(formatNumber(total))}</text>
          <text x="78" y="93" text-anchor="middle" class="donut-caption">${escapeHtml(options.caption || 'total')}</text>
        </svg>
        <div class="legend-list">
          ${items.map((row, index) => {
            const value = Number(options.value?.(row) ?? row.count);
            const label = options.label?.(row) ?? row.node_type ?? row.model ?? row.name;
            return `
              <div class="legend-row">
                <span class="legend-swatch" style="background:${chartColor(index)}"></span>
                <span>${escapeHtml(slugText(label))}</span>
                <strong>${escapeHtml(formatNumber(value))}</strong>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  function scatterPlot(tales) {
    const items = tales
      .filter((tale) => tale.stats?.words && tale.stats?.graph_edges)
      .map((tale) => ({
        title: tale.title,
        slug: tale.slug,
        words: Number(tale.stats.words),
        edges: Number(tale.stats.graph_edges),
        propp: Number(tale.stats.propp_events || 0),
      }));
    if (!items.length) return '<div class="empty-state">No tale points generated.</div>';
    const maxWords = Math.max(...items.map((item) => item.words));
    const maxEdges = Math.max(...items.map((item) => item.edges));
    const width = 760;
    const height = 320;
    const pad = 42;
    const x = (value) => pad + (value / maxWords) * (width - pad * 1.5);
    const y = (value) => height - pad - (value / maxEdges) * (height - pad * 1.4);
    const labeled = items
      .slice()
      .sort((a, b) => (b.words + b.edges * 3) - (a.words + a.edges * 3))
      .slice(0, 6);
    const labeledSet = new Set(labeled.map((item) => item.slug));
    return `
      <div class="scatter-wrap">
        <svg class="scatter-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Tale words versus graph edges">
          <line x1="${pad}" y1="${height - pad}" x2="${width - pad / 2}" y2="${height - pad}" class="axis-line"></line>
          <line x1="${pad}" y1="${height - pad}" x2="${pad}" y2="${pad / 2}" class="axis-line"></line>
          <text x="${width - 150}" y="${height - 10}" class="axis-label">canonical words</text>
          <text x="8" y="22" class="axis-label">graph edges</text>
          ${items.map((item) => `
            <circle
              cx="${x(item.words)}"
              cy="${y(item.edges)}"
              r="${Math.max(3.2, Math.min(8, 3 + item.propp / 2))}"
              class="scatter-point ${labeledSet.has(item.slug) ? 'is-labeled' : ''}"
            >
              <title>${escapeHtml(`${item.title}: ${formatNumber(item.words)} words, ${formatNumber(item.edges)} graph edges`)}</title>
            </circle>
          `).join('')}
          ${labeled.map((item, index) => `
            <text x="${Math.min(width - 210, x(item.words) + 8)}" y="${Math.max(24, y(item.edges) - 6 - (index % 2) * 10)}" class="point-label">${escapeHtml(item.title)}</text>
          `).join('')}
        </svg>
      </div>
    `;
  }

  function modelBreakdown(collections) {
    const counts = collections.reduce((acc, row) => {
      const key = row.model || 'unknown';
      acc[key] = (acc[key] || 0) + Number(row.entities || 0);
      return acc;
    }, {});
    return Object.entries(counts)
      .map(([model, entities]) => ({ model, entities }))
      .sort((a, b) => b.entities - a.entities);
  }

  function collectionCards(collections) {
    const sorted = collections.slice().sort((a, b) => Number(b.entities || 0) - Number(a.entities || 0));
    const max = Math.max(...sorted.map((row) => Number(row.entities || 0)), 1);
    return `
      <div class="collection-grid">
        ${sorted.map((row, index) => `
          <article class="collection-card">
            <div class="collection-topline">
              <span class="model-pill">${escapeHtml(row.model || 'model')}</span>
              <span>${escapeHtml(formatNumber(row.entities || 0))}</span>
            </div>
            <h4>${escapeHtml(row.name)}</h4>
            <div class="mini-meter"><span style="width:${Math.max(2, (Number(row.entities || 0) / max) * 100)}%; background:${chartColor(index)}"></span></div>
            <div class="collection-meta">
              ${escapeHtml([
                row.schema_mode,
                row.indices !== undefined ? `${row.indices} indices` : null,
                row.on_disk_bytes ? `${formatNumber(Math.round(Number(row.on_disk_bytes) / 1024))} KB` : null,
              ].filter(Boolean).join(' · '))}
            </div>
          </article>
        `).join('')}
      </div>
    `;
  }

  function insightStrip(items) {
    return `
      <section class="insight-strip">
        ${items.map((item) => `
          <article>
            <span>${escapeHtml(item.kicker)}</span>
            <strong>${escapeHtml(item.value)}</strong>
            <p>${escapeHtml(item.label)}</p>
          </article>
        `).join('')}
      </section>
    `;
  }

  function topFrequencies(tales, getItems, limit = 12) {
    const counts = new Map();
    for (const tale of tales || []) {
      for (const item of getItems(tale) || []) {
        if (!item) continue;
        counts.set(item, (counts.get(item) || 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
      .slice(0, limit);
  }

  function readerInspector(tale) {
    const stats = tale.stats || {};
    const sourceCount = tale.sources?.length || 0;
    const branchCount = tale.branches?.length || 0;
    const facets = [
      { label: 'characters', value: stats.characters || 0 },
      { label: 'locations', value: stats.locations || 0 },
      { label: 'magic objects', value: stats.magic_objects || 0 },
      { label: 'Propp events', value: stats.propp_events || 0 },
    ];
    const sourceRows = (tale.sources || []).map((source, index) => `
      <button class="source-step ${index === state.sourceIndex ? 'active' : ''}" data-source-step="${index}" type="button">
        <span>${escapeHtml(source.is_base ? 'base' : source.weight || 'source')}</span>
        <strong>${escapeHtml(source.title || source.book_tale_slug || source.book_id)}</strong>
        <em>${escapeHtml([source.book_id, source.word_count ? `${formatNumber(source.word_count)} words` : null].filter(Boolean).join(' · '))}</em>
      </button>
    `).join('');
    return `
      <section class="reader-inspector">
        <div class="reader-title-block">
          <span class="eyebrow">Gold reader</span>
          <h2>${escapeHtml(tale.title)}</h2>
          <p>${escapeHtml([
            tale.khm ? `KHM ${tale.khm}` : null,
            tale.atu ? `ATU ${tale.atu}` : null,
            tale.atu_name,
          ].filter(Boolean).join(' · ') || 'Canonical Grimm tale')}</p>
        </div>
        <div class="reader-metric-strip">
          ${metricCard('canonical words', stats.words || 0)}
          ${metricCard('source editions', sourceCount)}
          ${metricCard('branch records', branchCount)}
          ${metricCard('graph edges', stats.graph_edges || 0)}
        </div>
        <div class="reader-insight-grid">
          <div class="viz-panel compact-panel">
            <div class="panel-heading">
              <span>narrative load</span>
              <strong>facets modelled for this tale</strong>
            </div>
            ${horizontalBars(facets, {
              label: (row) => row.label,
              value: (row) => row.value,
              limit: 4,
            })}
          </div>
          <div class="viz-panel compact-panel">
            <div class="panel-heading">
              <span>provenance</span>
              <strong>source editions</strong>
            </div>
            <div class="source-steps">${sourceRows || '<div class="empty-state">No source editions exported.</div>'}</div>
          </div>
        </div>
      </section>
    `;
  }

  function branchDetails(tale) {
    const branches = tale.branches || [];
    if (!branches.length) {
      return `
        <section class="facet-panel">
          <div class="facet-title">Branching</div>
          <div class="metric-inline">No alternative branch records exported for this canonical tale.</div>
        </section>
      `;
    }
    return `
      <section class="facet-panel">
        <div class="facet-title">Branching</div>
        <div class="branch-list">
          ${branches.slice(0, 5).map((branch) => `
            <article class="branch-card">
              <div>
                <strong>${escapeHtml(branch.description || branch.section_id || branch.id)}</strong>
                <span>${escapeHtml([
                  branch.type,
                  branch.from_book_id,
                  branch.has_plot_break ? 'plot break' : 'no plot break',
                ].filter(Boolean).join(' · '))}</span>
              </div>
              <p>${escapeHtml(branch.text || '').slice(0, 220)}${String(branch.text || '').length > 220 ? '...' : ''}</p>
            </article>
          `).join('')}
        </div>
      </section>
    `;
  }

  function pipelineStageCards() {
    const stages = [
      {
        id: 'bronze',
        title: 'Bronze',
        path: 'input/1-bronze',
        body: 'Raw Project Gutenberg books stay close to the original source material.',
        output: 'book text',
      },
      {
        id: 'silver',
        title: 'Silver',
        path: 'input/2-silver',
        body: 'Books are extracted into per-book tale files, manifests, canonical text candidates, and branch notes.',
        output: 'source editions',
      },
      {
        id: 'gold',
        title: 'Gold',
        path: 'input/3-gold',
        body: 'The private canonical 206-tale collection adds ontology, graph entities, provenance, ATU/KHM, and curated metadata.',
        output: 'canonical corpus',
      },
      {
        id: 'reddb',
        title: 'Embedded RedDB',
        path: 'output/embedded.rdb',
        body: 'The CLI ingests words, graph, KV metadata, ingest time series, and derived statistics into one local snapshot.',
        output: 'multi-model DB',
      },
      {
        id: 'docs',
        title: 'Docs Export',
        path: 'docs/data/*.json',
        body: 'The Pages workflow rebuilds the database, exports static JSON, verifies the payload, and publishes the visual docs.',
        output: 'static site',
      },
    ];
    return `
      <div class="pipeline-flow">
        ${stages.map((stage, index) => `
          <article class="pipeline-card">
            <div class="pipeline-index">${index + 1}</div>
            <h3>${escapeHtml(stage.title)}</h3>
            <code>${escapeHtml(stage.path)}</code>
            <p>${escapeHtml(stage.body)}</p>
            <span>${escapeHtml(stage.output)}</span>
          </article>
        `).join('')}
      </div>
    `;
  }

  function commandTimeline() {
    const commands = [
      { cmd: './grimm setup', body: 'Install root and embedded dependencies, including the RedDB SDK binary.' },
      { cmd: './grimm rebuild', body: 'Build corpus metadata, validate gold, ingest text tables, then ingest the graph.' },
      { cmd: './grimm export docs', body: 'Read gold + embedded RedDB and write static docs/data JSON.' },
      { cmd: './grimm docs serve', body: 'Serve Docsify locally against the generated static payload.' },
    ];
    return `
      <div class="command-timeline">
        ${commands.map((item) => `
          <article>
            <code>${escapeHtml(item.cmd)}</code>
            <p>${escapeHtml(item.body)}</p>
          </article>
        `).join('')}
      </div>
    `;
  }

  function currentText() {
    if (state.tab === 'source') return state.tale?.sources?.[state.sourceIndex]?.text || 'This source text is not available in the generated docs data.';
    if (state.tab === 'translation') return state.translated || 'Use Translate to generate this view.';
    if (state.tab === 'friendly') return state.friendly || 'Use Friendly rewrite to generate this view.';
    return state.tale?.text || '';
  }

  function selectedSource(tale = state.tale) {
    return tale?.sources?.[state.sourceIndex] || null;
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
    const sourceOptions = (tale.sources || [])
      .map((source, index) => `<option value="${index}" ${index === state.sourceIndex ? 'selected' : ''}>${escapeHtml(`${source.is_base ? 'Base' : source.weight}: ${source.title || source.book_tale_slug}`)}</option>`)
      .join('');
    const source = selectedSource(tale);
    const textMeta = state.tab === 'source' && source
      ? [source.book_id, source.word_count ? `${source.word_count} source words` : null, source.match_method ? `match: ${source.match_method}` : null].filter(Boolean).join(' · ')
      : meta;
    const bodyHtml = state.tab === 'compare'
      ? compareTextHtml(tale.text, source?.text || '')
      : htmlText(currentText());

    root.innerHTML = `
      <div class="tale-app">
        ${state.error ? `<div class="error-box">${escapeHtml(state.error)}</div>` : ''}
        ${readerInspector(tale)}
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
          <label class="tale-field">
            <span class="tale-label">Source</span>
            <select data-role="source-select" ${sourceOptions ? '' : 'disabled'}>${sourceOptions || '<option>No source text</option>'}</select>
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
              <div class="tale-meta">${escapeHtml(textMeta)}</div>
            </header>
            <div class="tale-tabs">
              <button class="tale-tab ${state.tab === 'original' ? 'active' : ''}" data-tab="original">Gold canonical</button>
              <button class="tale-tab ${state.tab === 'source' ? 'active' : ''}" data-tab="source" ${sourceOptions ? '' : 'disabled'}>Source text</button>
              <button class="tale-tab ${state.tab === 'compare' ? 'active' : ''}" data-tab="compare" ${sourceOptions ? '' : 'disabled'}>Compare</button>
              <button class="tale-tab ${state.tab === 'translation' ? 'active' : ''}" data-tab="translation">${escapeHtml(LANGUAGES[state.language].label)}</button>
              <button class="tale-tab ${state.tab === 'friendly' ? 'active' : ''}" data-tab="friendly">Friendly</button>
            </div>
            <div class="tale-text ${state.tab === 'compare' ? 'compare-container' : ''}">${bodyHtml}</div>
          </article>

          <aside class="tale-side">
            ${facetPanel('World Laws', tale.facets.world_laws)}
            ${facetPanel('Moral Regimes', tale.facets.moral_regimes)}
            ${facetPanel('Characters', tale.facets.characters)}
            ${facetPanel('Locations', tale.facets.locations)}
            ${sourcePanel(tale)}
            ${branchDetails(tale)}
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
      state.sourceIndex = Math.max(0, state.tale.sources?.findIndex((source) => source.is_base) ?? 0);
      state.tab = 'original';
      state.error = '';
      state.status = '';
      render();
    });

    $('[data-role="source-select"]', root)?.addEventListener('change', (event) => {
      state.sourceIndex = Number(event.target.value) || 0;
      state.tab = 'source';
      state.error = '';
      state.status = '';
      render();
    });

    root.querySelectorAll('[data-source-step]').forEach((button) => {
      button.addEventListener('click', () => {
        state.sourceIndex = Number(button.dataset.sourceStep) || 0;
        state.tab = 'source';
        state.error = '';
        state.status = '';
        render();
      });
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
      state.sourceIndex = Math.max(0, state.tale.sources?.findIndex((source) => source.is_base) ?? 0);
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
        .slice(0, 10);
      const collections = overview.reddb?.collections || [];
      const sources = Number(overview.corpus?.canonical_source_count || 0);
      const branches = Number(overview.corpus?.explicit_branch_count || 0);
      root.innerHTML = `
        <div class="showcase-block">
          <section class="docs-hero-panel">
            <div>
              <span class="eyebrow">Embedded RedDB showcase</span>
              <h2>One literary corpus, five database surfaces.</h2>
              <p>Read the tales, inspect source editions, and pivot into graph structure, text tables, KV metadata, ingest time series, and ranked statistics without leaving the same generated snapshot.</p>
            </div>
            <div class="hero-command">
              <span>try it locally</span>
              <code>./grimm ask tale-machinery</code>
            </div>
          </section>
          <section class="metric-grid">
            ${metricCard('canonical tales', tales.totals?.tales || tales.tales?.length)}
            ${metricCard('graph nodes', overview.graph?.nodes)}
            ${metricCard('graph edges', overview.graph?.edges)}
            ${metricCard('word rows', overview.reddb?.table_counts?.tale_words)}
            ${metricCard('source links', sources)}
            ${metricCard('branch records', branches)}
          </section>
          ${insightStrip([
            { kicker: 'provenance', value: `${formatNumber(sources)} links`, label: 'Canonical tales keep references back to silver book versions.' },
            { kicker: 'branching', value: `${formatNumber(branches)} records`, label: 'Alternative passages are exported as precomputed corpus metadata.' },
            { kicker: 'runtime', value: `${formatNumber(collections.length)} collections`, label: 'The docs are generated from the embedded RedDB snapshot in CI.' },
          ])}
          <section class="split-grid">
            <div class="viz-panel">
              <div class="panel-heading">
                <span>Graph shape</span>
                <strong>node type distribution</strong>
              </div>
              ${donutChart(topNodeTypes, {
                label: (row) => row.node_type,
                value: (row) => row.count,
                title: 'Graph node type distribution',
                caption: 'top nodes',
              })}
            </div>
            <div class="viz-panel">
              <div class="panel-heading">
                <span>Model mix</span>
                <strong>entities by RedDB model</strong>
              </div>
              ${horizontalBars(modelBreakdown(collections), {
                label: (row) => row.model,
                value: (row) => row.entities,
                limit: 8,
              })}
            </div>
          </section>
          <section class="viz-panel">
            <div class="panel-heading">
              <span>Corpus terrain</span>
              <strong>canonical length versus graph density</strong>
            </div>
            ${scatterPlot(tales.tales || [])}
          </section>
        </div>
      `;
    } catch (error) {
      root.innerHTML = `<div class="error-box">${escapeHtml(error.message || String(error))}</div>`;
    }
  }

  async function mountAskCorpus() {
    const root = $('#ask-corpus-root');
    if (!root || root.dataset.mounted === '1') return;
    root.dataset.mounted = '1';
    try {
      const data = await loadJson(QUESTIONS_URL);
      root.innerHTML = `
        <section class="docs-hero-panel compact">
          <div>
            <span class="eyebrow">Question-first data access</span>
            <h2>Start with a literary question, then reveal the RedDB model underneath.</h2>
          </div>
        </section>
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
    const root = $('#reddb-showcase-root');
    if (!root || root.dataset.mounted === '1') return;
    root.dataset.mounted = '1';
    try {
      const overview = await loadJson(OVERVIEW_URL);
      const collections = overview.reddb?.collections || [];
      const centrality = overview.reddb?.centrality_top || [];
      const ingest = overview.reddb?.ingest_metrics || [];
      const tableRows = Number(overview.reddb?.table_counts?.tale_words || 0) + Number(overview.reddb?.table_counts?.tale_bigrams || 0) + Number(overview.reddb?.table_counts?.tale_vocab || 0);
      root.innerHTML = `
        <div class="showcase-block">
          <section class="docs-hero-panel">
            <div>
              <span class="eyebrow">RedDB feature map</span>
              <h2>The same story world is queried through graph, tables, KV, time series, and statistics.</h2>
              <p>The docs export turns runtime collections into static JSON, so the published site shows exactly what the embedded snapshot produced.</p>
            </div>
            <div class="hero-command">
              <span>raw query</span>
              <code>./grimm query "GRAPH CENTRALITY"</code>
            </div>
          </section>
          <section class="metric-grid">
            ${metricCard('collections', collections.length)}
            ${metricCard('graph entities', collections.find((row) => row.name === 'tales')?.entities)}
            ${metricCard('table rows', tableRows)}
            ${metricCard('timeseries points', collections.find((row) => row.name === 'ingest_log')?.entities)}
          </section>
          <section class="viz-panel">
            <div class="panel-heading">
              <span>Collections</span>
              <strong>multi-model snapshot</strong>
            </div>
            ${collectionCards(collections)}
          </section>
          <section class="split-grid">
            <div class="viz-panel">
              <div class="panel-heading">
                <span>Centrality</span>
                <strong>most connected concepts</strong>
              </div>
              ${horizontalBars(centrality.slice(0, 12), {
                label: (row) => slugText(row.label),
                value: (row) => row.score,
                limit: 12,
              })}
            </div>
            <div class="viz-panel">
              <div class="panel-heading">
                <span>Model weight</span>
                <strong>entities by model</strong>
              </div>
              ${donutChart(modelBreakdown(collections), {
                label: (row) => row.model,
                value: (row) => row.entities,
                title: 'RedDB model entity distribution',
                caption: 'entities',
              })}
            </div>
          </section>
          <section class="viz-panel">
            <div class="panel-heading">
              <span>Time series</span>
              <strong>ingest metrics recorded during build</strong>
            </div>
            ${horizontalBars(ingest.slice().sort((a, b) => numberValue(b, ['SUM(value)', 'sum(value)']) - numberValue(a, ['SUM(value)', 'sum(value)'])), {
              label: (row) => row.metric,
              value: (row) => numberValue(row, ['SUM(value)', 'sum(value)', 'MAX(value)', 'max(value)']),
              limit: 12,
            })}
          </section>
        </div>
      `;
    } catch (error) {
      root.innerHTML = `<div class="error-box">${escapeHtml(error.message || String(error))}</div>`;
    }
  }

  async function mountVisualAtlas() {
    const root = $('#visual-atlas-root');
    if (!root || root.dataset.mounted === '1') return;
    root.dataset.mounted = '1';
    try {
      const [overview, data] = await Promise.all([loadJson(OVERVIEW_URL), loadData()]);
      const longest = data.tales
        .slice()
        .sort((a, b) => Number(b.stats.words) - Number(a.stats.words))
        .slice(0, 12)
        .map((tale) => ({ title: tale.title, words: tale.stats.words, sources: tale.sources?.length || 0 }));
      const dense = data.tales
        .slice()
        .sort((a, b) => Number(b.stats.graph_edges) - Number(a.stats.graph_edges))
        .slice(0, 12)
        .map((tale) => ({ title: tale.title, edges: tale.stats.graph_edges, nodes: tale.stats.graph_nodes }));
      const sourceRich = data.tales
        .slice()
        .sort((a, b) => Number(b.sources?.length || 0) - Number(a.sources?.length || 0))
        .slice(0, 10)
        .map((tale) => ({ title: tale.title, sources: tale.sources?.length || 0, branches: tale.branches?.length || 0 }));
      root.innerHTML = `
        <div class="showcase-block">
          <section class="docs-hero-panel">
            <div>
              <span class="eyebrow">Visual atlas</span>
              <h2>Scan the corpus as a landscape before opening individual tales.</h2>
              <p>Length, source richness, graph density, and node-type balance make the curated gold layer inspectable at a glance.</p>
            </div>
          </section>
          <section class="viz-panel">
            <div class="panel-heading">
              <span>Corpus terrain</span>
              <strong>words versus graph edges</strong>
            </div>
            ${scatterPlot(data.tales || [])}
          </section>
          <section class="split-grid">
            <div class="viz-panel">
              <div class="panel-heading">
                <span>Length</span>
                <strong>longest canonical tales</strong>
              </div>
              ${horizontalBars(longest, {
                label: (row) => row.title,
                value: (row) => row.words,
                limit: 12,
              })}
            </div>
            <div class="viz-panel">
              <div class="panel-heading">
                <span>Graph density</span>
                <strong>most connected tales</strong>
              </div>
              ${horizontalBars(dense, {
                label: (row) => row.title,
                value: (row) => row.edges,
                limit: 12,
              })}
            </div>
          </section>
          <section class="split-grid">
            <div class="viz-panel">
              <div class="panel-heading">
                <span>Provenance</span>
                <strong>source-rich tales</strong>
              </div>
              ${horizontalBars(sourceRich, {
                label: (row) => row.title,
                value: (row) => row.sources,
                limit: 10,
              })}
            </div>
            <div class="viz-panel">
              <div class="panel-heading">
                <span>Ontology</span>
                <strong>node type distribution</strong>
              </div>
              ${donutChart((overview.graph?.node_types || []).slice().sort((a, b) => Number(b.count) - Number(a.count)), {
                label: (row) => row.node_type,
                value: (row) => row.count,
                title: 'Node type distribution',
                caption: 'nodes',
                limit: 9,
              })}
            </div>
          </section>
          <section class="viz-panel">
            <div class="panel-heading">
              <span>Data table</span>
              <strong>longest canonical tales</strong>
            </div>
            ${simpleTable(longest, [
              { key: 'title', label: 'tale' },
              { key: 'words', label: 'words', format: formatNumber },
              { key: 'sources', label: 'sources', format: formatNumber },
            ])}
          </section>
        </div>
      `;
    } catch (error) {
      root.innerHTML = `<div class="error-box">${escapeHtml(error.message || String(error))}</div>`;
    }
  }

  async function mountOntology() {
    const root = $('#ontology-root');
    if (!root || root.dataset.mounted === '1') return;
    root.dataset.mounted = '1';
    try {
      const [overview, data] = await Promise.all([loadJson(OVERVIEW_URL), loadData()]);
      const nodeTypes = (overview.graph?.node_types || []).slice().sort((a, b) => Number(b.count) - Number(a.count));
      const worldLaws = topFrequencies(data.tales, (tale) => tale.facets?.world_laws, 10);
      const moralRegimes = topFrequencies(data.tales, (tale) => tale.facets?.moral_regimes, 10);
      const numbers = topFrequencies(data.tales, (tale) => tale.facets?.numbers, 10);
      const locations = topFrequencies(data.tales, (tale) => tale.facets?.locations, 10);
      root.innerHTML = `
        <div class="showcase-block">
          <section class="docs-hero-panel">
            <div>
              <span class="eyebrow">Ontology</span>
              <h2>The vocabulary is the bridge between literary reading and graph queries.</h2>
              <p>Characters, world laws, moral regimes, locations, numbers, traits, and Propp-like events become reusable graph language instead of one-off annotations buried in prose.</p>
            </div>
            <div class="hero-command">
              <span>query surface</span>
              <code>./grimm query "GRAPH CENTRALITY"</code>
            </div>
          </section>
          <section class="split-grid">
            <div class="viz-panel">
              <div class="panel-heading">
                <span>Graph vocabulary</span>
                <strong>node type weight</strong>
              </div>
              ${donutChart(nodeTypes, {
                label: (row) => row.node_type,
                value: (row) => row.count,
                title: 'Ontology node types',
                caption: 'nodes',
                limit: 9,
              })}
            </div>
            <div class="viz-panel">
              <div class="panel-heading">
                <span>Reader lens</span>
                <strong>what the ontology makes visible</strong>
              </div>
              <div class="ontology-lens-grid">
                <article><strong>World law</strong><span>What can happen in the tale's reality?</span></article>
                <article><strong>Moral regime</strong><span>How does consequence or justice behave?</span></article>
                <article><strong>Agency</strong><span>How does a person, object, animal, or spell gain power to act?</span></article>
                <article><strong>Threshold</strong><span>Which places behave like transitions, tests, or borders?</span></article>
                <article><strong>Propp event</strong><span>What narrative function is happening, in what order, with which actor?</span></article>
                <article><strong>Trait</strong><span>Which reusable story qualities connect characters across tales?</span></article>
              </div>
            </div>
          </section>
          <section class="split-grid">
            <div class="viz-panel">
              <div class="panel-heading">
                <span>World laws</span>
                <strong>most reused reality rules</strong>
              </div>
              ${horizontalBars(worldLaws, { label: (row) => row.label, value: (row) => row.count, limit: 10 })}
            </div>
            <div class="viz-panel">
              <div class="panel-heading">
                <span>Moral regimes</span>
                <strong>consequence patterns</strong>
              </div>
              ${horizontalBars(moralRegimes, { label: (row) => row.label, value: (row) => row.count, limit: 10 })}
            </div>
          </section>
          <section class="split-grid">
            <div class="viz-panel">
              <div class="panel-heading">
                <span>Symbol numbers</span>
                <strong>recurring numeric motifs</strong>
              </div>
              ${horizontalBars(numbers, { label: (row) => row.label, value: (row) => row.count, limit: 10 })}
            </div>
            <div class="viz-panel">
              <div class="panel-heading">
                <span>Locations</span>
                <strong>recurring story places</strong>
              </div>
              ${horizontalBars(locations, { label: (row) => row.label, value: (row) => row.count, limit: 10 })}
            </div>
          </section>
        </div>
      `;
    } catch (error) {
      root.innerHTML = `<div class="error-box">${escapeHtml(error.message || String(error))}</div>`;
    }
  }

  async function mountPipeline() {
    const root = $('#pipeline-root');
    if (!root || root.dataset.mounted === '1') return;
    root.dataset.mounted = '1';
    try {
      const [overview, data] = await Promise.all([loadJson(OVERVIEW_URL), loadData()]);
      const tableRows = Number(overview.reddb?.table_counts?.tale_words || 0) + Number(overview.reddb?.table_counts?.tale_bigrams || 0) + Number(overview.reddb?.table_counts?.tale_vocab || 0);
      root.innerHTML = `
        <div class="showcase-block">
          <section class="docs-hero-panel">
            <div>
              <span class="eyebrow">Data pipeline</span>
              <h2>From public books to a private canonical corpus and a generated RedDB-powered site.</h2>
              <p>The pipeline keeps book editions, canonical editorial choices, graph structure, runtime database state, and static docs exports as separate layers.</p>
            </div>
          </section>
          ${pipelineStageCards()}
          <section class="metric-grid">
            ${metricCard('bronze books', overview.corpus?.book_count)}
            ${metricCard('silver book tales', overview.corpus?.book_tale_count)}
            ${metricCard('gold canonical tales', data.totals?.tales || data.tales?.length)}
            ${metricCard('source links', overview.corpus?.canonical_source_count)}
            ${metricCard('graph entities', Number(overview.graph?.nodes || 0) + Number(overview.graph?.edges || 0))}
            ${metricCard('text table rows', tableRows)}
          </section>
          <section class="split-grid">
            <div class="viz-panel">
              <div class="panel-heading">
                <span>Build commands</span>
                <strong>local and CI use the same entrypoint</strong>
              </div>
              ${commandTimeline()}
            </div>
            <div class="viz-panel">
              <div class="panel-heading">
                <span>Export contract</span>
                <strong>what GitHub Pages receives</strong>
              </div>
              <div class="artifact-list">
                <article><code>docs/data/tales.json</code><span>206 tales, readable gold text, source texts, branches, stats, facets.</span></article>
                <article><code>docs/data/overview.json</code><span>Corpus counters, graph totals, RedDB collections, table counts, centrality, ingest metrics.</span></article>
                <article><code>docs/data/questions.json</code><span>Curated Q&A cards that map questions to RedDB features and CLI commands.</span></article>
              </div>
            </div>
          </section>
        </div>
      `;
    } catch (error) {
      root.innerHTML = `<div class="error-box">${escapeHtml(error.message || String(error))}</div>`;
    }
  }

  async function mountBuildPublish() {
    const root = $('#build-publish-root');
    if (!root || root.dataset.mounted === '1') return;
    root.dataset.mounted = '1';
    try {
      const overview = await loadJson(OVERVIEW_URL);
      const collections = overview.reddb?.collections || [];
      root.innerHTML = `
        <div class="showcase-block">
          <section class="docs-hero-panel">
            <div>
              <span class="eyebrow">Build and publish</span>
              <h2>The site is static, but the data is regenerated from RedDB on every Pages deploy.</h2>
              <p>GitHub Actions installs dependencies, deletes stale RedDB runtime files, rebuilds the embedded snapshot, exports JSON, verifies the payload, and uploads the Docsify site.</p>
            </div>
            <div class="hero-command">
              <span>workflow</span>
              <code>.github/workflows/pages.yml</code>
            </div>
          </section>
          <section class="split-grid">
            <div class="viz-panel">
              <div class="panel-heading">
                <span>CI guardrails</span>
                <strong>what must be true before publish</strong>
              </div>
              <div class="check-list">
                <article><strong>Clean RedDB rebuild</strong><span>CI removes output/embedded.rdb* before rebuilding to avoid stale snapshot corruption.</span></article>
                <article><strong>Payload exists</strong><span>tales.json, overview.json, and questions.json must be present and non-empty.</span></article>
                <article><strong>Corpus complete</strong><span>The docs export must contain exactly 206 canonical tales.</span></article>
                <article><strong>Reader-ready text</strong><span>Hansel and Gretel must include gold text plus at least one silver source text.</span></article>
              </div>
            </div>
            <div class="viz-panel">
              <div class="panel-heading">
                <span>Published snapshot</span>
                <strong>collections behind the docs</strong>
              </div>
              ${collectionCards(collections)}
            </div>
          </section>
          <section class="viz-panel">
            <div class="panel-heading">
              <span>Why static?</span>
              <strong>no duplicate hand-maintained story files in docs</strong>
            </div>
            <div class="static-contract">
              <p>The docs folder owns the interface. The gold/silver layers own the corpus. The export step is the boundary: it brings the current RedDB snapshot into docs/data at publish time, so the visual site can stay static while still reflecting the database build.</p>
              <code>push to main -> rebuild RedDB -> export docs/data -> verify -> deploy Pages</code>
            </div>
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
      mountOntology(),
      mountPipeline(),
      mountBuildPublish(),
    ]);
  }

  window.GrimmDocs = { mount };
})();
