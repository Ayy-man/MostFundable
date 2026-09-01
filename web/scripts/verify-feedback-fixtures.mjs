import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const projectRoot = process.cwd();

function loadTypeScriptModule(filePath, requireMap = {}) {
  const source = fs.readFileSync(filePath, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filePath,
  }).outputText;
  const moduleRecord = { exports: {} };
  const localRequire = (specifier) => {
    if (specifier in requireMap) return requireMap[specifier];
    throw new Error(`Unexpected runtime import in ${filePath}: ${specifier}`);
  };
  const evaluate = new Function(
    "exports",
    "require",
    "module",
    "__filename",
    "__dirname",
    output,
  );
  evaluate(
    moduleRecord.exports,
    localRequire,
    moduleRecord,
    filePath,
    path.dirname(filePath),
  );
  return moduleRecord.exports;
}

const typesPath = path.join(projectRoot, "src/lib/demo/types.ts");
const fixturesPath = path.join(
  projectRoot,
  "src/lib/demo/feedback-fixtures.ts",
);
const types = loadTypeScriptModule(typesPath);
const fixtures = loadTypeScriptModule(fixturesPath, {
  "@/lib/demo/types": types,
});

const sum = (values) => values.reduce((total, value) => total + value, 0);
const roundTwo = (value) =>
  Math.round((value + Number.EPSILON) * 100) / 100;
const average = (values) =>
  values.length ? roundTwo(sum(values) / values.length) : 0;
const toTime = (date) => Date.parse(`${date}T00:00:00Z`);
const assertMaxTwoDecimals = (value, path = "metrics") => {
  if (typeof value === "number") {
    assert.equal(
      roundTwo(value),
      value,
      `${path} exceeds 2 decimal places: ${value}`,
    );
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertMaxTwoDecimals(entry, `${path}[${index}]`),
    );
    return;
  }
  if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, entry]) =>
      assertMaxTwoDecimals(entry, `${path}.${key}`),
    );
  }
};
const approvedFunding = fixtures.INITIAL_APPLICATION_RECORDS.filter(
  (application) =>
    application.outcome === "approved" &&
    application.approvedAmount !== null,
);
const fundedForOperator = (operatorId) =>
  sum(
    fixtures.BANK_OUTCOME_BATCHES.filter(
      (batch) =>
        batch.operatorId === operatorId &&
        batch.recordedAt.startsWith(fixtures.DEMO_TODAY.slice(0, 4)),
    ).map((batch) => batch.fundedAmount),
  ) +
  sum(
    approvedFunding
      .filter((application) => application.operatorId === operatorId)
      .map((application) => application.approvedAmount),
  );
const fundedAllTimeForOperator = (operatorId) =>
  sum(
    fixtures.BANK_OUTCOME_BATCHES.filter(
      (batch) => batch.operatorId === operatorId,
    ).map((batch) => batch.fundedAmount),
  ) +
  sum(
    approvedFunding
      .filter((application) => application.operatorId === operatorId)
      .map((application) => application.approvedAmount),
  );
const cashAllTimeForOperator = (operatorId) => {
  const clientIds = new Set(
    fixtures.DEMO_CLIENTS.filter(
      (client) => client.operatorId === operatorId,
    ).map((client) => client.clientId),
  );
  return sum(
    fixtures.CLIENT_FEE_RECORDS.filter((record) =>
      clientIds.has(record.clientId),
    ).map((record) => record.paid),
  );
};

