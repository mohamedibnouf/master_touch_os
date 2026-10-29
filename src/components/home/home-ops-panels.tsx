import { todayInRiyadh } from "@/lib/time/riyadh";
import { cache } from "react";
import Link from "next/link";
import {
  CalendarPlus,
  ClipboardCheck,
  FileText,
  FolderKanban,
  Gauge,
  Sparkles,
  Stamp,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/primitives";
import { CoreRepository } from "@/server/repositories/core.repository";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { hasPermission } from "@/server/policies/authorize";
import { logger } from "@/lib/logger";
import { commercialEntityHref } from "@/lib/commercial/entity-routes";
import { pendingActionHref } from "@/lib/work-item-href";
import { resolveNotificationHref } from "@/lib/notifications/href";
import { NotificationNavLink } from "@/components/notifications/notification-nav-link";
import { auditActionLabel, auditEntityLabel } from "@/lib/ui/audit-action-labels";
import type { AuthContext } from "@/types/models";
import { format, intlLocale, pickLocalized, type Locale } from "@/lib/i18n/config";
import { approvalTitleColumns, selectWithOptionalTitleEn } from "@/lib/approvals/title-en";
import { getI18n } from "@/lib/i18n/server";
import type { Dictionary } from "@/lib/i18n/dictionaries/ar";

type ProcAction = { id: string; label: string; href: string; status: string; overdue: boolean };

const loadHomeOps = cache(async (ctx: AuthContext) => {
  const { t, locale } = await getI18n();
  const o = t.home.ops;
  const supabase = await createServerSupabaseClient();
  const repo = new CoreRepository(supabase);
  const showOrgStats =
    hasPermission(ctx, "reports.management.read") || hasPermission(ctx, "employee.read");
  const canReadAudit = hasPermission(ctx, "audit.read");
  const dashboard = await repo.dashboard(ctx.organization.id, ctx.userId, {
    includeOrgStats: showOrgStats,
    includeAudit: canReadAudit,
  });

  const procActions: ProcAction[] = [];
  const today = todayInRiyadh();

  // Sequential on purpose: these are permission-gated authenticated RLS reads.
  // Running them all in one Promise.all previously contributed to 57014 contention.
  if (hasPermission(ctx, "purchase_request.approve")) {
    type PrRequestEmbed = { entity_type: string; entity_id: string; title: string | null; title_en?: string | null };
    const { data: prSteps } = await selectWithOptionalTitleEn((withTitleEn) =>
      supabase
        .from("approval_steps")
        .select(`id, due_at, approval_requests(${approvalTitleColumns("entity_type, entity_id, title", withTitleEn)})`)
        .eq("organization_id", ctx.organization.id)
        .eq("user_id", ctx.userId)
        .eq("status", "pending")
        .limit(20)
        .returns<Array<{ id: string; due_at: string | null; approval_requests: PrRequestEmbed | PrRequestEmbed[] | null }>>(),
    );
    for (const s of prSteps ?? []) {
      const req = Array.isArray(s.approval_requests) ? s.approval_requests[0] : s.approval_requests;
      if (!req) continue;
      const href = commercialEntityHref(req.entity_type, req.entity_id);
      if (href) {
        procActions.push({
          id: s.id,
          label: pickLocalized(locale, req.title, req.title_en) || req.entity_type,
          href,
          status: o.statusAwaitingMyDecision,
          overdue: Boolean(s.due_at && s.due_at < new Date().toISOString()),
        });
      }
    }
  }

  if (hasPermission(ctx, "rfq.issue")) {
    const { data: rfqsReady } = await supabase
      .from("rfqs")
      .select("id, rfq_number, title, response_due_date")
      .eq("organization_id", ctx.organization.id)
      .in("status", ["draft", "ready_to_issue"])
      .limit(5);
    for (const r of rfqsReady ?? []) {
      procActions.push({
        id: r.id,
        label: format(o.labelRfq, { number: r.rfq_number, title: r.title }),
        href: `/procurement/rfqs/${r.id}`,
        status: o.statusNeedsIssue,
        overdue: Boolean(r.response_due_date && r.response_due_date < today),
      });
    }
  }

  if (hasPermission(ctx, "quotation.compare")) {
    const { data: rfqsResp } = await supabase
      .from("rfqs")
      .select("id, rfq_number, title")
      .eq("organization_id", ctx.organization.id)
      .eq("status", "responses_received")
      .limit(5);
    for (const r of rfqsResp ?? []) {
      procActions.push({
        id: `cmp-${r.id}`,
        label: format(o.labelCompareQuotes, { number: r.rfq_number }),
        href: `/procurement/rfqs/${r.id}/comparison`,
        status: o.statusNeedsComparison,
        overdue: false,
      });
    }
  }

  if (hasPermission(ctx, "purchase_order.issue")) {
    const { data: posApproved } = await supabase
      .from("purchase_orders")
      .select("id, po_number")
      .eq("organization_id", ctx.organization.id)
      .eq("status", "approved")
      .limit(5);
    for (const p of posApproved ?? []) {
      procActions.push({
        id: p.id,
        label: format(o.labelPurchaseOrder, { number: p.po_number }),
        href: `/procurement/purchase-orders/${p.id}`,
        status: o.statusReadyToIssue,
        overdue: false,
      });
    }
  }

  if (hasPermission(ctx, "supplier_invoice.review")) {
    const { data: invReview } = await supabase
      .from("supplier_invoices")
      .select("id, invoice_number, due_date, status")
      .eq("organization_id", ctx.organization.id)
      .in("status", ["received", "under_review", "discrepancy"])
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(5);
    for (const i of invReview ?? []) {
      procActions.push({
        id: i.id,
        label: format(o.labelInvoice, { number: i.invoice_number }),
        href: `/finance/supplier-invoices/${i.id}`,
        status: i.status === "discrepancy" ? o.statusDiscrepancy : o.statusNeedsReview,
        overdue: Boolean(i.due_date && i.due_date < today),
      });
    }
  }

  if (hasPermission(ctx, "supplier_payment.record")) {
    const { data: invPay } = await supabase
      .from("supplier_invoices")
      .select("id, invoice_number, due_date")
      .eq("organization_id", ctx.organization.id)
      .in("status", ["approved_for_payment", "partially_paid"])
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(5);
    for (const i of invPay ?? []) {
      procActions.push({
        id: `pay-${i.id}`,
        label: format(o.labelPayInvoice, { number: i.invoice_number }),
        href: `/finance/supplier-invoices/${i.id}`,
        status: o.statusAwaitingPayment,
        overdue: Boolean(i.due_date && i.due_date < today),
      });
    }
  }

  if (hasPermission(ctx, "client_valuation.approve")) {
    const { data: valReview } = await supabase
      .from("client_valuations")
      .select("id, valuation_number, due_date, status")
      .eq("organization_id", ctx.organization.id)
      .in("status", ["internal_review"])
      .limit(5);
    for (const v of valReview ?? []) {
      procActions.push({
        id: v.id,
        label: format(o.labelReviewValuation, { number: v.valuation_number }),
        href: `/finance/client-valuations/${v.id}`,
        status: o.statusInternalReview,
        overdue: Boolean(v.due_date && v.due_date < today),
      });
    }
  }

  if (hasPermission(ctx, "client_valuation.submit")) {
    const { data: valSubmit } = await supabase
      .from("client_valuations")
      .select("id, valuation_number, status")
      .eq("organization_id", ctx.organization.id)
      .eq("status", "submitted")
      .limit(5);
    for (const v of valSubmit ?? []) {
      procActions.push({
        id: `vsub-${v.id}`,
        label: format(o.labelSendValuation, { number: v.valuation_number }),
        href: `/finance/client-valuations/${v.id}`,
        status: o.statusAwaitingClientSend,
        overdue: false,
      });
    }
  }

  if (hasPermission(ctx, "client_invoice.issue")) {
    const { data: invDraft } = await supabase
      .from("client_invoices")
      .select("id, invoice_number, due_date")
      .eq("organization_id", ctx.organization.id)
      .eq("status", "draft")
      .limit(5);
    for (const i of invDraft ?? []) {
      procActions.push({
        id: `cinv-${i.id}`,
        label: format(o.labelIssueInvoice, { number: i.invoice_number }),
        href: `/finance/client-invoices/${i.id}`,
        status: o.statusDraftReadyToIssue,
        overdue: false,
      });
    }
  }

  if (hasPermission(ctx, "client_payment.record")) {
    const { data: arCollect } = await supabase
      .from("client_invoices")
      .select("id, invoice_number, due_date, status")
      .eq("organization_id", ctx.organization.id)
      .in("status", ["issued", "partially_paid", "overdue"])
      .order("due_date", { ascending: true })
      .limit(5);
    for (const i of arCollect ?? []) {
      procActions.push({
        id: `ar-${i.id}`,
        label: format(o.labelCollect, { number: i.invoice_number }),
        href: `/finance/client-invoices/${i.id}`,
        status: i.status === "overdue" ? o.statusOverdue : o.statusAwaitingCollection,
        overdue: Boolean(i.due_date && i.due_date < today),
      });
    }
  }

  if (hasPermission(ctx, "variation.approve")) {
    const { data: voPending } = await supabase
      .from("variations")
      .select("id, vo_number, status")
      .eq("organization_id", ctx.organization.id)
      .in("status", ["under_review", "submitted", "negotiation"])
      .limit(5);
    for (const v of voPending ?? []) {
      procActions.push({
        id: v.id,
        label: format(o.labelApproveVariation, { number: v.vo_number }),
        href: `/finance/variations/${v.id}`,
        status: o.statusAwaitingApproval,
        overdue: false,
      });
    }
  }

  procActions.sort((a, b) => (a.overdue === b.overdue ? 0 : a.overdue ? -1 : 1));

  let recentNotes: Awaited<ReturnType<CoreRepository["listNotifications"]>> = [];
  if (hasPermission(ctx, "notification.read")) {
    try {
      recentNotes = await repo.listNotifications(ctx.userId, 5);
    } catch {
      logger.error("home notifications list failed", { code: "DATABASE" });
      recentNotes = [];
    }
  }

  return { dashboard, procActions, recentNotes, showOrgStats, canReadAudit };
});

function workKindLabel(kind: string, o: Dictionary["home"]["ops"]) {
  if (kind === "approval") return o.kindApproval;
  if (kind === "workflow") return o.kindWorkflow;
  if (kind === "rfi") return o.kindRfi;
  if (kind === "ncr") return o.kindNcr;
  if (kind === "document_revision") return o.kindDocumentRevision;
  if (kind === "inspection") return o.kindInspection;
  return o.kindAction;
}

function formatStamp(value: string, locale: Locale) {
  return new Date(value).toLocaleString(intlLocale(locale), { timeZone: "Asia/Riyadh" });
}

function WorkKindIcon({ kind }: { kind: string }) {
  const Icon =
    kind === "approval"
      ? Stamp
      : kind === "inspection"
        ? ClipboardCheck
        : kind === "ncr"
          ? Gauge
          : FileText;
  return <Icon className="h-4 w-4" aria-hidden />;
}

export async function HomeAttentionRail({ ctx }: { ctx: AuthContext }) {
  const [{ dashboard, procActions }, { t }] = await Promise.all([loadHomeOps(ctx), getI18n()]);
  const o = t.home.ops;
  const myApprovals = dashboard.pendingActions.filter((a) => a.kind === "approval").length;
  const attentionCount = myApprovals + procActions.length;
  const unread = dashboard.stats.unreadNotifications;
  const canOpenApprovals = hasPermission(ctx, "approval.review") || hasPermission(ctx, "approval.approve");

  return (
    <section data-testid="home-approvals" className="mt-surface-priority mt-tint-sand flex h-full min-w-0 flex-col p-4 md:p-5">
      <div className="flex items-center gap-2">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-warning/15 text-warning">
          <Stamp className="h-4 w-4" aria-hidden />
        </span>
        <p className="text-xs font-semibold text-warning">{o.attentionEyebrow}</p>
      </div>
      <p className="mt-4 text-3xl font-semibold tabular-nums leading-none text-ink">{attentionCount}</p>
      <p className="mt-2 text-sm font-semibold text-ink">{o.attentionTitle}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted">{o.attentionHint}</p>
      {canOpenApprovals ? (
        <Link
          href="/approvals"
          className="mt-4 inline-flex min-h-10 items-center justify-center rounded-[var(--radius-control)] bg-primary px-3 text-sm font-medium text-white duration-150 hover:bg-primary-hover"
        >
          {o.openApprovalsInbox}
        </Link>
      ) : null}
      {hasPermission(ctx, "notification.read") ? (
        <div className="mt-auto flex items-center justify-between gap-3 border-t border-line pt-4">
          <span className="text-xs text-muted">{o.unreadNotifications}</span>
          <Link href="/notifications" className="text-sm font-semibold tabular-nums text-primary duration-150 hover:underline">
            {unread}
          </Link>
        </div>
      ) : null}
    </section>
  );
}

export async function HomeOpsLower({ ctx }: { ctx: AuthContext }) {
  const [{ dashboard, procActions, recentNotes, canReadAudit }, { t, locale }] = await Promise.all([
    loadHomeOps(ctx),
    getI18n(),
  ]);
  const o = t.home.ops;

  const shortcuts = [
    hasPermission(ctx, "project.read")
      ? { href: "/projects", label: o.shortcutProjects, Icon: FolderKanban }
      : null,
    hasPermission(ctx, "leave.request") && ctx.employee
      ? { href: "/leave/new", label: o.shortcutLeaveRequest, Icon: CalendarPlus }
      : null,
    hasPermission(ctx, "reports.management.read")
      ? { href: "/management", label: o.shortcutCommandCenter, Icon: Gauge }
      : null,
    hasPermission(ctx, "reports.management.read")
      ? { href: "/management/analyst", label: o.shortcutAnalyst, Icon: Sparkles }
      : null,
    hasPermission(ctx, "document.read")
      ? { href: "/documents", label: o.shortcutDocuments, Icon: FileText }
      : null,
  ].filter((item): item is { href: string; label: string; Icon: typeof FolderKanban } => item !== null);

  const canOpenApprovals = hasPermission(ctx, "approval.review") || hasPermission(ctx, "approval.approve");
  const workEmpty = dashboard.pendingActions.length === 0 && procActions.length === 0;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-12 xl:gap-5">
      {shortcuts.length > 0 ? (
        <nav className="min-w-0 xl:col-span-12" aria-label={o.quickActions}>
          <h2 className="mt-section-title mb-2">{o.quickActions}</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
            {shortcuts.map((item) => {
              const Icon = item.Icon;
              return (
                <Link key={item.href} href={item.href} className="mt-action-tile">
                  <span className="mt-icon-well">
                    <Icon className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="text-sm font-semibold leading-snug text-ink">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </nav>
      ) : null}

      <section className="min-w-0 xl:col-span-12">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h2 className="mt-section-title">{o.myWorkToday}</h2>
          {canOpenApprovals ? (
            <Link href="/approvals" className="text-xs font-medium text-primary duration-150 hover:underline">
              {o.viewAll}
            </Link>
          ) : null}
        </div>
        {workEmpty ? (
          <p className="rounded-[var(--radius-control)] border border-dashed border-line bg-surface-muted px-4 py-6 text-center text-sm text-muted">
            {o.noPendingActions}
          </p>
        ) : (
          <ul className="mt-work-list mt-surface overflow-hidden p-1">
            {procActions.slice(0, 15).map((action) => (
              <li key={action.id}>
                <Link href={action.href} className="mt-work-row">
                  <span className="mt-icon-well">
                    <Wallet className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink" dir="auto">
                      {action.label}
                    </p>
                    <p className="text-[11px] leading-relaxed text-muted">
                      {o.financeProcurement} · {action.status}
                    </p>
                  </div>
                  {action.overdue ? (
                    <Badge tone="danger" className="shrink-0">
                      {o.overdue}
                    </Badge>
                  ) : null}
                </Link>
              </li>
            ))}
            {dashboard.pendingActions.map((action) => (
              <li key={action.id}>
                <Link href={pendingActionHref(action)} className="mt-work-row">
                  <span className="mt-icon-well">
                    <WorkKindIcon kind={action.kind} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink" dir="auto">
                      {pickLocalized(locale, action.title, action.titleEn) || action.title}
                    </p>
                    <p className="text-[11px] leading-relaxed text-muted">{workKindLabel(action.kind, o)}</p>
                  </div>
                  {action.isOverdue ? (
                    <Badge tone="danger" className="shrink-0">
                      {o.overdue}
                    </Badge>
                  ) : action.dueAt ? (
                    <Badge tone="neutral" className="shrink-0">
                      {o.withinDeadline}
                    </Badge>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="min-w-0 xl:col-span-6">
        <h2 className="mt-section-title mb-2">{o.recentNotifications}</h2>
        {!hasPermission(ctx, "notification.read") ? (
          <p className="text-sm text-muted">{o.notificationsPermission}</p>
        ) : recentNotes.length === 0 ? (
          <p className="text-sm text-muted">{o.noNotifications}</p>
        ) : (
          <ul className="space-y-1">
            {recentNotes.map((item) => {
              const href = resolveNotificationHref({
                type: item.type,
                entityType: item.entity_type,
                entityId: item.entity_id,
                storedHref: item.href,
                dedupKey: item.dedup_key,
              });
              const inner = (
                <div className="flex items-start gap-2.5 rounded-[var(--radius-control)] px-2 py-2">
                  <span
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${item.read_at ? "bg-line" : "bg-primary"}`}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <p
                      className={`truncate text-sm leading-relaxed text-ink ${item.read_at ? "" : "font-semibold"}`}
                      dir="auto"
                    >
                      {item.title}
                    </p>
                    <p className="text-[11px] text-muted">{formatStamp(item.created_at, locale)}</p>
                  </div>
                </div>
              );
              return (
                <li key={item.id}>
                  {href ? (
                    <NotificationNavLink
                      id={item.id}
                      href={href}
                      unread={!item.read_at}
                      className="block rounded-[var(--radius-control)] duration-150 hover:bg-surface-muted"
                    >
                      {inner}
                    </NotificationNavLink>
                  ) : (
                    inner
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {canReadAudit ? (
        <section className="min-w-0 xl:col-span-6">
          <h2 className="mt-section-title mb-2">{o.recentActivity}</h2>
          {dashboard.recentActivity.length === 0 ? (
            <p className="text-sm text-muted">{o.noActivity}</p>
          ) : (
            <ol className="relative space-y-0 border-s-2 border-primary/15 ps-4">
              {dashboard.recentActivity.map((item) => (
                <li key={item.id} className="relative pb-4 last:pb-0">
                  <span className="absolute top-1.5 -start-[21px] h-2.5 w-2.5 rounded-full border-2 border-surface bg-primary" aria-hidden />
                  <p className="text-sm font-semibold leading-relaxed text-ink">{auditActionLabel(item.action, locale)}</p>
                  <p className="text-[11px] text-muted">
                    {auditEntityLabel(item.entity_type, locale)} · {formatStamp(item.created_at, locale)}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </section>
      ) : null}
    </div>
  );
}

export async function HomeOpsPanels({ ctx }: { ctx: AuthContext }) {
  return (
    <>
      <HomeAttentionRail ctx={ctx} />
      <HomeOpsLower ctx={ctx} />
    </>
  );
}
