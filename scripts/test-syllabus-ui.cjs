// Run with: npx electron scripts/test-syllabus-ui.cjs
// Isolated, in-memory config: never opens the real app's data or GitHub repository.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'study-syllabus-ui-'));
app.setPath('userData', temp);
const preload = path.join(temp, 'preload.cjs');
fs.writeFileSync(preload, `window.testWrites=[]; window.api=new Proxy({}, {get:(_,key)=>{
  if(key==='loadConfig') return async()=>({lmsAuto:false,autoDownload:false,timetableFull:[{name:'Keep',professor:'',times:[]}]});
  if(key==='saveConfig') return async data=>{window.testWrites.push(data);return data;};
  return async()=>({enabled:false,ok:true});
}});`);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { preload, contextIsolation: false, sandbox: false } });
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) console.error(message); });
  try {
    await win.loadFile(path.join(__dirname, '..', 'index.html'));
    const result = await win.webContents.executeJavaScript(`(async()=>{
      const check=(condition,message)=>{if(!condition)throw new Error(message)};
      await new Promise(r=>setTimeout(r,100));
      const result={filename:'test.pdf',warning:'Test',draft:{name:'Test',professor:'Teacher',times:[{day:'2',start:'10:00',end:'13:00',place:'N23-507'}]}};
      $('btn-manual-timetable').click();check(!!$('syllabus-preview')&&$('sy-name').value==='','Manual entry unavailable');$('sy-cancel').click();
      const before=JSON.stringify(state.timetableFull);window.testWrites=[];
      previewSyllabus(result);$('sy-cancel').click();
      check(JSON.stringify(state.timetableFull)===before&&window.testWrites.length===0,'Cancel wrote data');
      previewSyllabus(result);$('sy-name').value='';$('sy-apply').click();
      check(!!$('syllabus-preview')&&window.testWrites.length===0,'Invalid draft saved');
      $('sy-name').value='Test';$('sy-apply').click();
      check(!$('syllabus-preview')&&state.timetableFull.length===2,'Apply failed');
      check(state.timetableFull[0].name==='Keep'&&state.timetableSource==='syllabus','Lost existing course or source');
      check(window.testWrites.some(p=>p.timetableSource==='syllabus'&&p.timetableFull.length===2),'Missing atomic config save');
      previewSyllabus(result);check($('sy-target').value==='1','Matching subject not offered for replacement');
      $('sy-prof').value='Updated';$('sy-apply').click();
      check(state.timetableFull.length===2&&state.timetableFull[1].professor==='Updated','Replacement duplicated course');
      previewSyllabus(result);state.timetableFull=[...state.timetableFull,{name:'Remote',times:[]}];$('sy-apply').click();
      check(!!$('syllabus-preview')&&$('sy-error').textContent.includes('바뀌었습니다'),'Stale preview accepted');$('sy-cancel').click();
      return 'PASS: preview cancel, invalid draft, apply, preserve other courses, replace and concurrent update';
    })()`);
    console.log(result);
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
app.on('will-quit', () => fs.rmSync(temp, { recursive: true, force: true }));