const expectedAdmin = {
  operators: fixtures.OPERATOR_FIXTURES.length,
  consumers: sum(
    fixtures.OPERATOR_FIXTURES.map((operator) => operator.clientCount),
  ),
  operatorsActivePlan: fixtures.OPERATOR_FIXTURES.filter(
    (operator) => operator.membership === "current",
  ).length,
  consumersActivePlan: fixtures.CLIENT_PLATFORM_PLAN_RECORDS.filter(
    (record) => record.status === "active",
  ).length,
  fundedAllTime: sum(
    fixtures.OPERATOR_FIXTURES.map((operator) =>
      fundedAllTimeForOperator(operator.id),
    ),
  ),
  fundedYtd: sum(
    fixtures.OPERATOR_FIXTURES.map((operator) =>
      fundedForOperator(operator.id),
    ),
  ),
  cashAllTime: sum(
    fixtures.OPERATOR_FIXTURES.map((operator) =>
      cashAllTimeForOperator(operator.id),
    ),
  ),
  analysisCreditsUsed: sum(
    fixtures.ANALYSIS_USAGE.map((entry) => entry.count),
  ),
  analyses: sum(fixtures.ANALYSIS_USAGE.map((entry) => entry.count)),
};
assert.deepEqual(
  fixtures.deriveAdminOverview(),
  expectedAdmin,
  "Admin Overview does not reconcile",
);
assert.equal(
  expectedAdmin.operatorsActivePlan,
  2,
  "Admin active-plan operators must count current memberships only",
);
assert.equal(
  expectedAdmin.consumersActivePlan,
  7,
  "Admin active-plan consumers must count active consumer subscriptions",
);
assert.equal(
  expectedAdmin.cashAllTime,
  sum(fixtures.CLIENT_FEE_RECORDS.map((record) => record.paid)),
  "Every recorded cash outcome must belong to an operator fixture",
);
assert.deepEqual(
  fixtures.OPERATOR_FIXTURES.map((operator) => ({
    cashAllTime: fixtures.deriveOperatorCashCollectedAllTime(operator.id),
    creditsUsed: fixtures.deriveAnalysisCreditsUsed(operator.id),
    operatorId: operator.id,
  })),
  fixtures.OPERATOR_FIXTURES.map((operator) => ({
    cashAllTime: cashAllTimeForOperator(operator.id),
    creditsUsed:
      fixtures.ANALYSIS_USAGE.find(
        (entry) => entry.operatorId === operator.id,
      )?.count ?? 0,
    operatorId: operator.id,
  })),
  "Per-operator cash outcomes and AI credits must reconcile",
);

const expectedOperatorAverageFunding = fixtures.OPERATOR_FIXTURES.map(
  (operator) => {
    const batches = fixtures.BANK_OUTCOME_BATCHES.filter(
      (batch) => batch.operatorId === operator.id,
    );
    const approvedApplications = approvedFunding.filter(
      (application) => application.operatorId === operator.id,
    );
    const fundedCount =
      sum(batches.map((batch) => batch.fundedCount)) +
      approvedApplications.length;
    const fundedAmount =
      sum(batches.map((batch) => batch.fundedAmount)) +
      sum(
        approvedApplications.map(
          (application) => application.approvedAmount,
        ),
      );

    return {
      averageFundedOutcome: fundedCount
        ? roundTwo(fundedAmount / fundedCount)
        : 0,
      operatorId: operator.id,
    };
  },
);
assert.deepEqual(
  fixtures.OPERATOR_FIXTURES.map((operator) => ({
    averageFundedOutcome: fixtures.deriveOperatorAverageFundedOutcome(
      operator.id,
    ),
    operatorId: operator.id,
  })),
  expectedOperatorAverageFunding,
  "Operator average funding must use recorded funded outcome count",
);
assert.deepEqual(
  fixtures.OPERATOR_FIXTURES.map((operator) => ({
    fundingReadyDays: fixtures.deriveOperatorFundingReadyDays(operator.id),
    operatorId: operator.id,
  })),
  fixtures.OPERATOR_BOOK_RECORDS.map((record) => ({
    fundingReadyDays: record.fundingReadyDays,
    operatorId: record.operatorId,
  })),
  "Operator funding-ready times must come from book records",
);

const platformMrr = sum(
  fixtures.OPERATOR_FIXTURES.map(
    (operator) => operator.platformFee + operator.additionalFees,
  ),
);
const monitoringRevenue = sum(
  fixtures.OPERATOR_FIXTURES.map(
    (operator) => operator.monitoringMembers * operator.monitoringPrice,
  ),
);
const monitoringCost = sum(
  fixtures.OPERATOR_FIXTURES.map(
    (operator) =>
      operator.monitoringMembers * operator.crsCostPerMonitoringMember,
  ),
);
const operatorMonitoringSplit = sum(
  fixtures.OPERATOR_FIXTURES.map(
    (operator) =>
      operator.monitoringMembers *
      operator.monitoringPrice *
      operator.monitoringSplitRate,
  ),
);
const expectedSaas = {
  monthlyRecurringTotal: roundTwo(platformMrr + monitoringRevenue),
  platformMrr,
  monitoringProfit: roundTwo(
    monitoringRevenue - monitoringCost - operatorMonitoringSplit,
  ),
  referralSplit: roundTwo(
    sum(fixtures.OPERATOR_FIXTURES.map((operator) => operator.referralSplit)),
  ),
  monitoringRevenue,
  monitoringCost,
  operatorMonitoringSplit: roundTwo(operatorMonitoringSplit),
};
assert.deepEqual(
  fixtures.deriveSaasMetrics(),
  expectedSaas,
  "SaaS metrics do not reconcile",
);

