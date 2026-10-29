import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { DomainEvent } from "@/lib/events/types";
import { logger } from "@/lib/logger";
import { createNotificationService, NotificationService } from "@/server/services/notification.service";

export class EventService {
  private readonly notifications: NotificationService;

  constructor(private readonly supabase: SupabaseClient) {
    this.notifications = createNotificationService(supabase);
  }

  async publish(event: DomainEvent): Promise<void> {
    const { error } = await this.supabase.rpc("emit_domain_event", {
      p_organization_id: event.organizationId,
      p_event_type: event.type,
      p_entity_type: event.entityType,
      p_entity_id: event.entityId,
      p_payload: event.payload,
      p_correlation_id: event.correlationId,
    });

    if (error) {
      logger.error("Failed to persist domain event", { type: event.type, message: error.message });
    }

    await this.dispatch(event);
  }

  private async dispatch(event: DomainEvent): Promise<void> {
    if (event.type === "approval.created" && event.actorId) {
      await this.notifications.notify({
        organizationId: event.organizationId,
        recipientProfileId: String(event.payload.recipientProfileId ?? event.actorId),
        type: event.type,
        title: "طلب موافقة جديد",
        message: "يوجد طلب موافقة يحتاج إلى إجراء.",
        titleEn: "New approval request",
        messageEn: "An approval request needs your action.",
        entityType: event.entityType,
        entityId: event.entityId,
        priority: "high",
      });
    }
  }
}
