

import type {Core, Summary} from "../src/interface.ts";

export class FakeSummary implements Summary {
  private summaryBuffer = "";
  private storedSummary = "";

  public addHeading(text: string, level: number): Summary {
    this.summaryBuffer += `<h${level}>${text}</h${level}>`

    return this;
  }

  public addList(items: string[]): Summary {
    this.summaryBuffer += "<ul>"

    for (const item of items) {
      this.summaryBuffer += `<li>${item}</li>`;
    }

    this.summaryBuffer += "</ul>"

    return this;
  }

  public async write(): Promise<void> {
    this.storedSummary = this.summaryBuffer;
  }

  public stringify(): string {
    return this.storedSummary;
  }
}

export class FakeCore implements Core {
  public readonly summary: Summary;

  constructor() {
    this.summary = new FakeSummary();
  }
}