const activeOperators = fixtures.OPERATOR_FIXTURES.filter(
  (operator) => operator.membership !== "deactivated",
);
const membershipDays = fixtures.MEMBERSHIP_PERIODS.map((period) =>
  Math.max(
    1,
    Math.round(
      (toTime(period.endedAt ?? fixtures.DEMO_TODAY) -
        toTime(period.startedAt)) /
        86400000,
    ),
  ),
);
const expectedAnalytics = {
  activeUsers: sum(
    fixtures.USER_ACTIVITY_SEGMENTS.map((segment) => segment.activeUsers),
  ),
  operators: fixtures.OPERATOR_FIXTURES.length,
  currentMonitoring: sum(
    fixtures.OPERATOR_FIXTURES.map((operator) => operator.monitoringMembers),
  ),
  trialConversion: roundTwo(
    (fixtures.TRIAL_RECORDS.filter(Boolean).length /
      fixtures.TRIAL_RECORDS.length) *
      100,
  ),
  averageMonthlyPlan: roundTwo(platformMrr / activeOperators.length),
  averageMembershipDays: average(membershipDays),
};
assert.deepEqual(
  fixtures.deriveAnalyticsMetrics(),
  expectedAnalytics,
  "Analytics metrics do not reconcile",
);

const previousMonth = new Date(`${fixtures.DEMO_TODAY}T00:00:00Z`);
previousMonth.setUTCMonth(previousMonth.getUTCMonth() - 1);
const previousMonthKey = previousMonth.toISOString().slice(0, 7);
const twelveMonthCutoff =
  toTime(fixtures.DEMO_TODAY) - (365 - 1) * 86400000;
const fundedByMonth = new Map();
for (const batch of fixtures.BANK_OUTCOME_BATCHES) {
  const month = batch.recordedAt.slice(0, 7);
  fundedByMonth.set(month, (fundedByMonth.get(month) ?? 0) + batch.fundedAmount);
}
for (const application of approvedFunding) {
  if (!application.outcomeRecordedAt) continue;
  const month = application.outcomeRecordedAt.slice(0, 7);
  fundedByMonth.set(
    month,
    (fundedByMonth.get(month) ?? 0) + application.approvedAmount,
  );
}
const bookBankTotals = fixtures.BANK_FIXTURES.map((bank) => ({
  bankId: bank.id,
  bankName: bank.name,
  fundedAmount:
    sum(
      fixtures.BANK_OUTCOME_BATCHES.filter(
        (batch) =>
          batch.bankId === bank.id &&
          toTime(batch.recordedAt) >= twelveMonthCutoff,
      ).map((batch) => batch.fundedAmount),
    ) +
    sum(
      approvedFunding
        .filter(
          (application) =>
            application.bankId === bank.id &&
            application.outcomeRecordedAt !== null &&
            toTime(application.outcomeRecordedAt) >= twelveMonthCutoff,
        )
        .map((application) => application.approvedAmount),
    ),
}));
const expectedAdminBookStats = {
  clientGrowthThisQuarter: sum(
    fixtures.OPERATOR_BOOK_RECORDS.map(
      (record) => record.clientsAddedThisQuarter,
    ),
  ),
  averageFundingReadyDays: average(
    fixtures.OPERATOR_BOOK_RECORDS.map((record) => record.fundingReadyDays),
  ),
  averageFundingPerConsumer: expectedAdmin.consumers
    ? roundTwo(expectedAdmin.fundedAllTime / expectedAdmin.consumers)
    : 0,
  biggestOptimizationBottleneck: [...fixtures.OPTIMIZATION_TASK_DURATIONS].sort(
    (left, right) => right.averageOpenDays - left.averageOpenDays,
  )[0],
  topBanks: bookBankTotals
    .sort(
      (left, right) =>
        right.fundedAmount - left.fundedAmount ||
        left.bankName.localeCompare(right.bankName),
    )
    .slice(0, 5),
  fundingThisYear: expectedAdmin.fundedYtd,
  previousMonthFunded: fundedByMonth.get(previousMonthKey) ?? 0,
};
assert.deepEqual(
  fixtures.deriveAdminBookStats(),
  expectedAdminBookStats,
  "Analytics Book stats do not reconcile",
);

