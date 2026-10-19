// 직책·관리자 표시, 직책 고르기, 임원 신청, 문의(오류 신고·개선 제안)
//  - 권한(무엇을 할 수 있나)은 role(owner/admin/member)만 본다. 직책(부원·임원·회장)은 표시용(나중에 기능 부여)
//  - 배지는 '관리자'(권한)가 먼저, 그다음 직책
//  - 회장 지정·해제는 최고 관리자만. 임원은 부원이 신청 → 관리자가 승인, 또는 관리자가 바로 지정
(function () {
  if (!SERVER_MODE) return;
  const C = window.Community, { ico, esc } = window.UI;
  const POS = { member: '부원', officer: '임원', president: '회장' };
  const POS_DESC = { member: '기본 직책', officer: '임원 신청을 승인하거나 관리자가 지정', president: '최고 관리자만 지정할 수 있어요' };
  const isAdminRole = r => r === 'admin' || r === 'owner';
  const badges = (role, position) => `${isAdminRole(role) ? '<span class="sd-badge sd-badge-accent role-badge">관리자</span>' : ''}<span class="sd-badge pos-badge pos-${position || 'member'}">${POS[position] || '부원'}</span>`;
  const myRole = () => state.serverRole;

  // 직책 고르기 시트 → 고른 값(member|officer|president) 또는 null
  function pickPosition({ title, name, current = 'member', confirmLabel = '정하기' }) {
    return new Promise(resolve => {
      const owner = myRole() === 'owner';
      const s = UI.sheet(title, `<p class="sd-muted">${esc(name)}님의 직책을 골라주세요. 직책은 권한과 따로이고, 관리자 권한은 운영진 지정으로 정해요.</p>
        <div class="sd-stack pos-options" role="radiogroup" aria-label="직책">${Object.keys(POS).map(k => {
          const disabled = k === 'president' && !owner;
          return `<label class="sd-radio-card"${disabled ? ' aria-disabled="true"' : ''}><input type="radio" name="pos" value="${k}" ${k === current ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
            <span class="sd-grow"><strong>${POS[k]}</strong><span class="sd-muted" style="display:block">${POS_DESC[k]}</span></span></label>`;
        }).join('')}</div>
        <div class="sd-actions sd-gap"><button type="button" class="sd-btn" data-sheet-close>취소</button><button type="button" class="sd-btn sd-btn-primary" data-pos-ok>${esc(confirmLabel)}</button></div>`,
        { onClose: v => resolve(v || null) });
      s.el.querySelector('[data-pos-ok]').onclick = () => s.close(s.el.querySelector('[name=pos]:checked')?.value || current);
    });
  }

  // ---------- 운영진 관리: 임원 신청 · 문의 ----------
  async function renderAdmin() {
    const box = $('posreq-admin-list'); if (!box) return;
    const [pr, iq] = await Promise.all([C.call('GET', '/admin/position-requests'), C.call('GET', '/admin/inquiries')]);
    const reqs = pr?.requests || [];
    $('posreq-admin-count').textContent = reqs.length || '';
    box.innerHTML = reqs.length ? reqs.map(r => `<div class="admin-row" data-req="${r.id}"><div class="who"><b>${esc(r.user.name)}</b> ${esc(r.user.username)} · 임원 신청
        <small>${new Date(r.createdAt).toLocaleString()}${r.message ? ' · ' + esc(r.message) : ''}</small></div>
        <span class="sd-actions" style="flex:none"><button type="button" class="sd-btn sd-btn-small sd-btn-primary" data-req-act="approve">승인</button><button type="button" class="sd-btn sd-btn-small" data-req-act="reject">거절</button></span></div>`).join('')
      : '<span class="set-hint">대기 중인 임원 신청이 없어요.</span>';
    const list = iq?.inquiries || [], counts = iq?.counts || { new: 0, checking: 0 };
    $('inquiry-admin-count').textContent = counts.new || '';
    $('inquiry-admin-list').innerHTML = list.length ? list.map(q => `<button type="button" class="sd-menu-row inquiry-row" data-inquiry="${q.id}">
        <span class="sd-menu-icon">${ico(q.category === 'bug' ? 'circle-alert' : q.category === 'idea' ? 'star' : 'message-circle-plus')}</span>
        <span class="sd-grow"><strong>${esc(q.body.split('\n')[0].slice(0, 40))}</strong><span class="sd-muted">${esc(q.user?.name || '')} · ${CAT[q.category]} · ${new Date(q.createdAt).toLocaleDateString()}</span></span>
        <span class="sd-badge ${q.status === 'new' ? 'sd-badge-accent' : ''}">${STATUS[q.status]}</span></button>`).join('')
      : '<span class="set-hint">처리할 문의가 없어요.</span>';
    adminList = list;
  }
  let adminList = [];
  $('posreq-admin-list')?.addEventListener('click', async e => {
    const b = e.target.closest('[data-req-act]'); if (!b) return;
    const row = b.closest('[data-req]'), name = row.querySelector('.who b').textContent, act = b.dataset.reqAct;
    if (act === 'reject' && !(await UI.confirm({ title: `${name}님의 임원 신청을 거절할까요?`, body: '부원으로 그대로 남고, 나중에 다시 신청할 수 있어요.', ok: '거절', danger: true }))) return;
    b.disabled = true;
    const r = await C.call('POST', `/admin/position-requests/${row.dataset.req}/${act}`);
    if (!r?.ok) { b.disabled = false; return showToast(r?.error || '처리 실패'); }
    showToast(act === 'approve' ? `${name}님을 임원으로 올렸어요` : `${name}님의 신청을 거절했어요`);
    renderAdmin(); window.Shell?.updateBadges?.();
  });
  $('inquiry-admin-list')?.addEventListener('click', e => {
    const b = e.target.closest('[data-inquiry]'); if (!b) return;
    const q = adminList.find(x => x.id === Number(b.dataset.inquiry)); if (q) inquiryDetail(q);
  });

  // ---------- 문의 ----------
  const CAT = { bug: '오류 신고', idea: '개선 제안', etc: '기타' };
  const STATUS = { new: '새 문의', checking: '확인 중', done: '처리 완료' };
  async function imageHtml(sha) { const r = sha ? await C.image(sha) : null; return r?.ok ? `<img class="inquiry-img" src="${r.dataUrl}" alt="첨부한 사진">` : ''; }
  async function inquiryDetail(q) {
    const s = UI.sheet('문의 처리', `<div class="inquiry-detail">
        <div class="sd-row"><strong>${esc(q.user?.name || '')} <span class="sd-muted">${esc(q.user?.username || '')}</span></strong><span class="sd-badge">${CAT[q.category]}</span></div>
        <p class="sd-muted">${new Date(q.createdAt).toLocaleString()} · ${esc(q.appVersion || '버전 모름')} · ${esc(q.platform || '')}</p>
        <div class="inquiry-body">${esc(q.body).replace(/\n/g, '<br>')}</div><div data-img></div>
        <div class="sd-field sd-gap"><span class="sd-label">상태</span><div class="sd-segment" role="group" aria-label="처리 상태">${Object.keys(STATUS).map(k => `<button type="button" data-st="${k}" aria-pressed="${q.status === k}">${STATUS[k]}</button>`).join('')}</div></div>
        <div class="sd-field"><label for="iq-reply">답장 <span class="sd-muted">(보내면 문의한 사람에게 알림)</span></label><textarea id="iq-reply" class="sd-textarea" maxlength="2000" placeholder="확인했어요. 다음 업데이트에서 고칠게요.">${esc(q.reply || '')}</textarea></div>
        ${q.repliedAt ? `<p class="sd-muted">마지막 답장 ${new Date(q.repliedAt).toLocaleString()}${q.repliedBy ? ' · ' + esc(q.repliedBy) : ''}</p>` : ''}
        <div class="sd-actions"><button type="button" class="sd-btn" data-sheet-close>닫기</button><button type="button" class="sd-btn sd-btn-primary" data-iq-save>저장</button></div></div>`);
    let status = q.status;
    s.el.querySelector('[data-img]').innerHTML = await imageHtml(q.image);
    s.el.addEventListener('click', async e => {
      const st = e.target.closest('[data-st]');
      if (st) { status = st.dataset.st; s.el.querySelectorAll('[data-st]').forEach(x => x.setAttribute('aria-pressed', String(x === st))); return; }
      if (!e.target.closest('[data-iq-save]')) return;
      const reply = $('iq-reply').value.trim();
      const r = await C.call('PATCH', `/admin/inquiries/${q.id}`, { status: reply && status === 'new' ? 'checking' : status, reply });
      if (!r?.inquiry) return showToast(r?.error || '저장하지 못했어요');
      s.close(); showToast(reply && reply !== q.reply ? '답장을 보냈어요' : '저장했어요'); renderAdmin(); window.Shell?.updateBadges?.();
    });
  }

  // 회원: 문의하기(오류 신고·개선 제안·기타) + 내 문의 목록
  async function openInquiry() {
    const P = UI.panel('inquiry-panel', '문의하기', '더보기');
    let category = 'bug', image = null;
    P.sub.hidden = false; P.sub.textContent = '오류나 불편한 점을 알려주시면 운영진이 확인하고 답장해요.';
    P.body.innerHTML = `<form id="iq-form" novalidate>
        <div class="sd-field"><span class="sd-label">종류</span><div class="sd-segment" role="group" aria-label="문의 종류">${Object.keys(CAT).map(k => `<button type="button" data-cat="${k}" aria-pressed="${k === category}">${CAT[k]}</button>`).join('')}</div></div>
        <div class="sd-field"><label for="iq-body">내용</label><textarea id="iq-body" class="sd-textarea" maxlength="2000" placeholder="어떤 화면에서 무엇을 했을 때 어떻게 됐는지 적어주세요."></textarea></div>
        <div class="sd-row"><button type="button" class="sd-btn sd-btn-small" data-iq-img>${ico('image-plus')}사진 첨부</button><span class="sd-muted" data-iq-imgname></span>
          <input type="file" id="iq-file" accept="image/png,image/jpeg,image/webp" hidden></div>
        <p class="sd-muted sd-gap">앱 버전과 운영체제 정보가 함께 전송돼요.</p><p class="sd-error" id="iq-err" hidden></p>
        <button class="sd-btn sd-btn-primary sd-btn-block sd-gap">보내기</button></form>
      <h3 class="sd-gap-lg">내 문의</h3><div id="iq-mine"><div class="sd-skeleton-row"><span class="sd-skeleton" style="flex:1"></span></div></div>`;
    const loadMine = async () => {
      const r = await C.call('GET', '/me/inquiries'), list = r?.inquiries || [];
      $('iq-mine').innerHTML = list.length ? list.map(q => `<details class="inquiry-mine"><summary><span class="sd-grow"><strong>${esc(q.body.split('\n')[0].slice(0, 36))}</strong>
          <span class="sd-muted">${CAT[q.category]} · ${new Date(q.createdAt).toLocaleDateString()}</span></span><span class="sd-badge ${q.reply ? 'sd-badge-accent' : ''}">${q.reply ? '답장 도착' : STATUS[q.status]}</span></summary>
          <div class="inquiry-body">${esc(q.body).replace(/\n/g, '<br>')}</div>${q.reply ? `<div class="inquiry-reply"><span class="sd-label">운영진 답장</span><p>${esc(q.reply).replace(/\n/g, '<br>')}</p></div>` : ''}</details>`).join('')
        : '<p class="sd-muted">아직 보낸 문의가 없어요.</p>';
    };
    loadMine();
    P.el.addEventListener('click', e => {
      const c = e.target.closest('[data-cat]');
      if (c) { category = c.dataset.cat; P.el.querySelectorAll('[data-cat]').forEach(x => x.setAttribute('aria-pressed', String(x === c))); }
      if (e.target.closest('[data-iq-img]')) $('iq-file').click();
    });
    $('iq-file').onchange = async e => {
      const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      try { image = (await C.uploadImage(f)).sha; P.el.querySelector('[data-iq-imgname]').textContent = f.name; }
      catch (err) { showToast(err.message); }
    };
    $('iq-form').onsubmit = async e => {
      e.preventDefault();
      const body = $('iq-body').value.trim(), err = $('iq-err');
      if (body.length < 5) { err.textContent = '내용을 조금 더 적어 주세요(5자 이상).'; err.hidden = false; $('iq-body').setAttribute('aria-invalid', 'true'); return; }
      const info = await window.api.appInfo?.() || {};
      const r = await C.call('POST', '/inquiries', { category, body, image, appVersion: info.version ? 'v' + info.version : '', platform: `${info.platform || navigator.platform} ${info.arch || ''}`.trim() });
      if (!r?.inquiry) { err.textContent = r?.error || '보내지 못했어요'; err.hidden = false; return; }
      err.hidden = true; $('iq-body').value = ''; image = null; P.el.querySelector('[data-iq-imgname]').textContent = '';
      showToast('문의를 보냈어요. 답장이 오면 알려드려요'); loadMine();
    };
  }

  // 내 계정: 직책과 임원 신청
  async function accountPositionHtml(u) {
    const r = await C.call('GET', '/me/position-request'), req = r?.request;
    const pos = u.position || 'member';
    let action = '';
    if (pos === 'member') action = req?.status === 'pending'
      ? `<span class="sd-badge sd-badge-warning">임원 신청 검토 중</span><button type="button" class="sd-btn sd-btn-small sd-btn-ghost" data-posreq-cancel>신청 취소</button>`
      : `<button type="button" class="sd-btn sd-btn-small" data-posreq>임원 신청</button>`;
    const note = req?.status === 'rejected' && pos === 'member' ? '<p class="sd-muted">지난 임원 신청은 승인되지 않았어요. 다시 신청할 수 있어요.</p>' : '';
    return `<div class="sd-setting-row stacked"><div class="sd-setting-copy"><strong>직책</strong><p>${badges(u.role, pos)} 회장은 신청할 수 없고 최고 관리자가 정해요.</p>${note}</div>
      <div class="sd-setting-control sd-actions">${action}</div></div>`;
  }
  async function requestOfficer(onDone) {
    const s = UI.sheet('임원 신청', `<form id="posreq-form" novalidate><p class="sd-muted">운영진이 확인하고 승인하면 임원이 돼요.</p>
      <div class="sd-field"><label for="posreq-msg">한마디 <span class="sd-muted">(선택)</span></label><textarea id="posreq-msg" class="sd-textarea" maxlength="300" placeholder="어떤 역할을 맡고 싶은지 적어주세요."></textarea></div>
      <div class="sd-actions"><button type="button" class="sd-btn" data-sheet-close>취소</button><button class="sd-btn sd-btn-primary">신청하기</button></div></form>`);
    s.el.querySelector('#posreq-form').onsubmit = async e => {
      e.preventDefault();
      const r = await C.call('POST', '/me/position-request', { message: $('posreq-msg').value });
      if (!r?.request) return showToast(r?.error || '신청하지 못했어요');
      s.close(); showToast('임원 신청을 보냈어요'); onDone?.();
    };
  }
  async function cancelRequest(onDone) {
    if (!(await UI.confirm({ title: '임원 신청을 취소할까요?', body: '나중에 다시 신청할 수 있어요.', ok: '신청 취소' }))) return;
    const r = await C.call('DELETE', '/me/position-request');
    if (!r?.ok) return showToast(r?.error || '취소하지 못했어요');
    showToast('임원 신청을 취소했어요'); onDone?.();
  }

  // 관리자에게 보일 대기 건수(가입·방·임원 신청·새 문의)
  async function pendingCounts() {
    const [u, rooms, pr, iq] = await Promise.all([window.api.adminUsers(), C.call('GET', '/admin/rooms'), C.call('GET', '/admin/position-requests'), C.call('GET', '/admin/inquiries')]);
    return { signups: u?.ok ? u.users.filter(x => x.status === 'pending').length : 0, rooms: rooms?.rooms?.length || 0,
      positions: pr?.requests?.length || 0, inquiries: iq?.counts?.new || 0 };
  }

  // 실시간 알림
  C.on('admin', () => { window.Shell?.updateBadges?.(); if (!$('settings').classList.contains('hidden')) renderAdmin(); });
  C.on('account', ev => {
    if (ev.what === 'inquiry-reply') showToast('문의에 운영진 답장이 도착했어요', '보기', () => openInquiry());
    if (ev.what === 'position') showToast(`직책이 '${POS[ev.position]}'(으)로 바뀌었어요`);
    if (ev.what === 'position-request') showToast(ev.status === 'approved' ? '임원 신청이 승인됐어요' : '임원 신청이 승인되지 않았어요');
  });

  window.Roles = { POS, badges, isAdminRole, pickPosition, accountPositionHtml, requestOfficer, cancelRequest };
  window.Admin = { render: renderAdmin, openInquiry, pendingCounts };
})();
