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
};
