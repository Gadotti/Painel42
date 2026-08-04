// ------------------------------------------------------------------ CVE Assets
async function loadCardContentCveAssets(card) {
  const cardElement = document.getElementById(card.id);
  if (!cardElement || !card.sourceItems) return;

  const wrapper = cardElement.querySelector('.asset-card');

  try {
    const filePath = card.sourceItems.replace(/^.*public\//, '').trim();
    const response = await fetch(filePath);
    if (!response.ok) {
      throw new Error(`Erro ao carregar CVE report: ${response.status}`);
    }

    const data = await response.json();

    const lastScan    = data?.last_scan;
    const reportItems = data?.report_items || [];

    let cveReportBlocksHtml = '';

    reportItems.forEach(report => {
      const url            = report.url;
      const name           = report.name;
      const currentVersion = report.current_version;
      const risk           = report.risk  || '';
      const alert          = report.alert || '—';
      const pubEndDate     = report.pubEndDate_checked || '—';

      const cvesList = report.cves || [];

      let riskCss = '';
      switch ((risk || '').toLowerCase()) {
        case 'critical': riskCss = 'risco-critico'; break;
        case 'high':     riskCss = 'risco-alto';    break;
        case 'medium':   riskCss = 'risco-medio';   break;
        case 'low':      riskCss = 'risco-baixo';   break;
        default:         riskCss = 'risco-nao';     break;
      }

      const counts = { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 };
      cvesList.forEach(cve => {
        const s = (cve.severity || '').toLowerCase();
        if (counts[s] !== undefined) counts[s]++;
        else counts.unknown++;
      });

      const totalCves = cvesList.length;

      const cveItemsHtml = cvesList.map(cve => {
        const sev              = (cve.severity || 'UNKNOWN').toLowerCase();
        const aiNote           = cve.claude_ai_assessment || '';
        const pubDate          = cve.published_date || '';
        const currentAssessment = cve.assessment || '';

        const triggerLabel      = currentAssessment || 'Avaliar…';
        const triggerLabelClass = currentAssessment
          ? 'cve-assess-label cve-assess-label--set'
          : 'cve-assess-label';

        return `
          <div class="cve-item">
            <div class="cve-id">${cve.cve_id}</div>
            <div class="cve-body">
              <div class="cve-desc">${cve.description || ''}</div>
              ${pubDate ? `<div class="cve-meta"><span class="cve-meta-label">Publicado:</span> ${pubDate}</div>` : ''}
              ${aiNote  ? `<div class="cve-meta cve-ai-note"><span class="cve-meta-label">IA:</span> ${aiNote}</div>` : ''}
              <div class="cve-assess-wrapper">
                <button class="cve-assess-trigger" type="button"
                        data-cve-id="${cve.cve_id}"
                        data-report-item-id="${report.id}"
                        data-current-assessment="${currentAssessment}">
                  <span class="${triggerLabelClass}">${triggerLabel}</span>
                  <svg class="cve-assess-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none"
                       stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="6 9 12 15 18 9"/>
                  </svg>
                </button>
              </div>
            </div>
            <div class="cve-severity ${sev}">${cve.severity || 'UNKNOWN'}</div>
          </div>
        `;
      }).join('');

      cveReportBlocksHtml += `
        <div class="asset-row" onclick="toggleCveAssetsDetails(this)">
          <div class="col ativo">
            <span class="asset-toggle-icon">▶</span>
            ${name}
          </div>
          <div class="col url">
            <a href="${url}" target="_blank" class="asset-url-link" onclick="event.stopPropagation()">${url}</a>
          </div>
          <div class="col versao">${currentVersion}</div>
          <div class="col cves-count">${totalCves}</div>
          <div class="col risco"><span class="${riskCss}">${risk}</span></div>
        </div>
        <div class="asset-details asset-collapsible">
          <div class="details-content">
            <div class="details-meta-grid">
              <div><span class="details-label">Alerta:</span> ${alert}</div>
              <div><span class="details-label">Verificado em:</span> ${pubEndDate}</div>
              ${counts.critical ? `<div><span class="cve-severity critical">CRITICAL</span> ${counts.critical}</div>` : ''}
              ${counts.high     ? `<div><span class="cve-severity high">HIGH</span> ${counts.high}</div>` : ''}
              ${counts.medium   ? `<div><span class="cve-severity medium">MEDIUM</span> ${counts.medium}</div>` : ''}
              ${counts.low      ? `<div><span class="cve-severity low">LOW</span> ${counts.low}</div>` : ''}
            </div>
            ${totalCves ? `
              <div class="cve-list-header">CVEs Identificados (${totalCves})</div>
              <div class="cve-list">${cveItemsHtml}</div>
            ` : '<p style="color:var(--text-muted);font-size:0.82rem;">Nenhum CVE registrado.</p>'}
          </div>
        </div>
      `;
    });

    wrapper.innerHTML = `
      <div class="asset-card-content">
        <div class="asset-header">
          <div class="col ativo">Nome</div>
          <div class="col url">URL / Ativo</div>
          <div class="col versao">Versão</div>
          <div class="col cves-count">CVEs</div>
          <div class="col risco">Risco</div>
        </div>
        <div class="asset-list">
          ${cveReportBlocksHtml || '<p style="padding:12px;color:var(--text-muted);">Nenhum item no relatório.</p>'}
        </div>
        <div class="asset-footer card-footer">
          Última varredura: ${lastScan || '—'}
        </div>
      </div>
    `;

    const contentArea = cardElement.querySelector('.card-content');
    contentArea.innerHTML = '';
    contentArea.appendChild(wrapper);

    initCveAssessmentDropdowns(cardElement, card.id, card.sourceItems);

  } catch (err) {
    console.error(`Erro ao carregar dados de cve assets para ${card.id}:`, err);
  }
}

function toggleCveAssetsDetails(row) {
  const isExpanded = row.classList.toggle('expanded');
  const metaEl = row.nextElementSibling;

  if (metaEl && metaEl.classList.contains('asset-collapsible')) {
    metaEl.classList.toggle('expanded', isExpanded);
  }
}

// ------------------------------------------------------------------ CVE Assessment — painel flutuante

function getCveAssessPanel() {
  let panel = document.getElementById('cve-assess-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'cve-assess-panel';
    document.body.appendChild(panel);
  }
  return panel;
}

function closeCveAssessPanel() {
  const panel = document.getElementById('cve-assess-panel');
  if (!panel) return;
  panel.classList.remove('open');
  panel._activeTrigger = null;

  document.querySelectorAll('.cve-assess-trigger.open').forEach(t => {
    t.classList.remove('open');
  });
}

function initCveAssessmentDropdowns(cardElement, cardId, sourceFile) {
  const ASSESSMENT_OPTIONS = ['Acknowledge/Mitigating', 'Accepted Risk', 'Not Affected', 'False Positive'];

  cardElement.querySelectorAll('.cve-assess-trigger').forEach(trigger => {
    trigger.addEventListener('click', function (e) {
      e.stopPropagation();

      const panel = getCveAssessPanel();

      if (panel._activeTrigger === trigger && panel.classList.contains('open')) {
        closeCveAssessPanel();
        return;
      }

      closeCveAssessPanel();

      const currentAssessment = trigger.dataset.currentAssessment || '';
      const cveId             = trigger.dataset.cveId;
      const reportItemId      = trigger.dataset.reportItemId;

      panel.innerHTML = ASSESSMENT_OPTIONS.map(opt => `
        <button class="cve-assess-option${currentAssessment === opt ? ' selected' : ''}" type="button" data-value="${opt}">
          <span class="cve-assess-option-icon">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </span>
          <span class="cve-assess-option-label">${opt}</span>
        </button>
      `).join('');

      const rect     = trigger.getBoundingClientRect();
      const panelW   = 170;
      const spaceBelow = window.innerHeight - rect.bottom;
      const openUp     = spaceBelow < 130 && rect.top > 130;

      panel.style.left = `${Math.min(rect.left, window.innerWidth - panelW - 8)}px`;
      if (openUp) {
        panel.style.bottom = `${window.innerHeight - rect.top + 4}px`;
        panel.style.top    = 'auto';
      } else {
        panel.style.top    = `${rect.bottom + 4}px`;
        panel.style.bottom = 'auto';
      }

      panel._activeTrigger = trigger;
      panel.classList.add('open');
      trigger.classList.add('open');

      panel.querySelectorAll('.cve-assess-option').forEach(option => {
        option.addEventListener('click', async function (ev) {
          ev.stopPropagation();

          const value = option.dataset.value;

          const label = trigger.querySelector('.cve-assess-label');
          label.textContent = value;
          label.classList.add('cve-assess-label--set');
          trigger.dataset.currentAssessment = value;

          closeCveAssessPanel();

          suppressedCardUpdates.add(cardId);

          try {
            const response = await fetch(
              `/api/cve-assessment?file=${encodeURIComponent(sourceFile)}`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reportItemId, cveId, assessment: value })
              }
            );
            if (!response.ok) {
              console.error('Erro ao salvar assessment de CVE:', response.status);
            }
          } catch (err) {
            console.error('Erro ao salvar assessment de CVE:', err);
          } finally {
            setTimeout(() => suppressedCardUpdates.delete(cardId), 5000);
          }
        });
      });
    });
  });
}
