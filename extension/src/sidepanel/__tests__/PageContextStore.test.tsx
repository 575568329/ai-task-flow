// extension/src/sidepanel/__tests__/PageContextStore.test.tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { PageContextProvider, usePageContext } from '../PageContextStore.js';

let listeners: Array<(message: { type: string; payload?: unknown; message?: string }) => void> = [];

beforeEach(() => {
  listeners = [];
  (global as unknown as { chrome: unknown }).chrome = {
    runtime: {
      onMessage: {
        addListener: (l: (m: unknown) => void) => listeners.push(l as never),
        removeListener: (l: (m: unknown) => void) => {
          listeners = listeners.filter((x) => x !== (l as never));
        },
      },
    },
  };
});

function Probe() {
  const { pageContext, error } = usePageContext();
  return <div>{pageContext ? pageContext.sourceUrl : 'empty'}|{error ?? 'no-err'}</div>;
}

describe('PageContextStore', () => {
  it('should store page context on CAPTURE_RESULT message', () => {
    const { getByText } = render(
      <PageContextProvider>
        <Probe />
      </PageContextProvider>,
    );
    expect(getByText('empty|no-err')).toBeTruthy();
    act(() => {
      listeners.forEach((l) =>
        l({ type: 'CAPTURE_RESULT', payload: { sourceUrl: 'https://x.com/p', title: 't', text: 'x' } }),
      );
    });
    expect(getByText('https://x.com/p|no-err')).toBeTruthy();
  });

  it('should set error on CAPTURE_ERROR message', () => {
    const { getByText } = render(
      <PageContextProvider>
        <Probe />
      </PageContextProvider>,
    );
    act(() => {
      listeners.forEach((l) => l({ type: 'CAPTURE_ERROR', message: '抓取失败' }));
    });
    expect(getByText('empty|抓取失败')).toBeTruthy();
  });
});
