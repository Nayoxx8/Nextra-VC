const PREFIX = "";

export const buildBaseChannelName = (icon: string, name: string): string => {
  const safeIcon = icon.trim();
  const safeName = name.trim();
  return `${PREFIX}${safeIcon}${safeName}`;
};

export const resolveUniqueChannelName = (
  existingNames: Iterable<string>,
  baseName: string
): string => {
  const usedNames = new Set(existingNames);
  if (!usedNames.has(baseName)) {
    return baseName;
  }

  let suffix = 2;
  while (usedNames.has(`${baseName} ${suffix}`)) {
    suffix += 1;
  }

  return `${baseName} ${suffix}`;
};

export const resolveUniqueChannelNameExcludingSelf = (
  existingChannels: Iterable<{ id: string; name: string }>,
  baseName: string,
  selfChannelId: string
): string => {
  const siblingNames: string[] = [];
  for (const channel of existingChannels) {
    if (channel.id !== selfChannelId) {
      siblingNames.push(channel.name);
    }
  }

  return resolveUniqueChannelName(siblingNames, baseName);
};
