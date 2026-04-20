export type VoiceOccupant = {
  isBot: boolean;
};

export const shouldDeleteGeneratedChannel = (
  occupants: VoiceOccupant[]
): boolean => {
  if (occupants.length === 0) {
    return true;
  }

  return occupants.every((occupant) => occupant.isBot);
};
