/* ================================================
   MANAGE VIEWS — Criar e excluir visões
   ================================================ */

(function () {
  const modal     = document.getElementById('manage-views-modal');
  const openBtn   = document.getElementById('btn-manage-views');
  const closeBtn  = document.getElementById('close-manage-views-modal');
  const createBtn = document.getElementById('btn-create-view');
  const titleInput = document.getElementById('new-view-title');
  const slugPreview = document.getElementById('new-view-slug-preview');
  const viewsList  = document.getElementById('manage-views-list');
  const feedback   = document.getElementById('manage-views-feedback');

  if (!modal || !openBtn) return;

  /* ── Abre o modal ── */
  openBtn.addEventListener('click', () => {
    clearFeedback();
    titleInput.value = '';
    slugPreview.textContent = '';
    renderViewsList();
    modal.classList.add('show');
  });

  /* ── Fecha o modal ── */
  closeBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('show')) closeModal();
  });

  function closeModal() {
    modal.classList.remove('show');
  }

  /* ── Gera preview do slug enquanto digita ── */
  titleInput.addEventListener('input', () => {
    const slug = slugify(titleInput.value);
    slugPreview.textContent = slug ? `layout.config-${slug}.json` : '';
    clearFeedback();
  });

  /* ── Criar nova visão ── */
  createBtn.addEventListener('click', async () => {
    const title = titleInput.value.trim();
    if (!title) {
      showFeedback('Informe um nome para a visão.', 'error');
      titleInput.focus();
      return;
    }

    createBtn.disabled = true;
    clearFeedback();

    try {
      const res = await fetch('/api/views', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });

      const data = await res.json();

      if (!res.ok) {
        showFeedback(data.error || 'Erro ao criar visão.', 'error');
        return;
      }

      titleInput.value = '';
      slugPreview.textContent = '';
      showFeedback(`Visão "${data.title}" criada com sucesso.`, 'success');

      // Atualiza o selector de visões sem recarregar a página
      await reloadViewOptions();
      renderViewsList();

    } catch (err) {
      showFeedback('Erro de comunicação com o servidor.', 'error');
      console.error(err);
    } finally {
      createBtn.disabled = false;
    }
  });

  /* ── Renderiza lista de visões para exclusão ── */
  async function renderViewsList() {
    viewsList.innerHTML = '<p class="mv-loading">Carregando visões…</p>';

    try {
      const res = await fetch('/api/views');
      if (!res.ok) throw new Error('Erro ao carregar visões');
      const views = await res.json();

      if (!views.length) {
        viewsList.innerHTML = '<p class="mv-empty">Nenhuma visão cadastrada.</p>';
        return;
      }

      viewsList.innerHTML = views.map(v => `
        <div class="mv-row" data-value="${v.value}">
          <span class="mv-title">${v.title}</span>
          <span class="mv-slug">${v.value}</span>
          <button class="mv-delete-btn" data-value="${v.value}" data-title="${v.title}" title="Excluir visão">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              <path d="M10 11v6M14 11v6"/>
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
            </svg>
          </button>
        </div>
      `).join('');

      viewsList.querySelectorAll('.mv-delete-btn').forEach(btn => {
        btn.addEventListener('click', () => deleteView(btn.dataset.value, btn.dataset.title));
      });

    } catch (err) {
      viewsList.innerHTML = '<p class="mv-empty">Erro ao carregar visões.</p>';
      console.error(err);
    }
  }

  /* ── Excluir visão (com confirmação) ── */
  async function deleteView(value, title) {
    const confirmed = confirm(`Tem certeza que deseja excluir a visão "${title}"?\n\nEsta ação removerá o layout salvo e não pode ser desfeita.`);
    if (!confirmed) return;

    clearFeedback();

    try {
      const res = await fetch(`/api/views/${encodeURIComponent(value)}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showFeedback(data.error || 'Erro ao excluir visão.', 'error');
        return;
      }

      showFeedback(`Visão "${title}" excluída.`, 'success');

      // Se a visão excluída era a ativa, vai para a default
      if (typeof selectedView !== 'undefined' && selectedView === value) {
        selectedView = 'default';
      }

      await reloadViewOptions();
      renderViewsList();

    } catch (err) {
      showFeedback('Erro de comunicação com o servidor.', 'error');
      console.error(err);
    }
  }

  /* ── Recarrega o selector de visões ── */
  async function reloadViewOptions() {
    if (typeof loadViewOptions === 'function') {
      await loadViewOptions();
    }
  }

  /* ── Utilitários de feedback ── */
  function showFeedback(msg, type) {
    feedback.textContent = msg;
    feedback.className = `mv-feedback mv-feedback--${type}`;
  }

  function clearFeedback() {
    feedback.textContent = '';
    feedback.className = 'mv-feedback';
  }

  /* ── Slug (espelha a lógica do backend) ── */
  function slugify(str) {
    return str
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, ''); // hífens já colapsados acima — mantém igual ao slugify do src/app.js
  }
})();