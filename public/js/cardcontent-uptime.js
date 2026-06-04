async function loadCardContentUptime(card) {
  const cardElement = document.getElementById(card.id);
  if (!cardElement || !card.sourceItems) return;

  const wrapper = cardElement.querySelector('.uptime-card');

  try {
    const filePath = card.sourceItems.replace(/^.*public\//, '').trim();
    const response = await fetch(filePath);
    if (!response.ok) {
      throw new Error(`Erro ao carregar status de uptime: ${response.status}`);
    }

    const data = await response.json();
    const item = Array.isArray(data) ? data[0] : data;

    const servicesStatus = item?.servicesStatus || [];

    let uptimeBlocksHtml = '';

    servicesStatus.forEach(service => {
      const url = service.url;
      const name = service.name || service.url;
      const status = service.status.toLowerCase();
      const statusText = status === 'online' ? 'Online' : 'Offline';

      let lastOnline = '-';
      if (service.lastStatusOnline && service.lastStatusOnline !== '') {
        lastOnline = new Date(service.lastStatusOnline).toLocaleString('pt-BR', {
          day: '2-digit', month: '2-digit', year: 'numeric',
          hour: '2-digit', minute: '2-digit', second: '2-digit'
        });
      }

      let lastOffline = '-';
      if (service.lastStatusOffline && service.lastStatusOffline !== '') {
        lastOffline = new Date(service.lastStatusOffline).toLocaleString('pt-BR', {
          day: '2-digit', month: '2-digit', year: 'numeric',
          hour: '2-digit', minute: '2-digit', second: '2-digit'
        });
      }

      uptimeBlocksHtml += `
        <div class="uptime-header" onclick="toggleUptimeMeta(this)">
          <div class="uptime-header-left">
            <span class="uptime-toggle-icon">▶</span>
            <a class="uptime-url" target="_blank" href="${url}">${name}</a>
          </div>
          <div class="uptime-status-indicator ${status}">${statusText}</div>
        </div>
        <div class="uptime-meta collapsible">
          <div class="uptime-time"><strong>Última vez online:</strong> ${lastOnline}</div>
          <div class="uptime-time"><strong>Última vez offline:</strong> ${lastOffline}</div>
        </div>
      `;
    });

    const lastChecked = new Date(item?.lastChecked || null);
    const formattedDate = !isNaN(lastChecked)
      ? lastChecked.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }).replace(',', '')
      : 'Data inválida';

    wrapper.innerHTML = `
    <div class="uptime-card-content">
      ${uptimeBlocksHtml}
      <div class="uptime-footer">
        <span class="uptime-label">Última verificação:</span>
        <span class="uptime-date">${formattedDate}</span>
      </div>
    </div>
    `;

    const contentArea = cardElement.querySelector('.card-content');
    contentArea.innerHTML = '';
    contentArea.appendChild(wrapper);
  } catch (err) {
    console.error(`Erro ao carregar dados de uptime para ${card.id}:`, err);
  }
}

function toggleUptimeMeta(headerEl) {
  const isExpanded = headerEl.classList.toggle('expanded');
  const metaEl = headerEl.nextElementSibling;

  if (metaEl && metaEl.classList.contains('collapsible')) {
    metaEl.classList.toggle('expanded', isExpanded);
  }
}
