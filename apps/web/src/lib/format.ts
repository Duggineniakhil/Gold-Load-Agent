const rupees = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

/** Whole rupees for display. Paise are dropped, never rounded up, so a loan is never overstated. */
export function formatRupees(paise: number): string {
  return rupees.format(Math.trunc(paise / 100));
}

export function formatDate(iso: string, withYear = true): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'Asia/Kolkata',
  }).format(new Date(iso));
}

/** The 409 message the spec asks for: "You already applied on 3 Oct, application GL-1042." */
export function duplicateMessage(existing: { applicationId: string; createdAt: string }): string {
  return `You already applied on ${formatDate(existing.createdAt, false)}, application ${existing.applicationId}.`;
}
