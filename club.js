// 동아리 탭: 채팅(카톡형 방 목록 → 대화) · 공지 · 멤버, 프로필 편집, 운영진 방 승인.
// 서버 정책은 server/src/rooms.js 참고(전체방 자동 참여·나가기 불가, 스터디·이벤트는 승인 후 열림).
(function () {
  if (!SERVER_MODE) return;
  const C = window.Community;
  const ico = n => `<span class="ico-${n}" aria-hidden="true"></span>`;
  const KIND = { all: '전체', social: '친목', study: '스터디', event: '이벤트' };
  const KIND_ICO = { social: 'food', study: 'code', event: 'flag' };
  const errText = r => r?.error || '요청 실패';   // main이 서버 오류 코드를 문장으로 바꿔 준다

  const S = {
    me: null, started: false, tab: 'chat', filter: 'all', query: '', searching: false,
    rooms: [], discover: [], notices: [], members: [],
    screen: 'list',          // list | room | new | profile
    room: null, messages: [], loadingOlder: false, noMore: false, listScroll: 0,
  };
  const view = () => $('view-club');
  const visible = () => !view().classList.contains('hidden') && nav() === 'club';
  const nav = () => document.querySelector('#nav button.active')?.dataset.nav;

  // ---------- 공통 ----------
  const avatarCache = new Map();
  async function avatarUrl(sha) {
    if (!sha) return null;
    if (!avatarCache.has(sha)) avatarCache.set(sha, C.image(sha).then(r => r?.ok ? r.dataUrl : null));
    return avatarCache.get(sha);
  }
  const initials = n => escapeHtml(!n || String(n).startsWith('(') ? '?' : String(n).slice(0, 2));
  function avatarHtml(name, sha, cls = 'avatar') {
    return `<span class="${cls}"${sha ? ` data-avatar="${sha}"` : ''}>${initials(name)}</span>`;
  }
  // 화면에 그린 뒤 사진을 채운다
  function fillAvatars(root) {
    root.querySelectorAll('[data-avatar]').forEach(async el => {
      const url = await avatarUrl(el.dataset.avatar);
      if (url) el.innerHTML = `<img src="${url}" alt="">`;
    });
  }
  function timeLabel(iso) {
    if (!iso) return '';
    const d = new Date(iso), now = new Date();
    const day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((day(now) - day(d)) / 86400000);
    if (diff === 0) return d.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
    if (diff === 1) return '어제';
    return `${d.getMonth() + 1}월 ${d.getDate()}일`;
  }
  const isAdmin = () => ['admin', 'owner'].includes(S.me?.role);

  async function ensureMe() {
    if (S.me) return S.me;
    const r = await C.call('GET', '/me');
    if (r?.ok !== false && r?.user) S.me = r.user;
    return S.me;
  }

  // ---------- 데이터 ----------
  async function loadRooms() {
    const [r, d] = await Promise.all([C.rooms(), C.call('GET', '/rooms/discover')]);
    if (r?.rooms) S.rooms = r.rooms;
    if (d?.rooms) S.discover = d.rooms;
    updateBadge();
  }
  function updateBadge() {
    const n = S.rooms.reduce((a, r) => a + (r.unread || 0), 0);
    const b = $('club-badge');
    b.hidden = !n; b.textContent = n > 99 ? '99+' : String(n);
  }

  // ---------- 진입 ----------
  async function open() {
    await ensureMe();
    if (!S.started) startLive();
    if (S.screen === 'room' && S.room) return renderRoom();
    S.screen = 'list';
    renderList();
    await Promise.all([loadRooms(), S.tab === 'notice' ? loadNotices() : null, S.tab === 'members' ? loadMembers() : null]);
    if (visible() && S.screen === 'list') renderList();
  }

  // ---------- 목록 화면(머리 + 탭) ----------
  function headHtml() {
    return `<div class="club-head">
      <div class="club-title-row"><div><div class="eyebrow">COSMIC 동아리</div><h1>동아리</h1></div>
        <button type="button" class="sd-btn sd-btn-small together-btn" data-c="together"><span class="sd-ico" data-icon="users" aria-hidden="true"></span>같이 공부</button>
      </div>
      <div class="club-subrow">
        ${S.tab === 'chat' ? `<div class="club-tools">
          <button class="tool" data-c="search" title="방 검색" aria-label="방 검색" aria-pressed="${S.searching}">${ico('search')}</button>
          <button class="tool" data-c="new" title="새 채팅방" aria-label="새 채팅방">${ico('newchat')}</button></div>`
        : S.tab === 'notice' && isAdmin() ? `<div class="club-tools"><button class="tool" data-c="new-notice" title="공지 쓰기" aria-label="공지 쓰기">${ico('plus')}</button></div>` : '<div class="club-tools"></div>'}
      <div class="club-tabs" role="tablist">${[['chat', '채팅'], ['notice', '공지'], ['members', '멤버']].map(([k, l]) =>
        `<button role="tab" data-ctab="${k}" aria-selected="${S.tab === k}" class="${S.tab === k ? 'active' : ''}">${l}</button>`).join('')}</div></div>
    </div>`;
  }
  function renderList() {
    const v = view(); v.className = 'view club-list';
    let body = '';
    if (S.tab === 'chat') body = chatListHtml();
    if (S.tab === 'notice') body = noticesHtml();
    if (S.tab === 'members') body = membersHtml();
    v.innerHTML = headHtml() + body;
    fillAvatars(v);
    if (S.searching) { const q = v.querySelector('#club-q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
    v.scrollTop = S.listScroll;
  }

  // ---------- 채팅방 목록 ----------
  function roomPic(r) {
    if (r.kind === 'all') return `<span class="roompic official"><span>C</span></span>`;
    return `<span class="roompic">${ico(KIND_ICO[r.kind] || 'chat')}</span>`;
  }
  function preview(r) {
    if (r.status === 'pending') return '운영진 승인을 기다리는 중이에요';
    const m = r.lastMessage;
    if (!m) return r.topic ? escapeHtml(r.topic) : '아직 대화가 없어요';
    if (m.deleted) return '삭제된 메시지';
    return `${escapeHtml(m.author)}: ${m.body ? escapeHtml(m.body) : m.hasImage ? '사진' : ''}`;
  }
  function matches(r) {
    if (S.filter !== 'all' && r.kind !== S.filter) return false;
    const q = S.query.trim().toLowerCase();
    return !q || r.name.toLowerCase().includes(q) || (r.topic || '').toLowerCase().includes(q);
  }
  function chatListHtml() {
    const rooms = S.rooms.filter(r => r.kind === 'all' ? S.filter === 'all' && matches(r) : matches(r));
    const disc = S.discover.filter(matches);
    const filters = [['all', '모두'], ['study', '스터디'], ['social', '친목'], ['event', '이벤트']];
    return `${S.searching ? `<div class="room-search"><input id="club-q" type="search" placeholder="방 이름이나 주제로 찾기" value="${escapeHtml(S.query)}" aria-label="방 검색"></div>` : ''}
      <div class="room-filters" role="group" aria-label="방 종류">${filters.map(([k, l]) => `<button data-filter="${k}" aria-pressed="${S.filter === k}">${l}</button>`).join('')}</div>
      <div class="room-list">${rooms.length ? rooms.map(r => `<button class="room" data-room="${r.id}">
          ${roomPic(r)}
          <span class="room-copy"><span class="room-name"><span>${escapeHtml(r.name)}</span>${r.visibility === 'private' ? ico('lock') : ''}${r.kind === 'all' ? ico('pin') : ''}<span class="room-count">${r.memberCount}</span></span>
            <span class="room-preview">${preview(r)}</span>${r.status === 'pending' ? '<span class="room-badge">승인 대기</span>' : ''}</span>
          <span class="room-right"><span class="room-time">${timeLabel(r.lastMessage?.createdAt)}</span>${r.unread ? `<span class="unread">${r.unread > 99 ? '99+' : r.unread}</span>` : ''}</span>
        </button>`).join('') : `<div class="room-empty">${S.query ? '찾는 방이 없어요' : '이 종류의 방은 아직 없어요'}</div>`}
      ${disc.length ? `<div class="room-section">참여할 수 있는 공개방</div>${disc.map(r => `<div class="room discover">
          ${roomPic(r)}<span class="room-copy"><span class="room-name"><span>${escapeHtml(r.name)}</span><span class="room-count">${r.memberCount}</span></span>
          <span class="room-preview">${KIND[r.kind]}${r.topic ? ' · ' + escapeHtml(r.topic) : ''}</span></span>
          <span class="room-right"><button class="btn mini" data-join="${r.id}">참여</button></span></div>`).join('')}` : ''}
      </div>`;
  }

  // ---------- 새 채팅방 ----------
  function renderNewRoom() {
    S.screen = 'new';
    const v = view(); v.className = 'view club-form';
    v.innerHTML = `<div class="subhead"><button class="back" data-c="back">${ico('back')}채팅</button></div>
      <div class="sub-title-row"><div class="sub-title">새 채팅방</div></div>
      <form class="pad club-new" id="club-new-form">
        <label for="nr-name">방 이름</label><input id="nr-name" maxlength="30" placeholder="예: 알고리즘 스터디" required>
        <label for="nr-topic">한 줄 소개 <span class="set-hint">(선택)</span></label><input id="nr-topic" maxlength="100" placeholder="어떤 이야기를 나누는 방인가요?">
        <label>종류</label>
        <div class="choice" role="radiogroup">${[['social', '친목', '바로 열려요'], ['study', '스터디', '운영진 승인 후 열려요'], ['event', '이벤트', '운영진 승인 후 열려요']].map(([k, l, d], i) =>
          `<label class="choice-item"><input type="radio" name="nr-kind" value="${k}" ${i ? '' : 'checked'}><span>${ico(KIND_ICO[k])}<b>${l}</b><small>${d}</small></span></label>`).join('')}</div>
        <label>공개 범위</label>
        <div class="choice" role="radiogroup">
          <label class="choice-item"><input type="radio" name="nr-vis" value="public" checked><span>${ico('users')}<b>공개방</b><small>누구나 찾아서 참여</small></span></label>
          <label class="choice-item"><input type="radio" name="nr-vis" value="private"><span>${ico('lock')}<b>비공개방</b><small>초대한 사람만</small></span></label>
        </div>
        <button class="btn primary wide" type="submit">만들기</button>
      </form>`;
    v.scrollTop = 0;
    v.querySelector('#nr-name').focus();
    v.querySelector('#club-new-form').onsubmit = async e => {
      e.preventDefault();
      const btn = e.target.querySelector('[type=submit]'); btn.disabled = true;
      const kind = v.querySelector('[name=nr-kind]:checked').value;
      const r = await C.call('POST', '/rooms', { name: $('nr-name').value, topic: $('nr-topic').value, kind, visibility: v.querySelector('[name=nr-vis]:checked').value });
      btn.disabled = false;
      if (!r?.room) return showToast(errText(r));
      showToast(r.room.status === 'pending' ? `'${r.room.name}' 방을 만들었어요. 운영진이 승인하면 열려요` : `'${r.room.name}' 방을 만들었어요`);
      await loadRooms();
      openRoom(r.room.id);
    };
  }

  // ---------- 대화 ----------
  async function openRoom(id) {
    S.listScroll = S.screen === 'list' ? view().scrollTop : S.listScroll;
    S.room = S.rooms.find(r => r.id === id) || { id, name: '', memberCount: 0, kind: 'social' };
    S.screen = 'room'; S.messages = []; S.noMore = false;
    renderRoom(true);
    const r = await C.messages(id);
    if (!r?.messages) { showToast(errText(r)); return backToList(); }
    S.messages = r.messages; S.noMore = r.messages.length < 50;
    renderLog(true);
  }
  function renderRoom(loading) {
    const r = S.room, v = view(); v.className = 'view club-room';
    const canManage = r.myRole === 'owner' || isAdmin();
    v.innerHTML = `<div class="chat-head">
        <button class="back" data-c="back" aria-label="채팅 목록으로">${ico('back')}</button>
        <div class="chat-title"><b>${escapeHtml(r.name)}</b><small>${KIND[r.kind] || ''} · ${r.memberCount}명${r.status === 'pending' ? ' · 승인 대기' : ''}</small></div>
        <button class="tool" data-c="room-menu" aria-label="방 메뉴" aria-expanded="false">${ico('more')}</button>
        <div class="room-menu" hidden>
          <button data-c="room-members">${ico('users')}참여자 보기</button>
          ${r.kind === 'study' && r.status === 'active' ? `<button data-c="room-together"><span class="sd-ico" data-icon="timer" aria-hidden="true"></span>같이 공부 · 이 방 랭킹</button>` : ''}
          ${canManage && r.kind !== 'all' ? `<button data-c="room-invite">${ico('plus')}초대하기</button>` : ''}
          ${r.kind !== 'all' ? `<button data-c="room-leave" class="danger">${ico('logout')}방 나가기</button>` : ''}
          ${canManage && r.kind !== 'all' ? `<button data-c="room-archive" class="danger">${ico('x')}방 닫기</button>` : ''}
        </div>
      </div>
      ${r.topic ? `<div class="chat-topic">${ico('megaphone')}<span>${escapeHtml(r.topic)}</span></div>` : ''}
      <div class="chat-log" id="chat-log" aria-live="polite">${loading ? '<div class="room-empty">불러오는 중…</div>' : ''}</div>
      <button class="new-msg" id="new-msg" hidden>새 메시지 ↓</button>
      <form class="compose" id="compose">
        <button type="button" class="tool" data-c="image" title="사진 보내기" aria-label="사진 보내기">${ico('image')}</button>
        <input id="compose-in" autocomplete="off" maxlength="4000" placeholder="${r.status === 'pending' ? '승인 전에는 방장만 볼 수 있어요' : '메시지 보내기'}" aria-label="메시지">
        <button type="submit" class="send" aria-label="보내기">${ico('send')}</button>
        <input type="file" id="compose-file" accept="image/png,image/jpeg,image/webp,image/gif" hidden>
      </form>`;
    const log = v.querySelector('#chat-log');
    log.addEventListener('scroll', () => {
      if (log.scrollTop < 40) loadOlder();
      if (nearBottom(log)) { $('new-msg').hidden = true; markRead(); }
    });
    v.querySelector('#compose').onsubmit = e => { e.preventDefault(); sendText(); };
    v.querySelector('#compose-in').addEventListener('paste', e => {
      const f = [...(e.clipboardData?.files || [])].find(x => x.type.startsWith('image/'));
      if (f) { e.preventDefault(); sendImage(f); }
    });
    v.querySelector('#compose-file').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) sendImage(f); };
    $('new-msg').onclick = () => { log.scrollTop = log.scrollHeight; };
    if (!loading) renderLog(true);
    setTimeout(() => v.querySelector('#compose-in')?.focus(), 0);
  }
  const nearBottom = el => el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  function msgHtml(m, prev) {
    const mine = m.userId === S.me?.id;
    const day = new Date(m.createdAt).toDateString();
    const dayLine = !prev || new Date(prev.createdAt).toDateString() !== day
      ? `<div class="chat-date">${new Date(m.createdAt).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' })}</div>` : '';
    const grouped = prev && !dayLine && prev.userId === m.userId && new Date(m.createdAt) - new Date(prev.createdAt) < 3 * 60000;
    const lastRead = S.room.lastReadId;
    const unreadLine = prev && prev.id <= lastRead && m.id > lastRead && !mine ? '<div class="chat-unread-line"><span>여기부터 안 읽음</span></div>' : '';
    const content = m.deleted ? '<span class="deleted">삭제된 메시지예요</span>'
      : `${m.image ? `<button class="chat-img" data-img="${m.image.sha}" style="${m.image.width ? `aspect-ratio:${m.image.width}/${m.image.height}` : ''}" aria-label="사진 크게 보기"></button>` : ''}${m.body ? `<span class="chat-text">${linkify(escapeHtml(m.body))}</span>` : ''}`;
    const canDelete = !m.tmp && !m.deleted && (mine || isAdmin());
    const msgState = m.tmp ? (m.failed ? `<span class="msg-state failed">전송 실패 · <button type="button" class="link" data-retry="${m.id}">다시 보내기</button></span>` : '<span class="msg-state">보내는 중…</span>') : '';
    return `${dayLine}${unreadLine}<div class="msg${mine ? ' mine' : ''}${grouped ? ' grouped' : ''}" data-mid="${m.id}">
      ${mine || grouped ? '' : avatarHtml(m.author, m.avatar, 'avatar sm')}
      <div class="msg-body">${mine || grouped ? '' : `<div class="msg-name">${escapeHtml(m.author)}</div>`}
        <div class="msg-line"><div class="bubble">${content}</div><span class="msg-time">${new Date(m.createdAt).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' })}</span>
        ${msgState}${canDelete ? `<button class="msg-del" data-del="${m.id}" title="삭제" aria-label="메시지 삭제">${ico('x')}</button>` : ''}</div></div></div>`;
  }
  const linkify = s => s.replace(/https?:\/\/[^\s<]+/g, u => `<a href="#" data-link="${u}">${u}</a>`);
  function renderLog(toBottom) {
    const log = $('chat-log'); if (!log) return;
    const prevH = log.scrollHeight, prevTop = log.scrollTop;
    log.innerHTML = S.messages.length ? S.messages.map((m, i) => msgHtml(m, S.messages[i - 1])).join('')
      : '<div class="room-empty">첫 메시지를 남겨 보세요</div>';
    fillAvatars(log); fillImages(log);
    if (toBottom === true) {
      const line = log.querySelector('.chat-unread-line');
      if (line) line.scrollIntoView({ block: 'center' }); else log.scrollTop = log.scrollHeight;
    } else if (toBottom === 'keep') log.scrollTop = prevTop + (log.scrollHeight - prevH);
    if (nearBottom(log)) markRead();
  }
  function fillImages(root) {
    root.querySelectorAll('[data-img]').forEach(async el => {
      const url = await avatarUrl(el.dataset.img);
      if (url) el.innerHTML = `<img src="${url}" alt="보낸 사진">`; else el.textContent = '사진을 불러오지 못했어요';
    });
  }
  async function loadOlder() {
    if (S.loadingOlder || S.noMore || !S.messages.length) return;
    S.loadingOlder = true;
    const r = await C.messages(S.room.id, S.messages[0].id);
    S.loadingOlder = false;
    if (!r?.messages) return;
    if (r.messages.length < 50) S.noMore = true;
    S.messages = r.messages.concat(S.messages);
    renderLog('keep');
  }
  let readTimer = null;
  function markRead() {
    if (!S.room || !S.messages.length) return;
    const last = [...S.messages].reverse().find(m => !m.tmp)?.id; if (!last) return;
    const room = S.rooms.find(r => r.id === S.room.id);
    if (room) { room.unread = 0; room.lastReadId = Math.max(room.lastReadId || 0, last); updateBadge(); }
    clearTimeout(readTimer);
    readTimer = setTimeout(() => C.call('POST', `/rooms/${S.room.id}/read`, { lastId: last }), 400);
  }
  // 보내는 동안은 '보내는 중' 말풍선을 먼저 보여 주고, 실패하면 그 자리에서 다시 보내기
  let tempSeq = 0;
  async function sendText(retryOf) {
    const inp = $('compose-in');
    const body = retryOf ? retryOf.body : inp.value.trim();
    if (!body) return;
    if (!retryOf) inp.value = '';
    const temp = retryOf || { id: 'tmp' + (++tempSeq), tmp: true, body, userId: S.me?.id, author: S.me?.displayName, createdAt: new Date().toISOString(), roomId: S.room.id };
    temp.failed = false;
    if (!retryOf) S.messages.push(temp);
    renderLog('bottom'); const log = $('chat-log'); if (log) log.scrollTop = log.scrollHeight;
    const r = await C.send(temp.roomId, body);
    if (!r?.message) { temp.failed = true; temp.error = errText(r); renderLog('keep'); return; }
    S.messages = S.messages.filter(x => x !== temp);
    addMessage(r.message);
  }
  async function sendImage(file) {
    try {
      showToast('사진 올리는 중…');
      const img = await C.uploadImage(file);
      const r = await C.send(S.room.id, $('compose-in')?.value.trim() || '', img);
      if (!r?.message) return showToast(errText(r));
      if ($('compose-in')) $('compose-in').value = '';
      hideToast(); addMessage(r.message);
    } catch (e) { showToast(e.message); }
  }
  function addMessage(m) {
    if (S.messages.some(x => x.id === m.id)) return;
    const log = $('chat-log'), atBottom = log && nearBottom(log);
    S.messages.push(m);
    const mine = m.userId === S.me?.id;
    if (mine) S.room.lastReadId = m.id;
    renderLog(atBottom || mine ? 'bottom' : 'keep');
    if (atBottom || mine) log.scrollTop = log.scrollHeight;
    else $('new-msg').hidden = false;
  }

  // 방 메뉴
  async function roomMembers() {
    const r = await C.call('GET', `/rooms/${S.room.id}/members`);
    if (!r?.members) return showToast(errText(r));
    sheet(`참여자 ${r.members.length}명`, `<div class="sheet-list">${r.members.map(m => `<div class="person">${avatarHtml(m.name, m.avatar, 'avatar sm')}<b>${escapeHtml(m.name)}</b>${m.role === 'owner' ? '<span class="pill soft">방장</span>' : ''}</div>`).join('')}</div>`);
  }
  async function roomInvite() {
    const [all, cur] = await Promise.all([C.members(), C.call('GET', `/rooms/${S.room.id}/members`)]);
    if (!all?.members) return showToast(errText(all));
    const inRoom = new Set((cur?.members || []).map(m => m.id));
    const cand = all.members.filter(m => !inRoom.has(m.id));
    if (!cand.length) return showToast('초대할 수 있는 회원이 없어요');
    const el = sheet('초대하기', `<div class="sheet-list">${cand.map(m => `<label class="person"><input type="checkbox" value="${m.id}">${avatarHtml(m.nickname || m.name, m.avatar, 'avatar sm')}<b>${escapeHtml(m.nickname || m.name)}</b></label>`).join('')}</div>
      <button class="btn primary wide" data-sheet="invite">초대</button>`);
    el.querySelector('[data-sheet=invite]').onclick = async () => {
      const ids = [...el.querySelectorAll('input:checked')].map(i => Number(i.value));
      if (!ids.length) return;
      const r = await C.call('POST', `/rooms/${S.room.id}/invite`, { userIds: ids });
      if (r?.added === undefined) return showToast(errText(r));
      closeSheet(); showToast(`${r.added}명을 초대했어요`);
    };
  }
  async function roomLeave(archive) {
    const ok = await UI.confirm(archive
      ? { title: '채팅방을 닫을까요?', body: `'${S.room.name}' 방이 모든 참여자에게서 사라져요. 되돌릴 수 없어요.`, ok: '방 닫기', danger: true }
      : { title: '채팅방에서 나갈까요?', body: `'${S.room.name}' 방이 목록에서 사라져요. 공개방이면 다시 참여할 수 있어요.`, ok: '나가기', danger: true });
    if (!ok) return;
    const r = archive ? await C.call('DELETE', `/rooms/${S.room.id}`) : await C.call('POST', `/rooms/${S.room.id}/leave`);
    if (!r?.ok) return showToast(errText(r));
    showToast(archive ? '방을 닫았어요' : '방에서 나왔어요');
    backToList(true);
  }

  // 아래에서 올라오는 시트(참여자·초대·공지 작성·프로필 사진 확대)
  let openSheet = null;
  function sheet(title, html) {
    closeSheet();
    openSheet = UI.sheet(title, html, { onClose: () => { openSheet = null; } });
    fillAvatars(openSheet.el);
    return openSheet.el;
  }
  function closeSheet() { openSheet?.close(); openSheet = null; }

  async function backToList(reload) {
    S.screen = 'list'; S.room = null; S.messages = [];
    renderList();
    if (reload !== false) { await loadRooms(); if (visible() && S.screen === 'list') renderList(); }
  }

  // ---------- 공지 ----------
  async function loadNotices() {
    const r = await C.notices();
    if (r?.notices) S.notices = r.notices;
  }
  function noticesHtml() {
    if (!S.notices.length) return '<div class="room-empty">아직 공지가 없어요</div>';
    return `<div class="notice-list">${S.notices.map(n => `<article class="notice${n.pinned ? ' pinned' : ''}">
      <div class="notice-top">${n.pinned ? `<span class="pill soft">${ico('pin')}고정</span>` : ''}<b>${escapeHtml(n.title)}</b></div>
      <div class="notice-body">${linkify(escapeHtml(n.body)).replace(/\n/g, '<br>')}</div>
      <div class="notice-meta">${escapeHtml(n.author)} · ${timeLabel(n.createdAt)}${isAdmin() ? ` · <button class="link" data-notice-edit="${n.id}">고치기</button> · <button class="link danger" data-notice-del="${n.id}">삭제</button>` : ''}</div>
    </article>`).join('')}</div>`;
  }
  function noticeEditor(n) {
    const el = sheet(n ? '공지 고치기' : '공지 쓰기', `<form class="club-new" id="notice-form">
      <label for="nt-title">제목</label><input id="nt-title" maxlength="100" value="${escapeHtml(n?.title || '')}" required>
      <label for="nt-body">내용</label><textarea id="nt-body" rows="7" maxlength="5000" required>${escapeHtml(n?.body || '')}</textarea>
      <label class="row"><input type="checkbox" id="nt-pin" ${n?.pinned ? 'checked' : ''}>맨 위에 고정</label>
      <button class="btn primary wide" type="submit">${n ? '저장' : '올리기'}</button></form>`);
    el.querySelector('#notice-form').onsubmit = async e => {
      e.preventDefault();
      const body = { title: $('nt-title').value, body: $('nt-body').value, pinned: $('nt-pin').checked };
      const r = n ? await C.call('PATCH', `/notices/${n.id}`, body) : await C.call('POST', '/notices', body);
      if (!r?.notice) return showToast(errText(r));
      closeSheet(); await loadNotices(); renderList();
    };
  }

  // ---------- 멤버 ----------
  async function loadMembers() {
    const r = await C.members();
    if (r?.members) S.members = r.members;
  }
  function membersHtml() {
    const online = S.members.filter(m => m.online || C.state.online.has(m.id));
    const roleLabel = { owner: '회장', admin: '운영진' };
    const row = m => `<button class="person member" data-member="${m.id}">${avatarHtml(m.nickname || m.name, m.avatar)}
      <span class="mt"><b>${escapeHtml(m.nickname || m.name)}${roleLabel[m.role] ? ` <span class="pill soft">${roleLabel[m.role]}</span>` : ''}</b>
      <small>${m.bio ? escapeHtml(m.bio) : m.study ? `오늘 ${m.study.todayMinutes}분 공부` : ''}</small></span>
      <span class="online-dot${C.state.online.has(m.id) ? ' on' : ''}" aria-label="${C.state.online.has(m.id) ? '접속 중' : '오프라인'}"></span></button>`;
    return `<div class="member-sum">전체 ${S.members.length}명 · 지금 접속 ${online.length}명</div>
      <div class="member-list">${S.members.slice().sort((a, b) => C.state.online.has(b.id) - C.state.online.has(a.id)).map(row).join('')}</div>`;
  }
  function memberDetail(id) {
    const m = S.members.find(x => x.id === id); if (!m) return;
    const days = ['', '월', '화', '수', '목', '금', '토', '일'];
    sheet(m.nickname || m.name, `<div class="profile-card">${avatarHtml(m.nickname || m.name, m.avatar, 'avatar lg')}
      <b>${escapeHtml(m.nickname || m.name)}</b>${m.nickname ? `<small>${escapeHtml(m.name)}</small>` : ''}
      ${m.bio ? `<p>${escapeHtml(m.bio)}</p>` : ''}</div>
      ${m.study ? `<div class="set-block"><span class="set-label">오늘 공부</span><span>${m.study.todayMinutes}분</span></div>` : ''}
      ${m.timetable?.length ? `<div class="set-block"><span class="set-label">시간표</span>${m.timetable.map(c => `<div class="set-hint">${escapeHtml(c.name)} · ${(c.times || []).map(t => `${days[t.day] || t.day} ${t.start}~${t.end}`).join(', ')}</div>`).join('')}</div>` : ''}`);
  }

  // ---------- 내 프로필 ----------
  async function openProfileEditor(onSaved) {
    const r = await C.call('GET', '/me/profile');
    if (!r?.profile) return showToast(errText(r));
    const p = r.profile; let avatar = p.avatar;
    const me = await ensureMe();
    const el = sheet('내 프로필', `<form class="club-new" id="profile-form">
      <div class="profile-card"><button type="button" class="avatar-edit" id="pf-avatar" title="사진 바꾸기">${avatarHtml(p.nickname || me?.displayName, avatar, 'avatar lg')}<span>사진 바꾸기</span></button>
        <input type="file" id="pf-file" accept="image/png,image/jpeg,image/webp" hidden></div>
      <label for="pf-nick">닉네임 <span class="set-hint">(비우면 이름 ${escapeHtml(me?.displayName || '')})</span></label><input id="pf-nick" maxlength="20" value="${escapeHtml(p.nickname)}">
      <label for="pf-bio">한 줄 소개</label><input id="pf-bio" maxlength="200" value="${escapeHtml(p.bio)}">
      <div class="sd-setting-row"><div class="sd-setting-copy"><label for="pf-study">공부 시간 공개</label><p>같이 공부·랭킹에 내 공부 시간과 과목이 보여요.</p></div>
        <div class="sd-setting-control"><span class="sd-toggle-hit"><input class="sd-toggle" type="checkbox" role="switch" id="pf-study" ${p.showStudy ? 'checked' : ''}></span></div></div>
      <div class="sd-setting-row"><div class="sd-setting-copy"><label for="pf-tt">시간표 공개</label><p>멤버 프로필에서 내 수업 시간이 보여요.</p></div>
        <div class="sd-setting-control"><span class="sd-toggle-hit"><input class="sd-toggle" type="checkbox" role="switch" id="pf-tt" ${p.showTimetable ? 'checked' : ''}></span></div></div>
      <div class="sheet-actions">${avatar ? '<button type="button" class="btn" id="pf-noavatar">사진 지우기</button>' : ''}<button class="btn primary" type="submit">저장</button></div></form>`);
    el.querySelector('#pf-avatar').onclick = () => el.querySelector('#pf-file').click();
    el.querySelector('#pf-file').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      try { const img = await C.uploadImage(f); avatar = img.sha; el.querySelector('#pf-avatar .avatar').dataset.avatar = avatar; fillAvatars(el); }
      catch (err) { showToast(err.message); }
    };
    el.querySelector('#pf-noavatar')?.addEventListener('click', () => { avatar = null; el.querySelector('#pf-avatar .avatar').innerHTML = initials(p.nickname || me?.displayName); });
    el.querySelector('#profile-form').onsubmit = async e => {
      e.preventDefault();
      const x = await C.call('PUT', '/me/profile', { nickname: $('pf-nick').value, bio: $('pf-bio').value, avatar, showStudy: $('pf-study').checked, showTimetable: $('pf-tt').checked });
      if (!x?.ok) return showToast(errText(x));
      myAvatarSha = avatar; closeSheet(); showToast('프로필을 저장했어요'); onSaved?.();
      if (nav() === 'more') window.Shell.goNav('more');
    };
  }
  let myAvatarSha;
  async function loadMyAvatar(elId) {
    if (myAvatarSha === undefined) { const r = await C.call('GET', '/me/profile'); myAvatarSha = r?.profile?.avatar || null; }
    const el = $(elId); if (!el || !myAvatarSha) return;
    const url = await avatarUrl(myAvatarSha); if (url) el.innerHTML = `<img src="${url}" alt="">`;
  }

  // ---------- 운영진: 방 승인 ----------
  async function renderRoomApprovals() {
    const list = $('room-admin-list'); if (!list) return;
    const r = await C.call('GET', '/admin/rooms');
    const rooms = r?.rooms || [];
    $('room-admin-count').textContent = rooms.length ? rooms.length : '';
    list.innerHTML = rooms.length ? rooms.map(x => `<div class="row admin-room" style="justify-content:space-between;gap:8px">
        <span><b>${escapeHtml(x.name)}</b> <span class="set-hint">${KIND[x.kind]} · ${x.visibility === 'private' ? '비공개' : '공개'} · ${escapeHtml(x.owner || '')}</span>${x.topic ? `<br><span class="set-hint">${escapeHtml(x.topic)}</span>` : ''}</span>
        <span style="display:flex;gap:6px;flex:none"><button class="sd-btn sd-btn-small sd-btn-primary" data-room-admin="approve" data-id="${x.id}">승인</button><button class="sd-btn sd-btn-small" data-room-admin="reject" data-id="${x.id}">거절</button></span></div>`).join('')
      : '<span class="set-hint">승인을 기다리는 방이 없어요</span>';
  }
  $('room-admin-list').addEventListener('click', async e => {
    const b = e.target.closest('[data-room-admin]'); if (!b) return;
    b.disabled = true;
    const r = await C.call('POST', `/admin/rooms/${b.dataset.id}/${b.dataset.roomAdmin}`);
    if (!r?.ok) { b.disabled = false; return showToast(errText(r)); }
    showToast(b.dataset.roomAdmin === 'approve' ? '방을 승인했어요' : '방 신청을 거절했어요');
    renderRoomApprovals();
  });

  // ---------- 클릭 ----------
  view().addEventListener('click', async e => {
    const t = e.target;
    const link = t.closest('[data-link]'); if (link) { e.preventDefault(); return window.api.openExternal?.(link.dataset.link); }
    const tab = t.closest('[data-ctab]');
    if (tab) {
      S.tab = tab.dataset.ctab; S.listScroll = 0; renderList();
      if (S.tab === 'notice') await loadNotices();
      if (S.tab === 'members') await loadMembers();
      if (S.tab === 'chat') await loadRooms();
      if (S.screen === 'list') renderList();
      return;
    }
    const f = t.closest('[data-filter]'); if (f) { S.filter = f.dataset.filter; return renderList(); }
    const room = t.closest('[data-room]'); if (room) return openRoom(Number(room.dataset.room));
    const join = t.closest('[data-join]');
    if (join) {
      join.disabled = true;
      const r = await C.call('POST', `/rooms/${join.dataset.join}/join`);
      if (!r?.room) { join.disabled = false; return showToast(errText(r)); }
      await loadRooms(); return openRoom(r.room.id);
    }
    const retry = t.closest('[data-retry]');
    if (retry) { const m = S.messages.find(x => x.id === retry.dataset.retry); if (m) sendText(m); return; }
    const del = t.closest('[data-del]');
    if (del) {
      if (!(await UI.confirm({ title: '메시지를 삭제할까요?', body: '모든 참여자에게 삭제된 메시지로 보여요.', ok: '삭제', danger: true }))) return;
      const r = await C.call('DELETE', `/messages/${del.dataset.del}`);
      if (!r?.ok) return showToast(errText(r));
      const m = S.messages.find(x => x.id === Number(del.dataset.del)); if (m) { m.deleted = true; m.body = ''; m.image = null; renderLog('keep'); }
      return;
    }
    const img = t.closest('[data-img]');
    if (img) { const url = await avatarUrl(img.dataset.img); if (url) sheet('사진', `<img class="sheet-img" src="${url}" alt="">`); return; }
    const mem = t.closest('[data-member]'); if (mem) return memberDetail(Number(mem.dataset.member));
    const ne = t.closest('[data-notice-edit]'); if (ne) return noticeEditor(S.notices.find(n => n.id === Number(ne.dataset.noticeEdit)));
    const nd = t.closest('[data-notice-del]');
    if (nd) {
      if (!(await UI.confirm({ title: '공지를 삭제할까요?', body: '동아리원 모두에게서 사라져요.', ok: '삭제', danger: true }))) return;
      const r = await C.call('DELETE', `/notices/${nd.dataset.noticeDel}`);
      if (!r?.ok) return showToast(errText(r));
      await loadNotices(); return renderList();
    }
    const c = t.closest('[data-c]')?.dataset.c;
    const menu = view().querySelector('.room-menu');
    if (c !== 'room-menu' && menu) { menu.hidden = true; view().querySelector('[data-c=room-menu]')?.setAttribute('aria-expanded', 'false'); }
    if (c === 'search') { S.searching = !S.searching; if (!S.searching) S.query = ''; return renderList(); }
    if (c === 'new') return renderNewRoom();
    if (c === 'new-notice') return noticeEditor(null);
    if (c === 'back') return backToList();
    if (c === 'image') return $('compose-file').click();
    if (c === 'room-menu') { menu.hidden = !menu.hidden; t.closest('[data-c]').setAttribute('aria-expanded', String(!menu.hidden)); return; }
    if (c === 'room-members') return roomMembers();
    if (c === 'room-together') return window.Focus?.openTogether(S.room.id, { label: '채팅방', nav: 'club', go: () => window.Shell.goNav('club') });
    if (c === 'together') return window.Focus?.openTogether();
    if (c === 'room-invite') return roomInvite();
    if (c === 'room-leave') return roomLeave(false);
    if (c === 'room-archive') return roomLeave(true);
  });
  view().addEventListener('input', e => {
    if (e.target.id !== 'club-q') return;
    S.query = e.target.value;
    const list = view().querySelector('.room-list');
    const tmp = document.createElement('div'); tmp.innerHTML = chatListHtml();
    list.replaceWith(tmp.querySelector('.room-list')); fillAvatars(view());
  });
  view().addEventListener('keydown', e => {
    if (e.key === 'Escape' && S.screen !== 'list') { e.preventDefault(); backToList(); }
  });

  // ---------- 실시간 ----------
  function startLive() {
    S.started = true;
    C.start();
    C.on('message', async ev => {
      if (ev.action === 'new') {
        const m = ev.message;
        if (S.screen === 'room' && S.room?.id === m.roomId) {
          addMessage(m);
          if (visible() && document.hasFocus()) markRead();
        }
        const room = S.rooms.find(r => r.id === m.roomId);
        if (room) {
          room.lastMessage = { id: m.id, author: m.author, body: m.body, hasImage: !!m.image, createdAt: m.createdAt };
          const reading = S.screen === 'room' && S.room?.id === m.roomId && visible();
          if (m.userId !== S.me?.id && !reading) room.unread = (room.unread || 0) + 1;
          S.rooms.sort((a, b) => (b.pinned - a.pinned) || new Date(b.lastMessage?.createdAt || b.createdAt) - new Date(a.lastMessage?.createdAt || a.createdAt));
          updateBadge();
          if (visible() && S.screen === 'list' && S.tab === 'chat') renderList();
          if (m.userId !== S.me?.id && !reading) showToast(`${room.name} · ${m.author}: ${m.body ? m.body.slice(0, 40) : '사진'}`, '보기', () => { window.Shell.goNav('club'); openRoom(room.id); });
        } else await loadRooms();
      }
      if (ev.action === 'delete' && S.room?.id === ev.roomId) {
        const m = S.messages.find(x => x.id === ev.id); if (m) { m.deleted = true; m.body = ''; m.image = null; renderLog('keep'); }
      }
    });
    C.on('room', async ev => {
      await loadRooms();
      if (ev.action === 'archive' && S.room?.id === ev.roomId) { showToast('방이 닫혔어요'); return backToList(false); }
      if (ev.action === 'approve') showToast('방이 승인되어 열렸어요');
      if (ev.action === 'reject') showToast('방 신청이 거절됐어요');
      if (ev.action === 'invited') showToast('새 채팅방에 초대됐어요');
      if (ev.action === 'pending' && isAdmin()) showToast('승인을 기다리는 방이 있어요');
      if (S.room) { const r = S.rooms.find(x => x.id === S.room.id); if (r) S.room = { ...S.room, ...r, lastReadId: S.room.lastReadId }; }
      if (visible() && S.screen === 'list') renderList();
    });
    C.on('notice', async ev => {
      await loadNotices();
      if (ev.action === 'new') showToast(`📢 새 공지: ${ev.notice.title}`, '보기', () => { S.tab = 'notice'; S.screen = 'list'; window.Shell.goNav('club'); });
      if (visible() && S.screen === 'list' && S.tab === 'notice') renderList();
    });
    C.on('presence', () => { if (visible() && S.screen === 'list' && S.tab === 'members') renderList(); });
    C.on('profile', () => { avatarCache.clear(); if (S.tab === 'members') loadMembers().then(() => visible() && S.screen === 'list' && renderList()); });
    C.on('connection', ev => { if (ev.connected) loadRooms().then(() => visible() && S.screen === 'list' && renderList()); });
    C.on('auth-lost', () => { C.stop(); S.started = false; S.me = null; });
  }

  // 로그인되어 있으면 백그라운드에서 연결해 안 읽은 수를 띄운다
  async function boot() {
    const st = await window.api.gitSyncStatus();
    if (st?.enabled && st?.hasToken && !S.started) { await ensureMe(); if (S.me) { startLive(); loadRooms(); } }
  }
  boot();
  setInterval(boot, 60000);

  window.Club = { open, openProfileEditor, loadMyAvatar, renderRoomApprovals, reset() { C.stop(); Object.assign(S, { me: null, started: false, rooms: [], screen: 'list', room: null }); updateBadge(); } };
})();
