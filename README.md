# バーコードリーダーWebアプリ + Googleスプレッドシート連携

iOS/Android のブラウザで一次元バーコードを読み取り、読み取った番号と日時を Google スプレッドシートへ保存する Next.js アプリです。Vercel にそのままデプロイできます。

## 構成

```text
スマホブラウザ
  ↓ カメラで一次元バーコード読取
Vercel / Next.js
  ↓ /api/scan が秘密鍵付きで中継
Google Apps Script Web App
  ↓ LockService で同時書き込みを保護
Google スプレッドシート
```

## 主な機能

- iOS Safari / Android Chrome などのスマホブラウザで動作
- `@zxing/browser` による一次元バーコード読み取り
- CODE_128 / CODE_39 / CODE_93 / EAN_13 / EAN_8 / ITF / UPC_A / UPC_E / CODABAR / RSS などに対応
- Google スプレッドシートへ以下を保存
  - 記録日時(JST)
  - 読み込み日時(端末/JST)
  - バーコード番号
  - バーコード形式
  - 担当者/端末名
  - User-Agent
  - Vercel受信日時(JST)
  - リクエストID
- 同じバーコードの3秒以内の連続送信をブロック
- Apps Script 側で `LockService` を使い、複数人が同時に読み取っても追記処理を直列化
- カメラで読めない場合の手入力保存フォーム付き

## 1. Google スプレッドシートを作る

1. Google ドライブで新しいスプレッドシートを作成します。
2. ファイル名を例として `バーコード読取ログ` にします。
3. シートは空のままでOKです。Apps Script が `Scans` シートとヘッダーを作ります。

## 2. Google Apps Script を設定する

1. スプレッドシートを開きます。
2. 上部メニューの **拡張機能 > Apps Script** を開きます。
3. `Code.gs` の中身を、このプロジェクトの `google-apps-script/Code.gs` の内容に全て置き換えます。
4. `setupOnce()` の中にある次の文字列を、十分長いランダム文字列に変更します。

```js
const secret = 'change_this_to_a_long_random_string';
```

例:

```js
const secret = 'bcr_2026_very_long_random_secret_xxxxxxxxxxxxx';
```

5. 保存します。
6. 関数選択で `setupOnce` を選び、実行します。
7. 初回は権限確認が出ます。自分のGoogleアカウントで承認してください。
8. 必要なら `testWrite` を実行します。スプレッドシートに `TEST-1234567890` の行が追加されれば Apps Script 側はOKです。

## 3. Apps Script をウェブアプリとしてデプロイする

1. Apps Script エディタ右上の **デプロイ > 新しいデプロイ** をクリックします。
2. 種類の選択で **ウェブアプリ** を選びます。
3. 設定は以下にします。
   - 説明: `barcode receiver v1` など
   - 次のユーザーとして実行: **自分**
   - アクセスできるユーザー: **全員**
4. **デプロイ** を押します。
5. 表示された **ウェブアプリURL** をコピーします。末尾が `/exec` のURLを使います。

## 4. Next.js アプリをローカルで起動する

```bash
npm install
cp .env.local.example .env.local
```

`.env.local` を編集します。

```env
GAS_WEB_APP_URL=https://script.google.com/macros/s/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx/exec
GAS_SHARED_SECRET=bcr_2026_very_long_random_secret_xxxxxxxxxxxxx
```

`GAS_SHARED_SECRET` は Apps Script の `setupOnce()` に入れた secret と完全一致させてください。

ローカル起動:

```bash
npm run dev
```

PCで `http://localhost:3000` を開きます。スマホ実機でカメラテストする場合は、Vercel へデプロイして HTTPS のURLで確認するのが簡単です。

## 5. Vercel にデプロイする

### GitHub 経由

1. このフォルダを GitHub リポジトリに push します。
2. Vercel で **Add New Project** を押します。
3. GitHub リポジトリを選びます。
4. Framework Preset は Next.js のままでOKです。
5. Environment Variables に以下を登録します。

```env
GAS_WEB_APP_URL=https://script.google.com/macros/s/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx/exec
GAS_SHARED_SECRET=bcr_2026_very_long_random_secret_xxxxxxxxxxxxx
```

6. **Deploy** を押します。
7. デプロイ後、Vercel のURLを iPhone/Android で開きます。

### Vercel CLI 経由

```bash
npm i -g vercel
vercel login
vercel
vercel env add GAS_WEB_APP_URL production
vercel env add GAS_SHARED_SECRET production
vercel --prod
```

環境変数を追加・変更した後は、必ず再デプロイしてください。

## 6. 実機テスト

1. iPhone または Android で Vercel の HTTPS URL を開きます。
2. 担当者名/端末名を入力します。任意です。
3. **カメラ開始** を押します。
4. カメラ権限を許可します。
5. バーコードを枠の中央に横向きで合わせます。
6. 「保存しました」と表示されることを確認します。
7. Google スプレッドシートの `Scans` シートに行が追加されているか確認します。

## 7. よくあるトラブル

### カメラが起動しない

- HTTPS で開いているか確認してください。Vercel 本番URLなら HTTPS です。
- iPhone の場合: 設定アプリ > Safari > カメラ、またはサイト別設定で許可します。
- Android Chrome の場合: アドレスバー左の設定からカメラ許可を確認します。
- 他のカメラアプリを閉じてから再試行してください。

### 保存に失敗する

- Vercel の `GAS_WEB_APP_URL` が `/exec` で終わるウェブアプリURLか確認してください。
- Vercel の `GAS_SHARED_SECRET` と Apps Script の `SHARED_SECRET` が一致しているか確認してください。
- Apps Script をコード変更後に再デプロイしたか確認してください。
- Apps Script の「実行数」画面でエラー内容を確認してください。

### Apps Script のコードを変更したのに反映されない

ウェブアプリはデプロイ済みバージョンが動きます。Apps Script を変更したら、**デプロイ > デプロイを管理 > 編集 > 新バージョン** で再デプロイしてください。

### 同時に使う人が多い

このサンプルは Apps Script の `LockService` でシートへの書き込み部分を直列化します。数人〜数十人が通常速度で読み取る用途なら扱いやすい構成です。高頻度で大量に読み取る場合は、Google Sheets を最終出力にしつつ、途中に Cloud Run / Firestore / Supabase などのDBを挟む構成を検討してください。

## 8. 列を減らしたい場合

Google Apps Script の `CONFIG.HEADER` と `sheet.appendRow([...])` の配列を同じ順番・同じ数にして変更してください。

最低限「日時」と「バーコード番号」だけにする場合は、Apps Script 側を以下のように調整します。

```js
HEADER: ['読み込み日時(端末/JST)', 'バーコード番号'],
```

```js
sheet.appendRow([
  readAtText,
  barcode,
]);
```

## 9. セキュリティ注意

- Apps Script のウェブアプリは「全員」に公開しますが、`SHARED_SECRET` が一致しない投稿は拒否します。
- `GAS_SHARED_SECRET` は `NEXT_PUBLIC_` を付けず、Vercel のサーバー側環境変数として保存してください。
- `GAS_WEB_APP_URL` と `GAS_SHARED_SECRET` はブラウザ側コードには出していません。
- 本格運用では、Vercel 側に簡易レート制限やログ監視を追加するとより安全です。
