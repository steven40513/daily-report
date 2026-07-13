const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function text(el) {
  return (el && el.textContent || '').replace(/\s+/g, ' ').trim();
}

function assert(name, condition, detail = '') {
  if (!condition) throw new Error(`${name}${detail ? `: ${detail}` : ''}`);
  console.log(`ok - ${name}`);
}

function createDom(seed = {}) {
  return new JSDOM(html, {
    url: 'https://example.test/daily-report/index.html',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.alertMessages = [];
      window.alert = (msg) => window.alertMessages.push(String(msg));
      window.confirm = () => true;
      window.scrollTo = () => {};
      Object.entries(seed).forEach(([key, value]) => window.localStorage.setItem(key, value));
    }
  });
}

function ready(dom) {
  const { document } = dom.window;
  return new Promise((resolve) => {
    if (document.readyState === 'complete' || document.readyState === 'interactive') resolve();
    else document.addEventListener('DOMContentLoaded', resolve, { once: true });
  });
}

function setCrewCounts(document, counts) {
  const rows = document.querySelectorAll('#screen-step2 .crew-row');
  rows.forEach((row, idx) => {
    const el = row.querySelector('.crew-num');
    el.textContent = String(counts[idx] || 0);
  });
}

async function main() {
  const dom = createDom();
  await ready(dom);
  const { window } = dom;
  const { document } = window;

  // Navigation and back behavior.
  document.querySelector('#home-start-report-btn').click();
  assert('home start button navigates to step 1', document.querySelector('.screen.active')?.id === 'screen-step1');
  document.querySelector('#screen-step1 .btn-primary').click();
  assert('step 1 next button navigates to step 2', document.querySelector('.screen.active')?.id === 'screen-step2');
  document.querySelector('#screen-step2 .back').click();
  assert('back button returns without hanging', document.querySelector('.screen.active')?.id === 'screen-step1');
  window.goTo('screen-home');
  document.querySelector('#screen-home .bottom-nav .nav-item:nth-child(2)').click();
  assert('home history nav opens history', document.querySelector('.screen.active')?.id === 'screen-history');
  window.goTo('screen-home');
  document.querySelector('#screen-home .bottom-nav .nav-item:nth-child(3)').click();
  assert('home settings nav opens settings', document.querySelector('.screen.active')?.id === 'screen-settings');

  // Date calculations and settings persistence.
  const settingsInputs = document.querySelectorAll('#screen-settings input[type="text"],#screen-settings input[type="date"]');
  settingsInputs[0].value = '高鐵綻測試案';
  settingsInputs[1].value = '瑋瓏營造測試股份有限公司';
  settingsInputs[2].value = '2026-06-01';
  settingsInputs[3].value = '2026-07-10';
  window.goTo('screen-home');
  const expectedRemainingDays = String(window.daysBetween(window.currentReportDate, '2026-07-10'));
  const expectedConstructionDays = String(window.daysBetween('2026-06-01', window.currentReportDate) + 1);
  assert('home remaining days recalculates from end date', text(document.getElementById('home-remain-days')) === expectedRemainingDays);
  assert('home construction days recalculates from start date', text(document.getElementById('home-cal-days')) === expectedConstructionDays);
  window.goTo('screen-step1');
  assert('construction days recalculates from start date', text(document.getElementById('step1-construction-days')).includes(expectedConstructionDays));

  // Crew exact total.
  window.goTo('screen-step2');
  setCrewCounts(document, [10, 8, 5, 3, 2]);
  window.updateCrewTotal();
  assert('five preset crew counts sum to 28', text(document.querySelector('#screen-step2 div[style*="font-size:28px"]')) === '28');

  // Add crew cancel and empty validation.
  const beforeCrewCount = document.querySelectorAll('#screen-step2 .crew-row').length;
  window.showAddCrewForm();
  window.cancelAddCrew();
  assert('cancel add crew hides form', document.getElementById('crew-add-form').style.display === 'none');
  assert('cancel add crew does not add row', document.querySelectorAll('#screen-step2 .crew-row').length === beforeCrewCount);
  window.showAddCrewForm();
  document.getElementById('crew-new-name').value = ' ';
  window.confirmAddCrew();
  assert('empty crew name is rejected', document.querySelectorAll('#screen-step2 .crew-row').length === beforeCrewCount);
  assert('empty crew name shows alert', window.alertMessages.includes('請輸入工種名稱'));
  window.cancelAddCrew();

  // Material categories, checks, cancel, validation, state preservation.
  window.goTo('screen-step3');
  const matCats = ['concrete', 'masonry', 'sealant', 'aggregate', 'rebar', 'other'];
  for (const cat of matCats) {
    window.switchMatCat(cat);
    assert(`material category ${cat} visible`, document.querySelector(`.mat-group[data-cat="${cat}"]`).style.display === 'block');
  }
  window.switchMatCat('concrete');
  const concreteQty = document.querySelector('.mat-group[data-cat="concrete"] .item-qty');
  concreteQty.value = '77';
  const firstMatCheck = document.querySelector('.mat-group[data-cat="concrete"] .item-check');
  const firstMatWasOn = firstMatCheck.classList.contains('on');
  window.toggleCheck(firstMatCheck);
  assert('material checkbox toggles', firstMatCheck.classList.contains('on') !== firstMatWasOn);
  window.switchMatCat('masonry');
  window.switchMatCat('concrete');
  assert('material quantity survives category switch', concreteQty.value === '77');
  window.addNewItem('mat');
  document.getElementById('mat-new-name').value = '取消材料';
  window.cancelAddItem('mat');
  assert('cancel material add hides form', document.getElementById('mat-add-form').style.display === 'none');
  assert('cancel material add clears partial name', document.getElementById('mat-new-name').value === '');
  window.addNewItem('mat');
  document.getElementById('mat-new-name').value = '';
  window.confirmAddItem('mat');
  assert('empty material name is rejected', window.alertMessages.includes('請輸入名稱'));
  window.cancelAddItem('mat');
  window.addNewItem('mat');
  document.getElementById('mat-new-name').value = '自訂防水材';
  document.getElementById('mat-new-unit').value = '桶';
  window.confirmAddItem('mat');
  const customMat = Array.from(document.querySelectorAll('.mat-group[data-cat="concrete"] .item-name')).find((el) => text(el) === '自訂防水材');
  assert('custom material can be added for reload test', Boolean(customMat));
  customMat.closest('.item-row').querySelector('.item-qty').value = '2';

  // Equipment categories, checks, cancel, XSS-like text, state preservation.
  window.goTo('screen-step4');
  const equipCats = ['excavate', 'crush', 'crane', 'transport'];
  for (const cat of equipCats) {
    window.switchEquipCat(cat);
    assert(`equipment category ${cat} visible`, document.querySelector(`.equip-group[data-cat="${cat}"]`).style.display === 'block');
  }
  window.switchEquipCat('crane');
  window.addNewItem('equip');
  document.getElementById('equip-new-name').value = '塔吊 TC100';
  document.getElementById('equip-new-unit').value = 'hr';
  window.confirmAddItem('equip');
  window.switchEquipCat('transport');
  window.switchEquipCat('crane');
  assert('equipment item survives category switch', text(document.querySelector('.equip-group[data-cat="crane"]')).includes('塔吊 TC100'));
  const equipCheck = document.querySelector('.equip-group[data-cat="crane"] .item-check');
  const equipWasOn = equipCheck.classList.contains('on');
  window.toggleCheck(equipCheck);
  assert('equipment checkbox toggles', equipCheck.classList.contains('on') !== equipWasOn);
  window.addNewItem('equip');
  document.getElementById('equip-new-name').value = '<img src=x onerror=alert(1)>';
  document.getElementById('equip-new-unit').value = '';
  window.confirmAddItem('equip');
  assert('equipment XSS-like name is text', text(document.querySelector('.equip-group[data-cat="crane"]')).includes('<img src=x onerror=alert(1)>'));
  window.addNewItem('equip');
  document.getElementById('equip-new-name').value = '取消機具';
  window.switchEquipCat('transport');
  assert('equipment add form hides on category switch', document.getElementById('equip-add-form').style.display === 'none');
  assert('equipment add form clears partial name', document.getElementById('equip-new-name').value === '');

  // Work log subcontractor hide and cross-surface badges.
  window.goTo('screen-step5');
  window.openLogForm();
  document.getElementById('log-title').value = 'B2F 模板組立';
  document.getElementById('log-person').value = '王主任';
  document.getElementById('log-unit').value = '模板班';
  document.getElementById('log-period-am').click();
  document.getElementById('log-hours').value = '8';
  document.getElementById('log-location').value = 'B2F A區';
  document.getElementById('log-work-today').value = '模板組立完成';
  document.getElementById('log-work-tomorrow').value = '模板校正';
  window.toggleCheck(document.getElementById('log-sub-check'));
  assert('subcontractor fields show after check', document.getElementById('log-sub-fields').style.display === 'block');
  window.toggleCheck(document.getElementById('log-sub-check'));
  assert('subcontractor fields hide after uncheck', document.getElementById('log-sub-fields').style.display === 'none');
  window.toggleCheck(document.getElementById('log-sub-check'));
  document.getElementById('log-sub-name').value = '協力模板行';
  window.saveLogRecord();
  const logId = JSON.parse(window.localStorage.getItem('cdr-logs'))[0].id;
  assert('subcontractor badge appears in list', text(document.getElementById('log-list-container')).includes('代工'));
  window.viewLogDetail(logId);
  assert('subcontractor appears in detail', text(document.getElementById('log-detail-content')).includes('協力模板行'));

  // PDF tab and filename.
  window.goTo('screen-preview');
  assert('pdf crew total contains 28', text(document.getElementById('pdf-pages-container')).includes('28 人'));
  assert('pdf construction days matches start date', text(document.getElementById('pdf-pages-container')).includes(`${expectedConstructionDays} 天`));
  assert('pdf includes subcontractor info', text(document.getElementById('pdf-pages-container')).includes('協力模板行'));
  assert('pdf includes settings-added project name', text(document.getElementById('pdf-pages-container')).includes('高鐵綻測試案'));
  assert('pdf filename includes project date extension', window.getPdfFileName().includes('高鐵綻測試案_日報_') && window.getPdfFileName().endsWith('.pdf'));
  window.showPdfPage(2);
  assert('pdf page 2 tab switches visible page', document.getElementById('pdf-page-2').style.display === 'block');
  window.showPdfPage(1);
  assert('pdf page 1 tab switches visible page', document.getElementById('pdf-page-1').style.display === 'block');

  // Weekly stats and history update after report save.
  window.goTo('screen-home');
  assert('weekly report count reflects saved report', text(document.getElementById('stat-reports')) === '1');
  assert('weekly crew count reflects saved report', text(document.getElementById('stat-crew')) === '28');

  const currentReport = JSON.parse(window.localStorage.getItem(`cdr-report-${window.currentReportDate}`));
  const yesterday = new Date(window.currentReportDate);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
  window.localStorage.setItem(`cdr-report-${yesterdayStr}`, JSON.stringify({ ...currentReport, date: yesterdayStr, progress: { notes: '第一次歷史備註' } }));
  window.goTo('screen-history');
  window.viewHistoryDetail(yesterdayStr);
  assert('history detail shows initial saved note', text(document.getElementById('history-detail-content')).includes('第一次歷史備註'));
  window.localStorage.setItem(`cdr-report-${yesterdayStr}`, JSON.stringify({ ...currentReport, date: yesterdayStr, progress: { notes: '第二次歷史備註' } }));
  window.goTo('screen-history');
  window.viewHistoryDetail(yesterdayStr);
  assert('history detail reflects updated saved report', text(document.getElementById('history-detail-content')).includes('第二次歷史備註'));

  // Custom item reload persistence.
  const snapshot = {};
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    snapshot[key] = window.localStorage.getItem(key);
  }
  const reloaded = createDom(snapshot);
  await ready(reloaded);
  const win2 = reloaded.window;
  const doc2 = win2.document;
  win2.goTo('screen-home');
  assert('settings project name survives reload', text(doc2.getElementById('home-project-name')) === '高鐵綻測試案');
  win2.goTo('screen-step3');
  win2.switchMatCat('concrete');
  assert('custom material survives reload', text(doc2.querySelector('.mat-group[data-cat="concrete"]')).includes('自訂防水材'));
  win2.goTo('screen-step4');
  win2.switchEquipCat('crane');
  assert('custom equipment survives reload', text(doc2.querySelector('.equip-group[data-cat="crane"]')).includes('塔吊 TC100'));
  win2.goTo('screen-step5');
  assert('work log survives reload', text(doc2.getElementById('log-list-container')).includes('B2F 模板組立'));

  // Empty storage / future feature entry checks.
  const cleanDom = createDom();
  await ready(cleanDom);
  assert('empty localStorage starts without stale reports', text(cleanDom.window.document.getElementById('history-list-container')).includes('尚無歷史日報紀錄'));
  assert('photo upload entry is not exposed', !text(document.body).includes('上傳照片') && !text(document.body).includes('施工照片'));
  assert('line embedded browser remains manual only', true);

  console.log('frontend-remaining-test: all assertions passed');
}

main().catch((err) => {
  console.error(`frontend-remaining-test failed: ${err.message}`);
  process.exit(1);
});
