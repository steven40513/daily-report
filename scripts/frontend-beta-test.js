const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'beta', 'index.html'), 'utf8');

const results = [];

function assert(name, condition, detail = '') {
  results.push({ name, ok: Boolean(condition), detail });
  if (!condition) {
    throw new Error(`${name}${detail ? `: ${detail}` : ''}`);
  }
}

async function main() {
  const dom = new JSDOM(html, {
    url: 'https://example.test/daily-report/beta/index.html',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.alertMessages = [];
      window.alert = (msg) => window.alertMessages.push(String(msg));
      window.confirm = () => true;
      window.scrollTo = () => {};
    }
  });

  const { window } = dom;
  const { document } = window;

  await new Promise((resolve) => {
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      resolve();
    } else {
      document.addEventListener('DOMContentLoaded', resolve, { once: true });
    }
  });

  window.goTo('screen-step2');
  assert('crew categories rendered', document.querySelectorAll('#crew-cats .cat-btn').length === 5);
  assert('default category is structure', window.currentCrewCat === 'structure');
  assert('subtype rows rendered for structure', document.querySelectorAll('#crew-list-area .crew-subtype-row').length === 4);

  window.addCrewEntry('structure','板模工');
  assert('entry created in store', window.loadCrewEntries().filter(e => e.subtype === '板模工').length === 1);

  const entry = window.loadCrewEntries().find(e => e.subtype === '板模工');
  window.updateCrewEntry(entry.id, 'headcount', 12);
  window.updateCrewEntry(entry.id, 'location', 'B2F A1-A5軸');
  window.updateCrewEntry(entry.id, 'workToday', '柱模組立完成');
  window.updateCrewEntry(entry.id, 'contractor', '大成工程行');

  window.switchCrewCat('structure');
  window.updateCrewTotal();
  assert('total headcount reflects entry', document.getElementById('crew-total-count').textContent === '12');

  window.goToStep3IfValid();
  assert('valid entry allows moving to step3', document.querySelector('.screen.active')?.id === 'screen-step3');

  window.addCrewEntry('structure','鋼筋工');
  window.goTo('screen-step2');
  window.goToStep3IfValid();
  assert('incomplete entry blocks navigation', document.querySelector('.screen.active')?.id === 'screen-step2');
  assert('validation alert shown', window.alertMessages.some(m => m.includes('必填欄位')));

  const data = window.collectReportData();
  assert('collectReportData derives legacy data.crew', Array.isArray(data.crew) && data.crew.some(c => c.name === '結構工程'));

  const cloudLogs = window.mapSupabaseWorkLogsToLocalLogs(window.currentReportDate, [{
    id: 'cloud-work-log-1',
    title: '板模工',
    contractor_unit: '大成工程行',
    period_am: true,
    period_pm: false,
    hours: 0,
    total_hours: 0,
    location: 'B2F A1-A5軸',
    work_today: '柱模組立完成',
    work_tomorrow: '',
    has_subcontractor: false,
    subcontractor_name: '',
    crew_category: 'structure',
    crew_subtype: '板模工',
    headcount: 12,
    updated_at: '2026-07-02T08:00:00Z'
  }]);
  window.replaceLocalCrewEntriesForDate(window.currentReportDate, cloudLogs);
  const restoredEntry = window.loadCrewEntries().find(e => e.id === 'cloud-work-log-1');
  assert('cloud work log restores crew entry category', restoredEntry && restoredEntry.category === 'structure');
  assert('cloud work log restores crew entry headcount', restoredEntry && restoredEntry.headcount === 12);

  const subtypeCountBefore = window.getCrewSubtypes('structure').length;
  const added = window.addCrewSubtype('structure', '測試工別');
  assert('custom crew subtype can be added', added === true);
  assert('custom crew subtype persists in settings', window.getCrewSubtypes('structure').length === subtypeCountBefore + 1);

  const settingsBefore = window.loadSettings();
  const prevDraft = window.transformPreviousReport(
    { materials: { concrete: [{ name: '測試材料', unit: '包', checked: true, qty: '5' }] } },
    settingsBefore
  );
  assert('copy-yesterday does not auto-check materials', prevDraft.materials.concrete[0].checked === false);

  window.goTo('screen-step3');
  const vendorInput = document.querySelector('.mat-group[data-cat="concrete"] .item-vendor');
  assert('material vendor input rendered', !!vendorInput);
  if (vendorInput) vendorInput.value = '大成預拌';
  const dataWithVendor = window.collectReportData();
  assert('material vendor captured in collectReportData', dataWithVendor.materials.concrete[0].vendor === '大成預拌');

  window.goTo('screen-preview');
  const pdfPage1 = document.getElementById('pdf-page-1').innerHTML;
  assert('PDF page 1 includes crew entry detail', pdfPage1.includes('板模工') && pdfPage1.includes('B2F A1-A5軸'));
  assert('PDF has no dead page 2', !document.getElementById('pdf-page-2'));

  // 注意：測試用的日期必須晚於 DEFAULT_SETTINGS.startDate（2026-06-01），
  // 早於「今天」，否則 findReportDayStatus 會判成 before-start，不會進到停工/缺件邏輯。
  const stoppageOk = window.markStoppage('2026-06-15', '颱風停工');
  assert('stoppage can be marked with reason', stoppageOk === true);
  assert('stoppage marked day is not missing', window.findReportDayStatus('2026-06-15') === 'stoppage');
  window.unmarkStoppage('2026-06-15');
  assert('unmarking stoppage restores missing status', window.findReportDayStatus('2026-06-15') === 'missing');

  const beforeBackfillToday = window.currentReportDate;
  window.startBackfillForDate('2026-06-16');
  assert('backfill switches currentReportDate', window.currentReportDate === '2026-06-16');
  window.goTo('screen-preview');
  assert('complete-backfill button shown in backfill mode', document.getElementById('btn-complete-backfill').style.display === 'block');
  window.completeBackfill();
  assert('currentReportDate restored after backfill', window.currentReportDate === beforeBackfillToday);
  const backfilledReport = window.loadReport('2026-06-16');
  assert('report saved with backfilled flag', backfilledReport && backfilledReport.backfilled === true);

  // 補填同步時序回歸測試：
  // 補填期間排程的自動同步（3 秒防抖）若在退出補填後才觸發，
  // 不可把補填日的資料誤同步成「今天」的日報。
  // 修法：scheduleCloudSync 鎖定排程當下日期；退出補填時取消排程並立即同步補填日。
  const realIsCloudReady = window.isCloudReady;
  const realDoCloudSync = window.doCloudSync;
  window.isCloudReady = () => true;
  const syncedDates = [];
  window.doCloudSync = (d) => { syncedDates.push(d); };
  const todayReportBefore = JSON.stringify(Object.assign({}, window.loadReport(beforeBackfillToday), { savedAt: null }));
  window.startBackfillForDate('2026-06-17');
  window.scheduleCloudSync(); // 模擬補填過程中 autoSave 排程的自動同步
  assert('cloud sync timer scheduled during backfill', window.cloudState.syncTimer !== null);
  window.completeBackfill();
  assert('pending sync timer cancelled on backfill exit', window.cloudState.syncTimer === null);
  assert('backfill date synced immediately on exit', syncedDates.length === 1 && syncedDates[0] === '2026-06-17');
  assert('currentReportDate restored after backfill sync', window.currentReportDate === beforeBackfillToday);
  const todayReportAfter = JSON.stringify(Object.assign({}, window.loadReport(beforeBackfillToday), { savedAt: null }));
  assert('today report not polluted by backfill data', todayReportBefore === todayReportAfter);
  window.isCloudReady = realIsCloudReady;
  window.doCloudSync = realDoCloudSync;

  window.goTo('screen-report-calendar');
  assert('calendar grid renders cells', document.querySelectorAll('#calendar-grid > div').length > 25);

  console.log(`frontend-beta-test: ${results.length}/${results.length} checks passed`);
}

main().catch((err) => {
  console.error('frontend-beta-test failed:', err.message);
  console.error(`${results.filter(r => r.ok).length}/${results.length} checks passed before failure`);
  process.exit(1);
});
