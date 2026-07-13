const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const results = [];

function assert(name, condition, detail = '') {
  results.push({ name, ok: Boolean(condition), detail });
  if (!condition) {
    throw new Error(`${name}${detail ? `: ${detail}` : ''}`);
  }
}

function text(el) {
  return (el && el.textContent || '').replace(/\s+/g, ' ').trim();
}

async function main() {
  const dom = new JSDOM(html, {
    url: 'https://example.test/daily-report/index.html',
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

  assert('init shows home screen', document.querySelector('.screen.active')?.id === 'screen-home');
  assert('report repository is exposed', Boolean(window.ReportRepository));
  assert('report repository uses local implementation by default', window.ReportRepository === window.LocalReportRepository);
  assert('report repository can load default settings', window.ReportRepository.loadSettings().projectName === '高鐵綻');
  assert('supabase config is exposed', Boolean(window.SUPABASE_CONFIG));
  assert('supabase url is configured', window.SUPABASE_CONFIG.url === 'https://wadlcguhhmmpizbcbuus.supabase.co');
  assert('supabase publishable key is configured', window.SUPABASE_CONFIG.publishableKey.startsWith('sb_publishable_'));
  assert('supabase client helper is exposed', typeof window.getSupabaseClient === 'function');
  assert('supabase otp helper is exposed', typeof window.requestSupabaseOtp === 'function');
  assert('supabase report sync helper is exposed', typeof window.syncCurrentReportToSupabase === 'function');
  assert('supabase report load helper is exposed', typeof window.loadCurrentReportFromSupabase === 'function');
  assert('supabase item mapper is exposed', typeof window.mapReportItemsForSupabase === 'function');
  assert('supabase report mapper is exposed', typeof window.mapSupabaseReportToLocalData === 'function');
  assert('supabase work log mapper is exposed', typeof window.mapSupabaseWorkLogsToLocalLogs === 'function');
  assert('supabase client is unavailable in jsdom without cdn global', window.getSupabaseClient() === null);

  // Settings -> home sync.
  window.goTo('screen-settings');
  assert('settings shows cloud connection card', Boolean(document.getElementById('supabase-status')));
  assert('settings has email login input', Boolean(document.getElementById('supabase-email')));
  assert('settings has manual cloud sync button', Boolean(document.getElementById('supabase-sync-btn')));
  assert('settings has manual cloud load button', Boolean(document.getElementById('supabase-load-btn')));
  assert('settings explains local fallback when client unavailable', text(document.getElementById('supabase-status')).includes('本機保存'));
  const settingsInputs = document.querySelectorAll('#screen-settings input[type="text"],#screen-settings input[type="date"]');
  settingsInputs[0].value = '高鐵綻測試案';
  settingsInputs[1].value = '瑋瓏營造測試股份有限公司';
  settingsInputs[2].value = '2026-06-01';
  settingsInputs[3].value = '2028-06-01';
  window.goTo('screen-home');
  assert('home project name syncs from settings', text(document.getElementById('home-project-name')) === '高鐵綻測試案');
  assert('home company name syncs from settings', text(document.getElementById('home-company-name')) === '瑋瓏營造測試股份有限公司');

  // Step navigation and weather.
  window.goTo('screen-step1');
  const amWeather = document.querySelectorAll('#screen-step1 .weather-col')[0].querySelectorAll('.weather-btn');
  const pmWeather = document.querySelectorAll('#screen-step1 .weather-col')[1].querySelectorAll('.weather-btn');
  window.selectWeather(amWeather[2]);
  window.selectWeather(pmWeather[0]);
  assert('am weather can select rain', text(document.querySelectorAll('#screen-step1 .weather-col')[0].querySelector('.weather-btn.selected span')) === '雨');
  assert('pm weather can select sunny independently', text(document.querySelectorAll('#screen-step1 .weather-col')[1].querySelector('.weather-btn.selected span')) === '晴');

  // Crew totals and new crew.
  window.goTo('screen-step2');
  const firstMinus = document.querySelector('#screen-step2 .crew-row .crew-btn');
  for (let i = 0; i < 5; i += 1) window.adjustCrew(firstMinus, -1);
  assert('crew decrement clamps at zero', text(document.querySelector('#screen-step2 .crew-num')) === '0');
  window.showAddCrewForm();
  document.getElementById('crew-new-name').value = '防水工程';
  window.confirmAddCrew();
  const crewLabels = Array.from(document.querySelectorAll('#screen-step2 .crew-label')).map(text);
  assert('new crew appears in step 2', crewLabels.includes('防水工程'));
  const addedCrewRow = Array.from(document.querySelectorAll('#screen-step2 .crew-row')).find((row) => text(row.querySelector('.crew-label')) === '防水工程');
  window.adjustCrew(addedCrewRow.querySelectorAll('.crew-btn')[1], 4);
  assert('new crew contributes to total', text(document.querySelector('#screen-step2 div[style*="font-size:28px"]')) === '4');

  // Materials.
  window.goTo('screen-step3');
  window.switchMatCat('other');
  assert('material category switches to other', text(document.getElementById('mat-cat-label')).includes('其他'));
  window.addNewItem('mat');
  document.getElementById('mat-new-name').value = '<script>alert(1)</script>';
  document.getElementById('mat-new-unit').value = '';
  window.confirmAddItem('mat');
  const addedMat = Array.from(document.querySelectorAll('.mat-group[data-cat="other"] .item-name')).find((el) => text(el) === '<script>alert(1)</script>');
  assert('material name is inserted as text, not HTML', Boolean(addedMat));
  assert('empty material unit defaults to 個', text(addedMat.closest('.item-row').querySelector('.item-unit')) === '個');
  addedMat.closest('.item-row').querySelector('.item-qty').value = '3';

  // Equipment.
  window.goTo('screen-step4');
  window.switchEquipCat('crane');
  window.addNewItem('equip');
  document.getElementById('equip-new-name').value = '小怪手 PC20';
  document.getElementById('equip-new-unit').value = 'hr';
  window.confirmAddItem('equip');
  const addedEquip = Array.from(document.querySelectorAll('.equip-group[data-cat="crane"] .item-name')).find((el) => text(el) === '小怪手 PC20');
  assert('equipment item can be added', Boolean(addedEquip));
  addedEquip.closest('.item-row').querySelector('.item-qty').value = '8';

  // Work log.
  window.goTo('screen-step5');
  window.openLogForm();
  document.getElementById('log-title').value = 'B2F 模板組立';
  document.getElementById('log-person').value = '王主任';
  document.getElementById('log-unit').value = '模板班';
  document.getElementById('log-period-am').click();
  document.getElementById('log-hours').value = '8';
  document.getElementById('log-total-hours').value = '8';
  document.getElementById('log-location').value = 'B2F A區';
  document.getElementById('log-work-today').value = '完成模板組立 60%';
  document.getElementById('log-work-tomorrow').value = '續做模板校正';
  window.toggleCheck(document.getElementById('log-sub-check'));
  document.getElementById('log-sub-name').value = '協力模板行';
  window.saveLogRecord();
  assert('work log returns to step 5', document.querySelector('.screen.active')?.id === 'screen-step5');
  assert('work log list contains new item', text(document.getElementById('log-list-container')).includes('B2F 模板組立'));

  // Notes and autosave.
  document.querySelector('#screen-step5 textarea').value = '今日進度正常，注意下午降雨。';
  window.goTo('screen-preview');
  assert('pdf preview renders page 1', Boolean(document.getElementById('pdf-page-1')));
  assert('pdf preview renders page 2 when logs exist', Boolean(document.getElementById('pdf-page-2')));
  assert('pdf preview includes settings project name', text(document.getElementById('pdf-pages-container')).includes('高鐵綻測試案'));
  assert('pdf preview includes weather', text(document.getElementById('pdf-pages-container')).includes('上午：雨 ／ 下午：晴'));
  assert('pdf preview includes custom material', text(document.getElementById('pdf-pages-container')).includes('<script>alert(1)</script>'));
  assert('pdf preview includes custom equipment', text(document.getElementById('pdf-pages-container')).includes('小怪手 PC20'));
  assert('pdf preview includes work log', text(document.getElementById('pdf-pages-container')).includes('B2F 模板組立'));
  assert('pdf preview includes notes', text(document.getElementById('pdf-pages-container')).includes('今日進度正常'));

  const reportKey = `cdr-report-${window.currentReportDate}`;
  assert('autosave writes current report key', Boolean(window.localStorage.getItem(reportKey)), reportKey);
  assert('logs are stored', JSON.parse(window.localStorage.getItem('cdr-logs')).length === 1);
  const mappedItems = window.mapReportItemsForSupabase('report-1', window.collectReportData());
  assert('supabase mapper includes crew items', mappedItems.some((item) => item.report_id === 'report-1' && item.item_type === 'crew'));
  assert('supabase mapper includes material items', mappedItems.some((item) => item.report_id === 'report-1' && item.item_type === 'material'));
  assert('supabase mapper includes equipment items', mappedItems.some((item) => item.report_id === 'report-1' && item.item_type === 'equipment'));
  const cloudReport = window.mapSupabaseReportToLocalData({
    report_date: window.currentReportDate,
    weather_am: '雨',
    weather_pm: '晴',
    construction_days: 31,
    notes: '雲端備註',
    updated_at: '2026-07-01T08:00:00Z'
  }, [
    { item_type: 'crew', category: 'crew', name: '模板班', unit: '人', quantity: 6, is_checked: true, sort_order: 0 },
    { item_type: 'material', category: 'concrete', name: '混凝土 5000psi', unit: '米', quantity: 12, is_checked: true, sort_order: 0 },
    { item_type: 'equipment', category: 'crane', name: '塔吊', unit: 'hr', quantity: 4, is_checked: true, sort_order: 0 }
  ]);
  assert('supabase report mapper restores weather', cloudReport.weather.am === '雨' && cloudReport.weather.pm === '晴');
  assert('supabase report mapper restores crew', cloudReport.crew[0].name === '模板班' && cloudReport.crew[0].count === 6);
  assert('supabase report mapper restores material', cloudReport.materials.concrete[0].qty === '12');
  assert('supabase report mapper restores equipment', cloudReport.equipment.crane[0].name === '塔吊');
  assert('supabase report mapper restores notes', cloudReport.progress.notes === '雲端備註');
  const cloudLogs = window.mapSupabaseWorkLogsToLocalLogs(window.currentReportDate, [{
    id: 'work-log-1',
    title: '雲端施工紀錄',
    person: '王主任',
    contractor_unit: '模板班',
    period_am: true,
    period_pm: false,
    hours: 8,
    total_hours: 16,
    location: 'B2F',
    work_today: '雲端工作內容',
    work_tomorrow: '明日續作',
    has_subcontractor: true,
    subcontractor_name: '協力商',
    updated_at: '2026-07-01T09:00:00Z'
  }]);
  assert('supabase work log mapper restores local shape', cloudLogs[0].title === '雲端施工紀錄' && cloudLogs[0].unit === '模板班' && cloudLogs[0].subcontractorName === '協力商');
  const cloudLogDate = window.currentReportDate;
  window.replaceLocalLogsForDate(cloudLogDate, cloudLogs);
  window.goTo('screen-step5');
  assert('cloud-loaded work log appears in step 5 list', text(document.getElementById('log-list-container')).includes('雲端施工紀錄'));
  assert('cloud-loaded work log is stored locally', JSON.parse(window.localStorage.getItem('cdr-logs')).some((log) => log.id === 'work-log-1' && log.date === cloudLogDate));

  // History only lists previous 30 days, so inject yesterday and verify detail rendering.
  const yesterday = new Date(window.currentReportDate);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
  const currentReport = JSON.parse(window.localStorage.getItem(reportKey));
  window.localStorage.setItem(`cdr-report-${yesterdayStr}`, JSON.stringify({ ...currentReport, date: yesterdayStr }));
  window.goTo('screen-history');
  assert('history list includes prior report', text(document.getElementById('history-list-container')).includes(yesterdayStr));
  window.localStorage.setItem('cdr-logs', JSON.stringify([{ ...cloudLogs[0], date: yesterdayStr }]));
  window.viewHistoryDetail(yesterdayStr);
  assert('history detail includes saved notes', text(document.getElementById('history-detail-content')).includes('今日進度正常'));
  assert('history detail includes work log', text(document.getElementById('history-detail-content')).includes('雲端施工紀錄'));

  // LINE Login and multi-project switcher now implemented
  assert('LINE login button exists', text(document.body).includes('LINE 登入'));
  assert('project switcher icon exists', document.getElementById('project-switch-icon') !== null);

  // Home login banner visibility.
  window.setCloudBadge('local');
  assert('login banner visible when not logged in', document.getElementById('home-login-banner').style.display !== 'none');
  window.setCloudBadge('cloud');
  assert('login banner hidden when cloud mode', document.getElementById('home-login-banner').style.display === 'none');
  window.setCloudBadge('syncing');
  assert('login banner hidden when syncing', document.getElementById('home-login-banner').style.display === 'none');
  window.setCloudBadge('error', '找不到專案');
  assert('login banner visible on error state', document.getElementById('home-login-banner').style.display !== 'none');

  console.log(`frontend-smoke-test: ${results.length}/${results.length} assertions passed`);
}

main().catch((err) => {
  console.error(`frontend-smoke-test failed: ${err.message}`);
  const failed = results.find((result) => !result.ok);
  if (failed) console.error(`failed assertion: ${failed.name}${failed.detail ? ` (${failed.detail})` : ''}`);
  process.exit(1);
});
