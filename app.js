/* ═══════════════════════════════════════════════════════
   BF TRACKER — APP LOGIC
   ═══════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ── Config ──
  // Password stored as SHA-256 hash — the plaintext never appears in source
  const PASSWORD_HASH = '53936d3205956ea948a7c121a4049878481712454a540ee4c02804b25d096aaf';

  async function hashPassword(pw) {
    const encoder = new TextEncoder();
    const data = encoder.encode(pw);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  const TIERS = [
    { id: 'perfect-angel', name: 'Perfect Angel', face: '😇', color: '#c4b5fd', borderColor: '#a78bfa' },
    { id: 'good-boy',      name: 'Good Boy',      face: '🐶', color: '#6ee7b7', borderColor: '#34d399' },
    { id: 'adequate',      name: 'Adequate',      face: '😐', color: '#fcd34d', borderColor: '#fbbf24' },
    { id: 'thin-ice',      name: 'Thin Ice',      face: '😰', color: '#fdba74', borderColor: '#fb923c' },
    { id: 'jail',          name: 'Jail',          face: '⛓️', color: '#fca5a5', borderColor: '#f87171' },
    { id: 'death-row',     name: 'Death Row',     face: '💀', color: '#f87171', borderColor: '#ef4444' },
  ];

  // ── DOM Refs ──
  const loginScreen   = document.getElementById('login-screen');
  const appScreen     = document.getElementById('app-screen');
  const loginForm     = document.getElementById('login-form');
  const passwordInput = document.getElementById('password-input');
  const loginError    = document.getElementById('login-error');
  const statusText    = document.getElementById('status-text');
  const sticker       = document.getElementById('bf-sticker');
  const faceOverlay   = document.getElementById('sticker-face-overlay');
  const nameTag       = document.getElementById('sticker-name-tag');
  const stickerRing   = sticker.querySelector('.sticker-ring');
  const column        = document.getElementById('tracker-column');

  let currentTier = TIERS[0];
  let isDragging  = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  // ── Login ──
  loginForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    const pw = passwordInput.value;
    const hash = await hashPassword(pw);
    if (hash === PASSWORD_HASH) {
      loginScreen.classList.add('hidden');
      appScreen.classList.remove('hidden');
      initSticker();
    } else {
      loginError.textContent = '❌ Wrong password. Nice try!';
      loginError.classList.remove('shake');
      void loginError.offsetWidth;
      loginError.classList.add('shake');
      passwordInput.value = '';
      passwordInput.focus();
    }
  });


  // ═══════════════════════════════════════════════════════
  // STICKER DRAG LOGIC
  //
  // The sticker is position:fixed, so left/top are viewport
  // coordinates — same as getBoundingClientRect(). This
  // means you can drag it ANYWHERE on screen and the tier
  // detection always works correctly.
  // ═══════════════════════════════════════════════════════

  function initSticker() {
    requestAnimationFrame(() => {
      snapToCurrentTier(false);
    });
  }

  // ── Pointer events (mouse + touch unified) ──
  sticker.addEventListener('pointerdown', onDragStart);

  function onDragStart(e) {
    e.preventDefault();
    isDragging = true;
    sticker.classList.add('is-dragging');
    sticker.setPointerCapture(e.pointerId);

    // Record where inside the sticker the user grabbed
    const rect = sticker.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;

    document.addEventListener('pointermove', onDragMove);
    document.addEventListener('pointerup', onDragEnd);
  }

  function onDragMove(e) {
    if (!isDragging) return;
    e.preventDefault();

    // Position:fixed means left/top = viewport coords
    sticker.style.left = (e.clientX - dragOffsetX) + 'px';
    sticker.style.top  = (e.clientY - dragOffsetY) + 'px';

    // Detect which tier the sticker center is over
    detectTierUnderSticker();
  }

  function onDragEnd() {
    if (!isDragging) return;
    isDragging = false;
    sticker.classList.remove('is-dragging');
    document.removeEventListener('pointermove', onDragMove);
    document.removeEventListener('pointerup', onDragEnd);

    // Just detect the final tier — sticker stays where you dropped it
    detectTierUnderSticker();
  }


  // ═══════════════════════════════════════════════════════
  // TIER DETECTION
  //
  // Uses the sticker's vertical center (viewport Y) to
  // determine which category it's over. If it's not
  // directly over any category, picks the closest one.
  // ═══════════════════════════════════════════════════════

  function detectTierUnderSticker() {
    const stickerRect = sticker.getBoundingClientRect();
    const centerY = stickerRect.top + stickerRect.height / 2;

    const categories = column.querySelectorAll('.category');
    let detectedTier = null;

    // 1. Check direct overlap
    for (const cat of categories) {
      const r = cat.getBoundingClientRect();
      if (centerY >= r.top && centerY <= r.bottom) {
        detectedTier = TIERS.find(t => t.id === cat.dataset.tier);
        break;
      }
    }

    // 2. Fallback: closest category by vertical distance
    if (!detectedTier) {
      let minDist = Infinity;
      for (const cat of categories) {
        const r = cat.getBoundingClientRect();
        const catMidY = r.top + r.height / 2;
        const dist = Math.abs(centerY - catMidY);
        if (dist < minDist) {
          minDist = dist;
          detectedTier = TIERS.find(t => t.id === cat.dataset.tier);
        }
      }
    }

    if (detectedTier && detectedTier.id !== currentTier.id) {
      setTier(detectedTier);
    }
  }


  // ═══════════════════════════════════════════════════════
  // SNAP TO TIER
  //
  // Centers the sticker inside the active category.
  // Because both sticker (fixed) and getBoundingClientRect
  // use viewport coords, the math is straightforward.
  // ═══════════════════════════════════════════════════════

  function snapToCurrentTier(animate) {
    const tierEl = document.getElementById('cat-' + currentTier.id);
    if (!tierEl) return;

    const catRect  = tierEl.getBoundingClientRect();
    const stickerW = sticker.offsetWidth;
    const stickerH = sticker.offsetHeight;

    const targetX = catRect.left + (catRect.width / 2) - (stickerW / 2);
    const targetY = catRect.top  + (catRect.height / 2) - (stickerH / 2);

    if (animate) {
      sticker.style.transition = 'left 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), top 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
    } else {
      sticker.style.transition = 'none';
    }

    sticker.style.left = targetX + 'px';
    sticker.style.top  = targetY + 'px';

    if (animate) {
      setTimeout(() => { sticker.style.transition = ''; }, 450);
    }
  }

  // Keep sticker aligned on scroll or resize
  function onLayoutChange() {
    if (!appScreen.classList.contains('hidden') && !isDragging) {
      snapToCurrentTier(false);
    }
  }
  window.addEventListener('resize', onLayoutChange);
  window.addEventListener('scroll', onLayoutChange, { passive: true });


  // ═══════════════════════════════════════════════════════
  // SET TIER (updates face, colors, highlights)
  // ═══════════════════════════════════════════════════════

  function setTier(tier) {
    currentTier = tier;

    // Face emoji with bounce
    faceOverlay.textContent = tier.face;
    sticker.classList.remove('face-change');
    void sticker.offsetWidth;
    sticker.classList.add('face-change');
    setTimeout(() => sticker.classList.remove('face-change'), 300);

    // Name tag
    nameTag.textContent = tier.name;
    nameTag.style.color = tier.color;
    nameTag.style.borderColor = tier.borderColor;

    // Ring color
    stickerRing.style.borderColor = tier.borderColor;
    stickerRing.style.boxShadow = `0 0 0 3px ${tier.borderColor}33, 0 6px 24px rgba(0,0,0,0.4)`;

    // Header status
    statusText.textContent = tier.name;
    statusText.style.color = tier.color;

    // Highlight active row
    document.querySelectorAll('.category').forEach(c => c.classList.remove('active-tier'));
    const activeCat = document.getElementById('cat-' + tier.id);
    if (activeCat) activeCat.classList.add('active-tier');

    // Persist
    localStorage.setItem('bf-tracker-tier', tier.id);
  }

  // ── Restore on load ──
  (function restoreSavedTier() {
    const savedId = localStorage.getItem('bf-tracker-tier');
    const saved = savedId && TIERS.find(t => t.id === savedId);
    setTier(saved || TIERS[0]);
  })();

})();
