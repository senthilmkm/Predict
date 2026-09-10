import React from 'react';
import { fireEvent, render, waitFor, cleanup } from './test-utils';
import {
  MemoryKeyValueStore,
  setKeyValueStore,
  setSecureStore,
} from '../../src/platform/storage';
import { DisclaimerReacceptScreen } from '../../src/screens/DisclaimerReacceptScreen';
import {
  hasAcceptedCurrentDisclaimer,
  listAutoTradeRiskAcceptances,
} from '../../src/storage/riskAcceptance';
import { DISCLAIMER_VERSION } from '../../src/config/disclaimers';

beforeEach(() => {
  setKeyValueStore(new MemoryKeyValueStore());
  setSecureStore(new MemoryKeyValueStore());
});

afterEach(() => cleanup());

describe('DisclaimerReacceptScreen', () => {
  test('requires checkbox then records current disclaimer version', async () => {
    const onAccepted = jest.fn();
    const s = await render(<DisclaimerReacceptScreen onAccepted={onAccepted} />);
    expect(s.getByTestId('screen-disclaimer-reaccept')).toBeTruthy();
    expect(await hasAcceptedCurrentDisclaimer()).toBe(false);
    await fireEvent.press(s.getByTestId('btn-disclaimer-reaccept'));
    expect(onAccepted).not.toHaveBeenCalled();
    await fireEvent(s.getByTestId('switch-disclaimer-reaccept'), 'valueChange', true);
    await fireEvent.press(s.getByTestId('btn-disclaimer-reaccept'));
    await waitFor(() => expect(onAccepted).toHaveBeenCalled());
    expect(await hasAcceptedCurrentDisclaimer()).toBe(true);
    const log = await listAutoTradeRiskAcceptances();
    expect(log[0].source).toBe('disclaimer_reaccept');
    expect(log[0].disclaimerVersion).toBe(DISCLAIMER_VERSION);
  });
});
