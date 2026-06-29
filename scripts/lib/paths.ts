import path from "node:path";

export const projectRoot = path.resolve(__dirname, "../..");

export const paths = {
  resultsJson: path.join(projectRoot, "reports", "results.json"),
  junitXml: path.join(projectRoot, "reports", "junit-results.xml"),
  aiAnalysis: path.join(projectRoot, "reports", "ai-analysis.md"),
  aiFixPlan: path.join(projectRoot, "reports", "ai-fix-plan.json"),
  aiTestReport: path.join(projectRoot, "reports", "ai-test-report.md"),
  aiTestReportJson: path.join(projectRoot, "reports", "ai-test-report.json"),
  standardsDir: path.join(projectRoot, "testing-standards"),
  uiStandards: path.join(projectRoot, "testing-standards", "ui-playwright-standards.md"),
  evaluationCriteria: path.join(
    projectRoot,
    "testing-standards",
    "evaluation-criteria.md",
  ),
  autoHealPolicy: path.join(projectRoot, "testing-standards", "auto-heal-policy.json"),
  fixAudit: path.join(projectRoot, "reports", "auto-fix-audit.json"),
};
