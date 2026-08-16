async function loadCardContentDynamicList(card) {
  const cardElement = document.getElementById(card.id);
  if (!cardElement) return;

  const cfg = card.dynamicList;
  if (!cfg || !cfg.sourceItems) return;

  const separator = cfg.separator || ';';
  const fields = cfg.fields || [];
  if (!fields.length) return;

  const limit = cfg.limit || 20;

  const url = `/api/partial-csv?file=${encodeURIComponent(cfg.sourceItems)}&limit=${limit}&separator=${encodeURIComponent(separator)}`;
  let items;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const csvText = await response.text();
    items = csvToJsonCustom(csvText, separator);
  } catch (err) {
    console.error('Erro ao carregar dynamic-list:', err);
    return;
  }

  if (cfg.orderBy) {
    const orderField = cfg.orderBy;
    const fieldDef = fields.find(f => f.header === orderField);
    const isDate = fieldDef && fieldDef.type === 'date';

    items.sort((a, b) => {
      const valA = isDate ? new Date(a[orderField]) : (a[orderField] || '');
      const valB = isDate ? new Date(b[orderField]) : (b[orderField] || '');
      if (cfg.order === 'asc') return valA > valB ? 1 : valA < valB ? -1 : 0;
      return valA < valB ? 1 : valA > valB ? -1 : 0;
    });
  }

  const limitedItems = items.slice(0, limit);

  const contentHtml = `
    <ul class="dynamic-list">
      ${limitedItems.map(item => `
        <li class="dynamic-list-item">
          ${fields.map(field => renderDynamicField(item, field)).join('')}
        </li>
      `).join('')}
    </ul>
  `;

  const container = cardElement.querySelector('.dynamic-list');
  if (container) {
    container.innerHTML = '';
    container.insertAdjacentHTML('beforeend', contentHtml);
  }

  await updateDynamicListFooter(cardElement, cfg.sourceItems);
}

/**
 * Preenche o rodapé do card com a data/hora da última alteração do arquivo
 * de origem. O mtime vem de /api/file-info (fs.promises.stat — mesmo
 * comportamento em Windows e Linux) em ISO 8601 e é exibido no fuso local do
 * navegador.
 */
async function updateDynamicListFooter(cardElement, sourceFile) {
  const footer = cardElement.querySelector('.dynamic-list-footer');
  if (!footer) return;

  if (!sourceFile) {
    setCardFooterDate(footer, '');
    return;
  }

  try {
    const response = await fetch(`/api/file-info?file=${encodeURIComponent(sourceFile)}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const info = await response.json();
    const date = new Date(info.mtime);
    if (isNaN(date.getTime())) throw new Error('mtime inválido');

    setCardFooterDate(footer, formatDateTimeBR(date), `Última alteração de ${sourceFile}`);
  } catch (err) {
    console.error('Erro ao obter a data de alteração do arquivo:', err);
    setCardFooterDate(footer, '');
  }
}

function formatDateTimeBR(date) {
  const pad = n => n.toString().padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} `
       + `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function renderDynamicField(item, field) {
  const raw = item[field.header] || '';

  switch (field.type) {
    case 'date': {
      const date = new Date(raw);
      if (isNaN(date.getTime())) return `<span class="dl-field dl-field--date">${raw}</span>`;
      return `<span class="dl-field dl-field--date">${formatDateTimeBR(date)}</span>`;
    }
    case 'url':
      if (!raw) return '<span class="dl-field dl-field--url"></span>';
      return `<a href="${raw}" target="_blank" class="dl-field dl-field--url" title="${raw}">Abrir link</a>`;
    default:
      return `<span class="dl-field dl-field--text" title="${raw}">${raw}</span>`;
  }
}
