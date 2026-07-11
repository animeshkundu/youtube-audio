import { describe, expect, it } from 'vitest';

import { parseLrc } from '../../src/shared/lyrics';

describe('parseLrc', () => {
  it('parses, sorts, and expands timed lyric lines', () => {
    expect(parseLrc('[00:12.50]Second\n[00:01.25][00:03.500]First\n[ar:Fixture]\ninvalid')).toEqual(
      [
        { time: 1.25, text: 'First' },
        { time: 3.5, text: 'First' },
        { time: 12.5, text: 'Second' },
      ]
    );
  });

  it('supports minute values beyond an hour and skips empty or invalid lines', () => {
    expect(parseLrc('[75:02.05]Long mix\n[00:99.00]Bad\n[00:02.00]   ')).toEqual([
      { time: 4502.05, text: 'Long mix' },
    ]);
    expect(parseLrc('')).toEqual([]);
  });
});
