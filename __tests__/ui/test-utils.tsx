import React from 'react';
import {
  render as rtlRender,
  fireEvent,
  waitFor,
  cleanup,
  act,
} from '@testing-library/react-native';

export async function render(ui: React.ReactElement) {
  const result = await rtlRender(ui);
  return result;
}

export { fireEvent, waitFor, cleanup, act };
