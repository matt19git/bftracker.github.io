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
    { id: 'perfect-angel', name: 'Perfect Angel', face: '😇', image: 'images/1.png', color: '#c4b5fd', borderColor: '#a78bfa' },
    { id: 'good-boy',      name: 'Good Boy',      face: '🐶', image: 'images/2.png', color: '#6ee7b7', borderColor: '#34d399' },
    { id: 'adequate',      name: 'Adequate',      face: '😐', image: 'images/3.png', color: '#fcd34d', borderColor: '#fbbf24' },
    { id: 'thin-ice',      name: 'Thin Ice',      face: '😰', image: 'images/4.png', color: '#fdba74', borderColor: '#fb923c' },
    { id: 'jail',          name: 'Jail',          face: '⛓️', image: 'images/5.png', color: '#fca5a5', borderColor: '#f87171' },
    { id: 'death-row',     name: 'Death Row',     face: '💀', image: 'images/6.png', color: '#f87171', borderColor: '#ef4444' },
  ];

  // ── DOM Refs ──
  const loginScreen   = document.getElementById('login-screen');
  const appScreen     = document.getElementById('app-screen');
  const loginForm     = document.getElementById('login-form');
  const passwordInput = document.getElementById('password-input');
  const loginError    = document.getElementById('login-error');
  const statusText    = document.getElementById('status-text');
  const sticker       = document.getElementById('bf-sticker');
  const stickerPhoto  = document.getElementById('sticker-photo');

  const nameTag       = document.getElementById('sticker-name-tag');
  const stickerRing   = sticker.querySelector('.sticker-ring');
  const column        = document.getElementById('tracker-column');

  // ── Supabase Configuration ──
  const SUPABASE_URL    = 'https://nqnhzcxyfijlkfmutaip.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xbmh6Y3h5ZmlqbGtmbXV0YWlwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY0ODY2NTEsImV4cCI6MjEwMjA2MjY1MX0.uGK-tT2R1DHH7vESz8KqsUT1ldiK1kgY_CYAuLiiVt4';
  const EDGE_FN_URL     = 'https://nqnhzcxyfijlkfmutaip.supabase.co/functions/v1/notify-discord';

  let supabase = null;
  if (window.supabase && window.supabase.createClient) {
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }

  let currentTier = TIERS[0];
  let currentPosX = 0.5;
  let currentPosY = 0.1;
  let isDragging  = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let isCustomPosition = false;

  let lastNotifiedTierId = null;
  let lastNotifiedX = null;
  let lastNotifiedY = null;

  async function sendDiscordNotification(newTierId, xPct, yPct) {
    if (!supabase) return;

    const newTier = TIERS.find(t => t.id === newTierId) || currentTier;
    const oldTier = TIERS.find(t => t.id === lastNotifiedTierId);

    lastNotifiedTierId = newTier.id;
    lastNotifiedX = xPct;
    lastNotifiedY = yPct;

    try {
      // Get the current auth session token
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return; // Not logged in, skip

      await fetch(EDGE_FN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          tierName:    newTier.name,
          tierEmoji:   newTier.face,
          oldTierName: oldTier ? oldTier.name : null,
          posX: xPct,
          posY: yPct,
        })
      });
    } catch (err) {
      console.warn('Discord notification error:', err);
    }
  }

  // ── Login ──
  loginForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    const pw = passwordInput.value;
    
    let authenticated = false;

    // Try Supabase Auth first
    if (supabase) {
      try {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: 'matthew.sadowski1@gmail.com',
          password: pw
        });
        if (data && data.session && !error) {
          authenticated = true;
        }
      } catch (err) {
        console.warn('Supabase Auth error:', err);
      }
    }

    // Fallback local hash check if Supabase offline or auth not matched
    if (!authenticated) {
      const hash = await hashPassword(pw);
      if (hash === PASSWORD_HASH) {
        authenticated = true;
      }
    }

    if (authenticated) {
      loginScreen.classList.add('hidden');
      appScreen.classList.remove('hidden');
      // sticker stays display:none until fully positioned below
      await initCloudState();
      sticker.style.display = '';      // already positioned — no flash
      sticker.style.visibility = '';   // clear any leftover
      setupRealtimeSubscription();
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
  // SUPABASE CLOUD SYNC & POSITIONING
  // ═══════════════════════════════════════════════════════

  function getRelativePosition() {
    const colRect = column.getBoundingClientRect();
    const stickerRect = sticker.getBoundingClientRect();
    const centerX = (stickerRect.left + stickerRect.width / 2) - colRect.left;
    const centerY = (stickerRect.top + stickerRect.height / 2) - colRect.top;
    return {
      x: Math.max(0, Math.min(1, centerX / colRect.width)),
      y: Math.max(0, Math.min(1, centerY / colRect.height))
    };
  }

  function applyRelativePosition(xPct, yPct, animate = false) {
    const colRect = column.getBoundingClientRect();
    const stickerW = sticker.offsetWidth || 90;
    const stickerH = sticker.offsetHeight || 90;

    const targetX = colRect.left + (xPct * colRect.width) - (stickerW / 2);
    const targetY = colRect.top + (yPct * colRect.height) - (stickerH / 2);

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

  async function saveStateToCloud(tierId, xPct, yPct) {
    // 1. Local backup
    localStorage.setItem('_upcfg', btoa(JSON.stringify({ tierId, xPct, yPct })));

    // 2. Send Discord Notification
    sendDiscordNotification(tierId, xPct, yPct);

    // 3. Cloud save via Supabase
    if (!supabase) return;
    try {
      await supabase
        .from('tracker_state')
        .update({
          tier_id: tierId,
          pos_x_pct: xPct,
          pos_y_pct: yPct,
          updated_at: new Date().toISOString()
        })
        .eq('id', 1);
    } catch (err) {
      console.warn('Supabase save error:', err);
    }
  }

  async function initCloudState() {
    let loadedTier = null;
    let loadedX = null;
    let loadedY = null;

    // Try fetching from Supabase first
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('tracker_state')
          .select('tier_id, pos_x_pct, pos_y_pct')
          .eq('id', 1)
          .single();

        if (data && !error) {
          loadedTier = TIERS.find(t => t.id === data.tier_id);
          loadedX = data.pos_x_pct;
          loadedY = data.pos_y_pct;
        }
      } catch (err) {
        console.warn('Supabase load error:', err);
      }
    }

    // Fallback to local storage if cloud missing
    if (!loadedTier) {
      try {
        const raw = localStorage.getItem('_upcfg');
        if (raw) {
          const parsed = JSON.parse(atob(raw));
          if (typeof parsed === 'object') {
            loadedTier = TIERS.find(t => t.id === parsed.tierId);
            loadedX = parsed.xPct;
            loadedY = parsed.yPct;
          } else {
            loadedTier = TIERS.find(t => t.id === parsed);
          }
        }
      } catch {
        // Ignored
      }
    }

    const tierToSet = loadedTier || TIERS[0];
    setTier(tierToSet, false);

    if (typeof loadedX === 'number' && typeof loadedY === 'number') {
      lastNotifiedTierId = tierToSet.id;
      lastNotifiedX = loadedX;
      lastNotifiedY = loadedY;
    }

    await new Promise(resolve => {
      requestAnimationFrame(() => {
        if (typeof loadedX === 'number' && typeof loadedY === 'number') {
          currentPosX = loadedX;
          currentPosY = loadedY;
          isCustomPosition = true;
          applyRelativePosition(loadedX, loadedY, false);
        } else {
          snapToCurrentTier(false);
        }
        resolve();
      });
    });
  }

  function setupRealtimeSubscription() {
    if (!supabase) return;

    supabase
      .channel('public:tracker_state')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'tracker_state', filter: 'id=eq.1' },
        (payload) => {
          if (isDragging) return; // Don't snap while user is dragging on this device
          const newRow = payload.new;
          if (!newRow) return;

          const newTier = TIERS.find(t => t.id === newRow.tier_id);
          if (newTier) {
            setTier(newTier, false);
          }

          if (typeof newRow.pos_x_pct === 'number' && typeof newRow.pos_y_pct === 'number') {
            currentPosX = newRow.pos_x_pct;
            currentPosY = newRow.pos_y_pct;
            isCustomPosition = true;
            applyRelativePosition(currentPosX, currentPosY, true);
          }
        }
      )
      .subscribe();
  }


  // ═══════════════════════════════════════════════════════
  // STICKER DRAG LOGIC
  // ═══════════════════════════════════════════════════════

  function initSticker() {
    requestAnimationFrame(() => {
      if (isCustomPosition) {
        applyRelativePosition(currentPosX, currentPosY, false);
      } else {
        snapToCurrentTier(false);
      }
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

    // Final tier detection
    detectTierUnderSticker();

    // Save relative position & tier to Supabase
    const relPos = getRelativePosition();
    currentPosX = relPos.x;
    currentPosY = relPos.y;
    isCustomPosition = true;

    saveStateToCloud(currentTier.id, relPos.x, relPos.y);
  }


  // ═══════════════════════════════════════════════════════
  // TIER DETECTION
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
      setTier(detectedTier, true);
    }
  }


  // ═══════════════════════════════════════════════════════
  // SNAP TO TIER
  // ═══════════════════════════════════════════════════════

  function snapToCurrentTier(animate) {
    const tierEl = document.getElementById('cat-' + currentTier.id);
    if (!tierEl) return;

    const catRect  = tierEl.getBoundingClientRect();
    const stickerW = sticker.offsetWidth || 90;
    const stickerH = sticker.offsetHeight || 90;

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
      if (isCustomPosition) {
        applyRelativePosition(currentPosX, currentPosY, false);
      } else {
        snapToCurrentTier(false);
      }
    }
  }
  window.addEventListener('resize', onLayoutChange);
  window.addEventListener('scroll', onLayoutChange, { passive: true });


  // ═══════════════════════════════════════════════════════
  // SET TIER (updates photo, colors, highlights)
  // ═══════════════════════════════════════════════════════

  function setTier(tier, triggerSave = false) {
    currentTier = tier;

    // Swap sticker photo to the tier's image
    stickerPhoto.src = tier.image;
    stickerPhoto.alt = tier.name;

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

    if (triggerSave) {
      const relPos = getRelativePosition();
      saveStateToCloud(tier.id, relPos.x, relPos.y);
    }
  }

  // Before login: hide sticker and clear any status so DevTools reveals nothing
  sticker.style.display = 'none';
  statusText.textContent = '—';

})();
