import {
  LocalizationSessionResult,
  ProbeLocation,
  RankedSuspect,
  SbflFormula,
  TestTrace,
} from './types';

function computeFormulas(
  ef: number,
  ep: number,
  totalFailed: number,
  totalPassed: number
): { tarantula: number; ochiai: number; dstar: number } {
  const fRatio = totalFailed > 0 ? ef / totalFailed : 0;
  const pRatio = totalPassed > 0 ? ep / totalPassed : 0;
  const denomT = fRatio + pRatio;
  const tarantula = denomT > 0 ? fRatio / denomT : 0;

  const denomO = Math.sqrt(totalFailed * (ef + ep));
  const ochiai = denomO > 0 ? ef / denomO : 0;

  const denomD = ep + (totalFailed - ef);
  const dstar = denomD > 0 ? (ef * ef) / denomD : 0;

  return { tarantula, ochiai, dstar };
}

export function rankSuspiciousness(
  targetFile: string,
  traces: TestTrace[],
  condProbes: ProbeLocation[],
  stmtProbes: ProbeLocation[]
): LocalizationSessionResult {
  const totalTests = traces.length;
  const failedTraces = traces.filter((t) => !t.passed);
  const passedTraces = traces.filter((t) => t.passed);
  const totalFailed = failedTraces.length;
  const totalPassed = passedTraces.length;

  const condCount = condProbes.length;
  const stmtCount = stmtProbes.length;

  const condEf = new Float64Array(condCount + 1);
  const condEp = new Float64Array(condCount + 1);
  const stmtEf = new Float64Array(stmtCount + 1);
  const stmtEp = new Float64Array(stmtCount + 1);

  // Track decision-group execution per test to compute decision-level Basic SBFL baseline
  const groupToCondIds = new Map<number, number[]>();
  for (const cp of condProbes) {
    if (cp.decisionGroupId !== undefined) {
      const list = groupToCondIds.get(cp.decisionGroupId) ?? [];
      list.push(cp.id);
      groupToCondIds.set(cp.decisionGroupId, list);
    }
  }

  const groupEf = new Map<number, number>();
  const groupEp = new Map<number, number>();

  for (const t of traces) {
    const uniqueConds = new Set(t.evalCondIds.filter((id) => id >= 1 && id <= condCount));
    const uniqueStmts = new Set(t.evalStmtIds.filter((id) => id >= 1 && id <= stmtCount));
    const hitGroups = new Set<number>();

    for (const cid of uniqueConds) {
      if (t.passed) {
        condEp[cid]++;
      } else {
        condEf[cid]++;
      }
      const gid = condProbes[cid - 1]?.decisionGroupId;
      if (gid !== undefined) {
        hitGroups.add(gid);
      }
    }

    for (const gid of hitGroups) {
      if (t.passed) {
        groupEp.set(gid, (groupEp.get(gid) ?? 0) + 1);
      } else {
        groupEf.set(gid, (groupEf.get(gid) ?? 0) + 1);
      }
    }

    for (const sid of uniqueStmts) {
      if (t.passed) {
        stmtEp[sid]++;
      } else {
        stmtEf[sid]++;
      }
    }
  }

  interface RawEntry {
    probe: ProbeLocation;
    ef: number;
    ep: number;
    tarantula: number;
    ochiai: number;
    dstar: number;
    basicTarantula: number;
    basicOchiai: number;
    basicDStar: number;
    groupSize: number;
  }

  const entries: RawEntry[] = [];

  for (const cp of condProbes) {
    const ef = condEf[cp.id];
    const ep = condEp[cp.id];
    const scores = computeFormulas(ef, ep, totalFailed, totalPassed);

    const gid = cp.decisionGroupId ?? -1;
    const gSize = groupToCondIds.get(gid)?.length ?? 1;
    const bScores = computeFormulas(
      groupEf.get(gid) ?? ef,
      groupEp.get(gid) ?? ep,
      totalFailed,
      totalPassed
    );

    entries.push({
      probe: cp,
      ef,
      ep,
      ...scores,
      basicTarantula: bScores.tarantula,
      basicOchiai: bScores.ochiai,
      basicDStar: bScores.dstar,
      groupSize: gSize,
    });
  }

  for (const sp of stmtProbes) {
    const ef = stmtEf[sp.id];
    const ep = stmtEp[sp.id];
    const scores = computeFormulas(ef, ep, totalFailed, totalPassed);
    entries.push({
      probe: sp,
      ef,
      ep,
      ...scores,
      basicTarantula: scores.tarantula,
      basicOchiai: scores.ochiai,
      basicDStar: scores.dstar,
      groupSize: 1,
    });
  }

  const totalProgramProbes = Math.max(1, entries.length);
  const eps = 1e-12;

  const computeExpectedRank = (score: number, getter: (e: RawEntry) => number): number => {
    let strictlyAbove = 0;
    let tied = 0;
    for (const e of entries) {
      const s = getter(e);
      if (s > score + eps) {
        strictlyAbove++;
      } else if (Math.abs(s - score) <= eps) {
        tied++;
      }
    }
    return strictlyAbove + (tied + 1) / 2;
  };

  const suspects: RankedSuspect[] = entries
    .filter((e) => e.ef > 0)
    .map((e) => {
      const rankT = computeExpectedRank(e.tarantula, (x) => x.tarantula);
      const rankO = computeExpectedRank(e.ochiai, (x) => x.ochiai);
      const rankD = computeExpectedRank(e.dstar, (x) => x.dstar);

      // Decision-level expected rank when all sub-conditions in the branch tie
      let kAboveBasicT = 0;
      let kAboveBasicO = 0;
      let kAboveBasicD = 0;
      for (const other of entries) {
        if (other.tarantula > e.basicTarantula + eps) kAboveBasicT++;
        if (other.ochiai > e.basicOchiai + eps) kAboveBasicO++;
        if (other.dstar > e.basicDStar + eps) kAboveBasicD++;
      }
      const basicRankT = kAboveBasicT + (e.groupSize + 1) / 2;
      const basicRankO = kAboveBasicO + (e.groupSize + 1) / 2;
      const basicRankD = kAboveBasicD + (e.groupSize + 1) / 2;

      return {
        probe: e.probe,
        ef: e.ef,
        ep: e.ep,
        tarantula: Number(e.tarantula.toFixed(4)),
        ochiai: Number(e.ochiai.toFixed(4)),
        dstar: Number(e.dstar.toFixed(4)),
        basicTarantula: Number(e.basicTarantula.toFixed(4)),
        basicOchiai: Number(e.basicOchiai.toFixed(4)),
        basicDStar: Number(e.basicDStar.toFixed(4)),
        rankTarantula: Number(rankT.toFixed(2)),
        rankOchiai: Number(rankO.toFixed(2)),
        rankDStar: Number(rankD.toFixed(2)),
        rankGainTarantula: Number((basicRankT - rankT).toFixed(2)),
        rankGainOchiai: Number((basicRankO - rankO).toFixed(2)),
        rankGainDStar: Number((basicRankD - rankD).toFixed(2)),
        examPercentTarantula: Number(((rankT / totalProgramProbes) * 100).toFixed(2)),
        examPercentOchiai: Number(((rankO / totalProgramProbes) * 100).toFixed(2)),
        examPercentDStar: Number(((rankD / totalProgramProbes) * 100).toFixed(2)),
      };
    });

  return {
    timestamp: new Date().toISOString(),
    targetFile,
    totalTests,
    passedTests: totalPassed,
    failedTests: totalFailed,
    totalCondProbes: condCount,
    totalStmtProbes: stmtCount,
    suspects,
  };
}

export function sortSuspectsByFormula(
  suspects: RankedSuspect[],
  formula: SbflFormula
): RankedSuspect[] {
  return [...suspects].sort((a, b) => {
    if (formula === 'Tarantula') {
      return b.tarantula - a.tarantula || a.rankTarantula - b.rankTarantula;
    }
    if (formula === 'DStar') {
      return b.dstar - a.dstar || a.rankDStar - b.rankDStar;
    }
    return b.ochiai - a.ochiai || a.rankOchiai - b.rankOchiai;
  });
}