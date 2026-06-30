import fs from "node:fs";
import path from "node:path";
import { test as base, expect, type Page } from "@playwright/test";

async function capturePageStyles(page: Page): Promise<string> {
  return page.evaluate(() => {
    const rules: string[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        for (const rule of Array.from(sheet.cssRules)) {
          rules.push(rule.cssText);
        }
      } catch {
        // Cross-origin stylesheets cannot expose cssRules.
      }
    }
    return rules.join("\n");
  });
}

export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    await use(page);

    if (testInfo.status === testInfo.expectedStatus) return;

    try {
      const html = await page.content();
      const htmlPath = path.join(testInfo.outputDir, "page.html");
      fs.writeFileSync(htmlPath, html, "utf8");
      await testInfo.attach("page-html", {
        path: htmlPath,
        contentType: "text/html",
      });

      const css = await capturePageStyles(page);
      if (css) {
        const cssPath = path.join(testInfo.outputDir, "page.css");
        fs.writeFileSync(cssPath, css, "utf8");
        await testInfo.attach("page-css", {
          path: cssPath,
          contentType: "text/css",
        });
      }
    } catch {
      // Page may already be closed on hard crashes.
    }
  },
});

export { expect };
