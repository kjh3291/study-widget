// 커뮤니티(공지·채팅·프로필) 연결층. 화면과 분리해 두어 디자인을 바꿔도 그대로 쓴다.
// - 실시간: 서버 /ws에 연결 → 첫 메시지로 기기 토큰 인증 → 끊기면 점점 늘어나는 간격으로 재연결
// - 요청: window.api.communityCall(method, path, body) (토큰은 main이 붙임)
// - 사진: 올리기 전에 긴 변 1600px로 줄이고(움직이는 GIF 제외), 받을 때는 main이 캐시해 data URL로 준다
(function () {
  const listeners = new Map();
  let ws = null, stopped = true, retry = 0, pingTimer = null, retryTimer = null;
  const state = { connected: false, online: new Set() };
  const emit = (type, ev) => (listeners.get(type) || []).concat(listeners.get('*') || []).forEach(fn => { try { fn(ev); } catch (e) { console.error(e); } });

  async function open() {
    if (stopped) return;
    const info = await window.api.communitySocketInfo();
    if (!info?.ok) { schedule(); return; }
    ws = new WebSocket(info.wsUrl);
    ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token: info.token }));
    ws.onmessage = e => {
      let ev; try { ev = JSON.parse(e.data); } catch { return; }
      if (ev.type === 'ready') { retry = 0; state.connected = true; state.online = new Set(ev.online); emit('connection', { connected: true }); return; }
      if (ev.type === 'presence') ev.online ? state.online.add(ev.userId) : state.online.delete(ev.userId);
      if (ev.type !== 'pong') emit(ev.type, ev);
    };
    ws.onclose = e => {
      const was = state.connected; state.connected = false; ws = null;
      if (was) emit('connection', { connected: false });
      if (e.code === 4003) { emit('auth-lost', {}); return; }   // 토큰이 무효: 다시 로그인 필요
      schedule();
    };
    ws.onerror = () => {};
  }
  function schedule() {
    if (stopped) return;
    clearTimeout(retryTimer);
    retryTimer = setTimeout(open, Math.min(30000, 1000 * 2 ** retry++));
  }

  async function prepareImage(file) {
    if (file.size > 10 * 1024 * 1024 && file.type === 'image/gif') throw new Error('움직이는 사진(GIF)은 10MB까지 올릴 수 있어요');
    if (file.type === 'image/gif') { const b = new Uint8Array(await file.arrayBuffer()); return { bytes: b, width: null, height: null }; }
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const canvas = new OffscreenCanvas(w, h);
    canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
    const blob = await canvas.convertToBlob({ type: file.type === 'image/png' && scale === 1 && file.size < 2 * 1024 * 1024 ? 'image/png' : 'image/jpeg', quality: 0.85 });
    if (blob.size > 10 * 1024 * 1024) throw new Error('사진이 너무 커요(10MB 초과)');
    return { bytes: new Uint8Array(await blob.arrayBuffer()), width: w, height: h };
  }

  window.Community = {
    state,
    on(type, fn) { listeners.set(type, [...(listeners.get(type) || []), fn]); return () => listeners.set(type, listeners.get(type).filter(f => f !== fn)); },
    start() {
      if (!stopped) return; stopped = false; retry = 0; open();
      clearInterval(pingTimer);
      pingTimer = setInterval(() => { if (ws?.readyState === 1) ws.send('{"type":"ping"}'); }, 25000);
    },
    stop() { stopped = true; clearInterval(pingTimer); clearTimeout(retryTimer); if (ws) ws.close(); ws = null; state.connected = false; },
    call: (method, path, body) => window.api.communityCall(method, path, body),
    notices: () => window.Community.call('GET', '/notices'),
    rooms: () => window.Community.call('GET', '/rooms'),
    messages: (roomId, before) => window.Community.call('GET', `/rooms/${roomId}/messages?limit=50${before ? '&before=' + before : ''}`),
    send: (roomId, body, image) => window.Community.call('POST', `/rooms/${roomId}/messages`, { body, image }),
    members: () => window.Community.call('GET', '/profiles'),
    async uploadImage(file) {
      const img = await prepareImage(file);
      const r = await window.api.communityUpload(img.bytes);
      if (!r?.ok) throw new Error(r?.error || '사진 올리기 실패');
      return { sha: r.sha, width: img.width, height: img.height };
    },
    image: sha => window.api.communityMedia(sha),   // → { ok, dataUrl }
  };
})();
