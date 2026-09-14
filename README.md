# 繰上げ返済 効果シミュレーター

住宅ローンの繰上げ返済の効果を試算できる、単体のWebページです。React + ReactDOMをCDNから読み込むだけで動く静的サイトなので、サーバーなしでGitHub Pagesに公開できます。

## 含まれる機能

- 複数の借入パターンをタブで管理（名前を付けて保存）
- 変動金利の履歴・繰上げ返済履歴の入力と効果計算
- 「5年ルール・125%ルール」のON/OFF切り替え（未払利息の元金組み入れも計算）
- 「繰上げ返済 vs 資産運用」の経済効果比較（利息軽減額を含む）
- タブを「実際の借入」として設定すると、以下の別ページに反映されます
  - **現在の状況**：今日時点の残高、これまでに支払った元金・利息の累計、今月の返済額の内訳
  - **返済予定表**：今後の毎月の返済額（元金・利息・残高）の一覧
- リンクによる共有（バックエンド不要。共有したい内容がURLの `#s=...` にエンコードされます）
- 入力内容はブラウザの localStorage にこの端末だけで自動保存されます（他の人のブラウザには送信されません）

## ファイル構成

```
index.html   … 公開するトップページ（React/ReactDOMをCDNから読み込み、bundle.jsを実行）
bundle.js    … アプリ本体（app.jsx をビルド済みのもの。これだけで動きます）
app.jsx      … アプリのソースコード（編集する場合はこちらを直してビルドし直してください）
```

`index.html` と `bundle.js` の2つがあれば公開できます。`app.jsx` は編集用の元ファイルです。

## GitHub Pagesへの公開手順

1. GitHub で新しいリポジトリを作成します（例: `mortgage-prepayment-simulator`）。Public / Private どちらでも公開できます。
2. このフォルダの中身（少なくとも `index.html` と `bundle.js`）をリポジトリのルートに追加し、コミット・プッシュします。

   ```bash
   git init
   git add index.html bundle.js app.jsx README.md
   git commit -m "Add mortgage prepayment simulator"
   git branch -M main
   git remote add origin https://github.com/<ユーザー名>/<リポジトリ名>.git
   git push -u origin main
   ```

3. GitHubのリポジトリ画面で **Settings → Pages** を開きます。
4. 「Build and deployment」の **Source** を `Deploy from a branch` にし、**Branch** を `main` / フォルダを `/ (root)` に設定して **Save** します。
5. 1分ほど待つと、ページ上部に公開URLが表示されます（通常は `https://<ユーザー名>.github.io/<リポジトリ名>/`）。

以降は `main` ブランチにプッシュするたびに自動で再公開されます。

## 注意事項

- React / ReactDOM は unpkg.com のCDNから読み込みます。閲覧する人にインターネット接続が必要です。
- 入力データは各自のブラウザの localStorage に保存されるだけで、外部には送信されません。
- 「共有」機能で発行されるリンクには、その借入タブの入力内容がそのままエンコードされて含まれます。第三者に見られたくない金額を含む場合は、共有先にご注意ください。
- 金融機関ごとに「5年ルール・125%ルール」や未払利息の扱いは細部が異なります。あくまで簡易的な試算ツールとしてご利用ください。

## ソースを編集する場合

`app.jsx` を編集した後、Node.js と esbuild で再ビルドしてください。

```bash
npm install esbuild --no-save
npx esbuild app.jsx --bundle=false --jsx=transform \
  --jsx-factory=React.createElement --jsx-fragment=React.Fragment \
  --format=iife --platform=browser --minify --outfile=bundle.js
```

`bundle.js` を差し替えて再度プッシュすれば、公開ページに反映されます。
