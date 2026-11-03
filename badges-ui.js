// 칭호·배지 화면(서버: server/src/badges.js). 기존 sd-* 컴포넌트로 만든 기능 확인용 화면이고,
// 다듬은 디자인은 docs/design-requests/badges.md 요청문으로 GPT에게 받는다.
//  - 더보기 › 배지 · 칭호: 칭호 고르기, 모은 배지, 모으는 중(진행 막대)
//  - 새 배지를 얻으면 알림(동기화 뒤 확인), 운영진이 특별 배지를 주면 바로 알림
//  - 동아리 멤버 목록·프로필에 칭호, 운영진 회원 관리에서 '배지 주기'
(function () {
  if (!SERVER_MODE) return;
  const C = window.Community, { ico, esc } = window.UI;
  const fmtVal = (p) => p.id.startsWith('focus-') && p.id !== 'first-focus'
    ? `${Math.floor(p.value / 3600)}/${p.goal / 3600}시간` : `${p.value}/${p.goal}`;
  const when = (t) => new Date(t).toLocaleDateString();
  const badgeRow = (b) => `<div class="badge-row${b.special ? ' special' : ''}"><span class="badge-ico">${ico(b.icon || 'star')}</span>
    <span class="sd-grow"><strong>${esc(b.label)}${b.special ? ' <span class="sd-badge sd-badge-accent">특별</span>' : ''}</strong>
    <span class="sd-muted">${esc(b.desc || '')} · ${when(b.earnedAt)}${b.grantedBy ? ` · ${esc(b.grantedBy)}님이 줌` : ''}</span></span></div>`;

  async function openPanel() {
    const P = UI.panel('badges-panel', '배지 · 칭호', '더보기');
    P.body.innerHTML = '<div class="sd-skeleton-row"><span class="sd-skeleton" style="flex:1"></span></div>';
    const render = async () => {
      const r = await C.call('GET', '/me/badges');
      if (!r?.badges) { P.body.innerHTML = `<div class="sd-empty">${ico('circle-alert')}<h3>불러오지 못했어요.</h3><p>${esc(r?.error || '연결을 확인해 주세요.')}</p></div>`; return; }
      const doing = r.progress.filter((p) => !p.earned);
      P.sub.hidden = false; P.sub.textContent = `배지 ${r.badges.length}개 · 공부·할 일·채팅 기록으로 서버가 계산해요`;
      P.body.innerHTML = `<h3 class="sd-gap">칭호 <span class="sd-muted">이름 옆에 보여요</span></h3>
        ${r.badges.length ? `<div class="sd-stack" role="radiogroup" aria-label="칭호">
          <label class="sd-radio-card"><input type="radio" name="title" value="" ${!r.title ? 'checked' : ''}><span class="sd-grow"><strong>칭호 없음</strong></span></label>
          ${r.badges.map((b) => `<label class="sd-radio-card"><input type="radio" name="title" value="${esc(b.id)}" ${r.title === b.id ? 'checked' : ''}><span class="sd-grow"><strong>${esc(b.label)}</strong></span></label>`).join('')}</div>`
          : '<p class="sd-muted">배지를 얻으면 칭호로 고를 수 있어요.</p>'}
        <h3 class="sd-gap-lg">모은 배지 <span class="sd-muted">${r.badges.length}</span></h3>
        ${r.badges.map(badgeRow).join('') || '<p class="sd-muted">아직 없어요. 집중 타이머로 공부를 기록해 보세요.</p>'}
        <h3 class="sd-gap-lg">모으는 중 <span class="sd-muted">${doing.length}</span></h3>
        ${doing.map((p) => `<div class="badge-row doing"><span class="badge-ico">${ico(p.icon)}</span><span class="sd-grow"><strong>${esc(p.label)}</strong><span class="sd-muted">${esc(p.desc)}</span>
          <span class="sd-progress" aria-label="${esc(p.label)} 진행"><span style="--progress:${Math.round(p.value / p.goal * 100)}%"></span></span></span><span class="badge-val">${fmtVal(p)}</span></div>`).join('') || '<p class="sd-muted">모든 배지를 모았어요!</p>'}`;
    };
    P.el.addEventListener('change', async (e) => {
      if (e.target.name !== 'title') return;
      const r = await C.call('PUT', '/me/title', { badge: e.target.value || null });
      if (r?.error) return showToast('칭호를 바꾸지 못했어요');
      showToast(e.target.value ? '칭호를 바꿨어요. 동아리 멤버 목록에 보여요.' : '칭호를 뺐어요.');
    });
    render();
  }

  // 새 배지 확인: 로그인 상태에서 15분마다 + 동기화 직후(너무 잦으면 건너뜀)
  let lastCheck = 0;
  async function checkNew(force) {
    if (!state.syncEnabled || (!force && Date.now() - lastCheck < 15 * 60 * 1000)) return;
    lastCheck = Date.now();
    const r = await C.call('GET', '/me/badges');
    const fresh = (r?.fresh || []).map((id) => r.badges.find((b) => b.id === id)).filter(Boolean);
    if (!fresh.length) return;
    const names = fresh.map((b) => b.label).join(', ');
    showToast(`새 배지: ${names}`, '보기', openPanel);
    window.api.notify('새 배지를 얻었어요', names);
  }
  setInterval(() => checkNew(false), 5 * 60 * 1000);
  setTimeout(() => checkNew(true), 30 * 1000);
  C.on && C.on('account', (ev) => { if (ev && ev.what === 'badge') { showToast(`운영진이 '${ev.label}' 배지를 줬어요`, '보기', openPanel); window.api.notify('특별 배지', ev.label); } });

  // 멤버 목록·프로필: 칭호 칩
  const titleChip = (m) => (m && m.title ? `<span class="sd-badge title-chip" title="칭호">${esc(m.title)}</span>` : '');
  // 프로필에서 그 회원의 배지 보기
  async function showMember(id, name) {
    const r = await C.call('GET', `/users/${id}/badges`);
    UI.sheet(`${name}님의 배지`, r?.badges?.length ? r.badges.map(badgeRow).join('') : '<p class="sd-muted">아직 배지가 없어요.</p>');
  }

  // 운영진: 특별 배지 주기·회수
  async function grantSheet(id, name) {
    const cur = await C.call('GET', `/users/${id}/badges`);
    const specials = (cur?.badges || []).filter((b) => b.special);
    const s = UI.sheet(`${name}님에게 배지 주기`, `<form id="badge-grant" class="sd-stack">
        <div class="sd-field"><label for="bg-label">배지 이름</label><input class="sd-input" id="bg-label" maxlength="20" placeholder="예: COSMIC 1기, 발표왕" required></div>
        <div class="sd-field"><label for="bg-note">까닭(선택)</label><input class="sd-input" id="bg-note" maxlength="100" placeholder="예: 11월 세미나 발표"></div>
        <div class="sd-actions"><button type="button" class="sd-btn" data-sheet-close>취소</button><button type="submit" class="sd-btn sd-btn-primary">주기</button></div></form>
      ${specials.length ? `<h3 class="sd-gap-lg">이미 준 특별 배지</h3>${specials.map((b) => `<div class="badge-row special"><span class="badge-ico">${ico('star')}</span><span class="sd-grow"><strong>${esc(b.label)}</strong><span class="sd-muted">${when(b.earnedAt)}</span></span>
        <button type="button" class="sd-btn sd-btn-small sd-btn-ghost sd-danger-text" data-revoke="${esc(b.id)}">회수</button></div>`).join('')}` : ''}`);
    s.el.querySelector('#badge-grant').addEventListener('submit', async (e) => {
      e.preventDefault();
      const label = s.el.querySelector('#bg-label').value.trim(), note = s.el.querySelector('#bg-note').value.trim();
      if (label.length < 2) return showToast('배지 이름을 2자 이상 적어 주세요.');
      const r = await C.call('POST', `/admin/users/${id}/badges`, { label, note });
      if (!r?.badge) return showToast('배지를 주지 못했어요');
      s.close(); showToast(`${name}님에게 '${label}' 배지를 줬어요`);
    });
    s.el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-revoke]'); if (!b) return;
      if (!(await UI.confirm({ title: '특별 배지를 회수할까요?', body: `${name}님의 배지에서 빠지고, 칭호로 쓰고 있었다면 칭호도 해제돼요.`, ok: '회수', danger: true }))) return;
      const r = await C.call('DELETE', `/admin/users/${id}/badges/${encodeURIComponent(b.dataset.revoke)}`);
      if (!r?.ok) return showToast('회수하지 못했어요');
      b.closest('.badge-row').remove(); showToast('회수했어요');
    });
  }

  document.addEventListener('click', (e) => { const b = e.target.closest('[data-member-badges]'); if (b) showMember(Number(b.dataset.memberBadges), b.dataset.name || ''); });
  window.Badges = { openPanel, checkNew, titleChip, showMember, grantSheet };
})();
