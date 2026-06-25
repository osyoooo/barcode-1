/**
 * Barcode receiver for Google Sheets.
 *
 * 使い方:
 * 1. Googleスプレッドシートを作る
 * 2. 拡張機能 > Apps Script を開く
 * 3. このファイルの中身を Code.gs に貼り付ける
 * 4. setupOnce() 内の secret を変更して、setupOnce を1回実行する
 * 5. デプロイ > 新しいデプロイ > ウェブアプリ で公開する
 */

const CONFIG = {
  SHEET_NAME: 'Scans',
  TIME_ZONE: 'Asia/Tokyo',
  HEADER: [
    '記録日時(JST)',
    '読み込み日時(端末/JST)',
    'バーコード番号',
    'バーコード形式',
    '担当者/端末名',
    'User-Agent',
    'Vercel受信日時(JST)',
    'リクエストID',
  ],
};

/**
 * 初回だけ実行してください。
 * secret は Vercel の GAS_SHARED_SECRET と同じ文字列にします。
 */
function setupOnce() {
  const secret = 'change_this_to_a_long_random_string';
  PropertiesService.getScriptProperties().setProperty('SHARED_SECRET', secret);

  const sheet = getOrCreateSheet_(SpreadsheetApp.getActiveSpreadsheet(), CONFIG.SHEET_NAME);
  ensureHeader_(sheet);
  sheet.setFrozenRows(1);
}

function doGet() {
  return json_({ ok: true, message: 'Barcode receiver is running.' });
}

function doPost(e) {
  const lock = LockService.getScriptLock();

  try {
    lock.waitLock(30000);

    const payload = parsePayload_(e);
    const expectedSecret = PropertiesService.getScriptProperties().getProperty('SHARED_SECRET');

    if (!expectedSecret) {
      return json_({ ok: false, error: 'Apps Script の SHARED_SECRET が未設定です。setupOnce() を実行してください。' });
    }

    if (String(payload.secret || '') !== expectedSecret) {
      return json_({ ok: false, error: 'unauthorized' });
    }

    const barcode = normalizeText_(payload.barcode, 256);
    if (!barcode) {
      return json_({ ok: false, error: 'barcode が空です。' });
    }

    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = getOrCreateSheet_(spreadsheet, CONFIG.SHEET_NAME);
    ensureHeader_(sheet);

    const requestId = Utilities.getUuid();
    const recordedAtText = formatDate_(new Date());
    const readAtText = formatDateOrRaw_(payload.readAt, 80);
    const appReceivedAtText = formatDateOrRaw_(payload.appReceivedAt, 80);

    sheet.appendRow([
      recordedAtText,
      readAtText,
      barcode,
      normalizeText_(payload.format, 64),
      normalizeText_(payload.operator, 100),
      normalizeText_(payload.userAgent, 500),
      appReceivedAtText,
      requestId,
    ]);

    SpreadsheetApp.flush();
    const row = sheet.getLastRow();

    return json_({ ok: true, row, requestId });
  } catch (error) {
    return json_({ ok: false, error: error && error.message ? error.message : String(error) });
  } finally {
    if (lock.hasLock()) {
      lock.releaseLock();
    }
  }
}

function parsePayload_(e) {
  if (e && e.postData && e.postData.contents) {
    try {
      return JSON.parse(e.postData.contents);
    } catch (error) {
      // JSONではないPOSTの場合はURLパラメータとして扱います。
      return e.parameter || {};
    }
  }
  return (e && e.parameter) || {};
}

function getOrCreateSheet_(spreadsheet, sheetName) {
  let sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(sheetName);
  }
  return sheet;
}

function ensureHeader_(sheet) {
  const header = CONFIG.HEADER;

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(header);
    sheet.setFrozenRows(1);
    return;
  }

  const firstRowRange = sheet.getRange(1, 1, 1, header.length);
  const firstRowValues = firstRowRange.getValues()[0];
  const isEmpty = firstRowValues.every(function (value) {
    return value === '' || value === null;
  });

  if (isEmpty) {
    firstRowRange.setValues([header]);
    sheet.setFrozenRows(1);
  }
}

function formatDate_(date) {
  return Utilities.formatDate(date, CONFIG.TIME_ZONE, 'yyyy-MM-dd HH:mm:ss');
}

function formatDateOrRaw_(value, maxLength) {
  const text = normalizeText_(value, maxLength);
  if (!text) return '';

  const date = new Date(text);
  if (isNaN(date.getTime())) return text;
  return formatDate_(date);
}

function normalizeText_(value, maxLength) {
  if (value === null || typeof value === 'undefined') return '';
  return String(value).trim().slice(0, maxLength);
}

function json_(object) {
  return ContentService
    .createTextOutput(JSON.stringify(object))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Apps Script エディタ上で疎通確認したい場合に使います。
 * setupOnce() 実行後、この関数を実行するとテスト行が1行追加されます。
 */
function testWrite() {
  const secret = PropertiesService.getScriptProperties().getProperty('SHARED_SECRET');
  const fakeEvent = {
    postData: {
      contents: JSON.stringify({
        secret: secret,
        barcode: 'TEST-1234567890',
        readAt: new Date().toISOString(),
        format: 'TEST',
        operator: 'Apps Script test',
        userAgent: 'Apps Script editor',
        appReceivedAt: new Date().toISOString(),
      }),
    },
  };

  const result = doPost(fakeEvent);
  Logger.log(result.getContent());
}
