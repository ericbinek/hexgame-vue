export type RenderSection = 'terrain' | 'objects' | 'overlay' | 'total';

export interface RenderSectionStats {
  count: number;
  lastMs: number;
  avgMs: number;
  maxMs: number;
}

export type RenderProfileSummary = Record<RenderSection, RenderSectionStats>;

const SECTIONS: RenderSection[] = ['terrain', 'objects', 'overlay', 'total'];

function emptyStats(): RenderSectionStats {
  return { count: 0, lastMs: 0, avgMs: 0, maxMs: 0 };
}

function nowMs(): number {
  return performance.now();
}

export class RenderProfiler {
  enabled: boolean;
  private readonly stats = new Map<RenderSection, RenderSectionStats>();

  constructor(enabled = false, private readonly now: () => number = nowMs) {
    this.enabled = enabled;
    this.reset();
  }

  reset(): void {
    this.stats.clear();
    for (const section of SECTIONS) this.stats.set(section, emptyStats());
  }

  measure<T>(section: RenderSection, fn: () => T): T {
    if (!this.enabled) return fn();
    const start = this.now();
    try {
      return fn();
    } finally {
      this.record(section, this.now() - start);
    }
  }

  summary(): RenderProfileSummary {
    return Object.fromEntries(SECTIONS.map((section) => [section, { ...this.stats.get(section)! }])) as RenderProfileSummary;
  }

  private record(section: RenderSection, ms: number): void {
    const prev = this.stats.get(section) ?? emptyStats();
    const count = prev.count + 1;
    this.stats.set(section, {
      count,
      lastMs: ms,
      avgMs: prev.avgMs + (ms - prev.avgMs) / count,
      maxMs: Math.max(prev.maxMs, ms),
    });
  }
}
