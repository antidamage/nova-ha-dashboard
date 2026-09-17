"use client";

import { AuthorityLists } from "./AuthorityLists";
import { BriefingsAndSubscriptions } from "./BriefingsAndSubscriptions";
import { ConversationalMemory } from "./ConversationalMemory";
import { HouseholdIdentities } from "./HouseholdIdentities";
import { ProactiveAutomations } from "./ProactiveAutomations";
import { ResearchJobs } from "./ResearchJobs";
import { StandingGrantForm } from "./StandingGrantForm";
import { useAgentAdministration } from "./useAgentAdministration";

export function AgentAdministration() {
  const {
    error, refresh, busy, profiles, roles, run, capability, createGrant, currency, endTime,
    expiresAt, granteeId, locations, maxAmount, maxUses, notifyOnUse, recipients, setCapability,
    setCurrency, setEndTime, setExpiresAt, setGranteeId, setLocations, setMaxAmount, setMaxUses,
    setNotifyOnUse, setRecipients, setStartTime, setTargets, startTime, targets, activeGoals,
    administration, research, briefingSchedules, briefings, subscriptions, memories,
    automationChannel, automationEventKind, automationId, automationMessage, automationOwnerId,
    automationSummary, automations, createAutomation, interventions, setAutomationChannel,
    setAutomationEventKind, setAutomationId, setAutomationMessage, setAutomationOwnerId,
    setAutomationSummary,
  } = useAgentAdministration();

  return (
    <section className="rounded-3xl border border-white/10 bg-neutral-950/60 p-5 text-neutral-100">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Voice agent authority</h2>
          <p className="text-sm text-neutral-400">Roles, standing grants, durable work, and audit replay.</p>
        </div>
        <button className="rounded-xl border border-white/15 px-3 py-2 text-sm" onClick={() => void refresh()}>
          Refresh
        </button>
      </div>
      {error ? <p role="alert" className="mt-3 text-sm text-red-300">{error}</p> : null}

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <HouseholdIdentities
          busy={busy} profiles={profiles} roles={roles} run={run}
        />

        <StandingGrantForm
          busy={busy} capability={capability} createGrant={createGrant} currency={currency}
          endTime={endTime} expiresAt={expiresAt} granteeId={granteeId} locations={locations}
          maxAmount={maxAmount} maxUses={maxUses} notifyOnUse={notifyOnUse} profiles={profiles}
          recipients={recipients} run={run} setCapability={setCapability} setCurrency={setCurrency}
          setEndTime={setEndTime} setExpiresAt={setExpiresAt} setGranteeId={setGranteeId}
          setLocations={setLocations} setMaxAmount={setMaxAmount} setMaxUses={setMaxUses}
          setNotifyOnUse={setNotifyOnUse} setRecipients={setRecipients} setStartTime={setStartTime}
          setTargets={setTargets} startTime={startTime} targets={targets}
        />
      </div>

      <AuthorityLists
        activeGoals={activeGoals} administration={administration} busy={busy} run={run}
      />

      <ResearchJobs
        research={research}
      />

      <BriefingsAndSubscriptions
        briefingSchedules={briefingSchedules} briefings={briefings} subscriptions={subscriptions}
      />

      <ConversationalMemory
        busy={busy} memories={memories} run={run}
      />

      <ProactiveAutomations
        administration={administration} automationChannel={automationChannel}
        automationEventKind={automationEventKind} automationId={automationId}
        automationMessage={automationMessage} automationOwnerId={automationOwnerId}
        automationSummary={automationSummary} automations={automations} busy={busy}
        createAutomation={createAutomation} interventions={interventions} run={run}
        setAutomationChannel={setAutomationChannel} setAutomationEventKind={setAutomationEventKind}
        setAutomationId={setAutomationId} setAutomationMessage={setAutomationMessage}
        setAutomationOwnerId={setAutomationOwnerId} setAutomationSummary={setAutomationSummary}
      />
    </section>
  );
}
