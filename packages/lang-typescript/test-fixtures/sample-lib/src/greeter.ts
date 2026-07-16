/**
 * Greets a user by name.
 */
export function greet(name: string): string {
  return `Hello, ${formatName(name)}!`;
}

// Internal helper — must never surface as a public symbol.
function formatName(name: string): string {
  return name.trim();
}
