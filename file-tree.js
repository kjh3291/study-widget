// '내 자료' 폴더 보기 계산(화면과 분리, node 테스트: scripts/test-file-tree.js)
// 과목 › 보조자료·수업자료·과제 › 파일. 어디에 있는 자료인지(source)에 따라 할 수 있는 일이 다르다.
//   보조자료  source 'server' — 서버에 있는 내 파일(기기에도 받아 둠). 학기 정리 예정일·정리됨 표시
//   수업자료  앱:  source 'local' — 이 기기에 받은 파일(열기·폴더에서 보기)
//             웹:  source 'lms'   — 서버에 없으니 LMS 원본 링크로 바로 받기
//   과제      앱:  'local' / 웹: 'lms'(내 제출물 링크)
(function (root) {
  const CAT_ORDER = ['보조자료', '수업자료', '과제'];
  const DAY = 86400000;
  const baseName = p => String(p || '').split(/[\\/]/).pop();

  // 서버 파일 목록(file-sync의 remote) → 항목. 삭제(휴지통)는 빼고, 학기 정리된 것은 '이 기기에만'으로 남긴다
  function serverEntries(remote) {
    return Object.entries(remote || {}).filter(([p, f]) => f && !f.deleted && p.split('/')[1] === '보조자료').map(([p, f]) => ({
      path: p, name: baseName(p), course: p.split('/')[0], cat: '보조자료', source: 'server',
      size: f.size || 0, updatedAt: f.updatedAt || 0, expiresAt: f.expiresAt || 0, expired: !!f.expired, term: f.term || '',
    }));
  }

  // 수업자료·과제: 앱은 이 기기에 받은 기록(materialsDone/assignDone), 웹은 LMS 목록(링크)
  function lmsEntries(mode, { lms, materialsDone, assignDone, cleanCourse = s => s } = {}) {
    const out = [];
    if (mode === 'web') {
      const add = (list, cat) => (list || []).forEach(m => {
        if (!m || !m.url) return;
        const course = cleanCourse(m.courseName) || '기타';
        out.push({ path: `${course}/${cat}/${m.title || '자료'}`, name: m.title || '자료', course, cat, source: 'lms', url: m.url });
      });
      add(lms && lms.materials, '수업자료');
      add(lms && lms.assignFiles, '과제');
      return out;
    }
    const add = (done, cat) => Object.entries(done || {}).forEach(([url, r]) => {
      if (!r || !r.path || r.missing) return;
      const course = r.course || '기타', name = baseName(r.path);
      out.push({ path: `${course}/${cat}/${name}`, name, course, cat, source: 'local', localPath: r.path, url, updatedAt: r.at || 0 });
    });
    add(materialsDone, '수업자료');
    add(assignDone, '과제');
    // 같은 파일을 여러 LMS 항목이 같이 쓰면(중복 저장 방지) 한 번만 보인다
    const seen = new Set();
    return out.filter(e => { const k = e.localPath.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  }

  // 정리 예정 칩: 정리됨 / D-n(30일 이내) / null
  function expiryChip(e, now) {
    if (e.source !== 'server') return null;
    if (e.expired) return { label: '이 기기에만', tone: 'past', title: '학기 정리로 서버에서 지웠어요. 이 기기 파일은 남아 있어요.' };
    if (!e.expiresAt) return null;
    const days = Math.ceil((e.expiresAt - now) / DAY);
    if (days > 30) return null;
    const d = new Date(e.expiresAt - 1);   // 정리 직전 날(보관 마지막 날)
    return { label: days <= 0 ? '곧 정리' : `D-${days} 정리`, tone: days <= 7 ? 'urgent' : 'soon', title: `${d.getMonth() + 1}/${d.getDate()}까지 서버에 보관, 그 뒤 서버에서만 지워져요` };
  }

  // 항목들 → 트리. folder = { name, path, folders: [], files: [], count, size }
  function buildTree(entries) {
    const rootNode = { name: '', path: '', folders: [], files: [], count: 0, size: 0 };
    const get = (node, name) => {
      let f = node.folders.find(x => x.name === name);
      if (!f) { f = { name, path: node.path ? node.path + '/' + name : name, folders: [], files: [], count: 0, size: 0 }; node.folders.push(f); }
      return f;
    };
    for (const e of entries) {
      const parts = e.path.split('/');
      let node = rootNode;
      const chain = [rootNode];
      for (const part of parts.slice(0, -1)) { node = get(node, part); chain.push(node); }
      node.files.push(e);
      chain.forEach(n => { n.count++; n.size += e.size || 0; });
    }
    const sortNode = (n, depth) => {
      n.folders.sort((a, b) => depth === 1
        ? (CAT_ORDER.indexOf(a.name) + 1 || 9) - (CAT_ORDER.indexOf(b.name) + 1 || 9)   // 과목 안: 보조자료·수업자료·과제 순
        : a.name.localeCompare(b.name, 'ko'));
      n.files.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
      n.folders.forEach(f => sortNode(f, depth + 1));
    };
    sortNode(rootNode, 0);
    return rootNode;
  }
  // 'A/B' 경로의 폴더(없으면 null)
  function findFolder(tree, p) {
    if (!p) return tree;
    let node = tree;
    for (const part of p.split('/')) { node = node.folders.find(f => f.name === part); if (!node) return null; }
    return node;
  }
  // 폴더 안에서 가장 빠른 정리 예정(정리 안 된 서버 파일 기준)
  function nextExpiry(folder) {
    let best = 0;
    const walk = n => { n.files.forEach(f => { if (f.source === 'server' && !f.expired && f.expiresAt && (!best || f.expiresAt < best)) best = f.expiresAt; }); n.folders.forEach(walk); };
    walk(folder);
    return best;
  }

  // 학기 정리 알림: 서버 보조자료(remote) → 띄울 알림 목록 [{ id, title, body }]
  //   정리 30일 전·7일 전·하루 전에 한 번씩, 정리된 뒤에 한 번. id로 같은 알림을 다시 띄우지 않는다
  function termNotices(remote, now) {
    const files = serverEntries(remote);
    const out = [];
    const md = (ms) => { const d = new Date(ms - 1); return `${d.getMonth() + 1}/${d.getDate()}`; };   // 보관 마지막 날
    const soon = files.filter(f => !f.expired && f.expiresAt && f.expiresAt > now && f.expiresAt - now <= 30 * DAY);
    if (soon.length) {
      const at = Math.min(...soon.map(f => f.expiresAt));
      const group = soon.filter(f => f.expiresAt === at), days = Math.ceil((at - now) / DAY);
      const stage = days <= 1 ? 'd1' : days <= 7 ? 'd7' : 'd30';
      const term = group[0].term ? group[0].term + ' ' : '';
      out.push({ id: `term-${at}-${stage}`, title: days <= 1 ? '내일 서버에서 보조자료를 정리해요' : `보조자료 서버 정리 ${days}일 전`,
        body: `${term}보조자료 ${group.length}개는 ${md(at)}까지 서버에 보관되고 그 뒤 서버에서 지워져요. 이 기기 파일은 그대로 남아요.` });
    }
    const gone = files.filter(f => f.expired);
    if (gone.length) {
      const at = Math.max(...gone.map(f => f.expiresAt || 0));
      out.push({ id: `term-done-${at}`, title: '학기 보조자료를 서버에서 정리했어요',
        body: `보조자료 ${gone.length}개를 서버에서 지웠어요. 이 기기에는 그대로 남아 있어요(다른 기기와는 더 이상 공유되지 않아요).` });
    }
    return out;
  }

  // 날짜 → 학기 이름(3~8월 1학기, 9~12월 2학기, 1~2월은 전년도 2학기) — 서버가 학기를 알려 주지 않는 이 기기 파일용
  function semesterOf(ms) {
    if (!ms) return '';
    const d = new Date(ms), y = d.getFullYear(), m = d.getMonth() + 1;
    return m >= 3 && m <= 8 ? `${y}년 1학기` : m >= 9 ? `${y}년 2학기` : `${y - 1}년 2학기`;
  }
  // GPT 디자인 컴포넌트(my-files.js, SdMyFiles.mount)가 받는 데이터로 바꾼다.
  //   entries: serverEntries + lmsEntries, local: { [항목 id]: { size, mtime } | null }(이 기기에 있는지·크기), usage: 서버 사용량
  const CAT_LABEL = { 보조자료: '보조자료', 수업자료: '수업자료', 과제: '과제(내 제출물)' };
  const fileId = e => e.source === 'server' ? 'srv:' + e.path : e.source === 'local' ? 'loc:' + e.localPath : 'lms:' + e.url;
  function toDesignData(entries, { local = {}, usage = null, now = Date.now() } = {}) {
    const pad = n => String(n).padStart(2, '0');
    const ymd = ms => { if (!ms) return ''; const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
    const courses = [...new Set(entries.map(e => e.course))].sort((a, b) => a.localeCompare(b, 'ko')).map(name => ({ id: name, name }));
    const files = entries.map(e => {
      const id = fileId(e), L = local[id];
      const sub = e.source === 'server' ? e.path.split('/').slice(2).join('/') : e.name;   // 보조자료 안 하위 폴더는 '1단원/풀이.txt'처럼
      const ext = (e.name.match(/\.([a-z0-9]{1,5})$/i) || [])[1];
      const modified = e.source === 'server' ? e.updatedAt : (L && L.mtime) || e.updatedAt;
      return {
        id, course: e.course, category: CAT_LABEL[e.cat] || e.cat, name: sub, type: ext ? ext.toUpperCase() : 'FILE',
        bytes: e.size || (L && L.size) || 0,
        semester: e.term || semesterOf(modified), modified: ymd(modified) || '-',
        local: e.source === 'lms' ? false : L === undefined ? true : !!L,   // 확인 안 한 것(undefined)은 받아 둔 것으로, null은 이 기기에 없음
        server: e.source === 'server' && !e.expired,
        lms: e.source !== 'server', url: e.url || '',
        cleanupDays: e.source === 'server' && !e.expired && e.expiresAt ? Math.max(0, Math.ceil((e.expiresAt - now) / DAY)) : null,
        rel: e.source === 'server' ? e.path : '', abs: e.localPath || '',
      };
    });
    return { usage: usage ? usage.used : 0, quota: usage ? usage.limit : 0, courses, files };
  }

  const api = { toDesignData, semesterOf, fileId, termNotices, serverEntries, lmsEntries, expiryChip, buildTree, findFolder, nextExpiry, CAT_ORDER };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FileTree = api;
})(typeof window !== 'undefined' ? window : globalThis);
