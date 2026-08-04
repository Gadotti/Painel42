/**
 * @jest-environment jsdom
 */

const { loadScript } = require('./load-script');

beforeAll(() => {
  global.fetch = jest.fn();
  loadScript('helpers.js');            // csvToJsonCustom
  loadScript('cardcontent-dynamic-list.js');
});

afterEach(() => {
  jest.clearAllMocks();
  document.body.innerHTML = '';
});

// Reproduz o markup gerado por createCardElement para cards dynamic-list
function makeDynamicListCard(id) {
  const el = document.createElement('div');
  el.id = id;
  el.innerHTML = `
    <div class="card-content">
      <div class="dynamic-list-wrapper">
        <ul class="dynamic-list"></ul>
        <div class="dynamic-list-footer"></div>
      </div>
    </div>`;
  document.body.appendChild(el);
  return el;
}

const CSV = 'data;titulo\n2025-03-01T10:00:00;Evento A\n2025-03-02T11:00:00;Evento B';

const CARD = {
  id: 'dl-1',
  cardType: 'dynamic-list',
  dynamicList: {
    sourceItems: '/dados/eventos.csv',
    separator: ';',
    limit: 10,
    fields: [
      { header: 'data',   type: 'date' },
      { header: 'titulo', type: 'text' },
    ],
  },
};

function mockCsv(csv = CSV) {
  global.fetch.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(csv) });
}

function mockFileInfo(mtime) {
  global.fetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ mtime, size: 128 }) });
}

// ─── rodapé: data de alteração do arquivo ───

describe('loadCardContentDynamicList — rodapé com data de alteração', () => {
  test('consulta /api/file-info com o caminho do arquivo de origem', async () => {
    makeDynamicListCard('dl-1');
    mockCsv();
    mockFileInfo('2025-03-10T14:32:00');

    await loadCardContentDynamicList(CARD);

    expect(global.fetch).toHaveBeenCalledWith(
      `/api/file-info?file=${encodeURIComponent('/dados/eventos.csv')}`
    );
  });

  test('exibe a data/hora formatada em pt-BR no rodapé', async () => {
    const el = makeDynamicListCard('dl-1');
    mockCsv();
    mockFileInfo('2025-03-10T14:32:00');   // sem Z: interpretado no fuso local

    await loadCardContentDynamicList(CARD);

    const footer = el.querySelector('.dynamic-list-footer');
    expect(footer.textContent).toBe('Atualizado em 10/03/2025 14:32');
    expect(footer.title).toContain('/dados/eventos.csv');
  });

  test('converte mtime em UTC para o fuso local do navegador', async () => {
    const el = makeDynamicListCard('dl-1');
    mockCsv();
    mockFileInfo('2025-03-10T14:32:05.000Z');

    await loadCardContentDynamicList(CARD);

    const footer = el.querySelector('.dynamic-list-footer');
    expect(footer.textContent).toMatch(/^Atualizado em \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
  });

  test('mantém o rodapé fora da lista rolável', async () => {
    const el = makeDynamicListCard('dl-1');
    mockCsv();
    mockFileInfo('2025-03-10T14:32:00');

    await loadCardContentDynamicList(CARD);

    const footer = el.querySelector('.dynamic-list-footer');
    expect(footer.closest('.dynamic-list')).toBeNull();
    expect(footer.parentElement.classList.contains('dynamic-list-wrapper')).toBe(true);
  });

  test('rodapé fica vazio quando /api/file-info falha', async () => {
    const el = makeDynamicListCard('dl-1');
    mockCsv();
    global.fetch.mockResolvedValueOnce({ ok: false, status: 404 });

    await loadCardContentDynamicList(CARD);

    const footer = el.querySelector('.dynamic-list-footer');
    expect(footer.textContent).toBe('');
    expect(footer.hasAttribute('title')).toBe(false);
    // a lista continua renderizada
    expect(el.querySelector('.dynamic-list').textContent).toContain('Evento A');
  });

  test('rodapé fica vazio quando o mtime é inválido', async () => {
    const el = makeDynamicListCard('dl-1');
    mockCsv();
    mockFileInfo('not-a-date');

    await loadCardContentDynamicList(CARD);

    expect(el.querySelector('.dynamic-list-footer').textContent).toBe('');
  });

  test('não consulta /api/file-info quando o CSV falha', async () => {
    makeDynamicListCard('dl-1');
    global.fetch.mockResolvedValueOnce({ ok: false, status: 500 });

    await loadCardContentDynamicList(CARD);

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

// ─── updateDynamicListFooter isolado ───

describe('updateDynamicListFooter', () => {
  test('não faz fetch quando o rodapé não existe no card', async () => {
    const el = document.createElement('div');
    el.innerHTML = '<ul class="dynamic-list"></ul>';
    document.body.appendChild(el);

    await updateDynamicListFooter(el, '/dados/eventos.csv');

    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('não faz fetch quando o arquivo de origem não está definido', async () => {
    const el = makeDynamicListCard('dl-2');

    await updateDynamicListFooter(el, undefined);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(el.querySelector('.dynamic-list-footer').textContent).toBe('');
  });
});
