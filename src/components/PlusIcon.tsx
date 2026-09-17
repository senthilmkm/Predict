import React from 'react';
import { TradeGlyph } from './TradeActionOrb';

/** @deprecated Prefer TradeActionOrb — kept for tests/import compatibility. */
export function PlusIcon({
  color,
  size = 18,
  testID,
}: {
  color: string;
  size?: number;
  testID?: string;
}) {
  return <TradeGlyph glyph="plus" color={color} size={size} testID={testID} />;
}
