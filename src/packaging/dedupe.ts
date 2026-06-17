export function dedupeObjects(
  objects: Array<{ id: string }>,
): Array<{ id: string }> {
  const seen = new Set<string>();
  return objects.filter((obj) => {
    if (seen.has(obj.id)) {
      return false;
    }
    seen.add(obj.id);
    return true;
  });
}
