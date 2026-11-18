// A report may arrive after a round has ended. Merge only report metadata;
// callers first establish that the saved answer evidence is identical.
export function mergeRoundReport(base, other) {
  if (!base.finishedAt || !other.finishedAt) return base;
  const key = (report, round) => `${report.generatedAt || report.updatedAt || round.finishedAt}\0${JSON.stringify(report)}`;
  let report=base.report;
  if (other.report && (!report || key(other.report,other)>key(report,base))) report=other.report;
  if (!report || report===base.report && !base.reportError) return base;
  const result={...base,report};delete result.reportError;return result;
}
