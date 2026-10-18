// COSMIC 셸: 하단 메뉴(오늘·학습·동아리·더보기), 학습 하위 화면, 더보기·설정 카테고리, 제목 표시줄 동기화 점.
// renderer.js의 화면 함수(switchTab·openSettings·showSyncStatus 등)는 그대로 쓰고 바깥에서 감싼다.
(function () {
  const STUDY = [
    { tab: 'timetable', ico: 'grid', name: '시간표', desc: '수업 블록을 누르면 그 과목 자료 폴더' },
    { tab: 'schedule', ico: 'calendar', name: '일정', desc: '월 달력·기간 일정·미리 알림' },
    { tab: 'lms', ico: 'school', name: 'LMS', desc: '과목 공지·과제 마감·수업자료' },
    { tab: 'attend', ico: 'attend', name: '출석', desc: '과목 × 주차 출석 기록' },
    { tab: 'stats', ico: 'chart', name: '기록', desc: '완료·연속 달성·공부 시간' },
  ];
  const SETTINGS = [
    { cat: 'screen', ico: 'palette', name: '화면과 위젯', desc: '테마 · 투명도 · 항상 위 · 시계' },
    { cat: 'study', ico: 'bell', name: '학습과 알림', desc: '집중 목표 · 알림 시각 · 이월' },
    { cat: 'lms', ico: 'sync', name: 'LMS와 동기화', desc: '자동 새로고침 · 다운로드 · 동기화' },
    { cat: 'files', ico: 'drive', name: '파일과 저장공간', desc: '사용량 · 휴지통 · 이전 버전 · 폴더' },
    { cat: 'account', ico: 'shield', name: '계정과 보안', desc: 'GitHub 연결 · 비밀번호 · 로그아웃', server: true },
  ];
  const ico = n => `<span class="ico-${n}" aria-hidden="true"></span>`;
  const VIEWS = ['view-study', 'view-club', 'view-more'];
  let nav = 'today';

  if (!SERVER_MODE) document.querySelectorAll('.srv-only').forEach(e => e.remove());
  document.querySelector('#nav [data-nav="club"]').hidden = !SERVER_MODE;

  function setNav(n) {
    nav = n;
    document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('active', b.dataset.nav === n));
  }
  function hideShellViews() { VIEWS.forEach(id => $(id).classList.add('hidden')); }
  function showShellView(id) {
    ['timetable', 'todos', 'schedule', 'lms', 'stats', 'attend'].forEach(t => $('view-' + t).classList.add('hidden'));
    VIEWS.forEach(v => $(v).classList.toggle('hidden', v !== id));
    $('settings').classList.add('hidden');
  }

  // 학습 하위 화면 머리(뒤로 + 제목)는 처음 열 때 한 번 붙인다
  function ensureSubhead(tab) {
    const item = STUDY.find(s => s.tab === tab); if (!item) return;
    const view = $('view-' + tab);
    if (view.querySelector(':scope > .study-head')) return;
    view.insertAdjacentHTML('afterbegin', `<div class="study-head"><div class="subhead"><button class="back" data-back-study>${ico('back')}학습</button></div>
      <div class="sub-title-row"><div class="sub-title">${item.name}</div></div></div>`);
  }

  // renderer의 탭 전환을 감싼다: 오늘(todos) 또는 학습 하위 화면
  const baseSwitch = switchTab;
  switchTab = function (tab) {
    hideShellViews();
    $('settings').classList.add('hidden');
    baseSwitch(tab);
    if (tab === 'todos') { setNav('today'); renderTodayHead(); }
    else { setNav('study'); ensureSubhead(tab); }
    $('view-' + tab).scrollTop = 0;
  };

  function goNav(n) {
    if (n === 'today') return switchTab('todos');
    setNav(n);
    if (n === 'study') { showShellView('view-study'); renderStudy(); }
    if (n === 'club') { showShellView('view-club'); window.Club?.open(); }
    if (n === 'more') { showShellView('view-more'); renderMore(); }
  }
  window.Shell = { goNav, openStudy: tab => switchTab(tab) };

  document.querySelector('#nav').addEventListener('click', e => {
    const b = e.target.closest('[data-nav]'); if (b) goNav(b.dataset.nav);
  });
  $('body').addEventListener('click', e => { if (e.target.closest('[data-back-study]')) goNav('study'); });

  // ---------- 오늘 ----------
  function renderTodayHead() {
    const d = new Date();
    $('today-date').textContent = `${d.getMonth() + 1}월 ${d.getDate()}일 ${'일월화수목금토'[d.getDay()]}요일`;
    renderFocusCard();
  }
  function renderFocusCard() {
    const card = $('focus-card'); if (!card) return;
    const min = Math.floor(todayFocusSecAll() / 60), goal = state.focusGoalMin || 120;
    const fmt = m => m >= 60 ? `${Math.floor(m / 60)}시간${m % 60 ? ' ' + (m % 60) + '분' : ''}` : `${m}분`;
    const running = !!state.timer;
    card.innerHTML = `<span class="orbit">${ico('timer')}</span><div class="ft"><b>${running ? '집중 중 · ' + escapeHtml(state.timer.taskText || '집중') : '나만의 집중 시간'}</b>
      <small>오늘 ${fmt(min)} / 목표 ${fmt(goal)}</small></div>
      <button class="btn primary mini" data-focus-card>${running ? '보기' : '시작'}</button>`;
  }
  function todayFocusSecAll() {
    const today = focusDay();
    let sec = ((state.focus && state.focus.sessions) || []).filter(s => s.date === today).reduce((a, s) => a + sessionSec(s), 0);
    if (state.timer) sec += state.timer.elapsed || 0;
    return sec;
  }
  $('focus-card').addEventListener('click', e => {
    if (!e.target.closest('[data-focus-card]')) return;
    if (state.timer) enterFocus(); else document.querySelector('#summary [data-tm="start"]')?.click();
  });
  setInterval(() => { if (nav === 'today') renderFocusCard(); }, 30000);
  // 타이머 시작·정지·일시정지 때 renderer가 요약을 다시 그리므로 집중 카드도 같이
  const baseSummary = renderSummary;
  renderSummary = function () { baseSummary(); renderFocusCard(); };

  // ---------- 학습 ----------
  function renderStudy() {
    $('view-study').innerHTML = `<div class="page-head"><div class="eyebrow">시간표 · 일정 · LMS · 출석 · 기록</div><h1>학습</h1></div>
      <div class="menu-list">${STUDY.map(s => `<button class="menu-row" data-study="${s.tab}"><span class="mi">${ico(s.ico)}</span>
        <span class="mt"><b>${s.name}${s.tab === 'lms' ? ' <span id="study-lms-badge"></span>' : ''}</b><small>${s.desc}</small></span>${ico('next').replace('class="', 'class="chev ')}</button>`).join('')}</div>`;
    const lmsBadge = document.querySelector('.tabs [data-tab="lms"] .lms-dot');
    if (lmsBadge) $('study-lms-badge').innerHTML = '<span class="pill">새 소식</span>';
  }
  $('view-study').addEventListener('click', e => { const b = e.target.closest('[data-study]'); if (b) switchTab(b.dataset.study); });

  // ---------- 더보기 ----------
  async function renderMore() {
    const st = SERVER_MODE ? await window.api.gitSyncStatus() : null;
    const name = st?.displayName || st?.username || '';
    const role = { owner: '최고 관리자', admin: '운영진', member: '동아리원' }[st?.role] || '';
    const isAdmin = ['admin', 'owner'].includes(st?.role);
    const initials = (name || 'S').slice(0, 2);
    $('view-more').innerHTML = `<div class="page-head"><div class="eyebrow">나에게 맞게</div><h1>더보기</h1></div>
      ${SERVER_MODE && st?.enabled ? `<button class="account-card menu-row" data-more="profile" style="width:auto"><span class="avatar" id="more-avatar">${escapeHtml(initials)}</span>
        <span class="mt"><b>${escapeHtml(name)}</b><small>${escapeHtml(st.username)} · ${role}</small></span>${ico('next').replace('class="', 'class="chev ')}</button>` : ''}
      <div class="menu-list">${SETTINGS.filter(s => !s.server || SERVER_MODE).map(s => `<button class="menu-row" data-cat="${s.cat}"><span class="mi">${ico(s.ico)}</span>
        <span class="mt"><b>${s.name}</b><small>${s.desc}</small></span>${ico('next').replace('class="', 'class="chev ')}</button>`).join('')}
        ${isAdmin ? `<button class="menu-row" data-cat="admin"><span class="mi">${ico('users')}</span><span class="mt"><b>운영진 관리</b><small>가입 승인 · 회원 관리 · 방 승인</small></span><span id="more-admin-count"></span>${ico('next').replace('class="', 'class="chev ')}</button>` : ''}
      </div>`;
    if (isAdmin) updateAdminCount();
    window.Club?.loadMyAvatar?.('more-avatar');
  }
  async function updateAdminCount() {
    const el = $('more-admin-count'); if (!el) return;
    const [u, r] = await Promise.all([window.api.adminUsers(), window.api.communityCall('GET', '/admin/rooms')]);
    const n = (u?.ok ? u.users.filter(x => x.status === 'pending').length : 0) + (r?.ok ? r.rooms.length : 0);
    el.innerHTML = n ? `<span class="pill">${n}</span>` : '';
  }
  $('view-more').addEventListener('click', e => {
    const c = e.target.closest('[data-cat]'); if (c) return openSettings(c.dataset.cat);
    if (e.target.closest('[data-more="profile"]')) window.Club?.openProfileEditor?.();
  });

  // ---------- 설정: 카테고리 하나만 보여 준다 ----------
  const baseOpenSettings = openSettings;
  openSettings = function (cat) {
    cat = typeof cat === 'string' ? cat : 'lms';
    const info = SETTINGS.find(s => s.cat === cat) || { name: cat === 'admin' ? '운영진 관리' : '설정' };
    document.querySelectorAll('#settings .set-cat').forEach(sec => { sec.hidden = sec.dataset.cat !== cat; });
    $('set-title').textContent = info.name;
    baseOpenSettings();
    setNav('more');
    if (cat === 'admin') window.Club?.renderRoomApprovals?.();
  };
  const closeSettings = () => { $('settings').classList.add('hidden'); goNav('more'); };
  $('btn-cancel').onclick = closeSettings;
  $('set-back').addEventListener('click', closeSettings);
  $('btn-settings').onclick = () => goNav('more');

  // ---------- 제목 표시줄 동기화 점 ----------
  const baseShowSync = showSyncStatus;
  showSyncStatus = function (status) {
    baseShowSync(status);
    const p = (status || {}).phase, dot = $('sync-dot');
    dot.className = 'sync-dot ' + ({ synced: 'ok', idle: 'ok', syncing: 'busy', saving: 'busy', pending: 'pending', error: 'err', conflict: 'err' }[p] || '');
    dot.title = $('sync-label').textContent;
    dot.setAttribute('aria-label', '동기화 상태: ' + $('sync-label').textContent);
  };

  // 미니 모드 아이콘 전환
  const baseToggleMini = toggleMini;
  toggleMini = function () { baseToggleMini(); $('btn-mini').innerHTML = ico(state.mini ? 'expand' : 'mini'); $('btn-mini').title = state.mini ? '펼치기' : '미니 모드'; };
  $('btn-mini').onclick = toggleMini;

  // 시작 화면은 오늘
  goNav('today');
})();
