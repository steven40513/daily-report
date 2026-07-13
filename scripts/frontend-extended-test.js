const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function createDom(seed = {}) {
  const dom = new JSDOM(html, {
    url: 'https://example.test/daily-report/index.html',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.alertMessages = [];
      window.alert = (msg) => window.alertMessages.push(String(msg));
      window.confirm = () => true;
      window.scrollTo = () => {};
      Object.entries(seed).forEach(([key, value]) => {
        window.localStorage.setItem(key, value);
      });
    }
  });
  return dom;
}

function ready(dom) {
  const { document } = dom.window;
  return new Promise((resolve) => {
    if (document.readyState === 'complete' || document.readyState === 'interactive') resolve();
    else document.addEventListener('DOMContentLoaded', resolve, { once: true });
  });
}

function text(el) {
  return (el && el.textContent || '').replace(/\s+/g, ' ').trim();
}

function assert(name, condition, detail = '') {
  if (!condition) throw new Error(`${name}${detail ? `: ${detail}` : ''}`);
  console.log(`ok - ${name}`);
}

async function main() {
  const dom = createDom();
  await ready(dom);
  const { window } = dom;
  const { document } = window;

  // Settings-added crew should propagate into current report UI before trial use.
  window.goTo('screen-settings');
  window.showSettingsCrewAdd();
  document.getElementById('settings-crew-new-name').value = '泥作工程';
  window.confirmSettingsCrewAdd();
  window.goTo('screen-step2');
  const crewNamesAfterSettings = Array.from(document.querySelectorAll('#screen-step2 .crew-label')).map(text);
  assert('settings-added crew appears in step 2 immediately', crewNamesAfterSettings.includes('泥作工程'));

  // Create log, edit it, verify list and PDF update.
  window.goTo('screen-step5');
  window.openLogForm();
  document.getElementById('log-title').value = 'B1F 鋼筋綁紮';
  document.getElementById('log-person').value = '李主任';
  document.getElementById('log-unit').value = '鋼筋班';
  document.getElementById('log-period-am').click();
  document.getElementById('log-hours').value = '6';
  document.getElementById('log-location').value = 'B1F B區';
  document.getElementById('log-work-today').value = '完成樑筋綁紮';
  document.getElementById('log-work-tomorrow').value = '柱筋綁紮';
  window.saveLogRecord();
  const logId = JSON.parse(window.localStorage.getItem('cdr-logs'))[0].id;
  window.viewLogDetail(logId);
  window.editLogRecord();
  document.getElementById('log-hours').value = '7';
  document.getElementById('log-work-today').value = '完成樑筋綁紮與查驗';
  window.saveLogRecord();
  assert('edited log list shows updated hours', text(document.getElementById('log-list-container')).includes('7 hr'));
  window.goTo('screen-preview');
  assert('edited log appears in pdf preview', text(document.getElementById('pdf-pages-container')).includes('完成樑筋綁紮與查驗'));

  // Delete log and verify PDF no longer shows it.
  window.viewLogDetail(logId);
  window.deleteLogRecord();
  assert('deleted log removed from list', !text(document.getElementById('log-list-container')).includes('B1F 鋼筋綁紮'));
  window.goTo('screen-preview');
  assert('deleted log removed from pdf preview', !text(document.getElementById('pdf-pages-container')).includes('B1F 鋼筋綁紮'));
  const yesterdayForDeletedLog = new Date(window.currentReportDate);
  yesterdayForDeletedLog.setDate(yesterdayForDeletedLog.getDate() - 1);
  const yesterdayForDeletedLogStr = `${yesterdayForDeletedLog.getFullYear()}-${String(yesterdayForDeletedLog.getMonth() + 1).padStart(2, '0')}-${String(yesterdayForDeletedLog.getDate()).padStart(2, '0')}`;
  window.localStorage.setItem(`cdr-report-${yesterdayForDeletedLogStr}`, JSON.stringify({ ...window.collectReportData(), date: yesterdayForDeletedLogStr }));
  window.goTo('screen-history');
  window.viewHistoryDetail(yesterdayForDeletedLogStr);
  assert('deleted log removed from history detail', !text(document.getElementById('history-detail-content')).includes('B1F 鋼筋綁紮'));

  // Persist current report and reload a new DOM with same localStorage payload.
  window.goTo('screen-step2');
  const firstCrewPlus = document.querySelector('#screen-step2 .crew-row .crew-btn:last-child');
  window.adjustCrew(firstCrewPlus, 5);
  window.goTo('screen-step5');
  document.querySelector('#screen-step5 textarea').value = '重整保存測試';
  window.goTo('screen-home');
  const snapshot = {};
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    snapshot[key] = window.localStorage.getItem(key);
  }

  const domReloaded = createDom(snapshot);
  await ready(domReloaded);
  const win2 = domReloaded.window;
  const doc2 = win2.document;
  win2.goTo('screen-step5');
  assert('reload restores notes', doc2.querySelector('#screen-step5 textarea').value.includes('重整保存測試'));
  win2.goTo('screen-step2');
  assert('reload restores crew count', text(doc2.querySelector('#screen-step2 .crew-num')) === '5');

  console.log('frontend-extended-test: all assertions passed');
}

main().catch((err) => {
  console.error(`frontend-extended-test failed: ${err.message}`);
  process.exit(1);
});
