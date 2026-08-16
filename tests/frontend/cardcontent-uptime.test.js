/**
 * @jest-environment jsdom
 */

const { loadScript } = require('./load-script');

beforeAll(() => {
  global.fetch = jest.fn();
  loadScript('helpers.js');            // cardFooterHtml, watchCardFooterFit
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

  test('mantém a data da última verificação vinda do arquivo de origem', async () => {
    makeUptimeCard('u-footer');
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([{ servicesStatus: [], lastChecked: '2025-01-01T12:00:00Z' }]),
    });

    await loadCardContentUptime({ id: 'u-footer', sourceItems: 'public/local-data-uptimes/up.json' });

    const footer = document.getElementById('u-footer').querySelector('.uptime-footer');
    expect(footer.querySelector('.card-footer-label').textContent).toBe('Atualizado em');
    expect(footer.querySelector('.card-footer-date').textContent).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}$/);
  });

  test('rodapé usa a legenda padronizada "Atualizado em"', async () => {
    makeUptimeCard('u-footer-label');
    mockUptimeResponse();

    await loadCardContentUptime({ id: 'u-footer-label', sourceItems: 'public/local-data-uptimes/up.json' });

    const footer = document.getElementById('u-footer-label').querySelector('.uptime-footer');
    expect(footer.textContent).toContain('Atualizado em');
    expect(footer.textContent).not.toContain('Última verificação');
    expect(footer.title).toContain('Atualizado em');
  });

  test('rodapé usa o formato compartilhado (.card-footer) e fica fora da lista rolável', async () => {
    makeUptimeCard('u-footer-out');
    mockUptimeResponse();

    await loadCardContentUptime({ id: 'u-footer-out', sourceItems: 'public/local-data-uptimes/up.json' });

    const footer = document.getElementById('u-footer-out').querySelector('.uptime-footer');
    expect(footer.classList.contains('card-footer')).toBe(true);
    expect(footer.closest('.uptime-list')).toBeNull();
    expect(footer.parentElement.classList.contains('uptime-card-content')).toBe(true);
  });

  test('os serviços são renderizados dentro da região rolável', async () => {
    makeUptimeCard('u-list');
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([{
        servicesStatus: [
          { url: 'https://a.com', name: 'Serviço A', status: 'online', lastStatusOnline: '', lastStatusOffline: '' },
        ],
        lastChecked: '2025-01-01T12:00:00Z',
      }]),
    });

    await loadCardContentUptime({ id: 'u-list', sourceItems: 'public/local-data-uptimes/up.json' });

    const list = document.getElementById('u-list').querySelector('.uptime-list');
    expect(list.textContent).toContain('Serviço A');
  });

  test('não lança erro quando o fetch falha', async () => {
    makeUptimeCard('u-err');
    global.fetch.mockResolvedValueOnce({ ok: false, status: 500 });

    await expect(
      loadCardContentUptime({ id: 'u-err', sourceItems: 'public/up.json' })
    ).resolves.not.toThrow();
  });
});
