/**
 * @jest-environment jsdom
 */

const { loadScript } = require('./load-script');

beforeAll(() => {
  global.subscribeCardToFile = jest.fn();
  global.fetch = jest.fn();
  loadScript('cardcontent-metric.js');
});

afterEach(() => {
  jest.clearAllMocks();
  document.body.innerHTML = '';
});

function makeCardEl(id) {
  const el = document.createElement('div');
  el.id = id;
  el.innerHTML = '<div class="metric-card"></div>';
  document.body.appendChild(el);
}

function mockCards(cards) {
  global.fetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(cards) });
}

function mockCount(count) {
  global.fetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ count }) });
}

function mockJson(data) {
  global.fetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(data) });
}

// ─── early-exit guards ───

describe('loadCardContentMetric — early exit', () => {
  test('returns without fetching if card element is not in the DOM', async () => {
    await loadCardContentMetric({ id: 'ghost', metric: { sources: [{ cardId: 'x' }] } });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('returns without fetching if metric config is absent', async () => {
    makeCardEl('no-cfg');
    await loadCardContentMetric({ id: 'no-cfg' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('returns without fetching if sources array is empty', async () => {
    makeCardEl('empty-src');
    await loadCardContentMetric({ id: 'empty-src', metric: { sources: [] } });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

// ─── list source ───

describe('loadCardContentMetric — list source', () => {
  test('renders one metric-item with count and label', async () => {
    makeCardEl('m-list');
    mockCards([
      { id: 'm-list', cardType: 'metric', metric: { sources: [{ cardId: 'src-l' }] } },
      { id: 'src-l', cardType: 'list', title: 'Events', list: { sourceItems: 'events.csv' } },
    ]);
    mockCount(42);

    await loadCardContentMetric({ id: 'm-list', metric: { sources: [{ cardId: 'src-l' }] } });

    const wrapper = document.getElementById('m-list').querySelector('.metric-card');
    expect(wrapper.querySelectorAll('.metric-item')).toHaveLength(1);
    expect(wrapper.querySelector('.metric-value').textContent.trim()).toBe('42');
    expect(wrapper.querySelector('.metric-label').textContent.trim()).toBe('Events');
  });

  test('uses card id as label when title is absent', async () => {
    makeCardEl('m-notitle');
    mockCards([
      { id: 'm-notitle', cardType: 'metric', metric: { sources: [{ cardId: 'src-nt' }] } },
      { id: 'src-nt', cardType: 'list', list: { sourceItems: 'x.csv' } },
    ]);
    mockCount(3);

    await loadCardContentMetric({ id: 'm-notitle', metric: { sources: [{ cardId: 'src-nt' }] } });

    const label = document.getElementById('m-notitle').querySelector('.metric-label');
    expect(label.textContent.trim()).toBe('src-nt');
  });
});

// ─── dynamic-list source ───

describe('loadCardContentMetric — dynamic-list source', () => {
  test('renders metric-item with count from dynamic-list', async () => {
    makeCardEl('m-dl');
    mockCards([
      { id: 'm-dl', cardType: 'metric', metric: { sources: [{ cardId: 'src-dl' }] } },
      { id: 'src-dl', cardType: 'dynamic-list', title: 'Alerts', dynamicList: { sourceItems: 'alerts.csv' } },
    ]);
    mockCount(7);

    await loadCardContentMetric({ id: 'm-dl', metric: { sources: [{ cardId: 'src-dl' }] } });

    const value = document.getElementById('m-dl').querySelector('.metric-value');
    expect(value.textContent.trim()).toBe('7');
  });
});

// ─── uptime source ───

describe('loadCardContentMetric — uptime source', () => {
  test('counts services matching the uptimeFilter', async () => {
    makeCardEl('m-up');
    mockCards([
      { id: 'm-up', cardType: 'metric', metric: { sources: [{ cardId: 'src-up', uptimeFilter: 'offline' }] } },
      { id: 'src-up', cardType: 'uptime', title: 'Services', sourceItems: 'public/local-data-uptimes/up.json' },
    ]);
    mockJson([{ servicesStatus: [
      { status: 'offline' }, { status: 'offline' }, { status: 'online' },
    ]}]);

    await loadCardContentMetric({ id: 'm-up', metric: { sources: [{ cardId: 'src-up', uptimeFilter: 'offline' }] } });

    const value = document.getElementById('m-up').querySelector('.metric-value');
    expect(value.textContent.trim()).toBe('2');
  });

  test('defaults uptimeFilter to offline when not specified', async () => {
    makeCardEl('m-up-def');
    mockCards([
      { id: 'm-up-def', cardType: 'metric', metric: { sources: [{ cardId: 'src-up-def' }] } },
      { id: 'src-up-def', cardType: 'uptime', title: 'Svc', sourceItems: 'public/up.json' },
    ]);
    mockJson({ servicesStatus: [{ status: 'offline' }, { status: 'online' }] });

    await loadCardContentMetric({ id: 'm-up-def', metric: { sources: [{ cardId: 'src-up-def' }] } });

    const value = document.getElementById('m-up-def').querySelector('.metric-value');
    expect(value.textContent.trim()).toBe('1');
  });

  test('strips public/ prefix from file path before fetching', async () => {
    makeCardEl('m-up-path');
    mockCards([
      { id: 'm-up-path', cardType: 'metric', metric: { sources: [{ cardId: 'src-path' }] } },
      { id: 'src-path', cardType: 'uptime', title: 'P', sourceItems: 'public/local/status.json' },
    ]);
    mockJson([{ servicesStatus: [] }]);

    await loadCardContentMetric({ id: 'm-up-path', metric: { sources: [{ cardId: 'src-path' }] } });

    const calls = global.fetch.mock.calls.map(c => c[0]);
    expect(calls).toContain('local/status.json');
  });

  test('remove caminho absoluto do container (/app/public/...) antes do fetch', async () => {
    makeCardEl('m-up-abs');
    mockCards([
      { id: 'm-up-abs', cardType: 'metric', metric: { sources: [{ cardId: 'src-up-abs' }] } },
      { id: 'src-up-abs', cardType: 'uptime', title: 'P', sourceItems: '/app/public/local-data-uptimes/up.json' },
    ]);
    mockJson([{ servicesStatus: [] }]);

    await loadCardContentMetric({ id: 'm-up-abs', metric: { sources: [{ cardId: 'src-up-abs' }] } });

    const calls = global.fetch.mock.calls.map(c => c[0]);
    expect(calls).toContain('local-data-uptimes/up.json');
  });
});

// ─── cve-assets source ───

describe('loadCardContentMetric — cve-assets source', () => {
  test('counts CVEs without an assessment as pending', async () => {
    makeCardEl('m-cve');
    mockCards([
      { id: 'm-cve', cardType: 'metric', metric: { sources: [{ cardId: 'src-cve' }] } },
      { id: 'src-cve', cardType: 'cve-assets', title: 'CVEs', sourceItems: 'public/local-events/cve.json' },
    ]);
    mockJson({ report_items: [
      { cves: [{ assessment: '' }, { assessment: null }, { assessment: 'Accepted' }] },
      { cves: [{ assessment: '' }] },
    ]});

    await loadCardContentMetric({ id: 'm-cve', metric: { sources: [{ cardId: 'src-cve' }] } });

    const value = document.getElementById('m-cve').querySelector('.metric-value');
    expect(value.textContent.trim()).toBe('3');
  });

  test('remove caminho absoluto do container (/app/public/...) antes do fetch', async () => {
    makeCardEl('m-cve-abs');
    mockCards([
      { id: 'm-cve-abs', cardType: 'metric', metric: { sources: [{ cardId: 'src-cve-abs' }] } },
      { id: 'src-cve-abs', cardType: 'cve-assets', title: 'CVEs', sourceItems: '/app/public/local-events/cve.json' },
    ]);
    mockJson({ report_items: [] });

    await loadCardContentMetric({ id: 'm-cve-abs', metric: { sources: [{ cardId: 'src-cve-abs' }] } });

    const calls = global.fetch.mock.calls.map(c => c[0]);
    expect(calls).toContain('local-events/cve.json');
  });
});

// ─── multiple sources ───

describe('loadCardContentMetric — multiple sources', () => {
  test('renders each source as a separate metric-item', async () => {
    makeCardEl('m-multi');
    mockCards([
      { id: 'm-multi', cardType: 'metric', metric: { sources: [{ cardId: 'sl-a' }, { cardId: 'sl-b' }] } },
      { id: 'sl-a', cardType: 'list', title: 'A', list: { sourceItems: 'a.csv' } },
      { id: 'sl-b', cardType: 'list', title: 'B', list: { sourceItems: 'b.csv' } },
    ]);
    mockCount(10);
    mockCount(20);

    await loadCardContentMetric({ id: 'm-multi', metric: { sources: [{ cardId: 'sl-a' }, { cardId: 'sl-b' }] } });

    const items = document.getElementById('m-multi').querySelectorAll('.metric-item');
    expect(items).toHaveLength(2);
    expect(items[0].querySelector('.metric-value').textContent.trim()).toBe('10');
    expect(items[1].querySelector('.metric-value').textContent.trim()).toBe('20');
  });

  test('skips a source whose cardId is not in allCards', async () => {
    makeCardEl('m-skip');
    mockCards([
      { id: 'm-skip', cardType: 'metric', metric: { sources: [{ cardId: 'ghost' }] } },
    ]);

    await loadCardContentMetric({ id: 'm-skip', metric: { sources: [{ cardId: 'ghost' }] } });

    const items = document.getElementById('m-skip').querySelectorAll('.metric-item');
    expect(items).toHaveLength(0);
  });
});

// ─── WebSocket subscription ───

describe('loadCardContentMetric — subscribeCardToFile', () => {
  test('subscribes the metric card to the source file', async () => {
    makeCardEl('m-sub');
    mockCards([
      { id: 'm-sub', cardType: 'metric', metric: { sources: [{ cardId: 'src-sub' }] } },
      { id: 'src-sub', cardType: 'list', title: 'Sub', list: { sourceItems: 'sub.csv' } },
    ]);
    mockCount(1);

    await loadCardContentMetric({ id: 'm-sub', metric: { sources: [{ cardId: 'src-sub' }] } });

    expect(global.subscribeCardToFile).toHaveBeenCalledWith('m-sub', 'sub.csv');
  });
});
