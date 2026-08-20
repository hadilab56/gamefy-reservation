/* ========================================
   GAMEFY ACADEMY — Application Logic
   ======================================== */

(function() {
  'use strict';

  // ---- STATE ----
  const state = {
    currentView: 'dashboard',
    user: null,
    calendarMonth: new Date().getMonth(),
    calendarYear: new Date().getFullYear(),
    stationDate: new Date(),
    filterDate: '',
    filterStatus: 'all',
    searchQuery: '',
    currentPage: 1,
    editingId: null,
    deletingId: null,
    deletingName: ''
  };

  // ---- API CLIENT ----
  const api = {
    async request(url, options = {}) {
      const defaults = {
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
      };
      const res = await fetch(url, { ...defaults, ...options });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      return data;
    },

    // Auth
    needsSetup: () => api.request('/api/auth/needs-setup'),
    setup: (d) => api.request('/api/auth/setup', { method: 'POST', body: JSON.stringify(d) }),
    login: (d) => api.request('/api/auth/login', { method: 'POST', body: JSON.stringify(d) }),
    logout: () => api.request('/api/auth/logout', { method: 'POST' }),
    me: () => api.request('/api/auth/me'),

    // Reservations
    getReservations: (params) => {
      const qs = new URLSearchParams(params).toString();
      return api.request(`/api/reservations?${qs}`);
    },
    getStats: () => api.request('/api/reservations/stats'),
    getCalendar: (month, year) => api.request(`/api/reservations/calendar?month=${month}&year=${year}`),
    getStations: (date) => api.request(`/api/reservations/stations?date=${date}`),
    createReservation: (d) => api.request('/api/reservations', { method: 'POST', body: JSON.stringify(d) }),
    updateReservation: (id, d) => api.request(`/api/reservations/${id}`, { method: 'PUT', body: JSON.stringify(d) }),
    deleteReservation: (id) => api.request(`/api/reservations/${id}`, { method: 'DELETE' })
  };

  // ---- UTILITY ----
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  function formatDate(d) {
    if (!d) return '';
    const date = new Date(d);
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  function formatDateISO(d) {
    const date = new Date(d);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function toTimeInput(timeStr) {
    if (!timeStr) return '';
    // Handle formats like "19:30", "19h", "13h"
    const cleaned = timeStr.replace('h', ':00').replace(/\s/g, '');
    if (/^\d{1,2}:\d{2}$/.test(cleaned)) return cleaned.padStart(5, '0');
    return timeStr;
  }

  function statusBadgeClass(status) {
    return `status-badge status-${status}`;
  }

  function statusLabel(status) {
    return status.charAt(0).toUpperCase() + status.slice(1);
  }

  function showToast(message, type = 'success') {
    const container = $('#toast-container');
    const icons = {
      success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22,4 12,14.01 9,11.01"/></svg>',
      error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>',
      info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>'
    };

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `${icons[type] || icons.info}<span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('toast-out');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // ---- CLOCK ----
  function updateClock() {
    const now = new Date();
    const time = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    const el = $('#live-clock');
    if (el) el.textContent = time;
  }

  // ---- AUTH ----
  async function checkAuth() {
    try {
      const { needsSetup } = await api.needsSetup();
      if (needsSetup) {
        showLogin(true);
        return;
      }

      try {
        const { user } = await api.me();
        state.user = user;
        showApp();
      } catch {
        showLogin(false);
      }
    } catch {
      showLogin(false);
    }
  }

  function showLogin(isSetup) {
    $('#login-page').classList.add('active');
    $('#app-page').classList.remove('active');

    if (isSetup) {
      $('#setup-form').classList.remove('hidden');
      $('#login-form').classList.add('hidden');
    } else {
      $('#setup-form').classList.add('hidden');
      $('#login-form').classList.remove('hidden');
    }
  }

  function showApp() {
    $('#login-page').classList.remove('active');
    $('#app-page').classList.add('active');

    // Update user info
    if (state.user) {
      const name = state.user.displayName || state.user.username;
      $('#user-name').textContent = name;
      $('#user-role').textContent = state.user.role === 'admin' ? 'Administrator' : 'Staff';
      $('#user-avatar').textContent = name.charAt(0).toUpperCase();
    }

    // Load initial view
    navigateTo('dashboard');
  }

  // ---- NAVIGATION ----
  function navigateTo(view) {
    state.currentView = view;

    // Update nav
    $$('.nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.view === view);
    });

    // Update views
    $$('.view').forEach(el => {
      el.classList.toggle('active', el.id === `view-${view}`);
    });

    // Update title
    const titles = {
      dashboard: 'Dashboard',
      reservations: 'Reservations',
      stations: 'Station Map',
      calendar: 'Calendar'
    };
    $('#page-title').textContent = titles[view] || 'Dashboard';

    // Load data
    switch (view) {
      case 'dashboard': loadDashboard(); break;
      case 'reservations': loadReservations(); break;
      case 'stations': loadStations(); break;
      case 'calendar': loadCalendar(); break;
    }

    // Close mobile sidebar
    $('#sidebar').classList.remove('open');
  }

  // ---- DASHBOARD ----
  async function loadDashboard() {
    try {
      const stats = await api.getStats();

      // Animate stat values
      animateValue($('#stat-today-val'), stats.today);
      animateValue($('#stat-active-val'), stats.active);
      animateValue($('#stat-pending-val'), stats.pending);
      animateValue($('#stat-total-val'), stats.total);

      // Today's date badge
      const today = new Date();
      $('#today-date').textContent = today.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

      // Today's timeline
      const todayISO = formatDateISO(today);
      const { reservations } = await api.getReservations({ date: todayISO, limit: 50 });
      renderTimeline(reservations);

      // Upcoming
      renderUpcoming(stats.upcoming);
    } catch (err) {
      console.error('Dashboard error:', err);
    }
  }

  function animateValue(el, target) {
    const start = parseInt(el.textContent) || 0;
    if (start === target) { el.textContent = target; return; }
    const duration = 600;
    const startTime = performance.now();

    function update(currentTime) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = Math.round(start + (target - start) * eased);
      if (progress < 1) requestAnimationFrame(update);
    }

    requestAnimationFrame(update);
  }

  // ---- TIME UTILITIES FOR HORIZONTAL AGENDA ----
  function timeStrToMinutes(str) {
    if (!str) return null;
    const parts = str.trim().split(':');
    if (parts.length < 2) return null;
    let h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    if (isNaN(h) || isNaN(m)) return null;
    if (h < 5) h += 24; // Handle night hours past midnight (00:00 to 04:59)
    return h * 60 + m;
  }

  function formatMinutesToTime(mins) {
    if (mins === null || isNaN(mins)) return '';
    let h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h >= 24) h -= 24;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  function getEstimatedDurationMinutes(durationStr) {
    if (!durationStr) return 120; // default 2 hours
    const d = durationStr.toLowerCase().trim();
    const match = d.match(/(\d+(\.\d+)?)\s*h/);
    if (match) return Math.round(parseFloat(match[1]) * 60);
    const numMatch = d.match(/(\d+)/);
    if (numMatch) return parseInt(numMatch[1], 10) * 60;
    return 120;
  }

  function getLeavingTimeInfo(r) {
    const startMins = timeStrToMinutes(r.arrivalTime);
    if (startMins === null) return { leavingTime: r.leavingTime || '', durationText: r.duration || '2h', endMins: 0, startMins: 0 };
    
    let endMins = timeStrToMinutes(r.leavingTime);
    let durationText = r.duration;
    
    if (endMins === null || endMins <= startMins) {
      const durMins = getEstimatedDurationMinutes(r.duration);
      endMins = startMins + durMins;
      if (!durationText) {
        durationText = durMins >= 60 ? `${Math.round(durMins / 60)}h` : `${durMins}m`;
      }
    } else {
      const diffMins = endMins - startMins;
      if (!durationText) {
        const h = Math.floor(diffMins / 60);
        const m = diffMins % 60;
        durationText = m > 0 ? `${h}h ${m}m` : `${h}h`;
      }
    }
    
    const leavingTime = r.leavingTime || formatMinutesToTime(endMins);
    return { leavingTime, durationText, endMins, startMins };
  }

  function renderHorizontalDailyAgenda(container, reservations, targetDateStr, prefix) {
    if (!reservations || !reservations.length) {
      container.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
          <p>No reservations for this day</p>
        </div>
      `;
      return;
    }

    // Sort by arrival time ascending
    const sorted = [...reservations].sort((a, b) => {
      const ma = timeStrToMinutes(a.arrivalTime) || 0;
      const mb = timeStrToMinutes(b.arrivalTime) || 0;
      return ma - mb;
    });

    // Fixed full-day hourly timeline (10:00 AM to 02:00 AM - 16 hours span, non-adjustable)
    const minHour = 10;
    const maxHour = 26; // 02:00 AM next day
    const totalHours = maxHour - minHour;
    const minMins = minHour * 60;
    const maxMins = maxHour * 60;
    const spanMins = maxMins - minMins;

    // Build horizontal time ruler hours & vertical grid guide lines
    let hoursHtml = '';
    let gridLinesHtml = '';
    for (let h = minHour; h <= maxHour; h++) {
      let displayH = h >= 24 ? h - 24 : h;
      const hourStr = `${String(displayH).padStart(2, '0')}:00`;
      hoursHtml += `<div class="h-ruler-hour"><span>${hourStr}</span></div>`;

      if (h < maxHour) {
        const lineLeftPct = ((h - minHour) / totalHours) * 100;
        gridLinesHtml += `<div class="h-grid-line" style="left: ${lineLeftPct}%"></div>`;
      }
    }
    // Final boundary line
    gridLinesHtml += `<div class="h-grid-line" style="left: 100%"></div>`;

    // Check if viewed day is today for NOW indicator
    const now = new Date();
    const isToday = targetDateStr === formatDateISO(now);
    let nowIndicatorHtml = '';
    if (isToday) {
      let nowH = now.getHours();
      if (nowH < 5) nowH += 24;
      const nowMins = nowH * 60 + now.getMinutes();
      if (nowMins >= minMins && nowMins <= maxMins) {
        const nowPercent = ((nowMins - minMins) / spanMins) * 100;
        nowIndicatorHtml = `
          <div class="h-now-line" style="left: ${nowPercent}%">
            <span class="h-now-tag">NOW</span>
          </div>
        `;
      }
    }

    // Assign tracks to overlapping reservations
    const tracks = [];
    const blockItems = sorted.map((r) => {
      const info = getLeavingTimeInfo(r);
      const startM = info.startMins !== null ? info.startMins : minMins;
      const endM = Math.max(startM + 50, info.endMins);

      let leftPct = ((startM - minMins) / spanMins) * 100;
      let widthPct = ((endM - startM) / spanMins) * 100;
      leftPct = Math.max(0, Math.min(97, leftPct));
      widthPct = Math.max(4, Math.min(100 - leftPct, widthPct));

      // Find free track row
      let trackIndex = 0;
      while (tracks[trackIndex] !== undefined && tracks[trackIndex] > startM) {
        trackIndex++;
      }
      tracks[trackIndex] = endM;

      const isVip = r.stations.includes('VIP Room') || r.stationType === 'vip';
      const statusClass = `status-${r.status}`;
      const vipClass = isVip ? 'is-vip' : '';

      return `
        <div class="h-timeline-block ${statusClass} ${vipClass}" 
             style="left: ${leftPct}%; width: ${widthPct}%; top: ${trackIndex * 46 + 8}px;"
             onclick="window.app.highlightAgendaCard('${prefix}', '${r._id}')"
             title="${escapeHtml(r.name)} (${r.arrivalTime} → ${info.leavingTime})">
          <div class="block-glow"></div>
          <span class="block-time">${r.arrivalTime}</span>
          <span class="block-name">${escapeHtml(r.name)}</span>
          ${r.stations.length ? `<span class="block-station">${r.stations.map(s => s === 'VIP Room' ? 'VIP' : s).join(', ')}</span>` : ''}
          <span class="block-duration">${escapeHtml(info.durationText)}</span>
        </div>
      `;
    });

    const trackAreaHeight = Math.max(70, tracks.length * 46 + 20);

    // Build horizontal cards grid
    const cardsHtml = sorted.map((r) => {
      const info = getLeavingTimeInfo(r);
      const isVip = r.stations.includes('VIP Room') || r.stationType === 'vip';
      const initials = r.name.split(' ').map(n => n[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || 'U';

      return `
        <div class="agenda-card-h ${isVip ? 'vip-card' : ''}" id="${prefix}-card-${r._id}" data-id="${r._id}">
          <div class="card-h-top">
            <div class="card-h-user">
              <div class="card-h-avatar ${isVip ? 'avatar-vip' : ''}">${initials}</div>
              <div class="card-h-meta">
                <span class="card-h-name" title="${escapeHtml(r.name)}">${escapeHtml(r.name)}</span>
                ${r.phone ? `<a href="tel:${r.phone}" class="card-h-phone" title="Call ${r.phone}">📞 ${escapeHtml(r.phone)}</a>` : '<span class="card-h-no-phone">No phone</span>'}
              </div>
            </div>
            <div class="card-h-status">
              <span class="${statusBadgeClass(r.status)}" onclick="window.app.cycleStatus('${r._id}', '${r.status}')" title="Click to change status">
                ${statusLabel(r.status)}
              </span>
            </div>
          </div>

          <!-- Horizontal Time Strip -->
          <div class="card-h-time-strip">
            <div class="time-block time-arr">
              <span class="time-label">ARRIVAL</span>
              <span class="time-value">${r.arrivalTime}</span>
            </div>
            <div class="time-vector">
              <span class="time-duration">⏱ ${escapeHtml(info.durationText)}</span>
              <div class="time-vector-bar">
                <div class="time-vector-line"></div>
                <div class="time-vector-head">▶</div>
              </div>
            </div>
            <div class="time-block time-dep">
              <span class="time-label">LEAVING</span>
              <span class="time-value">${escapeHtml(info.leavingTime || '—')}</span>
            </div>
          </div>

          <div class="card-h-stations">
            ${r.stations.length 
              ? r.stations.map(s => `<span class="station-tag${s === 'VIP Room' ? ' vip' : (s.startsWith('PS5') ? ' ps5' : '')}">${s}</span>`).join('') 
              : '<span class="text-muted" style="font-size:0.75rem">No station assigned</span>'}
          </div>

          ${r.notes ? `
            <div class="card-h-notes" title="${escapeHtml(r.notes)}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
              <span>${escapeHtml(r.notes)}</span>
            </div>
          ` : ''}

          <div class="card-h-actions">
            <button class="btn btn-outline btn-xs" onclick="window.app.editReservation('${r._id}')" title="Edit reservation">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              <span>Edit</span>
            </button>
            <button class="btn btn-outline btn-xs btn-h-delete" onclick="window.app.confirmDelete('${r._id}', '${escapeHtml(r.name)}')" title="Delete reservation">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,6 5,6 21,6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
              <span>Delete</span>
            </button>
          </div>
        </div>
      `;
    }).join('');

    container.innerHTML = `
      <div class="agenda-horizontal-wrapper">
        <!-- Full-Width Visual Horizontal Hourly Timeline Track -->
        <div class="agenda-h-track-container">
          <div class="agenda-h-track-header">
            <span class="track-header-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              FULL DAY HOURLY TIMELINE
            </span>
            <span class="track-header-count">${sorted.length} ${sorted.length === 1 ? 'reservation' : 'reservations'} scheduled</span>
          </div>
          
          <div class="agenda-h-track-fullwidth">
            <!-- Ruler Hour Marks -->
            <div class="h-ruler-scale">
              ${hoursHtml}
            </div>
            <!-- Blocks Area with Vertical Hour Grid Lines -->
            <div class="h-blocks-area" style="height: ${trackAreaHeight}px;">
              <div class="h-grid-lines-container">
                ${gridLinesHtml}
              </div>
              ${nowIndicatorHtml}
              ${blockItems.join('')}
            </div>
          </div>
        </div>

        <!-- Full-Width Agenda Cards Grid -->
        <div class="agenda-cards-grid-wrapper">
          <div class="agenda-cards-grid-title">
            <span>RESERVATION CARDS</span>
            <span class="text-muted" style="font-size:0.75rem">${sorted.length} total</span>
          </div>
          <div class="agenda-cards-grid">
            ${cardsHtml}
          </div>
        </div>
      </div>
    `;
  }

  function highlightAgendaCard(prefix, resId) {
    const card = $(`#${prefix}-card-${resId}`);
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.classList.add('card-highlighted');
      setTimeout(() => card.classList.remove('card-highlighted'), 1800);
    }
  }

  function renderTimeline(reservations) {
    const container = $('#today-timeline');
    const todayISO = formatDateISO(new Date());
    renderHorizontalDailyAgenda(container, reservations, todayISO, 'today');
  }

  function renderUpcoming(upcoming) {
    const container = $('#upcoming-list');
    if (!upcoming || !upcoming.length) {
      container.innerHTML = `<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg><p>No upcoming reservations</p></div>`;
      return;
    }

    container.innerHTML = upcoming.map(r => `
      <div class="timeline-item">
        <span class="timeline-time">${r.arrivalTime}</span>
        <div class="timeline-info">
          <div class="timeline-name">${escapeHtml(r.name)}</div>
          <div class="timeline-details">
            <span>${formatDate(r.date)}</span>
            <span class="${statusBadgeClass(r.status)}">${statusLabel(r.status)}</span>
          </div>
        </div>
      </div>
    `).join('');
  }

  // ---- RESERVATIONS ----
  async function loadReservations() {
    try {
      const params = { page: state.currentPage, limit: 20 };
      if (state.filterDate) params.date = state.filterDate;
      if (state.filterStatus !== 'all') params.status = state.filterStatus;
      if (state.searchQuery) params.search = state.searchQuery;

      const { reservations, total, page, totalPages } = await api.getReservations(params);
      renderReservationsTable(reservations);
      renderPagination(page, totalPages);
    } catch (err) {
      console.error('Reservations error:', err);
      showToast('Failed to load reservations', 'error');
    }
  }

  function renderReservationsTable(reservations) {
    const tbody = $('#reservations-tbody');
    if (!reservations.length) {
      tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:40px;color:var(--text-muted)">No reservations found</td></tr>`;
      return;
    }

    tbody.innerHTML = reservations.map(r => `
      <tr>
        <td class="td-name">${escapeHtml(r.name)}</td>
        <td>${escapeHtml(r.phone || '—')}</td>
        <td>${formatDate(r.date)}</td>
        <td class="td-time">${r.arrivalTime || '—'}</td>
        <td class="td-time">${r.leavingTime || '—'}</td>
        <td>${r.duration || '—'}</td>
        <td><div class="td-stations">${r.stations.map(s => `<span class="station-tag${s === 'VIP Room' ? ' vip' : (s.startsWith('PS5') ? ' ps5' : '')}">${s}</span>`).join('')}</div></td>
        <td>
          <span class="${statusBadgeClass(r.status)}" onclick="window.app.cycleStatus('${r._id}', '${r.status}')" title="Click to change status">
            ${statusLabel(r.status)}
          </span>
        </td>
        <td class="td-notes" title="${escapeHtml(r.notes || '')}">${escapeHtml(r.notes || '—')}</td>
        <td>
          <div class="td-actions">
            <button class="btn-icon btn-edit" onclick="window.app.editReservation('${r._id}')" title="Edit">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="btn-icon btn-delete" onclick="window.app.confirmDelete('${r._id}', '${escapeHtml(r.name)}')" title="Delete">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,6 5,6 21,6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
            </button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  function renderPagination(currentPage, totalPages) {
    const container = $('#pagination');
    if (totalPages <= 1) { container.innerHTML = ''; return; }

    let html = '';
    for (let i = 1; i <= totalPages; i++) {
      html += `<button class="${i === currentPage ? 'active' : ''}" onclick="window.app.goToPage(${i})">${i}</button>`;
    }
    container.innerHTML = html;
  }

  // ---- STATIONS ----
  async function loadStations() {
    try {
      const dateISO = formatDateISO(state.stationDate);
      $('#station-date').value = dateISO;

      const { stations } = await api.getStations(dateISO);
      renderStationsGrid(stations);
    } catch (err) {
      console.error('Stations error:', err);
    }
  }

  function renderStationsGrid(stations) {
    const grid = $('#stations-grid');
    grid.innerHTML = stations.map(s => {
      const isVip = s.type === 'vip';
      const isPs5 = s.type === 'ps5' || s.name.startsWith('PS5');
      const statusClass = `station-${s.currentStatus}`;
      const icon = isVip
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>'
        : isPs5
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="6" y1="12" x2="10" y2="12"/><line x1="8" y1="10" x2="8" y2="14"/><circle cx="15.5" cy="11.5" r="1" fill="currentColor"/><circle cx="17.5" cy="13.5" r="1" fill="currentColor"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>';

      let resInfo = '';
      if (s.reservations.length) {
        const next = s.reservations[0];
        resInfo = `
          <div class="station-res-info">
            <div class="res-name">${escapeHtml(next.name)}</div>
            <div class="res-time">${next.arrivalTime}${next.leavingTime ? ` → ${next.leavingTime}` : ''}</div>
            ${s.reservations.length > 1 ? `<div style="margin-top:4px;font-size:0.7rem;color:var(--text-muted)">+${s.reservations.length - 1} more</div>` : ''}
          </div>
        `;
      }

      return `
        <div class="station-card ${statusClass}">
          <div class="station-icon">${icon}</div>
          <div class="station-name">${s.name}</div>
          <div class="station-status-text">${s.currentStatus}</div>
          ${resInfo}
        </div>
      `;
    }).join('');
  }

  // ---- CALENDAR ----
  async function loadCalendar() {
    const month = state.calendarMonth + 1; // 1-indexed
    const year = state.calendarYear;

    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    $('#cal-title').textContent = `${monthNames[state.calendarMonth]} ${year}`;

    try {
      const { days } = await api.getCalendar(month, year);
      renderCalendarGrid(year, state.calendarMonth, days);
    } catch (err) {
      console.error('Calendar error:', err);
    }
  }

  function renderCalendarGrid(year, month, daysData) {
    const grid = $('#calendar-grid');
    // Keep day headers
    grid.innerHTML = `
      <div class="cal-day-header">Mon</div>
      <div class="cal-day-header">Tue</div>
      <div class="cal-day-header">Wed</div>
      <div class="cal-day-header">Thu</div>
      <div class="cal-day-header">Fri</div>
      <div class="cal-day-header">Sat</div>
      <div class="cal-day-header">Sun</div>
    `;

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDow = (firstDay.getDay() + 6) % 7; // Monday = 0
    const totalDays = lastDay.getDate();

    const today = new Date();
    const todayStr = formatDateISO(today);

    // Create lookup for reservation data
    const dayMap = {};
    daysData.forEach(d => { dayMap[d._id] = d; });

    // Previous month padding
    const prevMonthLast = new Date(year, month, 0).getDate();
    for (let i = startDow - 1; i >= 0; i--) {
      const day = prevMonthLast - i;
      grid.innerHTML += `<div class="cal-day other-month"><div class="cal-day-num">${day}</div></div>`;
    }

    // Current month days
    for (let d = 1; d <= totalDays; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const isToday = dateStr === todayStr;
      const dayData = dayMap[dateStr];

      let content = `<div class="cal-day-num">${d}</div>`;
      if (dayData) {
        content += `<div class="cal-day-count">${dayData.count} res.</div>`;
        content += `<div class="cal-day-previews-h">`;
        dayData.reservations.slice(0, 3).forEach(r => {
          content += `<span class="cal-time-pill" title="${escapeHtml(r.name)} (${r.arrivalTime}${r.leavingTime ? ' → ' + r.leavingTime : ''})">
            <span class="pill-time">${r.arrivalTime}</span>
            <span class="pill-name">${escapeHtml(r.name.split(' ')[0])}</span>
          </span>`;
        });
        if (dayData.count > 3) {
          content += `<span class="cal-time-pill pill-more">+${dayData.count - 3}</span>`;
        }
        content += `</div>`;
      }

      grid.innerHTML += `<div class="cal-day${isToday ? ' today' : ''}" data-date="${dateStr}" onclick="window.app.showCalDay('${dateStr}')">${content}</div>`;
    }

    // Next month padding
    const totalCells = startDow + totalDays;
    const remaining = (7 - (totalCells % 7)) % 7;
    for (let i = 1; i <= remaining; i++) {
      grid.innerHTML += `<div class="cal-day other-month"><div class="cal-day-num">${i}</div></div>`;
    }
  }

  async function showCalendarDay(dateStr) {
    try {
      const { reservations } = await api.getReservations({ date: dateStr, limit: 50 });
      const panel = $('#cal-day-detail');
      panel.classList.remove('hidden');

      const d = new Date(dateStr);
      $('#cal-detail-title').textContent = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
      
      const countEl = $('#cal-detail-count');
      if (countEl) {
        countEl.textContent = `${reservations.length} ${reservations.length === 1 ? 'reservation' : 'reservations'}`;
      }

      const body = $('#cal-detail-body');
      renderHorizontalDailyAgenda(body, reservations, dateStr, 'cal');
      panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (err) {
      console.error('Calendar day error:', err);
    }
  }

  // ---- SMART REAL-TIME STATION CONFLICT CHECKER ----
  async function updateStationAvailabilityInModal() {
    const dateInput = $('#res-date');
    const arrivalInput = $('#res-arrival');
    const leavingInput = $('#res-leaving');
    const durationInput = $('#res-duration');

    const dateVal = dateInput.value;
    const arrivalVal = arrivalInput.value;
    if (!dateVal || !arrivalVal) {
      // If date or arrival time not yet entered, enable all chips
      $$('#station-picker .station-chip').forEach(chip => {
        chip.classList.remove('station-disabled');
        const input = chip.querySelector('input');
        if (input) input.disabled = false;
        chip.removeAttribute('title');
      });
      return;
    }

    const startMins = timeStrToMinutes(arrivalVal);
    if (startMins === null) return;

    let endMins = timeStrToMinutes(leavingInput.value);
    if (endMins === null || endMins <= startMins) {
      const durMins = getEstimatedDurationMinutes(durationInput.value);
      endMins = startMins + durMins;
    }

    try {
      const { reservations } = await api.getReservations({ date: dateVal, limit: 100 });
      const activeRes = reservations.filter(r => 
        r.status !== 'cancelled' && 
        (!state.editingId || r._id !== state.editingId)
      );

      $$('#station-picker .station-chip').forEach(chip => {
        const input = chip.querySelector('input');
        if (!input) return;
        const stationName = input.value;

        // Check if any active reservation is using this station during overlapping time window
        const conflict = activeRes.find(r => {
          if (!r.stations.includes(stationName)) return false;
          const rInfo = getLeavingTimeInfo(r);
          const rStart = rInfo.startMins;
          const rEnd = rInfo.endMins;
          if (rStart === null) return false;
          // Overlap: startA < endB && endA > startB
          return startMins < rEnd && endMins > rStart;
        });

        if (conflict) {
          chip.classList.add('station-disabled');
          input.disabled = true;
          if (input.checked) {
            input.checked = false;
          }
          const confInfo = getLeavingTimeInfo(conflict);
          chip.title = `❌ Occupied by ${conflict.name} (${conflict.arrivalTime} → ${confInfo.leavingTime})`;
        } else {
          chip.classList.remove('station-disabled');
          input.disabled = false;
          chip.title = `✅ ${stationName} is available`;
        }
      });
    } catch (err) {
      console.error('Station availability check error:', err);
    }
  }

  // ---- MODAL ----
  function openReservationModal(reservation = null) {
    const modal = $('#reservation-modal');
    modal.classList.add('open');

    if (reservation) {
      state.editingId = reservation._id;
      $('#modal-title').textContent = 'Edit Reservation';
      $('#res-name').value = reservation.name;
      $('#res-phone').value = reservation.phone || '';
      $('#res-date').value = formatDateISO(reservation.date);
      $('#res-arrival').value = toTimeInput(reservation.arrivalTime);
      $('#res-leaving').value = toTimeInput(reservation.leavingTime);
      $('#res-duration').value = reservation.duration || '';
      $('#res-status').value = reservation.status;
      $('#res-notes').value = reservation.notes || '';
      $('#res-id').value = reservation._id;

      // Set station checkboxes
      $$('#station-picker input').forEach(cb => {
        cb.checked = reservation.stations.includes(cb.value);
      });
      updateStationAvailabilityInModal();
    } else {
      state.editingId = null;
      $('#modal-title').textContent = 'New Reservation';
      $('#reservation-form').reset();
      $('#res-date').value = formatDateISO(new Date());
      $('#res-id').value = '';
      $$('#station-picker input').forEach(cb => { cb.checked = false; });
      updateStationAvailabilityInModal();
    }
  }

  function closeReservationModal() {
    $('#reservation-modal').classList.remove('open');
    state.editingId = null;
  }

  async function saveReservation() {
    const name = $('#res-name').value.trim();
    const phone = $('#res-phone').value.trim();
    const date = $('#res-date').value;
    const arrivalTime = $('#res-arrival').value;
    const leavingTime = $('#res-leaving').value;
    const duration = $('#res-duration').value.trim();
    const status = $('#res-status').value;
    const notes = $('#res-notes').value.trim();

    const stations = [];
    $$('#station-picker input:checked').forEach(cb => stations.push(cb.value));

    const stationType = stations.includes('VIP Room') ? 'vip' : (stations.some(s => s.startsWith('PS5')) ? 'ps5' : 'pc');

    if (!name || !date || !arrivalTime) {
      showToast('Name, date, and arrival time are required', 'error');
      return;
    }

    if (!stations.length) {
      showToast('Please select at least one station', 'error');
      return;
    }

    // Final conflict check before saving
    const startMins = timeStrToMinutes(arrivalTime);
    let endMins = timeStrToMinutes(leavingTime);
    if (endMins === null || endMins <= startMins) {
      endMins = startMins + getEstimatedDurationMinutes(duration);
    }

    try {
      const { reservations: dayReservations } = await api.getReservations({ date, limit: 100 });
      const conflictingStations = [];
      dayReservations.forEach(r => {
        if (r.status === 'cancelled') return;
        if (state.editingId && r._id === state.editingId) return;
        const rInfo = getLeavingTimeInfo(r);
        if (rInfo.startMins === null) return;
        if (startMins < rInfo.endMins && endMins > rInfo.startMins) {
          stations.forEach(s => {
            if (r.stations.includes(s)) {
              conflictingStations.push({ station: s, name: r.name, time: `${r.arrivalTime} → ${rInfo.leavingTime}` });
            }
          });
        }
      });

      if (conflictingStations.length > 0) {
        const msg = conflictingStations.map(c => `${c.station} is already booked by ${c.name} (${c.time})`).join(', ');
        showToast(`Cannot book: ${msg}`, 'error');
        return;
      }
    } catch (err) {
      console.error('Conflict check error:', err);
    }

    const data = { name, phone, date, arrivalTime, leavingTime, duration, stations, stationType, notes, status };

    try {
      if (state.editingId) {
        await api.updateReservation(state.editingId, data);
        showToast('Reservation updated successfully');
      } else {
        await api.createReservation(data);
        showToast('Reservation created successfully');
      }

      closeReservationModal();
      refreshCurrentView();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // ---- DELETE ----
  function openDeleteModal(id, name) {
    state.deletingId = id;
    state.deletingName = name;
    $('#delete-name').textContent = name;
    $('#delete-modal').classList.add('open');
  }

  function closeDeleteModal() {
    $('#delete-modal').classList.remove('open');
    state.deletingId = null;
  }

  async function confirmDelete() {
    if (!state.deletingId) return;
    try {
      await api.deleteReservation(state.deletingId);
      showToast('Reservation deleted');
      closeDeleteModal();
      refreshCurrentView();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // ---- STATUS CYCLE ----
  async function cycleStatus(id, currentStatus) {
    const order = ['pending', 'confirmed', 'active', 'done'];
    const idx = order.indexOf(currentStatus);
    const nextStatus = order[(idx + 1) % order.length];

    try {
      await api.updateReservation(id, { status: nextStatus });
      showToast(`Status changed to ${statusLabel(nextStatus)}`);
      refreshCurrentView();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // ---- EDIT ----
  async function editReservation(id) {
    try {
      const { reservations } = await api.getReservations({ limit: 100 });
      const reservation = reservations.find(r => r._id === id);
      if (reservation) {
        openReservationModal(reservation);
      } else {
        showToast('Reservation not found', 'error');
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // ---- EXPORT ----
  function exportCSV() {
    const params = new URLSearchParams();
    if (state.filterDate) params.set('date', state.filterDate);
    if (state.filterStatus !== 'all') params.set('status', state.filterStatus);

    const url = `/api/reservations/export?${params.toString()}`;
    window.open(url, '_blank');
  }

  // ---- REFRESH ----
  function refreshCurrentView() {
    switch (state.currentView) {
      case 'dashboard': loadDashboard(); break;
      case 'reservations': loadReservations(); break;
      case 'stations': loadStations(); break;
      case 'calendar': loadCalendar(); break;
    }
  }

  // ---- HTML ESCAPE ----
  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ---- EVENT BINDINGS ----
  function bindEvents() {
    // Login form
    $('#login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = $('#login-username').value.trim();
      const password = $('#login-password').value;
      const errorEl = $('#login-error');

      try {
        const { user } = await api.login({ username, password });
        state.user = user;
        errorEl.classList.add('hidden');
        showApp();
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.classList.remove('hidden');
      }
    });

    // Setup form
    $('#setup-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = $('#setup-username').value.trim();
      const password = $('#setup-password').value;
      const displayName = $('#setup-display').value.trim();
      const errorEl = $('#login-error');

      try {
        const { user } = await api.setup({ username, password, displayName });
        state.user = user;
        errorEl.classList.add('hidden');
        showApp();
        showToast('Admin account created! Welcome to Gamefy Academy 🎮');
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.classList.remove('hidden');
      }
    });

    // Logout
    $('#logout-btn').addEventListener('click', async () => {
      try {
        await api.logout();
        state.user = null;
        showLogin(false);
        showToast('Logged out', 'info');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    // Navigation
    $$('.nav-item').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        navigateTo(el.dataset.view);
      });
    });

    // Mobile menu
    $('#mobile-menu-btn').addEventListener('click', () => {
      $('#sidebar').classList.toggle('open');
    });

    // New reservation
    $('#new-reservation-btn').addEventListener('click', () => openReservationModal());

    // Modal controls
    $('#modal-close').addEventListener('click', closeReservationModal);
    $('#modal-cancel').addEventListener('click', closeReservationModal);
    $('#reservation-modal .modal-overlay').addEventListener('click', closeReservationModal);
    $('#modal-save').addEventListener('click', saveReservation);

    // Live station conflict checker when changing date or times in modal
    ['#res-date', '#res-arrival', '#res-leaving', '#res-duration'].forEach(sel => {
      const el = $(sel);
      if (el) {
        el.addEventListener('input', updateStationAvailabilityInModal);
        el.addEventListener('change', updateStationAvailabilityInModal);
      }
    });

    // Delete modal
    $('#delete-modal-close').addEventListener('click', closeDeleteModal);
    $('#delete-cancel').addEventListener('click', closeDeleteModal);
    $('#delete-modal .modal-overlay').addEventListener('click', closeDeleteModal);
    $('#delete-confirm').addEventListener('click', confirmDelete);

    // Filters
    let searchTimeout;
    $('#search-input').addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        state.searchQuery = e.target.value.trim();
        state.currentPage = 1;
        loadReservations();
      }, 300);
    });

    $('#filter-date').addEventListener('change', (e) => {
      state.filterDate = e.target.value;
      state.currentPage = 1;
      loadReservations();
    });

    $('#filter-status').addEventListener('change', (e) => {
      state.filterStatus = e.target.value;
      state.currentPage = 1;
      loadReservations();
    });

    // Export
    $('#export-btn').addEventListener('click', exportCSV);

    // Station date controls
    $('#station-date').addEventListener('change', (e) => {
      state.stationDate = new Date(e.target.value);
      loadStations();
    });

    $('#station-prev-day').addEventListener('click', () => {
      state.stationDate.setDate(state.stationDate.getDate() - 1);
      loadStations();
    });

    $('#station-next-day').addEventListener('click', () => {
      state.stationDate.setDate(state.stationDate.getDate() + 1);
      loadStations();
    });

    $('#station-today-btn').addEventListener('click', () => {
      state.stationDate = new Date();
      loadStations();
    });

    // Calendar controls
    $('#cal-prev').addEventListener('click', () => {
      state.calendarMonth--;
      if (state.calendarMonth < 0) {
        state.calendarMonth = 11;
        state.calendarYear--;
      }
      loadCalendar();
    });

    $('#cal-next').addEventListener('click', () => {
      state.calendarMonth++;
      if (state.calendarMonth > 11) {
        state.calendarMonth = 0;
        state.calendarYear++;
      }
      loadCalendar();
    });

    $('#cal-today-btn').addEventListener('click', () => {
      const now = new Date();
      state.calendarMonth = now.getMonth();
      state.calendarYear = now.getFullYear();
      loadCalendar();
    });

    $('#cal-detail-close').addEventListener('click', () => {
      $('#cal-day-detail').classList.add('hidden');
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeReservationModal();
        closeDeleteModal();
      }
      // Ctrl/Cmd + N for new reservation
      if ((e.ctrlKey || e.metaKey) && e.key === 'n' && state.user) {
        e.preventDefault();
        openReservationModal();
      }
    });
  }

  // ---- EXPOSE GLOBAL FUNCTIONS (for inline onclick handlers) ----
  window.app = {
    cycleStatus,
    editReservation,
    confirmDelete: openDeleteModal,
    goToPage: (page) => {
      state.currentPage = page;
      loadReservations();
    },
    showCalDay: showCalendarDay,
    highlightAgendaCard
  };

  // ---- INIT ----
  function init() {
    bindEvents();
    updateClock();
    setInterval(updateClock, 1000);
    checkAuth();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
