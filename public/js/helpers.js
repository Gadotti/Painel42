/* ------------------------------
    Rodapé de card — legenda única compartilhada por dynamic-list, uptime e
    cve-assets. O rótulo e a data ficam em spans separados para que o rótulo
    possa ser omitido quando o texto completo não couber na largura do card.
------------------------------- */
const CARD_FOOTER_LABEL = 'Atualizado em';

/** Conteúdo (innerHTML) de um `.card-footer` com o rótulo e a data. */
function cardFooterHtml(dateText) {
  return `<span class="card-footer-label">${CARD_FOOTER_LABEL}</span>`
       + `<span class="card-footer-date">${dateText || '—'}</span>`;
}

/**
 * Preenche um `.card-footer`. Sem data, o rodapé fica vazio (some via
 * `.card-footer:empty`). O `title` padrão traz sempre o texto completo, que
 * continua acessível por hover mesmo no modo compacto.
 */
function setCardFooterDate(footer, dateText, title) {
  if (!footer) return;

  if (!dateText) {
    footer.textContent = '';
    footer.classList.remove('card-footer--compact');
    footer.removeAttribute('title');
    return;
  }

  footer.innerHTML = cardFooterHtml(dateText);
  footer.title = title || '';   // vazio ⇒ watchCardFooterFit aplica o texto completo
  watchCardFooterFit(footer);
}

/**
 * Decide entre "Atualizado em dd/mm/aaaa hh:mm" e só a data/hora: mede o
 * texto completo (scrollWidth) contra a largura visível do rodapé e cai para
 * o modo compacto quando transbordaria.
 */
function fitCardFooter(footer) {
  if (!footer || !footer.querySelector('.card-footer-label')) return;

  footer.classList.remove('card-footer--compact');
  if (footer.scrollWidth > footer.clientWidth + 1) {
    footer.classList.add('card-footer--compact');
  }
}

/**
 * Reavalia o encaixe sempre que o card muda de tamanho (resize manual,
 * mudança de colunas/linhas, redimensionamento da janela).
 */
function watchCardFooterFit(footer) {
  if (!footer) return;

  // Sem title próprio, o texto completo fica acessível por hover no modo compacto.
  const label = footer.querySelector('.card-footer-label');
  const date  = footer.querySelector('.card-footer-date');
  if (label && date && !footer.title) {
    footer.title = `${label.textContent} ${date.textContent}`;
  }

  fitCardFooter(footer);

  if (typeof ResizeObserver === 'undefined' || footer._cardFooterFitObserver) return;

  const observer = new ResizeObserver(() => fitCardFooter(footer));
  observer.observe(footer);
  footer._cardFooterFitObserver = observer;
}

function bindStepper(inputId, decId, incId, min, max, fallback) {
  const input = document.getElementById(inputId);
  const dec   = document.getElementById(decId);
  const inc   = document.getElementById(incId);
  if (!input || !dec || !inc) return;
  dec.addEventListener('click', () => {
    input.value = Math.max(min, (parseInt(input.value, 10) || fallback) - 1);
  });
  inc.addEventListener('click', () => {
    input.value = Math.min(max, (parseInt(input.value, 10) || fallback) + 1);
  });
}

function csvToJson(csv) {
  const lines = csv.trim().split('\n');
  //const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim());
  const headers = parseCSVLine(lines[0]);

  return lines.slice(1).map(line => {
    //Regex para , como separador
    // const values = line.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g)?.map(v =>
    //   v.replace(/^"|"$/g, '').trim()
    // );

    //Regex para ; como separador
    const values = line.match(/(".*?"|[^";\s]+)(?=\s*;|\s*$)/g)?.map(v =>
      v.replace(/^"|"$/g, '').trim()
    );

    return headers.reduce((obj, header, idx) => {
      obj[header] = values[idx] || '';
      return obj;
    }, {});
  });
}

function csvToJsonCustom(csv, separator) {
  const sep = separator || ';';
  const lines = csv.trim().split('\n');
  const headers = parseCSVLineCustom(lines[0], sep);

  return lines.slice(1).map(line => {
    const values = parseCSVLineCustom(line, sep);
    return headers.reduce((obj, header, idx) => {
      obj[header] = values[idx] || '';
      return obj;
    }, {});
  });
}

function parseCSVLineCustom(line, separator) {
  const sep = (separator || ';').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(?:"([^"]*(?:""[^"]*)*)")|([^${sep}]+)`, 'g');
  const result = [];
  let match;
  while ((match = regex.exec(line)) !== null) {
    result.push(match[1] ? match[1].replace(/""/g, '"') : match[2]);
  }
  return result;
}

function parseCSVLine(line) {
  //Regex para , como separador
  //const regex = /(?:\"([^\"]*(?:\"\"[^\"]*)*)\")|([^,]+)/g;

  //Regex para ; como separador
  const regex = /(?:\"([^\"]*(?:\"\"[^\"]*)*)\")|([^;]+)/g;
  
  const result = [];
  let match;
  while ((match = regex.exec(line)) !== null) {
    result.push(match[1] ? match[1].replace(/""/g, '"') : match[2]);
  }
  return result;
}