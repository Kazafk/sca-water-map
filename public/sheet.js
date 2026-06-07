// Bottom sheet mobile — 3 snap points : peek (80px) · half (50dvh) · full (92dvh)
// Drag sur le handle uniquement → pas de conflit avec le scroll du contenu.

export function initBottomSheet(panelEl) {
  let state    = 'closed';
  let dragStart = null;

  const SNAPS = () => {
    const h = panelEl.offsetHeight;
    const vh = window.innerHeight;
    return [
      { s: 'closed', shown: 0 },
      { s: 'peek',   shown: 80 },
      { s: 'half',   shown: Math.round(vh * 0.50) },
      { s: 'full',   shown: h },
    ];
  };

  function nearestSnap(shownPx) {
    return SNAPS().reduce((a, b) =>
      Math.abs(b.shown - shownPx) < Math.abs(a.shown - shownPx) ? b : a
    ).s;
  }

  function snapTo(s) {
    state = s;
    panelEl.dataset.sheetState = s;
  }

  // ── Touch drag on handle ──────────────────────────────────────────────────
  const handle = document.getElementById('sheet-handle');
  if (!handle) return { open: () => {}, close: () => {}, getState: () => state };

  handle.addEventListener('touchstart', (e) => {
    const m = new DOMMatrix(getComputedStyle(panelEl).transform);
    dragStart = {
      y:          e.touches[0].clientY,
      translateY: isNaN(m.m42) ? panelEl.offsetHeight : m.m42,
    };
    panelEl.style.transition = 'none';
    panelEl.dataset.sheetState = 'dragging';
  }, { passive: true });

  handle.addEventListener('touchmove', (e) => {
    if (!dragStart) return;
    const dy  = e.touches[0].clientY - dragStart.y;
    const max = panelEl.offsetHeight;
    const ty  = Math.min(max, Math.max(0, dragStart.translateY + dy));
    panelEl.style.transform = `translateY(${ty}px)`;
  }, { passive: true });

  handle.addEventListener('touchend', (e) => {
    if (!dragStart) return;
    const dy       = e.changedTouches[0].clientY - dragStart.y;
    const m        = new DOMMatrix(getComputedStyle(panelEl).transform);
    const translateY = isNaN(m.m42) ? panelEl.offsetHeight : m.m42;
    const shownPx  = panelEl.offsetHeight - translateY;
    const wasTap   = Math.abs(dy) < 8;

    // Re-enable CSS transition before snapping
    panelEl.style.transform = '';
    panelEl.style.transition = '';
    dragStart = null;

    if (wasTap) {
      // Cycle : full→half, half→peek, peek→full (never close on tap)
      const up = { closed: 'peek', peek: 'full', half: 'peek', full: 'half' };
      snapTo(up[state] || 'peek');
    } else {
      snapTo(nearestSnap(shownPx));
    }
  });

  return {
    open:     () => snapTo('half'),   // sélection commune → half par défaut
    peek:     () => snapTo('peek'),   // déselection → peek
    close:    () => snapTo('closed'),
    getState: () => state,
  };
}
