/* GPT 디자인(내 자료, 2026-11) 원본. 앱 연결은 renderer.js의 openMyFilesPanel, 토큰 연결·앱용 조정은 styles/sd-my-files.css 끝.
   원본에서 바꾼 것: 폴더 아이콘 글자(▱)를 앱 아이콘(sd-ico folder)으로 */
/* Integration: pass data and callbacks to SdMyFiles.mount(). All sizes are bytes.
   onAction({ action, file, version? }), onBack(), onTab(tab), onRetry().
   Supply server-returned cleanupDays; null means no scheduled cleanup. */
(() => {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const size = bytes => bytes >= 1073741824 ? `${+(bytes / 1073741824).toFixed(1)}GB` : bytes >= 1048576 ? `${+(bytes / 1048576).toFixed(1)}MB` : `${Math.ceil(bytes / 1024)}KB`;
  const categories = ['보조자료', '수업자료', '과제(내 제출물)'];
  let instanceCount = 0;
  function mount(host, options = {}) {
    const id = `sd-files-${++instanceCount}`;
    const state = { platform: 'app', status: 'normal', theme: 'auto', course: null, category: null, ...options.initialState };
    let data = options.data || sampleData;
    function visibleFiles() {
      return data.files.filter(file => {
        if (state.platform === 'app') return state.status === 'offline' ? file.local : file.local || file.server;
        if (file.category === '보조자료') return state.status !== 'offline' && file.server;
        return Boolean(file.lms);
      });
    }
    function chip(days) {
      if (days == null || days > 30) return '';
      return `<span class="sd-chip ${days <= 7 ? 'red' : 'orange'}">D-${Math.max(0, days)} 정리</span>`;
    }
    function folder(label, action, key, files) {
      const scheduled = files.filter(f => f.server && f.cleanupDays != null).map(f => f.cleanupDays);
      return `<button type="button" class="sd-menu-row" data-action="${action}" data-key="${escape(key)}"><span class="sd-ico" data-icon="folder" aria-hidden="true"></span><span class="sd-folder-info"><strong>${escape(label)}</strong><small>${files.length}개 · ${size(files.reduce((sum, f) => sum + f.bytes, 0))}</small></span><span class="sd-folder-end">${chip(scheduled.length ? Math.min(...scheduled) : null)}<span aria-hidden="true">›</span></span></button>`;
    }
    function fileRow(file) {
      const web = state.platform === 'web';
      const supplemental = file.category === '보조자료';
      const place = web ? (supplemental ? '서버' : 'LMS') : state.status === 'offline' ? '이 기기' : [file.server && '서버', file.local && '이 기기'].filter(Boolean).join(' · ');
      const cleaned = supplemental && file.local && !file.server;
      const action = (name, label) => `<button type="button" data-action="${name}" data-file="${escape(file.id)}" aria-label="${escape(file.name)}: ${label}">${label}</button>`;
      return `<li class="sd-file-row"><div class="sd-file-title"><span class="sd-file-type" aria-hidden="true">${escape(file.type)}</span><span class="sd-filename" title="${escape(file.name)}">${escape(file.name)}</span></div><div class="sd-status"><span>${place}</span>${cleaned ? '<span class="sd-chip">이 기기에만</span>' : supplemental && state.status !== 'offline' ? chip(file.cleanupDays) : ''}</div><div class="sd-meta">${size(file.bytes)} · ${escape(file.semester)}<br>수정 <time datetime="${escape(file.modified)}">${escape(file.modified.replaceAll('-', '.'))}</time></div><div class="sd-actions">${web ? action(supplemental ? 'download' : 'download-lms', supplemental ? '받기' : 'LMS 원본 받기 ↗') : file.local ? action('open', '열기') + action('reveal', '폴더에서 보기') : action('download', '이 기기에 받기')}${!web && supplemental && file.server && state.status !== 'offline' && file.versions?.length ? `<details><summary>이전 버전</summary>${file.versions.map(version => `<button type="button" data-action="version" data-file="${escape(file.id)}" data-version="${escape(version.id)}">${escape(version.date)} · ${size(version.bytes)}</button>`).join('')}</details>` : ''}</div></li>`;
    }
    function render(focusKey) {
      const web = state.platform === 'web';
      const course = data.courses.find(c => c.id === state.course);
      const files = visibleFiles().filter(f => !state.course || f.course === state.course);
      const current = files.filter(f => !state.category || f.category === state.category);
      let content;
      if (state.status === 'loading') {
        content = '<p role="status" class="sd-meta">자료를 불러오는 중…</p><div class="sd-skeleton" aria-hidden="true"></div><div class="sd-skeleton" aria-hidden="true"></div>';
      } else if (web && state.status === 'offline' && state.category === '보조자료') {
        content = '<div class="sd-empty"><strong>서버 자료를 표시할 수 없어요</strong><span>연결 후 다시 시도해 주세요.</span></div>';
      } else if (state.status === 'empty' || (state.category && current.length === 0)) {
        content = '<div class="sd-empty"><span class="sd-ico" data-icon="folder-open" aria-hidden="true"></span><strong>아직 자료가 없어요</strong><span>이 폴더에 저장된 파일이 없어요.</span></div>';
      } else if (!state.course) {
        content = data.courses.map(c => folder(c.name, 'course', c.id, files.filter(f => f.course === c.id))).join('');
      } else if (!state.category) {
        content = categories.map(c => folder(c, 'category', c, files.filter(f => f.category === c))).join('');
      } else {
        content = `<ul class="sd-file-list">${current.map(fileRow).join('')}</ul>`;
      }
      host.innerHTML = `<section id="${id}" class="sd-window" data-theme="${state.theme}" aria-label="${web ? '웹' : '앱'} 내 자료"><header class="sd-header"><button type="button" class="sd-back" data-action="back">‹ 설정</button><h2>내 자료</h2></header><div class="sd-sheet"><div class="sd-usage-label"><span>보조자료 ${size(data.usage)} / ${size(data.quota)}</span><small>${state.status === 'offline' ? '마지막 확인값' : '서버 사용량'}</small></div><div class="sd-progress" role="progressbar" aria-label="보조자료 서버 사용량" aria-valuemin="0" aria-valuemax="${data.quota}" aria-valuenow="${data.usage}" aria-valuetext="${size(data.usage)} / ${size(data.quota)}"><span style="width:${Math.min(100, Math.max(0, data.usage / data.quota * 100))}%"></span></div><p class="sd-note">학기가 끝나고 30일 뒤 서버에서 정리돼요. 기기 파일은 남아요.</p><nav class="sd-breadcrumb" aria-label="자료 경로"><button type="button" data-action="root" ${!course ? 'aria-current="page"' : ''}>내 자료</button>${course ? `<span aria-hidden="true">›</span><button type="button" data-action="up-course" ${!state.category ? 'aria-current="page"' : ''}>${escape(course.name)}</button>` : ''}${state.category ? `<span aria-hidden="true">›</span><span aria-current="page">${escape(state.category)}</span>` : ''}</nav>${state.status === 'offline' ? `<div class="sd-banner" role="status"><strong>서버에 연결할 수 없어요</strong>${web ? '보조자료는 연결 후 받을 수 있어요. LMS 원본은 LMS 연결이 필요해요.' : '이 기기에 저장된 자료만 보여요.'}<br><button type="button" class="sd-retry" data-action="retry">다시 시도</button></div>` : ''}<div class="sd-list-heading"><span>${escape(state.category || (course ? '분류' : '과목'))}</span><span>${state.category && state.status === 'normal' ? `${current.length}개` : ''}</span></div><div aria-busy="${state.status === 'loading'}">${content}</div><p class="sd-feedback" role="status" aria-live="polite"></p></div><nav class="sd-tabs" aria-label="하단 탭">${['시간표', '오늘', '학습', '동아리'].map(tab => `<button type="button" data-action="tab" data-key="${tab}">${tab}</button>`).join('')}</nav></section>`;
      if (focusKey) host.querySelector(`[data-action="${focusKey}"]`)?.focus();
    }
    function report(message) { host.querySelector('.sd-feedback').textContent = message; }
    async function click(event) {
      const button = event.target.closest('button[data-action]');
      if (!button || !host.contains(button)) return;
      const action = button.dataset.action;
      if (action === 'root') { state.course = null; state.category = null; render('root'); }
      else if (action === 'course') { state.course = button.dataset.key; state.category = null; render('up-course'); }
      else if (action === 'category') { state.category = button.dataset.key; render('up-course'); }
      else if (action === 'up-course') { state.category = null; render('up-course'); }
      else if (action === 'retry') {
        if (!options.onRetry) return report('미리보기: 실제 연결 상태는 바꾸지 않았어요.');
        button.disabled = true;
        try { const fresh = await options.onRetry(); if (fresh) data = fresh; state.status = 'normal'; render('root'); }
        catch { report('연결하지 못했어요. 잠시 후 다시 시도해 주세요.'); button.disabled = false; }
      } else {
        try {
          if (action === 'back') { if (options.onBack) await options.onBack(); else report('미리보기: 설정으로 돌아가기'); }
          else if (action === 'tab') { if (options.onTab) await options.onTab(button.dataset.key); else report(`미리보기: ${button.dataset.key} 탭`); }
          else {
            const file = data.files.find(f => f.id === button.dataset.file);
            if (options.onAction) await options.onAction({ action, file, version: file.versions?.find(v => v.id === button.dataset.version) });
            else report(`미리보기: ${button.textContent} — 실제 파일 작업은 실행하지 않았어요.`);
          }
        } catch { report('작업을 완료하지 못했어요. 다시 시도해 주세요.'); }
      }
    }
    function keydown(event) {
      if (event.key !== 'Backspace' || event.altKey || event.ctrlKey || event.metaKey || event.target.closest('input,textarea,select,[contenteditable="true"]')) return;
      event.preventDefault();
      if (state.category) { state.category = null; render('up-course'); }
      else if (state.course) { state.course = null; render('root'); }
    }
    host.addEventListener('click', click);
    host.addEventListener('keydown', keydown);
    render();
    return { update(next = {}) { Object.assign(state, next); render(); }, setData(next) { data = next; render(); }, destroy() { host.removeEventListener('click', click); host.removeEventListener('keydown', keydown); host.replaceChildren(); } };
  }
  const MB = 1048576;
  const sampleData = {
    usage: 145 * MB, quota: 2048 * MB,
    courses: [{ id: 'ds', name: '자료구조' }, { id: 'os', name: '운영체제' }],
    files: [
      { id: 'note', course: 'ds', category: '보조자료', name: '핵심 정리와 연습문제_최종수정본.pdf', type: 'PDF', bytes: 4.2 * MB, semester: '2026년 2학기', modified: '2026-11-03', local: true, server: true, cleanupDays: 12, versions: [{ id: 'v1', date: '2026.11.01', bytes: 4 * MB }] },
      { id: 'tree', course: 'ds', category: '보조자료', name: '트리와 그래프_실습.zip', type: 'ZIP', bytes: 8.6 * MB, semester: '2026년 2학기', modified: '2026-11-01', local: true, server: true, cleanupDays: 5 },
      { id: 'old', course: 'ds', category: '보조자료', name: '중간고사_복습노트.pdf', type: 'PDF', bytes: 1.8 * MB, semester: '2026년 1학기', modified: '2026-06-19', local: true, server: false, cleanupDays: null },
      { id: 'lecture', course: 'ds', category: '수업자료', name: '09주차_그래프_강의자료.pdf', type: 'PDF', bytes: 2.4 * MB, semester: '2026년 2학기', modified: '2026-11-02', local: true, server: false, lms: true },
      { id: 'assignment', course: 'ds', category: '과제(내 제출물)', name: '자료구조_과제03_내제출물.zip', type: 'ZIP', bytes: 0.8 * MB, semester: '2026년 2학기', modified: '2026-11-03', local: true, server: false, lms: true }
    ]
  };
  window.SdMyFiles = { mount, sampleData };
  const demo = document.getElementById('sd-demo');
  if (demo) {
    const instances = ['app', 'web'].map(platform => mount(document.getElementById(`sd-${platform}`), { initialState: { platform, course: 'ds', category: '보조자료' } }));
    demo.addEventListener('change', event => {
      if (event.target.id === 'sd-state') instances.forEach(instance => instance.update({ status: event.target.value }));
      if (event.target.id === 'sd-theme') instances.forEach(instance => instance.update({ theme: event.target.value }));
    });
  }
})();
