/**
 * @jest-environment jsdom
 */

const { loadScript } = require('./load-script');

beforeAll(() => {
  global.fetch = jest.fn();
  loadScript('cardcontent-uptime.js');
});

afterEach(() => {
  jest.clearAllMocks();
  document.body.innerHTML = '';
});

function makeUptimeCard(id) {
  const el = document.createElement('div');
  el.id = id;
  el.innerHTML = '<div class="uptime-card"></div><div class="card-content"></div>';
  document.body.appendChild(el);
}

function mockUptimeResponse() {
  global.fetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve([{ servicesStatus: [], lastChecked: null }]),
  });
}

// ─── early-exit guards ───

describe('loadCardContentUptime — early exit', () => {
  test('retorna sem fetch se o card não existe no DOM', async () => {
    await loadCardContentUptime({ id: 'ghost', sourceItems: 'public/up.json' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('retorna sem fetch se sourceItems está ausente', async () => {
    makeUptimeCard('no-src');
    await loadCardContentUptime({ id: 'no-src' });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

// ─── normalização de caminho ───

describe('loadCardContentUptime — normalização de caminho', () => {
  test('remove o prefixo public/ antes do fetch', async () => {
    makeUptimeCard('u-rel');
    mockUptimeResponse();

    await loadCardContentUptime({ id: 'u-rel', sourceItems: 'public/local-data-uptimes/up.json' });

    expect(global.fetch).toHaveBeenCalledWith('local-data-uptimes/up.json');
  });

  test('remove caminho absoluto do container (/app/public/...) antes do fetch', async () => {
    makeUptimeCard('u-abs');
    mockUptimeResponse();

    await loadCardContentUptime({ id: 'u-abs', sourceItems: '/app/public/local-data-uptimes/up.json' });

    expect(global.fetch).toHaveBeenCalledWith('local-data-uptimes/up.json');
  });
});

// ─── renderização ───

describe('loadCardContentUptime — renderização', () => {
  test('renderiza serviços online e offline', async () => {
    makeUptimeCard('u-render');
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([{
        servicesStatus: [
          { url: 'https://a.com', name: 'Serviço A', status: 'online',  lastStatusOnline: '', lastStatusOffline: '' },
          { url: 'https://b.com', name: 'Serviço B', status: 'offline', lastStatusOnline: '', lastStatusOffline: '' },
        ],
        lastChecked: '2025-01-01T12:00:00Z',
      }]),
    });

    await loadCardContentUptime({ id: 'u-render', sourceItems: 'public/local-data-uptimes/up.json' });

    const content = document.getElementById('u-render').querySelector('.card-content');
    expect(content.textContent).toContain('Serviço A');
    expect(content.textContent).toContain('Serviço B');
    expect(content.textContent).toContain('Online');
    expect(content.textContent).toContain('Offline');
  });

  test('não lança erro quando o fetch falha', async () => {
    makeUptimeCard('u-err');
    global.fetch.mockResolvedValueOnce({ ok: false, status: 500 });

    await expect(
      loadCardContentUptime({ id: 'u-err', sourceItems: 'public/up.json' })
    ).resolves.not.toThrow();
  });
});
