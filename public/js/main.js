async function loadViewOptions() {
  const res = await fetch('api/views');
  const views = await res.json();

  viewSelector.innerHTML = '';

  views.forEach(view => {
    const option = document.createElement('option');
    option.value = view.value;
    option.textContent = view.title;
    viewSelector.appendChild(option);
  });

  if (!views.some(v => v.value === selectedView)) {
    selectedView = 'default';
  }

  updateViewSelector();
}

function getCurrentView() {
  return viewSelector?.value || 'default';
}

function updateViewSelector() {
  if (viewSelector && selectedView) {
    viewSelector.value = selectedView;
  }

  updateUrlForView();
}

function updateUrlForView() {
  const newUrl = `/${selectedView}`;
  window.history.replaceState({}, '', newUrl);
}

function getLayoutConfig() {
  const cards = Array.from(grid.querySelectorAll('.card'));
  return cards.map((card, index) => {
    const title = card.querySelector('.card-header .title').innerText;
    const gridColumn = card.style.gridColumn.match(/span (\d+)/);
    const gridRow = card.style.gridRow.match(/span (\d+)/);

    const zoomWrapper = card.querySelector('.frame-wrapper');
    const zoomFrame = zoomWrapper?.querySelector('iframe');
    const zoomScale = zoomFrame?.dataset.scale || 1;

    return {
      id: card.dataset.id || `card${index + 1}`,
      order: index,
      title: title,
      columns: gridColumn ? parseInt(gridColumn[1]) : 1,
      rows: gridRow ? parseInt(gridRow[1]) : 1,
      zoom: parseFloat(zoomScale)
    };
  });
}

