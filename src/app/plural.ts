// "1 tab" / "3 tabs": the one counter every surface (menus, prompts, quick launch rows) reads
export function pluralize(count: number, noun: string, plural = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : plural}`;
}
