async function loadCardContentMetric(card) {
  const cardElement = document.getElementById(card.id);
  if (!cardElement) return;

  const cfg = card.metric;
  if (!cfg || !Array.isArray(cfg.sources) || !cfg.sources.length) return;

  let allCards;
  try {
    const res = await fetch('/api/cards');
    if (!res.ok) throw new Error();
    allCards = await res.json();
  } catch {
    return;
  }

  const results = [];

  for (const source of cfg.sources) {
    const sourceCard = allCards.find(c => c.id === source.cardId);
    if (!sourceCard) continue;

    const label = sourceCard.title || sourceCard.id;
    let value = null;

    try {
      switch (sourceCard.cardType) {
        case 'list': {
          const file = sourceCard.list?.sourceItems;
          if (!file) break;
          subscribeCardToFile(card.id, file);
          const res = await fetch(`/api/csv-count?file=${encodeURIComponent(file)}`);
          if (!res.ok) break;
          const data = await res.json();
          value = data.count ?? 0;
          break;
        }
        case 'dynamic-list': {
          const file = sourceCard.dynamicList?.sourceItems;
          if (!file) break;
          subscribeCardToFile(card.id, file);
          const res = await fetch(`/api/csv-count?file=${encodeURIComponent(file)}`);
          if (!res.ok) break;
          const data = await res.json();
          value = data.count ?? 0;
          break;
        }
        case 'uptime': {
          const file = sourceCard.sourceItems;
          if (!file) break;
          subscribeCardToFile(card.id, file);
          const filePath = file.replace(/^.*public\//, '').trim();
          const res = await fetch(filePath);
          if (!res.ok) break;
          const data = await res.json();
          const item = Array.isArray(data) ? data[0] : data;
          const services = item?.servicesStatus || [];
          const filter = (source.uptimeFilter || 'offline').toLowerCase();
          value = services.filter(s => (s.status || '').toLowerCase() === filter).length;
          break;
        }
        case 'cve-assets': {
          const file = sourceCard.sourceItems;
          if (!file) break;
          subscribeCardToFile(card.id, file);
          const filePath = file.replace(/^.*public\//, '').trim();
          const res = await fetch(filePath);
          if (!res.ok) break;
          const data = await res.json();
          const reportItems = data?.report_items || [];
          let pending = 0;
          reportItems.forEach(report => {
            (report.cves || []).forEach(cve => { if (!cve.assessment) pending++; });
          });
          value = pending;
          break;
        }
      }
    } catch (err) {
      console.error(`Erro ao carregar métrica da fonte "${source.cardId}":`, err);
    }

    if (value !== null) results.push({ label, value });
  }

  const wrapper = cardElement.querySelector('.metric-card');
  if (!wrapper) return;

  wrapper.innerHTML = results.map(r => `
    <div class="metric-item">
      <span class="metric-value">${r.value}</span>
      <span class="metric-label">${r.label}</span>
    </div>
  `).join('');
}
