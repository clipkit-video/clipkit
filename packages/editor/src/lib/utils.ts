// Standard shadcn `cn` helper — merges Tailwind classes intelligently.
// `clsx` handles falsy values + arrays + objects; `twMerge` resolves
// conflicts (e.g. `px-2` then `px-4` keeps the second one).

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
