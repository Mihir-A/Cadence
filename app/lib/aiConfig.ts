const isEnabledFlag = (value: string | undefined) =>
  value === "true" || value === "1";

export const isAiCallsDisabled = () =>
  isEnabledFlag(
    process.env.AI_CALLS_DISABLED ??
      process.env.NEXT_PUBLIC_AI_CALLS_DISABLED,
  );
