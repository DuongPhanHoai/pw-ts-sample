import path from "node:path";

/** Repository root (pw-ts-sample). */
export const projectRoot = path.resolve(__dirname, "../..");

export const aiTestRoot = path.join(projectRoot, "ai-test");

export const paths = {
  inputs: path.join(aiTestRoot, "inputs"),
  docs: path.join(aiTestRoot, "docs"),
  resultsJson: path.join(projectRoot, "reports", "results.json"),
  testResultsDir: path.join(projectRoot, "test-results"),
  reportsDir: path.join(projectRoot, "ai-reports"),
  suiteReportJson: path.join(projectRoot, "ai-reports", "ai-test-suite.json"),
  suiteReportMd: path.join(projectRoot, "ai-reports", "ai-test-suite.md"),
  suiteCaseDir: path.join(projectRoot, "ai-reports", "ai-test-suite"),
  suiteHistoryDir: path.join(projectRoot, "ai-reports", "ai-test-history"),
  modelEvalHistoryCsv: path.join(projectRoot, "ai-reports", "ai-test-history", "model_eval_history.csv"),
  modelEvalRunsCsv: path.join(projectRoot, "ai-reports", "ai-test-history", "model_eval_runs.csv"),
  modelEvalScoresCsv: path.join(projectRoot, "ai-reports", "ai-test-history", "model_eval_scores.csv"),
};
