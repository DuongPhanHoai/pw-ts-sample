export type QuoteChar = '"' | "'" | "`";

const ACTION_ARG =
  /\.(?:click|fill|locator|dblclick|press)\(\s*(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/;

/** Selector contains a double-quoted attribute value, e.g. [data-test="checkout"]. */
export function selectorHasInnerDoubleQuotes(selector: string): boolean {
  return /\[\w[\w-]*="[^"]*"\]/.test(selector) || /="[^"]*"/.test(selector);
}

export function selectorHasSingleQuote(selector: string): boolean {
  return selector.includes("'");
}

/**
 * Infer dominant quote style from nearby page-object lines (click/fill/locator calls).
 */
export function inferQuoteStyleFromSource(source: string, aroundLine?: number): QuoteChar {
  const lines = source.split(/\r?\n/);
  const start = aroundLine ? Math.max(0, aroundLine - 6) : 0;
  const end = aroundLine ? Math.min(lines.length, aroundLine + 4) : lines.length;
  const text = lines.slice(start, end).join("\n");

  let single = 0;
  let double = 0;
  for (const _ of text.matchAll(/\.(?:click|fill|locator)\(\s*'/g)) single += 1;
  for (const _ of text.matchAll(/\.(?:click|fill|locator)\(\s*"/g)) double += 1;

  if (single > double) return "'";
  if (double > single) return '"';
  return "'";
}

/**
 * Choose wrapping quotes so the selector literal is valid TypeScript.
 * Prefers matching nearby source style when the selector has no inner conflict.
 */
export function pickQuoteForSelector(
  selector: string,
  contextSource?: string,
  contextLine?: number,
): QuoteChar {
  if (selectorHasInnerDoubleQuotes(selector)) return "'";
  if (selectorHasSingleQuote(selector)) return '"';

  if (contextSource && contextLine) {
    const line = contextSource.split(/\r?\n/)[contextLine - 1] ?? "";
    const onLine = line.match(/\.(?:click|fill|locator)\(\s*(["'`])/);
    if (onLine?.[1]) return onLine[1] as QuoteChar;
    return inferQuoteStyleFromSource(contextSource, contextLine);
  }

  return '"';
}

export function wrapSelectorLiteral(selector: string, quote?: QuoteChar): string {
  const q = quote ?? pickQuoteForSelector(selector);
  if (q === "'") return `'${selector.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
  if (q === "`") return `\`${selector.replace(/\\/g, "\\\\").replace(/`/g, "\\`")}\``;
  return `"${selector.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function formatClickSnippet(
  selector: string,
  contextSource?: string,
  contextLine?: number,
): string {
  const quote = pickQuoteForSelector(selector, contextSource, contextLine);
  return `await this.page.click(${wrapSelectorLiteral(selector, quote)});`;
}

/** Parse broken apply output like click("[data-test="checkout"]"). */
export function extractMalformedBracketSelector(line: string): string | undefined {
  const match = line.match(/"\[([\w-]+=)"([^"]+)"\]/);
  if (!match) return undefined;
  return `[${match[1]}"${match[2]}"]`;
}

export function extractSelectorFromActionLine(
  line: string,
): { selector: string; quote: QuoteChar; prefix: string; suffix: string } | undefined {
  const match = line.match(ACTION_ARG);
  if (match?.[1] && match[2] !== undefined) {
    return {
      quote: match[1] as QuoteChar,
      selector: match[2].replace(/\\(.)/g, "$1"),
      prefix: match[0].slice(0, match[0].length - match[2].length - 2),
      suffix: "",
    };
  }

  const malformed = extractMalformedBracketSelector(line);
  if (malformed) {
    return { quote: '"', selector: malformed, prefix: "", suffix: "" };
  }

  return undefined;
}

export function lineHasMalformedSelectorQuotes(line: string): boolean {
  return /"\[[\w-]+="[^"]+"[^"]*"\]/.test(line) || /"\[data-test="/.test(line);
}

/** Replace the selector argument on one action line; picks valid quotes for newSelector. */
export function replaceSelectorOnLine(
  line: string,
  newSelector: string,
  contextSource?: string,
  contextLine?: number,
): string | null {
  if (lineHasMalformedSelectorQuotes(line)) {
    const malformed = line.match(
      /^(\s*.*?\.(?:click|fill|locator|dblclick|press)\(\s*)"\[[\w-]+="[^"]+"[^"]*"\]\s*(\).*?)$/,
    );
    if (malformed) {
      const quote = pickQuoteForSelector(newSelector, contextSource ?? line, contextLine);
      return `${malformed[1]}${wrapSelectorLiteral(newSelector, quote)}${malformed[2]}`;
    }
  }

  const match = line.match(
    /(^\s*.*?\.(?:click|fill|locator|dblclick|press)\(\s*)(["'`])((?:\\.|(?!\2)[\s\S])*?)\2(.*)$/,
  );
  if (!match) return null;

  const [, head, , oldSel, tail] = match;
  const unescapedOld = oldSel.replace(/\\(.)/g, "$1");
  if (unescapedOld === newSelector && !lineHasMalformedSelectorQuotes(line)) return null;

  const quote = pickQuoteForSelector(newSelector, contextSource ?? line, contextLine);
  const wrapped = wrapSelectorLiteral(newSelector, quote);
  return `${head}${wrapped}${tail}`;
}

export function replaceSelectorInSource(
  content: string,
  oldSelector: string,
  newSelector: string,
  failureLine?: number,
): string | null {
  if (!oldSelector || !newSelector) return null;
  if (oldSelector === newSelector && !lineHasMalformedSelectorQuotes(content)) return null;

  if (failureLine !== undefined && failureLine > 0) {
    const lines = content.split(/\r?\n/);
    const idx = failureLine - 1;
    if (idx >= 0 && idx < lines.length) {
      const updatedLine = replaceSelectorOnLine(
        lines[idx],
        newSelector,
        content,
        failureLine,
      );
      if (updatedLine && updatedLine !== lines[idx]) {
        lines[idx] = updatedLine;
        return lines.join("\n");
      }
    }
  }

  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (
      !lines[i].includes(oldSelector) &&
      !lineHasMalformedSelectorQuotes(lines[i])
    ) {
      continue;
    }
    const updatedLine = replaceSelectorOnLine(lines[i], newSelector, content, i + 1);
    if (updatedLine && updatedLine !== lines[i]) {
      lines[i] = updatedLine;
      return lines.join("\n");
    }
  }

  for (const quote of ['"', "'", "`"] as const) {
    const from = `${quote}${oldSelector}${quote}`;
    if (!content.includes(from)) continue;
    const wrapped = wrapSelectorLiteral(
      newSelector,
      pickQuoteForSelector(newSelector, content),
    );
    return content.replace(from, wrapped);
  }

  return null;
}

export const SELECTOR_QUOTE_RULES = `Selector string quoting (TypeScript):
- If the selector contains double quotes inside (e.g. [data-test="checkout"]), wrap the FULL selector in SINGLE quotes: click('[data-test="checkout"]').
- If the selector contains single quotes, wrap in double quotes or escape.
- NEVER emit broken nested quotes like click("[data-test="checkout"]").
- Read errorContextMd test source: match quote style of neighboring click/fill/locator lines when both forms are valid.
- suggestedSelectorOrChange must be syntactically valid TypeScript as it appears in the page object file.`;
