// Only known app pages may be used as OAuth destinations.
export function safeReturnTo(value: unknown): string {
  return value === '/?page=short' ? '/?page=short' : '/';
}
export function readLoginContext(value: string | null | undefined): {returnTo:string; origin?:string} {
  try {
    const parsed = JSON.parse(value || '{}');
    return {returnTo: safeReturnTo(parsed?.returnTo), origin: typeof parsed?.origin === 'string' ? parsed.origin : undefined};
  } catch { return {returnTo: '/'}; }
}
