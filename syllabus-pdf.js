const fs = require('node:fs/promises');
const path = require('node:path');
const { parseSyllabus } = require('./syllabus');
async function readSyllabus(filePath) {
  if (path.extname(filePath).toLowerCase() !== '.pdf') throw new Error('PDF 파일을 선택해 주세요.');
  if ((await fs.stat(filePath)).size > 20 * 1024 * 1024) throw new Error('20MB 이하의 PDF를 선택해 주세요.');
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({
    data: new Uint8Array(await fs.readFile(filePath)), isEvalSupported: false, useSystemFonts: true,
    cMapUrl: path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'cmaps') + path.sep,
    cMapPacked: true,
  });
  const timer = setTimeout(() => task.destroy(), 30000);
  try {
    const doc = await task.promise;
    const content = await (await doc.getPage(1)).getTextContent();
    // Restore visual row order instead of the PDF's internal object order.
    const lines = [];
    for (const item of content.items.filter(x => x.str).sort((a, b) => b.transform[5] - a.transform[5])) {
      let line = lines.find(x => Math.abs(x.y - item.transform[5]) < 3);
      if (!line) { line = { y: item.transform[5], items: [] }; lines.push(line); }
      line.items.push(item);
    }
    const text = lines.map(line => line.items.sort((a, b) => a.transform[4] - b.transform[4]).map(x => x.str).join(' ')).join('\n');
    return { filename: path.basename(filePath), ...parseSyllabus(text) };
  } finally { clearTimeout(timer); await task.destroy(); }
}
module.exports = { readSyllabus };
