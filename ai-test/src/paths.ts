import path from "node:path";

/** Repository root (pw-ts-sample). */
export const projectRoot = path.resolve(__dirname, "../..");

export const aiTestRoot = path.join(projectRoot, "ai-test");

export const paths = {
  inputs: path.join(aiTestRoot, "inputs"),
  docs: path.join(aiTestRoot, "docs"),
  resultsJson: path.join(projectRoot, "reports", "results.json"),
  testResultsDir: path.join(projectRoot, "test-results"),
  reportsDir: path.join(projectRoot, "reports"),
  suiteReportJson: path.join(projectRoot, "reports", "ai-test-suite.json"),
  suiteReportMd: path.join(projectRoot, "reports", "ai-test-suite.md"),
  suiteCaseDir: path.join(projectRoot, "reports", "ai-test-suite"),
  suiteHistoryDir: path.join(projectRoot, "reports", "ai-test-history"),
  suiteHistoryCsv: path.join(projectRoot, "reports", "ai-test-history", "summary.csv"),
};
