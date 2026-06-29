import {
  formatTokenSummary,
  summarizeTokenRecords,
  type TokenCallRecord,
} from "./token-estimate";

export class TokenTracker {
  readonly calls: TokenCallRecord[] = [];

  record(call: TokenCallRecord): void {
    this.calls.push(call);
  }

  summary() {
    return summarizeTokenRecords(this.calls);
  }

  formatSummary(): string {
    return formatTokenSummary(this.summary());
  }

  toJson() {
    const summary = this.summary();
    return {
      generatedAt: new Date().toISOString(),
      summary,
      calls: this.calls,
    };
  }
}
