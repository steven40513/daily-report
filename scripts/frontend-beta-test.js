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

  // 停工紀錄雲端同步測試
  const realGetClient = window.getSupabaseClient;
  const realCloudPush = window.cloudPushStoppage;
  window.isCloudReady = () => true;
  const pushedStoppages = [];
  window.cloudPushStoppage = (d, r) => { pushedStoppages.push(d); };
  window.markStoppage('2026-06-14', '本機停工'); // cloudPushStoppage 被 stub 收錄
  assert('markStoppage pushes to cloud when ready', pushedStoppages.includes('2026-06-14'));
  window.getSupabaseClient = () => ({
    from: () => ({ select: () => ({ eq: async () => ({ data: [{ stoppage_date: '2026-06-20', reason: '颱風停工' }], error: null }) }) })
  });
  const stoppageSynced = await window.syncStoppagesWithCloud();
  assert('stoppage cloud sync succeeds', stoppageSynced === true);
  assert('cloud stoppage merged into local', window.getStoppage('2026-06-20') !== null);
  assert('local-only stoppage kept and re-pushed', window.getStoppage('2026-06-14') !== null && pushedStoppages.filter(d => d === '2026-06-14').length === 2);
  assert('stoppage day counted in calendar status', window.findReportDayStatus('2026-06-20') === 'stoppage');
  window.getSupabaseClient = realGetClient;
  window.cloudPushStoppage = realCloudPush;
  window.isCloudReady = realIsCloudReady;
  window.unmarkStoppage('2026-06-14');
  window.unmarkStoppage('2026-06-20');
  assert('unmark removes merged stoppages', window.getStoppage('2026-06-20') === null);

  // 補填標記雲端映射測試
  const mapped = window.mapSupabaseReportToLocalData({
    report_date: '2026-06-18',
    weather_am: '晴',
    weather_pm: '陰',
    construction_days: 18,
    notes: '',
    backfilled: true,
    backfilled_at: '2026-07-14T10:00:00Z',
    client_updated_at: '2026-07-14T10:00:00Z'
  }, []);
  assert('cloud report restores backfilled flag', mapped.backfilled === true);
  assert('cloud report restores backfilledAt', mapped.backfilledAt === '2026-07-14T10:00:00Z');

  // 累計彙算測試（現場需求：申報與月結核對要看累積量）
  const cumEntries = window.loadCrewEntries();
  cumEntries.push({ id: 'cum-1', date: '2026-06-21', category: 'structure', subtype: '累計測試工', headcount: 3 });
  cumEntries.push({ id: 'cum-2', date: '2026-06-22', category: 'structure', subtype: '累計測試工', headcount: 4 });
  window.saveCrewEntries(cumEntries);
  const crewCum = window.computeCrewCumulative('2026-06-22');
  assert('crew cumulative sums across days', crewCum.bySubtype['累計測試工'] === 7);
  assert('crew cumulative excludes later dates', window.computeCrewCumulative('2026-06-21').bySubtype['累計測試工'] === 3);
  window.saveReport('2026-06-21', { date: '2026-06-21', materials: { concrete: [{ name: '累計測試材料', unit: '包', checked: true, qty: '5' }] }, equipment: {} });
  window.saveReport('2026-06-22', { date: '2026-06-22', materials: { concrete: [{ name: '累計測試材料', unit: '包', checked: true, qty: '2.5' }] }, equipment: {} });
  const matCumTotals = window.computeItemCumulative('2026-06-22', 'materials');
  assert('material cumulative sums across days', matCumTotals['累計測試材料'] === 7.5);
  assert('unchecked or invalid qty ignored in cumulative', window.computeItemCumulative('2026-06-20', 'materials')['累計測試材料'] === undefined);
  window.goTo('screen-preview');
  const pdfWithCum = document.getElementById('pdf-page-1').innerHTML;
  assert('PDF includes cumulative column', pdfWithCum.includes('累計'));
  assert('PDF crew section shows cumulative total', pdfWithCum.includes('開工累計'));

  window.goTo('screen-report-calendar');
  assert('calendar grid renders cells', document.querySelectorAll('#calendar-grid > div').length > 25);

  // 區間彙總查詢測試（月結核對：總量＋逐日明細）
  const rangeDays = window.collectRangeDataLocal('2026-06-21', '2026-06-22');
  assert('range collects material days', rangeDays['2026-06-21'] && rangeDays['2026-06-21'].materials.length === 1);
  assert('range collects crew entries', rangeDays['2026-06-21'].crew.some(c => c.subtype === '累計測試工'));
  const agg = window.aggregateRange(rangeDays);
  assert('range aggregates material total', agg.sections.materials['累計測試材料'].total === 7.5);
  assert('range keeps daily detail', agg.sections.materials['累計測試材料'].daily.length === 2);
  assert('range aggregates crew total', agg.sections.crew['累計測試工'].total === 7);

  window.goTo('screen-summary-query');
  assert('summary screen becomes active', document.querySelector('.screen.active')?.id === 'screen-summary-query');
  document.getElementById('summary-start').value = '2026-06-21';
  document.getElementById('summary-end').value = '2026-06-22';
  await window.runSummaryQuery();
  const resultsHtml = document.getElementById('summary-results').textContent;
  assert('summary renders material total', resultsHtml.includes('累計測試材料') && resultsHtml.includes('7.5 包'));
  assert('summary renders crew section', resultsHtml.includes('累計測試工'));
  assert('summary note says local only', document.getElementById('summary-source-note').textContent.includes('本機'));

  // 雲端覆蓋邏輯：同一天以雲端為準
  const realCollectCloud = window.collectRangeDataCloud;
  window.collectRangeDataCloud = async () => ({
    '2026-06-22': { materials: [{ name: '累計測試材料', unit: '包', qty: 9, vendor: '雲端廠商' }], equipment: [], crew: [] }
  });
  await window.runSummaryQuery();
  const cloudResults = document.getElementById('summary-results').textContent;
  assert('cloud day overrides local day', cloudResults.includes('14 包')); // 5(本機 06-21) + 9(雲端 06-22)
  assert('summary note mentions cloud', document.getElementById('summary-source-note').textContent.includes('雲端'));
  window.collectRangeDataCloud = realCollectCloud;

  // vendor 欄位雲端同步測試
  const vendorItems = window.mapReportItemsForSupabase('rep-1', {
    crew: [],
    materials: { concrete: [{ name: '測試砂', unit: '米', checked: true, qty: '3', vendor: '砂石行A' }] },
    equipment: { dig: [{ name: '測試怪手', unit: 'hr', checked: true, qty: '8' }] }
  });
  assert('material vendor synced to cloud payload', vendorItems.find(i => i.name === '測試砂').vendor === '砂石行A');
  assert('missing vendor defaults to empty string', vendorItems.find(i => i.name === '測試怪手').vendor === '');
  const vendorMapped = window.mapSupabaseReportToLocalData(
    { report_date: '2026-06-19', construction_days: 19, notes: '' },
    [{ item_type: 'material', category: 'concrete', name: '測試砂', unit: '米', quantity: 3, is_checked: true, vendor: '砂石行A' }]
  );
  assert('cloud vendor restored to local data', vendorMapped.materials.concrete[0].vendor === '砂石行A');

  // 選填欄位（時段/工時/明日內容/代工）測試
  window.addCrewEntry('structure', '鋼筋工');
  const rebarEntry = window.loadCrewEntries().find(e => e.subtype === '鋼筋工' && e.date === window.currentReportDate);
  window.updateCrewEntry(rebarEntry.id, 'headcount', 5);
  window.updateCrewEntry(rebarEntry.id, 'location', '3F');
  window.updateCrewEntry(rebarEntry.id, 'workToday', '版筋綁紮');
  window.updateCrewEntry(rebarEntry.id, 'contractor', '鋼筋行B');
  window.updateCrewEntry(rebarEntry.id, 'am', false);
  window.updateCrewEntry(rebarEntry.id, 'pm', false);
  window.alertMessages.length = 0;
  window.goTo('screen-step2');
  window.goToStep3IfValid();
  assert('period rule blocks navigation', window.alertMessages.some(m => m.includes('時段')));
  window.updateCrewEntry(rebarEntry.id, 'am', true);
  window.updateCrewEntry(rebarEntry.id, 'pm', true);
  window.updateCrewEntry(rebarEntry.id, 'isSubcontractor', true);
  window.goToStep3IfValid();
  assert('subcontractor name required before navigation', window.alertMessages.some(m => m.includes('代工廠商名稱')));
  window.updateCrewEntry(rebarEntry.id, 'subcontractorName', '外包工程行C');
  window.goToStep3IfValid();
  assert('valid optional fields allow navigation', document.querySelector('.screen.active')?.id === 'screen-step3');
  window.updateCrewEntry(rebarEntry.id, 'hours', 4.5);
  window.updateCrewEntry(rebarEntry.id, 'workTomorrow', '續作版筋');
  window.goTo('screen-step2');
  const step2Text = document.getElementById('crew-list-area').textContent;
  assert('optional fields toggle rendered', step2Text.includes('選填欄位'));
  assert('subcontractor input auto-expanded when marked', step2Text.includes('此工項為代工'));
  window.goTo('screen-preview');
  const pdfSub = document.getElementById('pdf-page-1').innerHTML;
  assert('PDF marks subcontractor in red', pdfSub.includes('外包工程行C') && pdfSub.includes('（代工）'));
  assert('PDF crew table has tomorrow column', pdfSub.includes('明日工作內容'));

  // 現場照片測試
  const tinyJpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
  let photoAdds = 0;
  for (let i = 0; i < 6; i++) if (window.addPhotoRecord(window.currentReportDate, tinyJpeg)) photoAdds++;
  assert('six photos accepted', photoAdds === 6);
  assert('seventh photo rejected by daily limit', window.addPhotoRecord(window.currentReportDate, tinyJpeg) === false);
  window.goTo('screen-step5');
  assert('photo grid renders six cells', document.getElementById('photo-grid').children.length === 6);
  assert('photo count label shows 6/6', document.getElementById('photo-count-label').textContent.includes('6/6'));
  const firstPhoto = window.getPhotosForDate(window.currentReportDate)[0];
  window.removePhoto(firstPhoto.id);
  assert('photo removed from store and grid', window.getPhotosForDate(window.currentReportDate).length === 5 && document.getElementById('photo-grid').children.length === 5);
  window.goTo('screen-preview');
  const attachPage = document.getElementById('pdf-page-2');
  assert('PDF photo attachment page exists', !!attachPage);
  assert('attachment page titled 現場照片附件', attachPage.innerHTML.includes('現場照片附件'));
  assert('attachment contains five photos', attachPage.querySelectorAll('img').length === 5);
  const photosAll = window.loadPhotos();
  photosAll.push({ id: 'old-photo', date: '2026-06-01', dataUrl: tinyJpeg, storagePath: 'p/x.jpg', uploaded: true });
  window.savePhotos(photosAll);
  window.cleanupOldPhotoData();
  assert('old uploaded photo dataUrl stripped', window.loadPhotos().find(p => p.id === 'old-photo').dataUrl === null);
  assert('recent photos keep dataUrl', window.getPhotosForDate(window.currentReportDate).every(p => p.dataUrl));

  // 各專案總覽測試
  const realProjects = window.cloudState.projects;
  const realIsCloudReady2 = window.isCloudReady;
  const realGetClient2 = window.getSupabaseClient;
  window.isCloudReady = () => true;
  window.cloudState.projects = [
    { id: 'p1', name: '測試案A', start_date: '2026-06-01' },
    { id: 'p2', name: '測試案B', start_date: '2026-06-01' }
  ];
  const chainFor = (result) => { const c = { select: () => c, in: () => c, gte: () => c, lte: () => c, then: (res, rej) => Promise.resolve(result).then(res, rej) }; return c; };
  window.getSupabaseClient = () => ({
    from: (t) => chainFor(t === 'daily_reports'
      ? { data: [{ project_id: 'p1', report_date: window.getTodayStr() }], error: null }
      : { data: [], error: null })
  });
  await window.renderProjectOverview();
  const overviewText = document.getElementById('overview-list').textContent;
  assert('overview shows filled project', overviewText.includes('測試案A') && overviewText.includes('今日已交'));
  assert('overview shows pending project with missing streak', overviewText.includes('測試案B') && overviewText.includes('今日未交') && overviewText.includes('連續缺件 7 天'));
  window.cloudState.projects = [{ id: 'a' }, { id: 'b' }];
  window.updateProjectSwitcher();
  assert('overview entry visible with multiple projects', document.getElementById('home-overview-entry').style.display === 'block');
  window.cloudState.projects = realProjects;
  window.updateProjectSwitcher();
  window.isCloudReady = realIsCloudReady2;
  window.getSupabaseClient = realGetClient2;

  console.log(`frontend-beta-test: ${results.length}/${results.length} checks passed`);
}

main().catch((err) => {
  console.error('frontend-beta-test failed:', err.message);
  console.error(`${results.filter(r => r.ok).length}/${results.length} checks passed before failure`);
  process.exit(1);
});