function saveLayoutConfig() {
  const currentView = getCurrentView();
  const config = getLayoutConfig();

  fetch(`/api/layout/${currentView}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(config)
  })
  .then(response => {
    if (!response.ok) throw new Error('Erro ao salvar layout');
  })
  .catch(err => console.error(err));
}

async function fetchLayout(view = 'default') {
  try {
    const response = await fetch(`/api/layout/${view}`);
    if (!response.ok) throw new Error('Erro ao obter layout');
    const data = await response.json();
    return data || [];
  } catch (err) {
    console.error('Erro ao obter layout:', err);
    return [];
  }
}

function loadLayoutConfig() {
  localStorage.setItem('lastView', selectedView);
  updateUrlForView();

  let cardElementsList = [];

  Promise.all([fetchLayout(selectedView), fetchAvailableCards()])
    .then(([layout, allCards]) => {
      const grid = document.querySelector('.grid');
      grid.innerHTML = '';

      const cardPromises = layout.map(async layoutItem => {
        const fullCardConfig = allCards.find(card => card.id === layoutItem.id);
        if (!fullCardConfig) return;

        const mergedConfig = {
          ...fullCardConfig,
          ...layoutItem
        };

        const cardElement = createCardElement(mergedConfig);
        adjustFrameZoom(cardElement, 0, false);
        initializeCardEvents(cardElement);

        cardElementsList.push(cardElement);
      });

      return Promise.all(cardPromises);
    })
  .then(() => {
    renderCardsInOrder(grid, cardElementsList);
    loadCardsContent();
    adjustCardColSpans();
    signSocketListeners();
  })
  .catch(err => {
    console.error('Erro ao carregar configuração do layout:', err);
  });
}

function renderCardsInOrder(container, cardElementsList) {
  const sortedCards = cardElementsList.sort((a, b) => {
    return Number(a.dataset.order) - Number(b.dataset.order);
  });

  sortedCards.forEach(card => {
    container.appendChild(card);
  });
}

function createCardElement(config) {
  const card = document.createElement('div');
  const columns = config.columns ?? 1;
  const rows = config.rows ?? 1;
  const view = config.view ?? '';
  let externalSourceMonitor;

  card.className = 'card';
  card.id = config.id;
  card.dataset.id = config.id;
  card.dataset.colSpan = columns;
  card.dataset.rowSpan = rows;
  card.dataset.view = view;
  card.dataset.order = config.order;
  card.style.gridColumn = `span ${columns}`;
  card.style.gridRow = `span ${rows}`;
  card.setAttribute('draggable', true);

  let contentHtml = '';
  let contentZoomControls = '';

  switch (config.cardType) {
    case 'chart':
      externalSourceMonitor = config.sourceItems;
      contentHtml = `<canvas id="chart-${config.id}"></canvas>`;
      break;
    case 'list':
      externalSourceMonitor = config.list?.sourceItems;
      contentHtml = '<ul class="event-list"></ul>';
      break;
    case 'dynamic-list':
      externalSourceMonitor = config.dynamicList?.sourceItems;
      // O wrapper mantém o rodapé (data de alteração do arquivo) fora da área
      // de rolagem: a lista rola, o rodapé fica fixo na base do card.
      contentHtml = `
        <div class="dynamic-list-wrapper">
          <ul class="dynamic-list"></ul>
          <div class="dynamic-list-footer card-footer"></div>
        </div>`;
      break;
    case 'metric':
      contentHtml = '<div class="metric-card"></div>';
      break;
    case 'uptime':
      externalSourceMonitor = config.sourceItems;
      contentHtml = "<div class='uptime-card'></div>";
      break;
    case 'cve-assets':
      externalSourceMonitor = config.sourceItems;
      contentHtml = "<div class='asset-card'></div>";
      break;
    case 'frame':
      externalSourceMonitor = config.sourceItems;
      contentZoomControls = `
        <div class="card-zoom-controls">
          <button class="zoom-in-button" title="Aumentar zoom">➕</button>
          <button class="zoom-out-button" title="Reduzir zoom">➖</button>
          <span class="zoom-percentage">(100%)</span>
        </div>
      `;
      contentHtml = `
        <div class="frame-wrapper" data-url="${config.frame.url}" title="Clique para abrir em nova aba">
          <iframe src="${config.frame.url}" frameborder="0"></iframe>
        </div>`;
      break;
    default:
      break;
  }

  card.dataset.externalSourceMonitor = externalSourceMonitor;

  const uptimeEditBtn = config.cardType === 'uptime'
    ? `<button class="uptime-edit-button" title="Editar monitoramento">
         <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
           <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
           <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
         </svg>
       </button>`
    : '';

  const metricEditBtn = config.cardType === 'metric'
    ? `<button class="metric-edit-button" title="Editar métrica">
         <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
           <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
           <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
         </svg>
       </button>`
    : '';

  card.innerHTML = `
    <div class="card-header">
      ${contentZoomControls}
      <span class="title">${config.title}</span>
      <div class="card-controls">
        <button class="expand-button" title="Expandir">⛶</button>
        ${uptimeEditBtn}
        ${metricEditBtn}
        <button class="settings-button" title="Opções">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
      </div>
    </div>
    <div class="card-content">
      ${contentHtml}
    </div>
    <div class="resize-handle right"></div>
    <div class="resize-handle bottom"></div>
    <div class="resize-handle corner"></div>
  `;

  const iframe = getFrameFromCardElement(card);
  if (iframe) {
    const zoomScale = config.zoom ?? 1;
    iframe.dataset.scale = zoomScale;
  }

  return card;
}

function getFrameFromCardElement(cardElement) {
  const wrapper = cardElement.querySelector('.frame-wrapper');
  const iframe = wrapper?.querySelector('iframe');
  return iframe;
}

function adjustFrameZoom(cardElement, delta = 0, saveLayout = true) {
  const iframe = getFrameFromCardElement(cardElement);
  if (!iframe) return;

  const zoomDisplay = cardElement.querySelector('.zoom-percentage');

  let currentScale = parseFloat(iframe.dataset.scale) || 1.0;
  currentScale = Math.max(0.1, Math.min(2, currentScale + delta));

  iframe.style.transform = `scale(${currentScale})`;
  iframe.style.width = `${100 / currentScale}%`;
  iframe.style.height = `${95 / currentScale}%`;
  iframe.dataset.scale = currentScale.toFixed(2);

  if (zoomDisplay) {
    zoomDisplay.textContent = `(${Math.round(currentScale * 100)}%)`;
  }

  if (saveLayout) {
    saveLayoutConfig();
  }
}

async function fetchAvailableCards() {
  try {
    const response = await fetch('/api/cards');
    if (!response.ok) throw new Error('Erro ao carregar os cards');
    const cards = await response.json();
    return cards;
  } catch (err) {
    console.error('Erro ao carregar os cards:', err);
    return [];
  }
}

function loadCardsContent(cardId = '') {
  fetchAvailableCards().then(cards => {
    cards.forEach((card) => {
      if (cardId !== '' && card.id !== cardId) return;

      switch (card.cardType) {
        case 'chart':
          loadCardContentChart(card);
          break;
        case 'list':
          loadCardContentList(card);
          break;
        case 'dynamic-list':
          loadCardContentDynamicList(card);
          break;
        case 'metric':
          loadCardContentMetric(card);
          break;
        case 'frame':
          if (cardId !== '') {
            reloadCardFrame(card);
          }
          break;
        case 'uptime':
          loadCardContentUptime(card);
          break;
        case 'cve-assets':
          loadCardContentCveAssets(card);
          break;
        default:
          break;
      }

      if (card.cardType === 'frame' || card.view) {
        const cardElement = document.getElementById(card.id);
        const expandButton = cardElement?.querySelector('.expand-button');
        if (expandButton) {
          expandButton.style.display = 'block';
        }
      }

      let animateHighlight = true;
      if (card.animateHighlight !== undefined) {
        animateHighlight = card.animateHighlight;
      }

      if (animateHighlight) {
        animateCardHighlight(card.id);
      }
    });
  });
}

function reloadCardFrame(card) {
  const iframeElement = document.getElementById(card.id)?.querySelector('iframe');
  if (!iframeElement) return;
  iframeElement.src = card.frame.url;
}

async function fetchSourceItems(sourceItems, limit) {
  if (!sourceItems) return [];

  try {
    const url = `/api/partial-csv?file=${encodeURIComponent(sourceItems)}&limit=${limit}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Erro ao buscar o arquivo: ${response.status}`);
    }

    const csvText = await response.text();
    return csvToJson(csvText);
  } catch (error) {
    console.error('Erro ao carregar eventos:', error);
    return [];
  }
}

function adjustCardColSpans() {
  const cards = grid.querySelectorAll('.card');

  const gridWidth = grid.clientWidth;
  const colMinWidth = 280;
  const maxCols = Math.floor(gridWidth / colMinWidth);

  cards.forEach(card => {
    const requestedCols = parseInt(card.dataset.colSpan || '1', 10);
    const spanCols = Math.min(requestedCols, maxCols);
    card.style.gridColumn = `span ${spanCols}`;
  });
}

function animateCardHighlight(cardId) {
  const card = document.getElementById(cardId);
  if (!card) return;

  card.classList.add('highlight');

  setTimeout(() => {
    card.classList.remove('highlight');
  }, 1100);
}