const operator = fixtures.OPERATOR_FIXTURES.find(
  (entry) => entry.id === "op-apex",
);
assert.deepEqual(
  fixtures.OPERATOR_PIPELINE.map(({ stage }) => stage),
  types.FUNDING_STAGES,
  "Operator pipeline must use the canonical stage taxonomy",
);
assert.equal(
  sum(fixtures.OPERATOR_PIPELINE.map(({ count }) => count)),
  operator.clientCount,
  "Operator pipeline total must reconcile to the operator client count",
);
const graduateIndex = types.FUNDING_STAGES.indexOf("Graduate");
assert.ok(
  graduateIndex > 0,
  "Canonical stage taxonomy must place Graduate after the active stages",
);
const activeClientStages = types.FUNDING_STAGES.slice(0, graduateIndex);
const expectedActiveClients = sum(
  fixtures.OPERATOR_PIPELINE.filter(({ stage }) =>
    activeClientStages.includes(stage),
  ).map(({ count }) => count),
);
assert.equal(
  expectedActiveClients,
  196,
  "Active clients must include every canonical stage except Graduate",
);
const recentPerformance = fixtures.TEAM_PERFORMANCE_RECORDS.filter(
  (record) =>
    toTime(record.completedAt) >=
    toTime(fixtures.DEMO_TODAY) - 89 * 86400000,
);
const expectedOperatorHome = {
  activeClients: expectedActiveClients,
  fundedAllTime: fundedAllTimeForOperator("op-apex"),
  fundedYtd: fundedForOperator("op-apex"),
  graduatedClients:
    fixtures.OPERATOR_PIPELINE.find(({ stage }) => stage === "Graduate")
      ?.count ?? 0,
  feesCollected: cashAllTimeForOperator("op-apex"),
  analyses:
    fixtures.ANALYSIS_USAGE.find((entry) => entry.operatorId === "op-apex")
      .count,
  averageOptimizationDays: average(
    recentPerformance.map((record) => record.optimizationDays),
  ),
  averageFundingPerGraduatedClient: average(
    recentPerformance
      .map((record) => record.fundingAmount)
      .filter((amount) => amount > 0),
  ),
};
assert.deepEqual(
  fixtures.deriveOperatorHomeMetrics(),
  expectedOperatorHome,
  "Operator Home metrics do not reconcile",
);

const expectedTeamPerformance = fixtures.TEAM_MEMBERS.map((member) => {
  const records = fixtures.TEAM_PERFORMANCE_RECORDS.filter(
    (record) => record.memberId === member.id,
  );
  const graduationDays = records
    .map((record) => record.graduationDays)
    .filter((days) => days !== null);
  return {
    memberId: member.id,
    memberName: member.name,
    averageOptimizationDays: average(
      records.map((record) => record.optimizationDays),
    ),
    averageFundingPerClient: average(
      records.map((record) => record.fundingAmount),
    ),
    averageGraduationDays: average(graduationDays),
    totalClientRevenue: sum(
      records.map((record) => record.clientRevenue),
    ),
  };
});
assert.deepEqual(
  fixtures.deriveTeamPerformance(),
  expectedTeamPerformance,
  "Team performance metrics do not reconcile",
);

assertMaxTwoDecimals({
  adminBookStats: expectedAdminBookStats,
  adminOverview: expectedAdmin,
  analytics: expectedAnalytics,
  operatorHome: expectedOperatorHome,
  operatorAverageFunding: expectedOperatorAverageFunding,
  saas: expectedSaas,
  teamPerformance: expectedTeamPerformance,
});

console.log(
  JSON.stringify(
    {
      adminBookStats: expectedAdminBookStats,
      adminOverview: expectedAdmin,
      analytics: expectedAnalytics,
      operatorHome: expectedOperatorHome,
      operatorAverageFunding: expectedOperatorAverageFunding,
      saas: expectedSaas,
      teamPerformance: expectedTeamPerformance,
    },
    null,
    2,
  ),
);
console.log("Fixture reconciliation passed.");
