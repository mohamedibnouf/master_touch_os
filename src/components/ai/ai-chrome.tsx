export function AiSparkle({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden
      className={className ?? "h-3.5 w-3.5 text-primary"}
    >
      <path
        fill="currentColor"
        d="M8 1.2 8.9 6.1 13.8 7 8.9 7.9 8 12.8 7.1 7.9 2.2 7 7.1 6.1 8 1.2Z"
      />
    </svg>
  );
}

export function AiDisclaimer({ className }: { className?: string }) {
  return (
    <p className={className ?? "text-xs text-muted"}>
      التحليل الذكي أداة مساعدة لاتخاذ القرار وقد يحتاج إلى مراجعة بشرية.
    </p>
  );
}
