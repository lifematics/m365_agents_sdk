# RAGAS Evaluation for Q&A Data

このディレクトリには、`sample_questions_with_answers.csv`に含まれる質問・回答データを RAGAS（Retrieval-Augmented Generation Assessment）で評価するための Python スクリプトが含まれています。

## セットアップ

```bash
# 環境設定
cp .env.docker .env
# .envファイルを編集してAzure OpenAI設定を確認

docker compose up -d

# Azure OpenAI設定テスト。テストが通るかを確認する
docker compose exec ragas-shell python test_azure_config.py
```

## 実行方法

```bash
# サンプルデータに対してRAGAS評価を実行
docker compose exec ragas-shell python ragas_evaluation.py  sample_questions_with_answers.csv
```

評価実行後、`ragas_evaluation_results.csv` が生成されます。

## データ形式

入力 CSV ファイル (`sample_questions_with_answers.csv`) は以下の列を含む必要があります：

- `question` - 質問
- `reference` - 参考回答（正解）
- `answer` - 生成された回答

## 参考リンク

- [RAGAS Documentation](https://docs.ragas.io/)
