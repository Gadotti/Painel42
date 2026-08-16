/**
 * @jest-environment jsdom
 */

const { loadScript } = require('./load-script');

beforeAll(() => {
  loadScript('helpers.js');
});

describe('parseCSVLine', () => {
  test('parses semicolon-delimited line', () => {
    const result = parseCSVLine('timestamp;event;detailsUrl');
    expect(result).toEqual(['timestamp', 'event', 'detailsUrl']);
  });

  test('handles quoted fields with inner semicolons', () => {
    const result = parseCSVLine('"campo;com;ponto";valor2;valor3');
    expect(result).toEqual(['campo;com;ponto', 'valor2', 'valor3']);
  });

  test('handles quoted fields with escaped double quotes', () => {
    const result = parseCSVLine('"campo ""aspas""";outro');
    expect(result).toEqual(['campo "aspas"', 'outro']);
  });

  test('handles single field', () => {
    const result = parseCSVLine('unico');
    expect(result).toEqual(['unico']);
  });
});

describe('csvToJson', () => {
  test('converts basic CSV to array of objects', () => {
    const csv = 'timestamp;event;detailsUrl\n2024-01-01;Login;http://example.com';
    const result = csvToJson(csv);
    expect(result).toEqual([
      { timestamp: '2024-01-01', event: 'Login', detailsUrl: 'http://example.com' }
    ]);
  });

  test('converts multiple rows', () => {
    const csv = [
      'col1;col2',
      'a;b',
      'c;d'
    ].join('\n');
    const result = csvToJson(csv);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ col1: 'a', col2: 'b' });
    expect(result[1]).toEqual({ col1: 'c', col2: 'd' });
  });

  test('handles missing values as empty strings', () => {
    const csv = 'h1;h2;h3\nonly';
    const result = csvToJson(csv);
    expect(result[0]).toEqual({ h1: 'only', h2: '', h3: '' });
  });

  test('handles quoted values', () => {
    const csv = 'name;desc\n"Alice";"Desc com espaco"';
    const result = csvToJson(csv);
    expect(result[0]).toEqual({ name: 'Alice', desc: 'Desc com espaco' });
  });
});

// ─── rodapé de card: legenda "Atualizado em" + modo compacto ───

describe('cardFooterHtml', () => {
  test('monta rótulo e data em spans separados', () => {
    const el = document.createElement('div');
    el.innerHTML = cardFooterHtml('10/03/2025 14:32');

    expect(el.querySelector('.card-footer-label').textContent).toBe('Atualizado em');
    expect(el.querySelector('.card-footer-date').textContent).toBe('10/03/2025 14:32');
  });

  test('usa "—" quando não há data', () => {
    const el = document.createElement('div');
    el.innerHTML = cardFooterHtml('');
    expect(el.querySelector('.card-footer-date').textContent).toBe('—');
  });
});

describe('setCardFooterDate', () => {
  function makeFooter() {
    const footer = document.createElement('div');
    footer.className = 'card-footer';
    document.body.appendChild(footer);
    return footer;
  }

  afterEach(() => { document.body.innerHTML = ''; });

  test('preenche rótulo, data e title padrão', () => {
    const footer = makeFooter();
    setCardFooterDate(footer, '10/03/2025 14:32');

    expect(footer.querySelector('.card-footer-label').textContent).toBe('Atualizado em');
    expect(footer.title).toBe('Atualizado em 10/03/2025 14:32');
  });

  test('respeita um title personalizado', () => {
    const footer = makeFooter();
    setCardFooterDate(footer, '10/03/2025 14:32', 'Última alteração de /dados/x.csv');

    expect(footer.title).toBe('Última alteração de /dados/x.csv');
  });

  test('esvazia o rodapé (e limpa title/compacto) sem data', () => {
    const footer = makeFooter();
    setCardFooterDate(footer, '10/03/2025 14:32');
    footer.classList.add('card-footer--compact');

    setCardFooterDate(footer, '');

    expect(footer.textContent).toBe('');
    expect(footer.hasAttribute('title')).toBe(false);
    expect(footer.classList.contains('card-footer--compact')).toBe(false);
  });

  test('não quebra com rodapé inexistente', () => {
    expect(() => setCardFooterDate(null, '10/03/2025 14:32')).not.toThrow();
  });
});

describe('fitCardFooter', () => {
  function makeFooter(scrollWidth, clientWidth) {
    const footer = document.createElement('div');
    footer.className = 'card-footer';
    footer.innerHTML = cardFooterHtml('10/03/2025 14:32');
    // jsdom não faz layout: as medidas são simuladas.
    Object.defineProperty(footer, 'scrollWidth', { get: () => scrollWidth });
    Object.defineProperty(footer, 'clientWidth', { get: () => clientWidth });
    document.body.appendChild(footer);
    return footer;
  }

  afterEach(() => { document.body.innerHTML = ''; });

  test('mantém o rótulo quando o texto completo cabe', () => {
    const footer = makeFooter(120, 200);
    fitCardFooter(footer);
    expect(footer.classList.contains('card-footer--compact')).toBe(false);
  });

  test('oculta o rótulo quando o texto completo não cabe', () => {
    const footer = makeFooter(220, 120);
    fitCardFooter(footer);
    expect(footer.classList.contains('card-footer--compact')).toBe(true);
  });

  test('volta ao formato completo quando o card cresce', () => {
    const footer = document.createElement('div');
    footer.className = 'card-footer';
    footer.innerHTML = cardFooterHtml('10/03/2025 14:32');
    let clientWidth = 120;
    Object.defineProperty(footer, 'scrollWidth', { get: () => 220 });
    Object.defineProperty(footer, 'clientWidth', { get: () => clientWidth });
    document.body.appendChild(footer);

    fitCardFooter(footer);
    expect(footer.classList.contains('card-footer--compact')).toBe(true);

    clientWidth = 300;
    fitCardFooter(footer);
    expect(footer.classList.contains('card-footer--compact')).toBe(false);
  });

  test('ignora rodapés sem rótulo', () => {
    const footer = document.createElement('div');
    footer.className = 'card-footer';
    document.body.appendChild(footer);

    expect(() => fitCardFooter(footer)).not.toThrow();
    expect(footer.classList.contains('card-footer--compact')).toBe(false);
  });
});
