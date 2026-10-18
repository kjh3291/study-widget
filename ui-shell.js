// COSMIC 셸: 하단 메뉴(오늘·학습·동아리·더보기), 학습 하위 화면, 더보기·설정 카테고리, 제목 표시줄 동기화 점.
// renderer.js의 화면 함수(switchTab·openSettings·showSyncStatus 등)는 그대로 쓰고 바깥에서 감싼다.
(function () {
  const STUDY = [
    { tab: 'timetable', ico: 'grid', name: '시간표', desc: '수업 블록을 누르면 그 과목 자료 폴더' },
    { tab: 'schedule', ico: 'calendar', name: '일정', desc: '월 달력·기간 일정·미리 알림' },
    { tab: 'lms', ico: 'school', name: 'LMS', desc: '과목 공지·과제 마감·수업자료' },
    { tab: 'attend', ico: 'attend', name: '출석', desc: '과목 × 주차 출석 기록' },
    { view: 'records', ico: 'timer', name: '집중 기록', desc: '일·주·월 공부 시간과 세션' },
    { tab: 'stats', ico: 'chart', name: '기록', desc: '할 일 완료와 연속 달성' },
  ];
  const SETTINGS = [
    { cat: 'screen', ico: 'palette', name: '화면과 위젯', desc: '테마 · 투명도 · 항상 위 · 시계' },
    { cat: 'study', ico: 'bell', name: '학습과 알림', desc: '집중 목표 · 알림 시각 · 이월' },
    { cat: 'lms', ico: 'sync', name: 'LMS와 동기화', desc: '자동 새로고침 · 다운로드 · 동기화' },
    { cat: 'files', ico: 'drive', name: '파일과 저장공간', desc: '사용량 · 휴지통 · 이전 버전 · 폴더' },
    { cat: 'account', ico: 'shield', name: '계정과 보안', desc: 'GitHub 연결 · 비밀번호 · 로그아웃', server: true },
  ];
  const ico = n => `<span class="ico-${n}" aria-hidden="true"></span>`;
  const VIEWS = ['view-study', 'view-club', 'view-more', 'view-focus', 'view-records', 'view-together'];
  let nav = 'today';

  if (!SERVER_MODE) document.querySelectorAll('.srv-only').forEach(e => e.remove());
  if (!IS_LAB) document.querySelectorAll('.lab-only').forEach(e => e.remove());   // 개발용 항목은 실험실 앱에서만
  document.querySelector('#nav [data-nav="club"]').hidden = !SERVER_MODE;

  function setNav(n) {
    nav = n;
    document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('active', b.dataset.nav === n));
  }
  function hideShellViews() { VIEWS.forEach(id => $(id).classList.add('hidden')); }
  // 셸이 관리하는 화면 하나를 보여 주고 하단 메뉴 위치를 맞춘다(집중·기록·같이 공부도 여기로)
  function showView(id, navName) { showShellView(id); setNav(navName); $(id).scrollTop = 0; }
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
  window.Shell = { goNav, showView, openStudy: tab => switchTab(tab) };

  document.querySelector('#nav').addEventListener('click', e => {
    const b = e.target.closest('[data-nav]'); if (b) goNav(b.dataset.nav);
  });
  $('body').addEventListener('click', e => { if (e.target.closest('[data-back-study]')) goNav('study'); });

  // ---------- 오늘 ----------
  function renderTodayHead() {
    const d = new Date();
    $('today-date').textContent = `${d.getMonth() + 1}월 ${d.getDate()}일 ${'일월화수목금토'[d.getDay()]}요일`;
    window.Focus?.refresh();
  }

  // ---------- 학습 ----------
  function renderStudy() {
    $('view-study').innerHTML = `<div class="page-head"><div class="eyebrow">시간표 · 일정 · LMS · 출석 · 기록</div><h1>학습</h1></div>
      <div class="menu-list">${STUDY.map(s => `<button class="menu-row" ${s.view ? `data-study-view="${s.view}"` : `data-study="${s.tab}"`}><span class="mi">${ico(s.ico)}</span>
        <span class="mt"><b>${s.name}${s.tab === 'lms' ? ' <span id="study-lms-badge"></span>' : ''}</b><small>${s.desc}</small></span>${ico('next').replace('class="', 'class="chev ')}</button>`).join('')}</div>`;
    const lmsBadge = document.querySelector('.tabs [data-tab="lms"] .lms-dot');
    if (lmsBadge) $('study-lms-badge').innerHTML = '<span class="pill">새 소식</span>';
  }
  $('view-study').addEventListener('click', e => {
    if (e.target.closest('[data-study-view="records"]')) return window.Focus.openRecords();
    const b = e.target.closest('[data-study]'); if (b) switchTab(b.dataset.study);
  });

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
    syncSettingControls();
    setNav('more');
    if (cat === 'admin') window.Club?.renderRoomApprovals?.();
  };
  const closeSettings = () => { $('settings').classList.add('hidden'); goNav('more'); };
  $('btn-cancel').onclick = closeSettings;
  $('set-back').addEventListener('click', closeSettings);
  $('btn-settings').onclick = () => goNav('more');

  // ---------- 설정 컨트롤(2차 디자인): 스테퍼·시간 선택·슬라이더 값·선택 표시 ----------
  const fmtGoal = h => { const m = Math.round(h * 60); return m >= 60 ? `${Math.floor(m / 60)}시간${m % 60 ? ' ' + (m % 60) + '분' : ''}` : `${m}분`; };
  function syncSettingControls() {
    const goal = Number($('inp-focus-goal').value) || 2;
    $('goal-out').textContent = fmtGoal(goal);
    $('goal-minus').disabled = goal <= 0.5; $('goal-plus').disabled = goal >= 16;
    $('morning-label').textContent = UI.timeLabel($('inp-morning').value || '08:00');
    const ds = Number.isFinite(state.focusDayStart) ? state.focusDayStart : 300;
    $('day-start-label').textContent = UI.timeLabel(`${Math.floor(ds / 60)}:${ds % 60}`);
    const op = Number($('inp-opacity').value) || 100;
    $('opacity-out').textContent = op + '%';
    $('inp-opacity').style.setProperty('--slider-fill', ((op - 30) / 70 * 100) + '%');
    document.querySelectorAll('.sd-theme-options [role=radio]').forEach(b => b.setAttribute('aria-checked', String(b.classList.contains('sel'))));
    ['h', 'hm', 'hms'].forEach(f => $('clk-' + f).setAttribute('aria-pressed', String($('clk-' + f).classList.contains('sel'))));
  }
  function stepGoal(d) {
    const v = Math.min(16, Math.max(0.5, (Number($('inp-focus-goal').value) || 2) + d));
    $('inp-focus-goal').value = String(v); $('inp-focus-goal').dispatchEvent(new Event('change'));
    syncSettingControls();
  }
  $('goal-minus').onclick = () => stepGoal(-0.5);
  $('goal-plus').onclick = () => stepGoal(0.5);
  $('btn-morning').onclick = async () => {
    const v = await UI.timePicker($('inp-morning').value || '08:00', { title: '알림 시각 선택', hint: '오늘 할 일 요약을 받을 시각을 골라주세요.', minuteStep: 60 });
    if (!v) return;
    $('inp-morning').value = v; $('inp-morning').dispatchEvent(new Event('change')); syncSettingControls();
  };
  $('btn-day-start').onclick = async () => {
    const ds = Number.isFinite(state.focusDayStart) ? state.focusDayStart : 300;
    const v = await UI.timePicker(`${String(Math.floor(ds / 60)).padStart(2, '0')}:${String(ds % 60).padStart(2, '0')}`,
      { title: '집중 날짜 기준', hint: '이 시각부터 다음 날 같은 시각 전까지를 하루로 계산해요.', minuteStep: 30 });
    if (!v) return;
    const [h, m] = v.split(':').map(Number);
    state.focusDayStart = h * 60 + m; persist({ focusDayStart: state.focusDayStart });
    syncSettingControls(); window.Focus?.refresh();
  };
  $('inp-opacity').addEventListener('input', syncSettingControls);
  ['theme-dark', 'theme-light', 'theme-cbnu', 'theme-baekjoon', 'theme-gray', 'clk-h', 'clk-hm', 'clk-hms'].forEach(id => $(id).addEventListener('click', () => setTimeout(syncSettingControls)));

  // ---------- 제목 표시줄 동기화 점 ----------
  const baseShowSync = showSyncStatus;
  showSyncStatus = function (status) {
    baseShowSync(status);
    const p = (status || {}).phase, dot = $('sync-dot');
    dot.className = 'sync-dot ' + ({ synced: 'ok', idle: 'ok', syncing: 'busy', saving: 'busy', pending: 'pending', error: 'err', conflict: 'err' }[p] || '');
    dot.title = $('sync-label').textContent;
    const hint = { synced: '기기 간 데이터가 최신 상태예요.', idle: '이 기기에 저장돼 있어요.', saving: '변경 내용을 저장하고 있어요.', syncing: '서버와 맞추는 중이에요.', pending: '연결되면 자동으로 올려요.', error: '연결을 확인한 뒤 다시 시도해주세요.', conflict: '확인이 필요한 항목이 있어요.' }[p];
    if (hint && $('sync-hint')) $('sync-hint').textContent = hint;
    dot.setAttribute('aria-label', '동기화 상태: ' + $('sync-label').textContent);
  };

  // 미니 모드 아이콘 전환
  const baseToggleMini = toggleMini;
  toggleMini = function () { baseToggleMini(); $('btn-mini').innerHTML = ico(state.mini ? 'expand' : 'mini'); $('btn-mini').title = state.mini ? '펼치기' : '미니 모드'; };
  $('btn-mini').onclick = toggleMini;

  // 시작 화면은 오늘
  goNav('today');
})();
