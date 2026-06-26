# バーコードリーダーWebアプリ + Googleスプレッドシート連携 シンプルアクセス制限版

iOS/Android のブラウザで一次元バーコードを読み取り、読み取った番号と日時を Google スプレッドシートへ保存する Next.js アプリです。

この版は、前回のサービスアカウント / Google OAuth 構成ではなく、元の Apps Script 構成を維持したまま、アプリ画面にシンプルなユーザー名・パスワード制限を追加しています。

## 構成

```text
スマホブラウザ
  ↓ Basic認証でアプリ画面へ入る
Vercel / Next.js
  ↓ /api/scan が GAS_SHARED_SECRET 付きで中継
Google Apps Script Web App
  ↓ LockService で同時書き込みを保護
Google スプレッドシート
```

## 主な機能

- iOS Safari / Android Chrome などのスマホブラウザで動作
- `@zxing/browser` による一次元バーコード読み取り
- 読み取り後、保存が終わったタイミングで大きく **GO** を表示
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
- Vercel 側でユーザー名・パスワードによる簡易アクセス制限

## アクセス制御の考え方

このシンプル版では、厳密な「Googleアカウントごとのログイン」は使いません。
代わりに、次の3つで制限します。

```text
1. スプレッドシートのリンク共有をオフ
2. Vercelアプリにユーザー名・パスワードを設定
3. Apps ScriptにはGAS_SHARED_SECRETを設定し、Vercelからの正しい送信だけ受け付ける
```

スプレッドシート自体は、あなたのGoogleアカウントだけ、または必要な人だけに共有してください。
作業者がスプレッドシートを直接開く必要がない場合、作業者にシートを共有する必要はありません。
作業者には Vercel のURLとアプリ用ユーザー名・パスワードだけを渡します。

## 1. Google スプレッドシートを作る

1. Google ドライブで新しいスプレッドシートを作成します。
2. ファイル名を例として `バーコード読取ログ` にします。
3. シートは空のままでOKです。Apps Script が `Scans` シートとヘッダーを作ります。
4. 右上の **共有** から、リンク共有が **制限付き** になっていることを確認してください。

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

「アクセスできるユーザー: 全員」と聞くと不安に見えますが、スプレッドシートが全員公開になるわけではありません。
このWebアプリURLは Vercel から呼び出す受け口で、`GAS_SHARED_SECRET` が一致しない投稿は Apps Script 側で拒否します。

## 4. Next.js アプリをローカルで起動する

```bash
npm install
cp .env.local.example .env.local
```

`.env.local` を編集します。

```env
GAS_WEB_APP_URL=https://script.google.com/macros/s/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx/exec
GAS_SHARED_SECRET=bcr_2026_very_long_random_secret_xxxxxxxxxxxxx

APP_ACCESS_USER=scanner
APP_ACCESS_PASSWORD=your_long_app_password_here
```

`GAS_SHARED_SECRET` は Apps Script の `setupOnce()` に入れた secret と完全一致させてください。

`APP_ACCESS_USER` と `APP_ACCESS_PASSWORD` は、Vercelアプリ画面を開くためのユーザー名・パスワードです。
許可した作業者にだけこの2つを伝えてください。

ローカル起動:

```bash
npm run dev
```

PCで `http://localhost:3000` を開きます。
`APP_ACCESS_PASSWORD` を設定している場合、ブラウザにユーザー名・パスワード入力が表示されます。

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
APP_ACCESS_USER=scanner
APP_ACCESS_PASSWORD=your_long_app_password_here
```

6. **Deploy** を押します。
7. デプロイ後、Vercel のURLを iPhone/Android で開きます。
8. ユーザー名とパスワードを入力してアプリに入ります。

### Vercel CLI 経由

```bash
npm i -g vercel
vercel login
vercel
vercel env add GAS_WEB_APP_URL production
vercel env add GAS_SHARED_SECRET production
vercel env add APP_ACCESS_USER production
vercel env add APP_ACCESS_PASSWORD production
vercel --prod
```

環境変数を追加・変更した後は、必ず再デプロイしてください。

## 6. 実機テスト

1. iPhone または Android で Vercel の HTTPS URL を開きます。
2. ユーザー名・パスワードを入力します。
3. 担当者名/端末名を入力します。任意です。
4. **カメラ開始** を押します。
5. カメラ権限を許可します。
6. バーコードを枠の中央に横向きで合わせます。
7. 「保存中」の間は動かさず、大きな **GO** が出たら次のバーコードへ移ります。
8. Google スプレッドシートの `Scans` シートに行が追加されているか確認します。

## 7. パスワードを変えたい場合

Vercel の Environment Variables で `APP_ACCESS_PASSWORD` を変更し、再デプロイしてください。
変更後、作業者は新しいパスワードを入力する必要があります。

## 8. よくあるトラブル

### ユーザー名・パスワードを何度も聞かれる

ユーザー名またはパスワードが間違っている可能性があります。
Vercel の環境変数 `APP_ACCESS_USER` と `APP_ACCESS_PASSWORD` を確認してください。

### パスワード入力画面を消したい

Vercel の環境変数から `APP_ACCESS_PASSWORD` を削除し、再デプロイしてください。
ただし本番では設定することをおすすめします。

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

## 9. セキュリティ注意

- スプレッドシートのリンク共有は **制限付き** にしてください。
- Apps Script のウェブアプリは「全員」に公開しますが、`SHARED_SECRET` が一致しない投稿は拒否します。
- `GAS_SHARED_SECRET` は `NEXT_PUBLIC_` を付けず、Vercel のサーバー側環境変数として保存してください。
- `APP_ACCESS_PASSWORD` も `NEXT_PUBLIC_` を付けず、Vercel のサーバー側環境変数として保存してください。
- 作業者が退職・異動した場合、`APP_ACCESS_PASSWORD` を変更してください。
- 厳密に「Googleアカウントごと」に許可・拒否したい場合は、Googleログイン/OAuth構成またはVercel側の認証機能が必要です。
